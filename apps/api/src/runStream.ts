import { redis } from './redis';

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

export async function publishRunStreamEvent(runId: string, event: object, options?: { expire?: boolean }) {
  const key = `run-stream:${runId}`;

  // Use the event's updatedAt as the stream ID so consumer can use the same
  // clock (Node.js) to compute its starting offset — no Redis clock skew.
  const updatedAt = (event as any).updatedAt;
  const ms = new Date(updatedAt).getTime();
  await redis.xadd(key, `${ms}-*`, 'data', JSON.stringify(event));

  if (options?.expire) {
    await redis.expire(key, 60);
  }
}

export async function* consumeRunStream(
  runId: string,
  afterTimestamp: string,
  signal: AbortSignal,
) {
  const key = `run-stream:${runId}`;

  // Both this offset and the stream entry IDs use the Node.js clock (updatedAt),
  // so there's no cross-clock skew.
  const startMs = new Date(afterTimestamp).getTime();
  let lastId = `${startMs}-0`;

  while (!signal.aborted) {
    const results = await redis.xread('COUNT', 100, 'BLOCK', 500, 'STREAMS', key, lastId);

    if (signal.aborted) return;

    if (!results) continue;

    for (const [_streamKey, entries] of results) {
      for (const [id, fields] of entries) {
        lastId = id;
        const data = JSON.parse(fields[1]);
        yield data;

        if (data.status && TERMINAL_STATUSES.includes(data.status)) {
          return;
        }
      }
    }
  }
}
