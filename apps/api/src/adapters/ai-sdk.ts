import type { RunBody, StandardSession, UIMessage } from 'agentview/apiTypes';
import { log } from '../logger';
import { isRunFinished, RunTerminationError, type FastPatchOp } from '../runs';
import { getSessionStatusFields } from '../sessions';
import { type Adapter } from './adapters';
import { expireAISDKStream, publishAISDKStreamEvent } from './ai-sdk-stream';

interface AISDKChunk {
    type: string;
    [key: string]: any;
}

/**
 * Parse an AI SDK SSE stream.
 * AI SDK uses `data: <json>\n\n` format (no `event:` field).
 * Stream ends with `data: [DONE]\n\n`.
 */
async function* parseAISDKStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string, void, unknown> {

    const decoder = new TextDecoder();

    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();

        if (done) {
            // Process remaining buffer
            if (buffer.trim()) {
                const lines = buffer.split('\n\n');
                for (const block of lines) {
                    const chunk = parseDataLine(block.trim());
                    if (chunk) yield chunk;
                }
            }
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';

        for (const block of blocks) {
            const trimmed = block.trim();
            if (!trimmed) continue;
            const chunk = parseDataLine(trimmed);
            if (chunk) yield chunk;
        }
    }
}

function parseDataLine(line: string): string | null {
    if (!line.startsWith('data: ')) return null;
    const payload = line.substring(6).trim();

    return payload;
    // if (payload === '[DONE]') return null;
    // try {
    //     return JSON.parse(payload);
    // } catch {
    //     throw new AgentAPIError({
    //         message: 'Error parsing AI SDK stream chunk (invalid JSON)',
    //         data: payload,
    //     });
    // }
}

/**
 * Counts consecutive 'text' items from the end of the emitted item types array.
 * This determines how many items should be marked as output on completion.
 */
function computeOutputItemCount(emittedItemTypes: string[]): number {
    let count = 0;
    for (let i = emittedItemTypes.length - 1; i >= 0; i--) {
        if (emittedItemTypes[i] === 'text') {
            count++;
        } else {
            break;
        }
    }
    return Math.max(count, 1); // at least 1
}

