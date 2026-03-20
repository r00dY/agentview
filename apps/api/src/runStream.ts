import { redis } from './redis';

export async function publishRunStreamEvent(runId: string, adapter: string, createdAt: string | null, data: string) {
  const key = `run-stream:${adapter}:${runId}`;

  // Use the event's updatedAt as the stream ID so consumer can use the same
  // clock (Node.js) to compute its starting offset — no Redis clock skew.
  const ms = createdAt ? new Date(createdAt).getTime() : Date.now();
  await redis.xadd(key, `${ms}-*`, 'data', data);

  if (data === '[DONE]') {
    await expireRunStream(runId, adapter);
  }
}

export async function expireRunStream(runId: string, adapter: string) {
  const key = `run-stream:${adapter}:${runId}`;
  await redis.expire(key, 60);
}

/**
 * Calls `onDone` when [DONE] appears on the run stream. Returns a cleanup function.
 */
export function onRunStreamDone(runId: string, adapter: string, onDone: () => void) {
  const abortController = new AbortController();

  (async () => {
    try {
      for await (const data of consumeRunStream(runId, adapter, abortController.signal)) {
        if (data === '[DONE]') {
          onDone();
          return;
        }
      }
    } catch {
      // Expected on cleanup
    }
  })();

  return abortController
}

export async function* consumeRunStream(
  runId: string,
  adapter: string,
  signal: AbortSignal,
  afterTimestamp?: string,
) {
  const key = `run-stream:${adapter}:${runId}`;

  // Both this offset and the stream entry IDs use the Node.js clock (updatedAt),
  // so there's no cross-clock skew.
  let lastId = '0-0';

  if (afterTimestamp) {
    const startMs = new Date(afterTimestamp).getTime();
    lastId = `${startMs}-0`;
  }

  while (!signal.aborted) {
    const results = await redis.xread('COUNT', 100, 'BLOCK', 500, 'STREAMS', key, lastId);

    if (signal.aborted) return;

    if (!results) continue;

    for (const [_streamKey, entries] of results) {
      for (const [id, fields] of entries) {
        lastId = id;
        const data = fields[1];
        yield data;

        if (data === '[DONE]') {
          return;
        }
      }
    }
  }
}