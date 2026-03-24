import { redis } from './redis';

export async function publishRunStreamEvent(runId: string, createdAt: string | null, data: string) {
  const key = `run-stream:agentview:${runId}`;

  // Use the event's updatedAt as the stream ID so consumer can use the same
  // clock (Node.js) to compute its starting offset — no Redis clock skew.
  const ms = createdAt ? new Date(createdAt).getTime() : Date.now();
  await redis.xadd(key, `${ms}-*`, 'data', data);

  if (data === '[DONE]' || data === '[TERMINATED]') {
    await redis.expire(key, 60);
  }
}

/**
 * Calls `onTerminated` when [TERMINATED] appears on the run stream. Returns a cleanup function.
 */
export function onRunTerminated(runId: string, onTerminated: () => void) {
  const abortController = new AbortController();

  (async () => {
    try {
      for await (const data of consumeRunStreamRaw(runId, abortController.signal)) {
        if (data === '[TERMINATED]') {
          onTerminated();
          return;
        }
      }
    } catch {
      // Expected on cleanup
    }
  })();

  return abortController
}

/**
 * Consumes the run stream, translating [TERMINATED] into [DONE] so consumers
 * never see the internal termination signal.
 */
export async function* consumeRunStream(
  runId: string,
  signal: AbortSignal,
  afterTimestamp?: string,
) {
  for await (const data of consumeRunStreamRaw(runId, signal, afterTimestamp)) {
    if (data === '[DONE]' || data === '[TERMINATED]') {
      return;
    }
    yield data;
  }
}

async function* consumeRunStreamRaw(
  runId: string,
  signal: AbortSignal,
  afterTimestamp?: string,
) {
  const key = `run-stream:agentview:${runId}`;

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
      }
    }
  }
}
