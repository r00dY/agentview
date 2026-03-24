import { redis } from '../redis';

/**
 * Redis Stream-based bridge between the agent-fetch worker (producer) and
 * the HTTP response (consumer).
 *
 * The worker calls publishAISDKStreamEvent() to push chunks into a Redis
 * Stream keyed by run ID. The HTTP handler reads them back via
 * waitForAISDKResponse() + consumeAISDKStream().
 *
 * Protocol:
 *   1. First entry is always  [RESPONSE]{json}  — HTTP status + headers
 *   2. Then N data entries    {json}             — native AI SDK chunks
 *   3. Last entry is          [DONE]             — signals end of stream
 */

const POLL_INTERVAL_MS = 50;

const streamKey = (runId: string) => `run-stream:ai-sdk:${runId}`;

export async function publishAISDKStreamEvent(runId: string, data: string) {
  await redis.xadd(streamKey(runId), `${Date.now()}-*`, 'data', data);
}

export async function expireAISDKStream(runId: string) {
  await redis.expire(streamKey(runId), 60);
}

// Polls the Redis Stream for new entries.
// Uses non-blocking XREAD so we don't monopolise the shared Redis connection
// (XREAD BLOCK would prevent other commands on the same connection).
async function* consumeRaw(
  runId: string,
  signal: AbortSignal,
): AsyncGenerator<string> {
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

export interface AISDKResponseMeta {
  status: number;
  headers: Record<string, string>;
  error?: string
}

// Reads the first entry from the stream — must be the [RESPONSE] meta-event.
// Returns the parsed HTTP status/headers so the caller can set them before streaming.
export async function waitForAISDKResponse(
  runId: string,
  signal: AbortSignal,
): Promise<AISDKResponseMeta> {
  for await (const data of consumeRaw(runId, signal)) {
    if (!data.startsWith('[RESPONSE]')) {
      throw new Error('[ai-sdk-stream] first event received and it is not [RESPONSE]');
    }
    return JSON.parse(data.slice('[RESPONSE]'.length));
  }

  throw new Error('[ai-sdk-stream] [RESPONSE] event not received');
}

// Yields AI SDK chunk strings. Skips the [RESPONSE] meta-event, stops on [DONE].
export async function* consumeAISDKStream(
  runId: string,
  signal: AbortSignal,
): AsyncGenerator<string> {
  for await (const data of consumeRaw(runId, signal)) {
    if (data.startsWith('[RESPONSE]')) continue;
    yield data;
    if (data === '[DONE]') return;
  }
}
