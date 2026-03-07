import type { RunBody } from 'agentview/apiTypes';
import { AgentAPIError, type AgentAPIEvent } from '../agentApi';
import { sessionToUIMessages } from './mapping';

interface AISDKChunk {
  type: string;
  [key: string]: any;
}

/**
 * Parse an AI SDK SSE stream.
 * AI SDK uses `data: <json>\n\n` format (no `event:` field).
 * Stream ends with `data: [DONE]\n\n`.
 */
async function* parseAISDKStream(body: ReadableStream<Uint8Array>): AsyncGenerator<AISDKChunk, void, unknown> {
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

function parseDataLine(line: string): AISDKChunk | null {
  if (!line.startsWith('data: ')) return null;
  const payload = line.substring(6).trim();
  if (payload === '[DONE]') return null;
  try {
    return JSON.parse(payload);
  } catch {
    throw new AgentAPIError({
      message: 'Error parsing AI SDK stream chunk (invalid JSON)',
      data: payload,
    });
  }
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

export async function* callAgentAPIAISDK(
  body: RunBody,
  url: string,
  signal?: AbortSignal
): AsyncGenerator<AgentAPIEvent, void, unknown> {
  let response: Response;

  try {
    // Build AI SDK request body
    const messages = sessionToUIMessages(body.session);

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

    // Yield version from header
    const versionHeader = response.headers.get('x-agentview-version');
    if (versionHeader) {
      yield { name: 'version', data: versionHeader };
    }

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

    for await (const chunk of parseAISDKStream(response.body)) {
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
          break;
      }
    }
  } catch (error: unknown) {
    if (error instanceof AgentAPIError) {
      throw error;
    } else if (error instanceof Error) {
      throw new AgentAPIError({
        message: 'Agent API connection error: ' + error.message,
        cause: error.cause,
      });
    } else {
      throw error;
    }
  }
}

function tryParseJSON(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getErrorObject(input: any): { message: string; [key: string]: any } {
  if (typeof input === 'object' && 'message' in input) {
    return input;
  }
  return { message: 'Unknown error', details: input };
}
