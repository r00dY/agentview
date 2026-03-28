import { AgentViewError, type AgentViewRunFinishedErrorBody } from 'agentview';
import { redis } from './redis';
import { createRedisStreamConsumer } from './redisStreamConsumer';


const streamKey = (runId: string) => `run-stream:agentview:${runId}`;

// --- Publishing (shared connection) ---

export async function publishRunStreamEvent(runId: string, createdAt: string | null, data: string) {
  const key = streamKey(runId);
  const ms = createdAt ? new Date(createdAt).getTime() : Date.now();
  await redis.xadd(key, `${ms}-*`, 'data', data);

  if (data.startsWith('[DONE]')) {
    await redis.expire(key, 60);
  }
}

// --- Consuming (dedicated connection per consumer) ---

export function createRunStreamConsumer(runId: string, signal: AbortSignal, afterTimestamp?: string) {
  const startId = afterTimestamp
    ? `${new Date(afterTimestamp).getTime()}-0`
    : undefined;

  const consumer = createRedisStreamConsumer(streamKey(runId), signal, { startId });

  async function* entries() {
    for await (const data of consumer.entries()) {
      if (data.startsWith('[DONE]')) return;
      yield data;
    }
  }

  return { entries, close: consumer.close };
}

/**
 * Calls `onFinished` when [DONE] appears on the run stream.
 * Returns an AbortController — call .abort() to stop listening.
 */
export function onRunFinished(runId: string, onFinished: (body: AgentViewError) => void) {
  const abortController = new AbortController();
  const consumer = createRedisStreamConsumer(streamKey(runId), abortController.signal);

  (async () => {
    try {
      for await (const data of consumer.entries()) {
        if (data.startsWith('[DONE]')) {
          const body : AgentViewRunFinishedErrorBody = JSON.parse(data.slice('[DONE]'.length));
          const error = new AgentViewError("Run finished.", 400, {
            code: "run.finished",
            ...body
          });
          onFinished(error);
          return;
        }
      }
    } catch {
      // Expected on cleanup
    } finally {
      consumer.close();
    }
  })();

  return abortController;
}