async function callAgentAPIAISDK(
    body: RunBody,
    url: string,
    send: (event: { name: string, data: any }) => Promise<void>,
    signal?: AbortSignal
): Promise<void> {
    const currentRun = body.session.runs[body.session.runs.length - 1];
    // setContext({ runId: currentRun.id });
    log.info('[ai-sdk] start');

    /**
     * Build AI SDK request body
     */
    const messages = sessionToUIMessages(body.session);

    // For channel-based runs: we'll create run from incoming channel messages
    const incomingMessages = currentRun.channelMessages.filter(cm => cm.direction === 'incoming');
    const isChannelRun = incomingMessages.length > 0;

    /**
     * Fetch the agent API response
     */
    let response: Response | undefined = undefined;

    log.info('[ai-sdk] fetch');

    let fetchError: string | undefined = undefined;

    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ messages, session: body.session }),
            signal,
        });

    } catch (error: unknown) {
        /**
         * If we get error while fetching we always send back response and discard the run.
         * It doesn't matter whether it's termination error or not.
         * Basically if fetch is unsuccessful, run won't exist.
         */
        if (error instanceof RunTerminationError) {
            if (error.reason.status === 'discarded') { // If run was discarded we don't need to discard it again (but response should be sent for sanity check)
                log.info('[ai-sdk] fetch interrupted, run discarded');
                return;
            }
            else {
                fetchError = error.message;
            }
        } else if (error instanceof TypeError) {
            fetchError = error.message ?? 'Connection error';
        } else {
            throw error; // those are unexpected errors
        }

        log.info('[ai-sdk] fetch interrupted: ' + fetchError);

        await send({
            name: 'run.discard',
            data: {
                message: fetchError ?? 'Internal error'
            },
        });

        await publishAISDKStreamEvent(currentRun.id, '[RESPONSE]' + JSON.stringify({ // AgentViewError format
            status: 400,
            headers: {
                'Content-Type': 'application/json',
            },
            error: JSON.stringify({
                message: fetchError
            })
        }));

        return;

    } finally {
        await expireAISDKStream(currentRun.id);
    }

    /**
     * Response is there.
     * Let's check for error responses or no response body
     * If error, we send upstream error response to the client.
     */
    let responseError: string | undefined = undefined;

    if (!response.body) {
        responseError = 'No response body';
    }
    else if (!response.ok) {
        try {
            responseError = await response.text();
        } catch {
            responseError = 'Error reading response body';
        }
    }

    const headers = {
        ...Object.fromEntries(response.headers.entries()),
        'X-Upstream-Response': "true", // signals it's original upstream response, not agentview middleware response
        'Access-Control-Expose-Headers': 'x-upstream-response'
    }

    if (responseError !== undefined) {
        log.info('[ai-sdk] error response, discarding run: ' + responseError);

        await send({
            name: 'run.discard',
            data: {
                message: responseError
            },
        });

        await publishAISDKStreamEvent(currentRun.id, '[RESPONSE]' + JSON.stringify({
            status: response.status,
            headers,
            error: responseError
        }));

        return;
    }

    /**
     * Let's read the response body SSE stream
     */

    // send response first

    let finalOp: FastPatchOp | undefined = undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined = undefined;

    try {
        log.info('[ai-sdk] streaming started');

        await send({
            name: 'run.accept',
            data: {},
        });

        await publishAISDKStreamEvent(currentRun.id, '[RESPONSE]' + JSON.stringify({
            status: response.status,
            headers
            // no error -> app expects stream
        }));

        // Parse AI SDK stream and convert to run.patch events
        const textBuffers = new Map<string, string>();
        const reasoningBuffers = new Map<string, string>();
        const toolStates = new Map<string, { toolName: string; inputText: string; input?: any }>();
        let messageMetadata: any = undefined;
        const emittedItemTypes: string[] = [];
        const outputTexts: string[] = [];

        /**
         * 1. We first send event to "our system" (yield), and it's blocking
         * 2. Only then we send event to stream. 
         */

        reader = response.body!.getReader();

        for await (const data of parseAISDKStream(reader)) {
            if (data === '[DONE]') { // done is end of stream. We send it ourselves in the finally block.
                log.debug('[DONE] received');
                break;
            }

            // transforms
            const chunk = JSON.parse(data) as AISDKChunk;
            if (chunk.type === 'start' && !chunk.messageId) {
                chunk.messageId = currentRun.id;// + '-input';
            }

            switch (chunk.type) {
                case 'start': {
                    if (chunk.messageMetadata !== undefined) {
                        messageMetadata = chunk.messageMetadata;
                    }
                    break;
                }

                case 'text-start': {
                    textBuffers.set(chunk.id, '');
                    break;
                }

                case 'text-delta': {
                    const current = textBuffers.get(chunk.id) ?? '';
                    textBuffers.set(chunk.id, current + chunk.delta);
                    break;
                }

                case 'text-end': {
                    const text = textBuffers.get(chunk.id) ?? '';
                    textBuffers.delete(chunk.id);
                    emittedItemTypes.push('text');
                    outputTexts.push(text);

                    log.debug('[ai-sdk] fast.patch for "text"')
                    await send({
                        name: 'fast.patch',
                        data: { type: 'item', content: { type: 'text', text } },
                    });
                    break;
                }

                case 'reasoning-start': {
                    reasoningBuffers.set(chunk.id, '');
                    break;
                }

                case 'reasoning-delta': {
                    const current = reasoningBuffers.get(chunk.id) ?? '';
                    reasoningBuffers.set(chunk.id, current + chunk.delta);
                    break;
                }

                case 'reasoning-end': {
                    const text = reasoningBuffers.get(chunk.id) ?? '';
                    reasoningBuffers.delete(chunk.id);
                    emittedItemTypes.push('reasoning');

                    log.debug('[ai-sdk] run.patch for "reasoning"')
                    await send({
                        name: 'fast.patch',
                        data: { type: 'item', content: { type: 'reasoning', text } },
                    });
                    break;
                }

                case 'tool-input-start': {
                    toolStates.set(chunk.toolCallId, {
                        toolName: chunk.toolName,
                        inputText: '',
                    });
                    break;
                }

                case 'tool-input-delta': {
                    const state = toolStates.get(chunk.toolCallId);
                    if (state) {
                        state.inputText += chunk.inputTextDelta;
                    }
                    break;
                }

                case 'tool-input-available': {
                    const state = toolStates.get(chunk.toolCallId);
                    if (state) {
                        state.input = chunk.input;
                    }
                    break;
                }

                case 'tool-output-available': {
                    const state = toolStates.get(chunk.toolCallId);
                    if (state) {
                        emittedItemTypes.push('tool-call');
                        log.debug('[ai-sdk] run.patch for "tool-output-available"')
                        await send({
                            name: 'fast.patch',
                            data: { type: 'item', content: { type: 'tool-call', toolCallId: chunk.toolCallId, toolName: state.toolName, state: 'output-available', input: state.input, output: chunk.output } },
                        });
                        toolStates.delete(chunk.toolCallId);
                    }
                    break;
                }

                case 'tool-output-error': {
                    const state = toolStates.get(chunk.toolCallId);
                    if (state) {
                        emittedItemTypes.push('tool-call');
                        log.debug('[ai-sdk] run.patch for "tool-output-error"')
                        await send({
                            name: 'fast.patch',
                            data: { type: 'item', content: { type: 'tool-call', toolCallId: chunk.toolCallId, toolName: state.toolName, state: 'output-error', input: state.input, errorText: chunk.errorText } },
                        });
                        toolStates.delete(chunk.toolCallId);
                    }
                    break;
                }

                case 'finish': {
                    if (chunk.messageMetadata !== undefined) {
                        messageMetadata = chunk.messageMetadata;
                    }
                    const outputCount = computeOutputItemCount(emittedItemTypes);

                    finalOp = {
                        type: 'complete',
                        outputItemCount: outputCount,
                        channelReply: isChannelRun ? { text: outputTexts.filter(Boolean).join('\n\n') } : undefined,
                    };

                    break;
                }

                case 'error': {
                    finalOp = {
                        type: 'fail',
                        failReason: {
                            message: chunk.errorText ?? 'Unknown error from AI SDK stream',
                        },
                    };

                    break;
                }

                case 'data-session-state': {
                    emittedItemTypes.push('data');
                    log.debug('[ai-sdk] run.patch for state')
                    await send({
                        name: 'run.patch',
                        data: {
                            state: chunk.data,
                        },
                    });
                    break;
                }

                // Ignore other events: start-step, finish-step, source-url, file, etc.
                default:
                    if (chunk.type.startsWith('data-')) {
                        log.debug(`[ai-sdk] run.patch for "${chunk.type}"`)
                        emittedItemTypes.push('data');
                        await send({
                            name: 'run.patch',
                            data: {
                                items: [{ type: chunk.type, data: chunk.data }],
                            },
                        });
                    }
                    log.trace(chunk, 'ignored chunk');
                    break;
            }

            // we just mirror native chunks to the stream.
            log.trace(chunk, 'stream event')
            await publishAISDKStreamEvent(currentRun.id, JSON.stringify(chunk));
        }

        if (!finalOp) {
            log.info('[ai-sdk] stream ended incomplete');
            finalOp = {
                type: 'fail',
                failReason: {
                    message: 'Agent stream ended without completing',
                },
            };
        }
        else {
            log.info('[ai-sdk] stream ended complete');
        }

        /**
         * This is the moment when we send final run.patch that will close the run internally.
         * Closing the run triggers [DONE] event on the stream, which will trigger `signal` to abort (with "run.finished" error code).
         * That's why after this command we must only clean up and not touch `reader` anymore.
         */
        log.debug('[ai-sdk] run.patch for completion')

        await send({
            name: 'fast.patch',
            data: finalOp,
        });

        // await publishAISDKStreamEvent(currentRun.id, JSON.stringify({ type: 'data-session-patch', data: { status: finalOp.status, failReason: finalOp.failReason } }));

    } catch (error: unknown) {

        // Run terminated signal (we have 5s to clean up)
        if (error instanceof RunTerminationError) {
            if (error.reason.status === 'discarded') {
                // this can happen for channels, when new messages pops in.
                // We don't need to cleanup this, since discard is not a SIGNAL, the run is already closed. We can just safely return
                log.info('[ai-sdk] run discarded, returning')
                return;
            }
            else if (error.reason.status === 'cancelled') {
                finalOp = {
                    type: 'cancel',
                };
            }
            else {
                finalOp = {
                    type: 'fail',
                    failReason: {
                        message: error.message ?? 'Connection error',
                    },
                };
            }
        }
        else if (error instanceof TypeError) {
            finalOp = {
                type: 'fail',
                failReason: {
                    message: error.message ?? 'Connection error',
                },
            };
        }
        else { // streaming while
            finalOp = {
                type: 'fail',
                failReason: {
                    message: error instanceof Error ? error.message : String(error),
                },
            };
        }

        if (!finalOp) {
            throw new Error(`[ai-sdk] unreachable, no finalOp set`);
        }

        log.info(`[ai-sdk] error while streaming. finalOp: ${JSON.stringify(finalOp)}`);

        await send({
            name: 'fast.patch',
            data: finalOp,
        });

        if (finalOp.type === 'cancel') {
            await publishAISDKStreamEvent(currentRun.id, JSON.stringify({ type: 'abort', reason: 'Cancelled by user' }));
        }
        else {
            await publishAISDKStreamEvent(currentRun.id, JSON.stringify({ type: 'error', errorText: finalOp.failReason?.message ?? 'Unknown error' }));
        }

        // if (!finalOp) {
        //     throw new Error(`[ai-sdk] unreachable, no finalOp set`);
        // }

        // log.info(`[ai-sdk] error while streaming, status: ${finalOp.status}, failReason: ${finalOp.failReason?.message ?? 'Unknown error'}`);

        // await send({
        //     name: 'run.patch',
        //     data: finalOp,
        // });

        // if (finalOp.status === 'cancelled') {
        //     await publishAISDKStreamEvent(currentRun.id, JSON.stringify({ type: 'abort', reason: 'Cancelled by user' }));
        // }
        // else {
        //     await publishAISDKStreamEvent(currentRun.id, JSON.stringify({ type: 'error', errorText: finalOp.failReason?.message ?? 'Unknown error' }));
        // }

    } finally { // best effort cleanup
        await reader?.cancel().catch(() => { }); // reader is potentially in error state ([done] already delivered)

        try {
            await publishAISDKStreamEvent(currentRun.id, "[DONE]");
            await expireAISDKStream(currentRun.id);
        } catch (e) { }

    }
}


function sessionToUIMessages(session: StandardSession): UIMessage[] {
    const messages: UIMessage[] = [];

    for (const run of session.runs) {
        if (run.agentRef?.adapter !== "ai-sdk") {
            throw new Error("[sessionToUIMessages] Run is not an AI SDK run");
        }

        const items = run.sessionItems;
        if (items.length === 0) continue;

        // Split items by type field, with positional fallback for NULL type
        const hasTypedItems = items.some(item => item.type != null);
        const inputItems = hasTypedItems
            ? items.filter(item => item.type === 'input')
            : [items[0]];
        const outputItems = hasTypedItems
            ? items.filter(item => item.type === 'output' || item.type === 'step')
            : items.slice(1);

        // Squash all input items into one user message  by collecting all their parts
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

        // For in_progress runs (current run), only include the user message
        if (!isRunFinished(run)) {
            continue;
        }

        // Output items → assistant message parts
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
