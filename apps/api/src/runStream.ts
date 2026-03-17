import { redis } from './redis';

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

export async function publishRunStreamEvent(runId: string, event: object) {
  const key = `run-stream:${runId}`;
  await redis.xadd(key, '*', 'data', JSON.stringify(event));

  const status = (event as any).status;
  if (status && TERMINAL_STATUSES.includes(status)) {
    await redis.expire(key, 60);
  }
}

export async function expireRunStream(runId: string) {
  await redis.expire(`run-stream:${runId}`, 60);
}

export async function* consumeRunStream(
  runId: string,
  afterTimestamp: string,
  signal: AbortSignal,
) {
  const key = `run-stream:${runId}`;

  // Convert ISO timestamp to ms for initial offset
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
