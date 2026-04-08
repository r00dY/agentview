import http, { IncomingMessage } from 'node:http';
import https from 'node:https';
import type { RunBody, StandardSession, UIMessage } from 'agentview/apiTypes';
import { log } from '../logger';
import { isRunFinished, RunTerminationError } from '../runs';
import { getSessionStatusFields } from '../sessions';
import { type Adapter } from './adapters';
import { expireAISDKStream, publishAISDKStreamEvent } from './ai-sdk-stream';

function flatHeaders(res: IncomingMessage): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) {
        if (v != null) out[k] = Array.isArray(v) ? v.join(', ') : v;
    }
    return out;
}

function extractDataPayload(block: string): string | null {
    for (const line of block.split('\n')) {
        if (line.startsWith('data: ')) return line.substring(6);
        if (line.startsWith('data:')) return line.substring(5);
    }
    return null;
}

function callAgentAPIAISDK(
    body: RunBody,
    url: string,
    send: (event: { name: string, data: any }) => Promise<void>,
    signal?: AbortSignal
): Promise<void> {
    const currentRun = body.session.runs[body.session.runs.length - 1];
    const runId = currentRun.id;
    log.info('[ai-sdk] start');

    const messages = sessionToUIMessages(body.session);
    const requestBody = JSON.stringify({ messages, session: body.session });

    log.info('[ai-sdk] fetch');

    return new Promise<void>((resolve) => {
        const mod = url.startsWith('https') ? https : http;

        const req = mod.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody),
            },
            signal,
        }, (res) => {
            const headers = {
                ...flatHeaders(res),
                'X-Upstream-Response': 'true',
                'Access-Control-Expose-Headers': 'x-upstream-response',
            };

            // Error response — collect body and discard run
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                let errorBody = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { errorBody += chunk; });
                res.on('end', () => {
                    log.info('[ai-sdk] error response, discarding run: ' + errorBody);
                    send({ name: 'run.discard', data: { message: errorBody } });
                    publishAISDKStreamEvent(runId, '[RESPONSE]' + JSON.stringify({
                        status: res.statusCode ?? 0,
                        headers,
                        error: errorBody,
                    }));
                    expireAISDKStream(runId);
                    resolve();
                });
                return;
            }

            // Success — raw stream ingestion
            log.info('[ai-sdk] streaming started');
            send({ name: 'run.accept', data: {} });
            publishAISDKStreamEvent(runId, '[RESPONSE]' + JSON.stringify({
                status: res.statusCode,
                headers,
            }));

            let buffer = '';
            res.setEncoding('utf8');

            res.on('readable', () => {
                let chunk: string | null;
                while ((chunk = res.read() as string | null) !== null) {
                    buffer += chunk;

                    const blocks = buffer.split('\n\n');
                    buffer = blocks.pop()!;

                    for (const block of blocks) {
                        const payload = extractDataPayload(block);
                        if (!payload || payload === '[DONE]') continue;

                        // log.trace(JSON.parse(payload)); // simulate parse overhead
                        publishAISDKStreamEvent(runId, payload);
                    }
                }
            });

            res.on('end', () => {
                if (buffer) {
                    const payload = extractDataPayload(buffer);
                    if (payload && payload !== '[DONE]') {
                        publishAISDKStreamEvent(runId, payload);
                    }
                }
                log.info('[ai-sdk] stream ingestion done');
                publishAISDKStreamEvent(runId, '[DONE]');
                expireAISDKStream(runId);
                resolve();
            });

            res.on('error', (err) => {
                log.info('[ai-sdk] stream error: ' + err.message);
                if (err instanceof RunTerminationError && err.reason.status === 'cancelled') {
                    publishAISDKStreamEvent(runId, JSON.stringify({ type: 'abort', reason: 'Cancelled by user' }));
                } else {
                    publishAISDKStreamEvent(runId, JSON.stringify({ type: 'error', errorText: err.message }));
                }
                publishAISDKStreamEvent(runId, '[DONE]');
                expireAISDKStream(runId);
                resolve();
            });
        });

        req.on('error', (error) => {
            if (error instanceof RunTerminationError && error.reason.status === 'discarded') {
                log.info('[ai-sdk] fetch interrupted, run discarded');
                resolve();
                return;
            }

            const msg = error.message ?? String(error);
            log.info('[ai-sdk] fetch interrupted: ' + msg);

            send({ name: 'run.discard', data: { message: msg } });
            publishAISDKStreamEvent(runId, '[RESPONSE]' + JSON.stringify({
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                error: JSON.stringify({ message: msg }),
            }));
            expireAISDKStream(runId);
            resolve();
        });

        req.end(requestBody);
    });
}


function sessionToUIMessages(session: StandardSession): UIMessage[] {
    const messages: UIMessage[] = [];

    for (const run of session.runs) {
        if (run.agentRef?.adapter !== "ai-sdk") {
            throw new Error("[sessionToUIMessages] Run is not an AI SDK run");
        }

        const items = run.sessionItems;
        if (items.length === 0) continue;

        const hasTypedItems = items.some(item => item.type != null);
        const inputItems = hasTypedItems
            ? items.filter(item => item.type === 'input')
            : [items[0]];
        const outputItems = hasTypedItems
            ? items.filter(item => item.type === 'output' || item.type === 'step')
            : items.slice(1);

        const userParts: any[] = [];
        for (const inputItem of inputItems) {
            const inputContent = inputItem.content;
            if (Array.isArray(inputContent.parts)) {
                userParts.push(...inputContent.parts);
            } else {
                userParts.push({ type: 'text', text: typeof inputContent === 'string' ? inputContent : (inputContent.content ?? JSON.stringify(inputContent)) });
            }
        }

        const firstInputItem = inputItems[0];
        const userMessage: UIMessage = {
            id: firstInputItem.id,
            role: 'user',
            parts: userParts,
        };
        if (firstInputItem.content?.metadata) {
            userMessage.metadata = firstInputItem.content.metadata;
        }
        messages.push(userMessage);

        if (!isRunFinished(run)) {
            continue;
        }

        if (outputItems.length > 0) {
            const assistantParts = outputItems.map(item => item.content);
            const assistantMessage: UIMessage = {
                id: run.id,
                role: 'assistant',
                parts: assistantParts,
            };
            if (run.metadata) {
                assistantMessage.metadata = run.metadata;
            }
            messages.push(assistantMessage);
        }
    }

    return messages;
}


export const aiSDKAdapter = {
    callAgent: callAgentAPIAISDK,
    enrichSession: (session: StandardSession) => {
        const messages = sessionToUIMessages(session);
        const statusFields = getSessionStatusFields(session);
        return {
            messages,
            ...statusFields,
            resume: statusFields.status === 'in_progress',
        }
    },
    createDefaultInputForChannelMessages: (incomingMessages: any[], runId: string) => {
        return {
            id: `${runId}-input`,
            role: 'user',
            parts: incomingMessages.map(cm => ({ type: 'text', text: cm.text ?? '' })),
        };
    }
} satisfies Adapter;
