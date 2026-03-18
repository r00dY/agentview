/**
 * Parse an AI SDK-style SSE stream (`data: <json>\n\n`).
 * Yields parsed JSON objects. Stops when `data: [DONE]` is received.
 */
export async function* parseDataStream(response: Response): AsyncGenerator<any, void, unknown> {
  if (!response.body) throw new Error('No response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';

      for (const block of blocks) {
        const trimmed = block.trim();
        if (!trimmed) continue;

        for (const line of trimmed.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') return;
          yield JSON.parse(payload);
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      for (const line of buffer.trim().split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        yield JSON.parse(payload);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
