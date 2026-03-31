import { redisPublisher } from './redis';
import { createRedisStreamConsumer } from './redisStreamConsumer';


const streamKey = (runId: string) => `run-stream:agentview:${runId}`;

// --- Publishing (shared connection) ---

export async function publishRunStreamEvent(runId: string, createdAt: string | null, data: string) {
  const key = streamKey(runId);
  const ms = createdAt ? new Date(createdAt).getTime() : Date.now();
  await redisPublisher.xadd(key, `${ms}-*`, 'data', data);

  if (data === '[DONE]') {
    await redisPublisher.expire(key, 60);
  }
}

// --- Consuming (dedicated connection per consumer) ---

export function createRunStreamConsumer(runId: string, signal: AbortSignal) {
  const consumer = createRedisStreamConsumer(streamKey(runId), signal);

  async function* entries() {
    for await (const data of consumer.entries()) {
      if (data === '[DONE]') return;
      yield data;
    }
  }

  return { entries, close: consumer.close };
}
