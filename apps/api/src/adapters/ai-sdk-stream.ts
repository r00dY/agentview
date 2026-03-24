import { redis } from '../redis';

const streamKey = (runId: string) => `run-stream:ai-sdk:${runId}`;

export async function publishAISDKStreamEvent(runId: string, data: string) {
  const key = streamKey(runId);
  const ms = Date.now();
  await redis.xadd(key, `${ms}-*`, 'data', data);
}

export async function expireAISDKStream(runId: string) {
  const key = streamKey(runId);
  await redis.expire(key, 60);
}

async function* consumeRaw(
  runId: string,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const key = streamKey(runId);
  let lastId = '0-0';

  while (!signal.aborted) {
    const results = await redis.xread('COUNT', 100, 'BLOCK', 500, 'STREAMS', key, lastId);
    if (signal.aborted) return;
    if (!results) continue;

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

/**
 * Waits for the __response__ meta-event published by the AI SDK adapter.
 */
export async function waitForAISDKResponse(
  runId: string,
  signal: AbortSignal,
): Promise<AISDKResponseMeta> {
  for await (const data of consumeRaw(runId, signal)) { // only read the first event
    if (!data.startsWith('[RESPONSE]')) {
      throw new Error('[ai-sdk-stream] first event received and it is not [RESPONSE]');
    }
    return JSON.parse(data.slice(10))
  }

  throw new Error('[ai-sdk-stream] [RESPONSE] event not received');
}

/**
 * Yields raw AI SDK chunk JSON strings.
 * Skips __response__ meta-events, stops on [DONE].
 */
export async function* consumeAISDKStream(
  runId: string,
  signal: AbortSignal,
): AsyncGenerator<string> {
  for await (const data of consumeRaw(runId, signal)) {
    if (data.startsWith('[RESPONSE]')) continue;
    yield data;
    if (data === '[DONE]') {
      return;
    };
  }
}
