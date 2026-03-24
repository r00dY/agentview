import { redis } from './redis';

/**
 * Redis Stream-based bridge for the "standard" (non-AI-SDK) run protocol.
 *
 * The worker publishes run patches via publishRunStreamEvent(). HTTP handlers
 * consume them via consumeRunStream() to stream updates to the client.
 *
 * Protocol:
 *   - N data entries  {json}        — run patch events
 *   - [DONE]                        — run finished normally
 *   - [TERMINATED]                  — run was cancelled externally
 *
 * Stream IDs use the Node.js clock (Date.now()) so both publisher and
 * consumer share the same time source — no Redis clock skew.
 *
 * IMPORTANT: All reads use non-blocking XREAD + sleep polling.
 * We share a single Redis connection across the whole process (HTTP server +
 * workers). XREAD BLOCK would monopolise that connection, preventing any
 * other command (XADD, GET, SET, …) from being processed until the block
 * times out. This caused a ~500ms per-chunk delay in streaming responses.
 */

const POLL_INTERVAL_MS = 50;

export async function publishRunStreamEvent(runId: string, createdAt: string | null, data: string) {
  const key = `run-stream:agentview:${runId}`;
  const ms = createdAt ? new Date(createdAt).getTime() : Date.now();
  await redis.xadd(key, `${ms}-*`, 'data', data);

  if (data === '[DONE]' || data === '[TERMINATED]') {
    await redis.expire(key, 60);
  }
}

/**
 * Calls `onTerminated` when [TERMINATED] appears on the run stream.
 * Returns an AbortController — call .abort() to stop listening.
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
 * Yields run patch events. Stops on [DONE] or [TERMINATED] (neither is
 * forwarded to the caller).
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
  let lastId = '0-0';

  if (afterTimestamp) {
    lastId = `${new Date(afterTimestamp).getTime()}-0`;
  }

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
