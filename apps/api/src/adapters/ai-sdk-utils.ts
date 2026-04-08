/**
 * Pure utility functions for AI SDK stream parsing.
 * No DB/Redis/session dependencies — safe to import from any process.
 */

export interface AISDKChunk {
    type: string;
    [key: string]: any;
}

/**
 * Parse an AI SDK SSE stream.
 * AI SDK uses `data: <json>\n\n` format (no `event:` field).
 * Stream ends with `data: [DONE]\n\n`.
 */
export async function* parseAISDKStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string, void, unknown> {

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
}

/**
 * Counts consecutive 'text' items from the end of the emitted item types array.
 * This determines how many items should be marked as output on completion.
 */
export function computeOutputItemCount(emittedItemTypes: string[]): number {
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
