import { redis } from './redis';
import { createRedisStreamConsumer } from './redisStreamConsumer';

/**
 * Redis Stream-based bridge for the "standard" (non-AI-SDK) run protocol.
 *
 * The worker publishes run patches via publishRunStreamEvent(). HTTP handlers
 * consume them via createRunStreamConsumer() to stream updates to the client.
 *
 * Protocol:
 *   - N data entries  {json}        — run patch events
 *   - [DONE]                        — run finished normally
 *   - [TERMINATED]                  — run was cancelled externally
 *
 * Stream IDs use the Node.js clock (Date.now()) so both publisher and
 * consumer share the same time source — no Redis clock skew.
 */

const POLL_INTERVAL_MS = 50;

const streamKey = (runId: string) => `run-stream:agentview:${runId}`;

// --- Publishing (shared connection) ---

export async function publishRunStreamEvent(runId: string, createdAt: string | null, data: string) {
  const key = streamKey(runId);
  const ms = createdAt ? new Date(createdAt).getTime() : Date.now();
  await redis.xadd(key, `${ms}-*`, 'data', data);

  if (data === '[DONE]' || data === '[TERMINATED]') {
    await redis.expire(key, 60);
  }
}

// --- Consuming (HTTP handlers — dedicated connection) ---

/**
 * Yields run patch events. Stops on [DONE] or [TERMINATED] (neither is
 * forwarded to the caller). Uses a dedicated Redis connection via
 * RedisStreamConsumer.
 *
 * The caller MUST call close() when done (use try/finally).
 */
export function createRunStreamConsumer(runId: string, signal: AbortSignal, afterTimestamp?: string) {
  const startId = afterTimestamp
    ? `${new Date(afterTimestamp).getTime()}-0`
    : undefined;

  const consumer = createRedisStreamConsumer(streamKey(runId), signal, { startId });

  async function* entries() {
    for await (const data of consumer.entries()) {
      if (data === '[DONE]' || data === '[TERMINATED]') return;
      yield data;
    }
  }

  return { entries, close: consumer.close };
}

// --- Termination listener (worker — shared connection, lightweight) ---

/**
 * Calls `onTerminated` when [TERMINATED] appears on the run stream.
 * Returns an AbortController — call .abort() to stop listening.
 *
 * Uses non-blocking polling on the shared connection since this runs inside
 * the worker — one dedicated connection per run would be wasteful here.
 */
export function onRunTerminated(runId: string, onTerminated: () => void) {
  const abortController = new AbortController();

  (async () => {
    try {
      for await (const data of pollRunStream(runId, abortController.signal)) {
        if (data === '[TERMINATED]') {
          onTerminated();
          return;
        }
      }
    } catch {
      // Expected on cleanup
    }
  })();

  return abortController;
}

// Non-blocking poll loop on the shared connection — only used by onRunTerminated.
async function* pollRunStream(runId: string, signal: AbortSignal) {
  const key = streamKey(runId);
  let lastId = '0-0';

  while (!signal.aborted) {
    const results = await redis.xread('STREAMS', key, lastId);
    if (signal.aborted) return;

    if (!results) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    for (const [, entries] of results) {
      for (const [id, fields] of entries) {
        lastId = id;
        yield fields[1];
      }
    }
  }
}
