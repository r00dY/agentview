import { redisPublisher } from '../redis';
import { createRedisStreamConsumer } from '../redisStreamConsumer';

/**
 * AI SDK streaming bridge between the agent-fetch worker and HTTP response.
 *
 * Protocol (entries in the Redis Stream keyed by run ID):
 *   1.  [RESPONSE]{json}   — HTTP status + headers (always first)
 *   2.  {json}              — native AI SDK chunks (N entries)
 *   3.  [DONE]              — end of stream
 *
 * Publishing uses the shared `redis` connection (instant XADD).
 * Consuming uses a dedicated connection via RedisStreamConsumer.
 */

const streamKey = (runId: string) => `run-stream:ai-sdk:${runId}`;

// --- Publishing (shared connection) ---

export async function publishAISDKStreamEvent(runId: string, data: string) {
  await redisPublisher.xadd(streamKey(runId), `${Date.now()}-*`, 'data', data);
}

export async function expireAISDKStream(runId: string) {
  await redisPublisher.expire(streamKey(runId), 60);
}

// --- Consuming (dedicated connection per consumer) ---

export interface AISDKResponseMeta {
  status: number;
  headers: Record<string, string>;
  error?: string;
}

export interface AISDKStreamConsumer {
  /** Reads the [RESPONSE] meta-event. Must be called first. */
  waitForResponse(): Promise<AISDKResponseMeta>;
  /** Yields AI SDK chunk strings. Stops on [DONE]. */
  stream(): AsyncGenerator<string>;
  /** Closes the underlying Redis connection. Safe to call multiple times. */
  close(): void;
}

/**
 * Creates an AI SDK stream consumer for a given run.
 *
 * waitForResponse() and stream() share a cursor — call them in sequence
 * and the stream picks up exactly where the response left off.
 *
 * The caller MUST call close() when done (use try/finally).
 * The AbortSignal also triggers close() as a safety net.
 */
export function createAISDKStreamConsumer(runId: string, signal: AbortSignal): AISDKStreamConsumer {
  const consumer = createRedisStreamConsumer(streamKey(runId), signal);

  return {
    async waitForResponse() {
      for await (const data of consumer.entries()) {
        if (!data.startsWith('[RESPONSE]')) {
          throw new Error('[ai-sdk-stream] first event is not [RESPONSE]');
        }
        return JSON.parse(data.slice('[RESPONSE]'.length));
      }
      throw new Error('[ai-sdk-stream] [RESPONSE] not received');
    },

    async *stream() {
      for await (const data of consumer.entries()) {
        if (data.startsWith('[RESPONSE]')) continue;
        yield data;
        if (data === '[DONE]') return;
      }
    },

    close: consumer.close,
  };
}
