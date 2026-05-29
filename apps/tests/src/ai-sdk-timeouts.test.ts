import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { type User } from 'agentview';

import { z } from 'zod';
import type { MockServer } from './mockServer';
import {
  createMockServer,
  writeAISDKChunks,
  writeAISDKDone,
  writeAISDKSuccessHeaders,
} from './mockServer';

import { type UIDataTypes, type UIMessage, type UIMessageChunk } from 'ai';
import { setupTestOrg } from './utils';
import { updateEnvironment } from 'agentview/updateEnvironment';

// Long-running tests: each waits for the real expired-runs worker (1s poll)
// to fire after idleTimeout. Keep these in their own file so the main
// ai-sdk suite stays fast.
const TEST_TIMEOUT = 90_000;
const IDLE_TIMEOUT_MS = 10_000;

describe('ai-sdk timeouts', () => {
  let org: Awaited<ReturnType<typeof setupTestOrg>>;

  beforeAll(async () => {
    org = await setupTestOrg();
  });

  const AI_SDK_AGENT_PORT = 3459;
  const AI_SDK_AGENT_URL = `http://localhost:${AI_SDK_AGENT_PORT}/agent`;

  let mockAISDKServer: MockServer | null = null;
  let client: typeof org.prodClient;
  let user: User;

  function buildConfig() {
    const inputSchema = z.looseObject({ role: z.literal('user'), parts: z.array(z.any()) });
    return {
      agents: [{
        name: 'test-ai-sdk-timeout',
        version: '1.0.0',
        url: AI_SDK_AGENT_URL,
        adapter: 'ai-sdk',
        runs: [{
          input: { schema: inputSchema },
          output: [],
          validateOutput: false,
          idleTimeout: IDLE_TIMEOUT_MS,
        }],
      }],
      channels: [{ type: 'api', name: 'test-ai-sdk-timeout', agent: 'test-ai-sdk-timeout' }],
    };
  }

  function sendMessageViaTransport(
    transport: ReturnType<typeof org.prodClient.createTransport>,
    sessionId: string,
    input: UIMessage,
  ) {
    return transport.sendMessages({
      chatId: sessionId,
      messages: [input],
      trigger: 'submit-message',
      messageId: undefined,
      abortSignal: undefined,
    });
  }

  async function consumeChunks(stream: ReadableStream<UIMessageChunk<unknown, UIDataTypes>>) {
    const chunks: UIMessageChunk[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return chunks;
  }

  beforeAll(async () => {
    mockAISDKServer = await createMockServer(AI_SDK_AGENT_PORT);
    client = org.prodClient;
    const result = await client.users.create();
    user = result.user;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (mockAISDKServer) {
      await mockAISDKServer.close();
      mockAISDKServer = null;
    }
  }, 30_000);

  beforeEach(() => {
    mockAISDKServer?.resetRequests();
  });

  test('connect-phase timeout: upstream never responds → run timed out after idleTimeout', async () => {
    await updateEnvironment(client, { config: buildConfig() });
    const session = await client.sessions.create({ agent: 'test-ai-sdk-timeout', userId: user.id });

    let upstreamClosed = false;
    let upstreamWroteHeaders = false;

    mockAISDKServer!.setHandler((_body, res, req) => {
      // Hold the request open without writing anything — streaming-server stays
      // in the 'connecting' phase forever, so no pings ever fire and the run's
      // expiresAt stays at its initial value (createdAt + idleTimeout).
      req.on('close', () => { upstreamClosed = true; });
      res.on('finish', () => { upstreamWroteHeaders = true; });
    });

    const startedAt = Date.now();
    const runPromise = client.sessions.createRun(session.id, {
      input: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
    });

    // Expired-runs worker fires DELETE /streams → upstreamReq is destroyed
    // with RunTerminationError → streaming-server returns 409
    // { code: 'CONNECTION_TERMINATED', message: 'failed (Timeout)' }
    // → SDK rejects with AgentViewError carrying the body in `details`.
    await expect(runPromise).rejects.toThrowError(expect.objectContaining({
      statusCode: 409,
      message: expect.stringContaining('Timeout'),
      details: expect.objectContaining({
        code: 'CONNECTION_TERMINATED',
      }),
    }));

    const elapsed = Date.now() - startedAt;
    // Sanity: ensure we actually waited for the timeout, not some other failure.
    expect(elapsed).toBeGreaterThanOrEqual(IDLE_TIMEOUT_MS);

    // Mock saw the request close (upstream torn down) and never wrote a response.
    expect(upstreamClosed).toBe(true);
    expect(upstreamWroteHeaders).toBe(false);

    // The run never entered the streaming phase, so it never became active.
    // Session view filters out inactive runs → session looks idle.
    const finalSession = await client.sessions.get(session.id);
    expect(finalSession.status).toBe('idle');
    expect(finalSession.messages.length).toBe(0);
  }, TEST_TIMEOUT);

  test('streaming-then-silence timeout: tokens flow for 15s then upstream goes silent → run failed with Timeout', async () => {
    await updateEnvironment(client, { config: buildConfig() });
    const session = await client.sessions.create({ agent: 'test-ai-sdk-timeout', userId: user.id });

    const STREAM_DURATION_MS = 15_000;
    const TICK_MS = 100;

    let dataInterval: ReturnType<typeof setInterval> | null = null;
    let stopTimeout: ReturnType<typeof setTimeout> | null = null;

    mockAISDKServer!.setHandler((_body, res) => {
      writeAISDKSuccessHeaders(res);
      writeAISDKChunks(res, [
        { type: 'start' },
        { type: 'text-start', id: 't1' },
      ]);

      // Send a text-delta every TICK_MS for STREAM_DURATION_MS, then stop —
      // do NOT close the connection. Streaming-server's last ping happens on
      // the final chunk; after that, expiresAt won't be refreshed and the
      // expired-runs worker should kill the run ~idleTimeout later.
      dataInterval = setInterval(() => {
        if (res.destroyed) {
          if (dataInterval) clearInterval(dataInterval);
          return;
        }
        writeAISDKChunks(res, [
          { type: 'text-delta', id: 't1', delta: '.' },
        ]);
      }, TICK_MS);

      stopTimeout = setTimeout(() => {
        if (dataInterval) {
          clearInterval(dataInterval);
          dataInterval = null;
        }
        // Intentionally do not call res.end() — we want the upstream to look
        // like it's hung mid-stream.
      }, STREAM_DURATION_MS);
    });

    const startedAt = Date.now();

    const stream = await sendMessageViaTransport(
      client.createTransport(),
      session.id,
      { id: 'msg_1', role: 'user', parts: [{ type: 'text', text: 'Stream please' }] },
    );

    const chunks = await consumeChunks(stream);
    const elapsed = Date.now() - startedAt;

    // Cleanup mock timers in case the handler is still active.
    if (dataInterval) clearInterval(dataInterval);
    if (stopTimeout) clearTimeout(stopTimeout);

    // We received at least the start + text-start + many text-deltas.
    expect(chunks.some(c => c.type === 'start')).toBe(true);
    expect(chunks.some(c => c.type === 'text-start')).toBe(true);
    expect(chunks.filter(c => c.type === 'text-delta').length).toBeGreaterThan(50);

    // The stream ended with an error chunk (server forced termination).
    const errorChunk = chunks.find(c => c.type === 'error');
    expect(errorChunk).toBeDefined();

    // Ping is throttled to once per 5s of upstream activity. Worst case the
    // last ping fires up to 5s before streaming stops, so the lower bound is
    // STREAM_DURATION + IDLE_TIMEOUT - PING_THROTTLE = 15 + 10 - 5 = 20s.
    const PING_THROTTLE_MS = 5_000;
    expect(elapsed).toBeGreaterThanOrEqual(STREAM_DURATION_MS + IDLE_TIMEOUT_MS - PING_THROTTLE_MS);

    // Run was active (streaming phase reached) → it shows up as the last run,
    // session reports the terminal status from the worker.
    //
    // Note: the streaming-server intercepts the graceful termination signal
    // and writes its own reason via the fast-patch 'fail' op (which runs
    // before the worker's terminateRun, because sendRunTerminationSignal
    // waits for streamDone). So the recorded reason is
    // { code: 'STREAM_TERMINATED', message: 'failed (Timeout)' }, not the
    // raw { message: 'Timeout' } from the worker.
    const finalSession = await client.sessions.get(session.id);
    expect(finalSession.status).toBe('failed');
    expect(finalSession.reason?.code).toBe('STREAM_TERMINATED');
    expect(finalSession.reason?.message).toContain('Timeout');
  }, TEST_TIMEOUT);
});
