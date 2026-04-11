
/**
* Parse an SSE stream, extracts only data frames.
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
  