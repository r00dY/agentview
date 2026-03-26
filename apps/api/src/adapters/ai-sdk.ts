import type { RunBody } from 'agentview/apiTypes';
import { type AgentAPIEvent } from '../agentApi';
import { expireAISDKStream, publishAISDKStreamEvent } from './ai-sdk-stream';
import type { StandardSession, UIMessage } from 'agentview/apiTypes';
import { type Adapter } from './adapters';
import { getSessionStatusFields } from '../sessions';

interface AISDKChunk {
    type: string;
    [key: string]: any;
}

/**
 * Parse an AI SDK SSE stream.
 * AI SDK uses `data: <json>\n\n` format (no `event:` field).
 * Stream ends with `data: [DONE]\n\n`.
 */
async function* parseAISDKStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, unknown> {
    const reader = body.getReader();
    const decoder = new TextDecoder();

    try {
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
    } finally {
        reader.releaseLock();
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

async function* callAgentAPIAISDK(
    body: RunBody,
    url: string,
    signal?: AbortSignal
): AsyncGenerator<AgentAPIEvent, void, unknown> {
    const currentRun = body.session.runs[body.session.runs.length - 1];
    console.log(`[ai-sdk][${currentRun.id}] start`);

    /**
     * Build AI SDK request body
     */
    const messages = sessionToUIMessages(body.session);

    // For channel-based runs: create input from incoming channel messages
    const incomingMessages = currentRun.channelMessages.filter(cm => cm.direction === 'incoming');
    const hasInput = currentRun.sessionItems.some(si => si.type === 'input');
    const isChannelRun = incomingMessages.length > 0 && !hasInput;

    if (isChannelRun) {
        const inputContent = {
            role: 'user',
            parts: incomingMessages.map(cm => ({ type: 'text', text: cm.text ?? '' })),
        };
        yield { name: 'run.set_input', data: inputContent };
        messages.push({
            id: currentRun.id + '-input',
            role: 'user',
            parts: inputContent.parts,
        });
    }

    /**
     * Fetch the agent API response
     */
    let response: Response | undefined = undefined;
    console.log(`[ai-sdk][${currentRun.id}] fetching`);

    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ messages, session: body.session }),
            signal,
        });

    } catch (error: unknown) { // Here we only handle fetch errors, other errors will be handled later
        if (error instanceof Error && error.name === 'AbortError') {
            // if aborted during fetching, we don't have to yield anything since the run is already properly terminated in agentview
            // but we'll need to properly handle opened stream.

            console.log('[ai-sdk] aborted while fetching. Sending [RESPONSE] and [DONE] events to the stream')
            await publishAISDKStreamEvent(currentRun.id, '[RESPONSE]' + JSON.stringify({
                status: 400,
                headers: {}
            }));
            await publishAISDKStreamEvent(currentRun.id, JSON.stringify({ type: 'abort', reason: 'Cancelled by user' }));
            await publishAISDKStreamEvent(currentRun.id, "[DONE]");
            return;
        }
        else {
            let message: string;

            if (error instanceof TypeError) { // node fetch error
                message = (error as any).cause?.message ?? error.message ?? 'Fetch error';
            }
            else {
                message = (error as any)?.message ?? 'Unknown error';
            }

            yield {
                name: 'run.patch',
                data: {
                    status: 'failed',
                    failReason: {
                        message
                    },
                },
            };

            await publishAISDKStreamEvent(currentRun.id, '[RESPONSE]' + JSON.stringify({
                status: 400,
                headers: {},
                error: message
            }));
            return;
        }
    } finally {
        await expireAISDKStream(currentRun.id);
    }

    /**
     * Response is there.
     * Let's check for error responses or no response body
     */
    let error: string | undefined = undefined;
    if (!response.body) {
        error = 'No response body';
    }
    else if (!response.ok) {
        try {
            error = await response.text();
        } catch (error: unknown) {
            error = 'Error reading response body';
        }
    }

    if (error) {
        yield {
            name: 'run.patch',
            data: {
                status: 'failed',
                failReason: {
                    message: error
                },
            },
        };

        await publishAISDKStreamEvent(currentRun.id, '[RESPONSE]' + JSON.stringify({
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            error
        }));

        return;
    }

    /**
     * Let's read the response body SSE stream
     */

    // send response first

    let isComplete = false;

    try {
        console.log(`[ai-sdk][${currentRun.id}] streaming`);

        await publishAISDKStreamEvent(currentRun.id, '[RESPONSE]' + JSON.stringify({
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
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
        for await (const data of parseAISDKStream(response.body!)) {
            if (data === '[DONE]') { // done is end of stream. We send it ourselves in the finally block.
                console.log(`[ai-sdk][${currentRun.id}] [DONE]`);
                break;
            }

            // transforms
            const chunk = JSON.parse(data) as AISDKChunk;
            if (chunk.type === 'start' && !chunk.messageId) {
                chunk.messageId = currentRun.id + '-input';
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
                    yield {
                        name: 'run.patch',
                        data: { items: [{ type: 'text', text }] },
                    };
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

                    console.log(`[ai-sdk][${currentRun.id}] yield run.patch for`, chunk)
                    yield {
                        name: 'run.patch',
                        data: { items: [{ type: 'reasoning', text }] },
                    };
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
                        console.log(`[ai-sdk][${currentRun.id}] yield run.patch for`, chunk)
                        yield {
                            name: 'run.patch',
                            data: {
                                items: [{
                                    type: 'tool-call',
                                    toolCallId: chunk.toolCallId,
                                    toolName: state.toolName,
                                    state: 'output-available',
                                    input: state.input,
                                    output: chunk.output,
                                }],
                            },
                        };
                        toolStates.delete(chunk.toolCallId);
                    }
                    break;
                }

                case 'tool-output-error': {
                    const state = toolStates.get(chunk.toolCallId);
                    if (state) {
                        emittedItemTypes.push('tool-call');
                        console.log(`[ai-sdk][${currentRun.id}] yield run.patch for`, chunk)
                        yield {
                            name: 'run.patch',
                            data: {
                                items: [{
                                    type: 'tool-call',
                                    toolCallId: chunk.toolCallId,
                                    toolName: state.toolName,
                                    state: 'output-error',
                                    input: state.input,
                                    errorText: chunk.errorText,
                                }],
                            },
                        };
                        toolStates.delete(chunk.toolCallId);
                    }
                    break;
                }

                case 'finish': {
                    if (chunk.messageMetadata !== undefined) {
                        messageMetadata = chunk.messageMetadata;
                    }
                    const outputCount = computeOutputItemCount(emittedItemTypes);
                    console.log(`[ai-sdk][${currentRun.id}] yield run.patch COMPLETED for`, chunk)

                    isComplete = true;
                    yield {
                        name: 'run.patch',
                        data: {
                            status: 'completed',
                            outputItemCount: outputCount,
                            channelReply: isChannelRun ? { text: outputTexts.filter(Boolean).join('\n\n') } : undefined,
                            ...(messageMetadata !== undefined ? { metadata: messageMetadata } : {}),
                        },
                    };
                    break;
                }

                case 'error': {
                    console.log(`[ai-sdk][${currentRun.id}] yield run.patch ERROR for`, chunk)

                    isComplete = true;
                    yield {
                        name: 'run.patch',
                        data: {
                            status: 'failed',
                            failReason: {
                                message: chunk.errorText ?? 'Unknown error from AI SDK stream',
                            },
                        },
                    };
                    break;
                }

                // Ignore other events: start-step, finish-step, source-url, file, etc.
                default:
                    if (chunk.type.startsWith('data-')) {
                        emittedItemTypes.push('data');
                        yield {
                            name: 'run.patch',
                            data: {
                                items: [{ type: chunk.type, data: chunk.data }],
                            },
                        };
                    }
                    console.log(`[ai-sdk][${currentRun.id}] Ignored chunk: `, chunk.type);
                    break;
            }

            // we just mirror native chunks to the stream.
            console.log(`[ai-sdk][${currentRun.id}] stream event`, chunk)
            await publishAISDKStreamEvent(currentRun.id, JSON.stringify(chunk));
        }

        if (!isComplete) {
            console.log(`[ai-sdk][${currentRun.id}] stream ended INCOMPLETE`);
            yield {
                name: 'run.patch',
                data: {
                    status: 'failed',
                    failReason: {
                        message: 'Agent stream ended without completing',
                    },
                },
            };
        }
        else {
            console.log(`[ai-sdk][${currentRun.id}] stream ended complete`);
        }

    } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') {
            console.log('[ai-sdk] aborted while streaming')
            await publishAISDKStreamEvent(currentRun.id, JSON.stringify({ type: 'abort', reason: 'Cancelled by user' }));
            return; // abort doesn't require action since it means the run is already properly terminated
        }

        // This is for severe errors.
        yield {
            name: 'run.patch',
            data: {
                status: 'failed',
                failReason: {
                    message: error instanceof Error ? error.message : String(error),
                },
            },
        };

    } finally {
        console.log(`[ai-sdk][${currentRun.id}] stream cleanup, sending [DONE]`);
        await publishAISDKStreamEvent(currentRun.id, "[DONE]");
        await expireAISDKStream(currentRun.id);
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
        if (run.status === 'in_progress') {
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
    enrichSession: (session: StandardSession) => ({
        messages: sessionToUIMessages(session),
        resume: session.runs[session.runs.length - 1]?.status === 'in_progress',
        ...getSessionStatusFields(session),
    }),
} satisfies Adapter;
