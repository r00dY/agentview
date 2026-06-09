import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { UIDataTypes, UIMessage, UIMessageChunk } from 'ai';
import { z } from 'zod';

import { updateEnvironment } from 'agentview/updateEnvironment';

import { setupTestOrg } from './utils';
import {
  createMockServer,
  writeAISDKChunks,
  writeAISDKDone,
  writeAISDKSuccessHeaders,
  type MockServer,
} from './mockServer';

const { spawn } = require('child_process');

const PROXY_TIMEOUT = 15_000;
const TEST_TIMEOUT = PROXY_TIMEOUT + 30_000;

const SMOKE_AGENT_PORT = 3461;
const SMOKE_AGENT_URL = `http://localhost:${SMOKE_AGENT_PORT}/agent`;

/**
 * Smoke test: end-to-end wiring check.
 *
 * Used both locally and against production deployments to verify the
 * whole stack is connected: API server, streaming server, tunnel proxy,
 * agent endpoint.
 *
 * Setup: org + users + local client (X-Env: local-admin) routed through
 * a real Cloudflare tunnel + local proxy back to a mock agent server
 * that parrots the user's message back, streamed token-by-token.
 */
describe('smoke', () => {
  let org: Awaited<ReturnType<typeof setupTestOrg>>;
  let mockServer: MockServer | null = null;
  let proxyProcess: any;

  beforeAll(async () => {
    org = await setupTestOrg();

    mockServer = await createMockServer(SMOKE_AGENT_PORT);

    proxyProcess = spawn(
      'npx',
      ['agentview', 'proxy', 'start', '--api-key', org.apiKeySecret.key, '--env', 'local-admin'],
      {
        detached: true,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      }
    );
    proxyProcess.unref();

    await new Promise((r) => setTimeout(r, PROXY_TIMEOUT));
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (mockServer) {
      await mockServer.close();
      mockServer = null;
    }
    if (proxyProcess?.pid) {
      try { process.kill(-proxyProcess.pid, 'SIGTERM'); } catch { }
    }
  }, 30_000);

  test('two turns via local client + tunnel proxy', async () => {
    const client = org.admin.localClient;

    const inputSchema = z.looseObject({ role: z.literal('user'), parts: z.array(z.any()) });
    await updateEnvironment(client, {
      config: {
        agents: [{
          name: 'smoke-agent',
          version: '1.0.0',
          url: SMOKE_AGENT_URL,
          adapter: 'ai-sdk',
          runs: [{
            input: { schema: inputSchema },
            output: [],
            validateOutput: false,
          }],
        }],
        channels: [{ type: 'api', name: 'smoke-channel', agent: 'smoke-agent' }],
      },
    });

    // Parrot handler: echoes user message back, streamed as "tokens", plus a
    // reasoning block that dumps the conversation history so we can verify
    // history flows through.
    mockServer!.setHandler((body, res) => {
      const messages: any[] = body?.messages ?? [];
      const userTurn = messages.filter((m) => m.role === 'user').length;
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const lastUserText = lastUser?.parts?.find((p: any) => p.type === 'text')?.text ?? '';

      const historySummary = messages
        .map((m) => `${m.role}:${m.parts?.find((p: any) => p.type === 'text')?.text ?? ''}`)
        .join('|');

      const reply = `Parrot turn ${userTurn}: ${lastUserText}`;
      const tokens = reply.split(/(\s+)/).filter(Boolean);

      writeAISDKSuccessHeaders(res);
      writeAISDKChunks(res, [
        { type: 'start' },
        { type: 'reasoning-start', id: 'r1' },
        { type: 'reasoning-delta', id: 'r1', delta: `history=${historySummary}` },
        { type: 'reasoning-end', id: 'r1' },
        { type: 'text-start', id: 't1' },
        ...tokens.map((t) => ({ type: 'text-delta' as const, id: 't1', delta: t })),
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: 'stop' },
      ]);
      writeAISDKDone(res);
      res.end();
    });

    const { user } = await client.users.create();
    const session = await client.sessions.create({ agent: 'smoke-agent', userId: user.id });

    const transport = client.createTransport();

    // Turn 1
    const stream1 = await transport.sendMessages({
      chatId: session.id,
      messages: [{ id: 'msg_u1', role: 'user', parts: [{ type: 'text', text: 'hello world' }] }],
      trigger: 'submit-message',
      messageId: undefined,
      abortSignal: undefined,
    });
    const chunks1 = await consumeChunks(stream1);

    const text1 = chunks1.filter((c) => c.type === 'text-delta').map((c: any) => c.delta).join('');
    const reasoning1 = chunks1.filter((c) => c.type === 'reasoning-delta').map((c: any) => c.delta).join('');
    expect(text1).toBe('Parrot turn 1: hello world');
    expect(reasoning1).toBe('history=user:hello world');

    // Turn 2
    const stream2 = await transport.sendMessages({
      chatId: session.id,
      messages: [{ id: 'msg_u2', role: 'user', parts: [{ type: 'text', text: 'how are you' }] }],
      trigger: 'submit-message',
      messageId: undefined,
      abortSignal: undefined,
    });
    const chunks2 = await consumeChunks(stream2);

    const text2 = chunks2.filter((c) => c.type === 'text-delta').map((c: any) => c.delta).join('');
    const reasoning2 = chunks2.filter((c) => c.type === 'reasoning-delta').map((c: any) => c.delta).join('');
    expect(text2).toBe('Parrot turn 2: how are you');
    expect(reasoning2).toBe('history=user:hello world|assistant:Parrot turn 1: hello world|user:how are you');

    const finalSession = await client.sessions.get(session.id);
    expect(finalSession.isRunning).toBe(false);
    expect(finalSession.messages.length).toBe(4);
    expect(finalSession.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  }, TEST_TIMEOUT);
});

async function consumeChunks(stream: ReadableStream<UIMessageChunk<unknown, UIDataTypes>>) {
  const chunks: UIMessageChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}
