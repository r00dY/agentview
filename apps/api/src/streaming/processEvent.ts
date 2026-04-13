
import { uiMessageChunkSchema } from "ai";
import type { FastPatchOp } from "../runs";

export type State = {
    textBuffers: Map<string, string>,
    reasoningBuffers: Map<string, string>,
    toolStates: Map<string, { toolName: string; inputText: string; input?: any }>,
    emittedItemTypes: string[],
    outputTexts: string[],
    finalOp?: FastPatchOp
}

// export async function processEvent(runId: string, state: State, data: string) {
//     // parse
//     const chunk = await parseChunk(data);

//     // update chunk (rare)
//     let chunkUpdated = false;
//     if (chunk.type === 'start' && !chunk.messageId) {
//         chunk.messageId = runId;
//         chunkUpdated = true;
//     }

//     // update state
//     const op = processChunk(state, chunk);

//     return {
//         data: chunkUpdated ? JSON.stringify(chunk) : data, 
//         op 
//     };
// }

// Resolve the LazySchema once — gives us a Schema with a `.validate()` method.
// const uiMessageChunkValidator = uiMessageChunkSchema();

// async function parseChunk(data: string) {
//     const obj = JSON.parse(data);

//     // simplified parsing for text-delta
//     if (obj.type === 'text-delta') {
//         if (typeof obj.delta !== 'string' || typeof obj.id !== 'string') {
//             throw new Error('Invalid text-delta chunk');
//         }
//         return obj;
//     }

//     const validationResult = await uiMessageChunkValidator.validate!(JSON.parse(data));
//     if (!validationResult.success) {
//         throw validationResult.error;
//     }

//     return validationResult.value;
// }

export function processEvent(runId: string, state: State, data: string) {
    // parse
    const chunk = parseChunk(data);

    // update chunk (rare)
    let chunkUpdated = false;
    if (chunk.type === 'start' && !chunk.messageId) {
        chunk.messageId = runId;
        chunkUpdated = true;
    }

    // update state
    const op = processChunk(state, chunk);

    return {
        data: chunkUpdated ? JSON.stringify(chunk) : data, 
        op 
    };
}


function parseChunk(data: string) {
    const obj = JSON.parse(data);

    // simplified parsing for text-delta
    if (obj.type === 'text-delta') {
        if (typeof obj.delta !== 'string' || typeof obj.id !== 'string') {
            throw new Error('Invalid text-delta chunk');
        }
        return obj;
    }

    // TO DO: validate chunks!!!

    return obj;
}

function processChunk(state: State, chunk: Awaited<ReturnType<typeof parseChunk>>) : FastPatchOp | undefined {
    switch (chunk.type) {
        case 'start': {
            break;
        }

        case 'text-start': {
            state.textBuffers.set(chunk.id, '');
            break;
        }

        case 'text-delta': {
            const current = state.textBuffers.get(chunk.id) ?? '';
            state.textBuffers.set(chunk.id, current + chunk.delta);
            break;
        }

        case 'text-end': {
            const text = state.textBuffers.get(chunk.id) ?? '';
            state.textBuffers.delete(chunk.id);
            state.emittedItemTypes.push('text');
            state.outputTexts.push(text);

            return { type: 'item', content: { type: 'text', text } }
            break;
        }

        case 'reasoning-start': {
            state.reasoningBuffers.set(chunk.id, '');
            break;
        }

        case 'reasoning-delta': {
            const current = state.reasoningBuffers.get(chunk.id) ?? '';
            state.reasoningBuffers.set(chunk.id, current + chunk.delta);
            break;
        }

        case 'reasoning-end': {
            const text = state.reasoningBuffers.get(chunk.id) ?? '';
            state.reasoningBuffers.delete(chunk.id);
            state.emittedItemTypes.push('reasoning');

            return { type: 'item', content: { type: 'reasoning', text } }
            break;
        }

        case 'tool-input-start': {
            state.toolStates.set(chunk.toolCallId, {
                toolName: chunk.toolName,
                inputText: '',
            });
            break;
        }

        case 'tool-input-delta': {
            const toolState = state.toolStates.get(chunk.toolCallId);
            if (toolState) {
                toolState.inputText += chunk.inputTextDelta;
            }
            break;
        }

        case 'tool-input-available': {
            const toolState = state.toolStates.get(chunk.toolCallId);
            if (toolState) {
                toolState.input = chunk.input;
            }
            break;
        }

        case 'tool-output-available': {
            const toolState = state.toolStates.get(chunk.toolCallId);
            if (toolState) {
                state.emittedItemTypes.push('tool-call');
                state.toolStates.delete(chunk.toolCallId);
                return {
                    type: 'item',
                    content: { type: 'tool-call', toolCallId: chunk.toolCallId, toolName: toolState.toolName, state: 'output-available', input: toolState.input, output: chunk.output },
                }
            }
            break;
        }

        case 'tool-output-error': {
            const toolState = state.toolStates.get(chunk.toolCallId);
            if (toolState) {
                state.emittedItemTypes.push('tool-call');
                state.toolStates.delete(chunk.toolCallId);
                return {
                    type: 'item',
                    content: { type: 'tool-call', toolCallId: chunk.toolCallId, toolName: toolState.toolName, state: 'output-error', input: toolState.input, errorText: chunk.errorText },
                }
            }
            break;
        }

        case 'finish': {
            const outputCount = computeOutputItemCount(state.emittedItemTypes);

            state.finalOp = {
                type: 'complete',
                outputItemCount: outputCount,
                channelReply: { text: state.outputTexts.filter(Boolean).join('\n\n') }, // we can always send channel reply, even for non-channel runs, who cares
            };
            break;
        }

        case 'error': {
            state.finalOp = {
                type: 'fail',
                failReason: {
                    message: chunk.errorText ?? 'Unknown error from AI SDK stream',
                },
            };
            break;
        }

        case 'data-session-state': {
            state.emittedItemTypes.push('data');
            return {
                type: 'state',
                content: chunk.data,
            }
            break;
        }

        default:
            if (chunk.type.startsWith('data-')) {
                state.emittedItemTypes.push('data');
                return {
                    type: 'item',
                    content: chunk,
                }
            }
            break;
    }
}

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
  