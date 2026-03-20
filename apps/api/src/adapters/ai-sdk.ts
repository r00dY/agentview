import type { RunBody } from 'agentview/apiTypes';
import { AgentAPIError, type AgentAPIEvent } from '../agentApi';
import { expireRunStream, publishRunStreamEvent } from '../runStream';
import type { StandardSession, UIMessage } from 'agentview/apiTypes';
import { type Adapter } from './adapters';

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
    let response: Response;

    const currentRun = body.session.runs[body.session.runs.length - 1];

    try {
        // Build AI SDK request body
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

        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ messages, session: body.session }),
            signal,
        });

        // Yield response_data (same as callAgentAPI)
        const responseData: any = {
            request: {
                url,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: { messages },
            },
            response: {
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
            },
        };

        yield { name: 'response_data', data: responseData };

        if (!response.ok) {
            const content = tryParseJSON(await response.text());
            responseData.response.body = content;
            yield { name: 'response_data', data: responseData };

            const error = getErrorObject(content);
            throw new AgentAPIError({
                ...error,
                message: `HTTP error response (${response.status}): ${error.message}`,
            });
        }

        if (!response.body) {
            throw new AgentAPIError({ message: 'No response body' });
        }

        // Parse AI SDK stream and convert to run.patch events
        const textBuffers = new Map<string, string>();
        const reasoningBuffers = new Map<string, string>();
        const toolStates = new Map<string, { toolName: string; inputText: string; input?: any }>();
        let messageMetadata: any = undefined;
        const emittedItemTypes: string[] = [];
        const outputTexts: string[] = [];

        console.log('[ai-sdk] Starting stream');

        for await (const data of parseAISDKStream(response.body)) {
            /**
             * WE DO NOT SEND [DONE] HERE AND IT'S IMPORTANT!!!
             * 
             * [done] literally closes the stream, so after the stream closes external apps assume the state of the system is already correct. We can't send [done] prematurely becasue concecutive getSession would get the old state.
             * That's why [done] is conditionally sent in the applyRunPatch in the final phase. (it's exception)
             * 
             */
            if (data === '[DONE]') {
                break;
            }

            // transforms
            const chunk = JSON.parse(data) as AISDKChunk;
            if (chunk.type === 'start' && !chunk.messageId) {
                chunk.messageId = currentRun.id + '-input';
            }

            publishRunStreamEvent(currentRun.id, 'ai-sdk', new Date().toISOString(), JSON.stringify(chunk));

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
                    yield {
                        name: 'run.patch',
                        data: {
                            status: 'completed',
                            outputItemCount: outputCount,
                            ...(messageMetadata !== undefined ? { metadata: messageMetadata } : {}),
                        },
                    };

                    if (isChannelRun) {
                        const replyText = outputTexts.filter(Boolean).join('\n\n');
                        yield { name: 'channel.reply', data: { text: replyText } };
                    }
                    break;
                }

                case 'error': {
                    throw new AgentAPIError({
                        message: chunk.errorText ?? 'Unknown error from AI SDK stream',
                    });
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
                    console.log('[ai-sdk] Ignored chunk: ', chunk.type);
                    break;
            }
        }

        console.log('[ai-sdk] Stream finished');
    } catch (error: unknown) {
        console.error('[ai-sdk] Stream error: ', (error as any)?.message ?? 'Unknown error');

        throw error;

        // if (error instanceof AgentAPIError) {
        //     throw error;
        // } else if (error instanceof Error) {
            
        //     throw new AgentAPIError({
        //         message: 'Agent API connection error: ' + error.message,
        //         cause: error.cause,
        //     });
        // } else {
        //     throw error;
        // }
    } finally {
        // console.log('[ai-sdk] Stream finished');
        // await publishRunStreamEvent(currentRun.id, 'ai-sdk', new Date().toISOString(), "[DONE]");
    }
}

function tryParseJSON(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function getErrorObject(input: any): { message: string;[key: string]: any } {
    if (typeof input === 'object' && 'message' in input) {
        return input;
    }
    return { message: 'Unknown error', details: input };
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
        resume: session.runs[session.runs.length - 1]?.status === 'in_progress'
    }),
} satisfies Adapter;