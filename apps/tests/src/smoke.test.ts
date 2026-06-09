import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { UIDataTypes, UIMessage, UIMessageChunk } from 'ai';
import { z } from 'zod';
import { google } from 'googleapis';

import { updateEnvironment } from 'agentview/updateEnvironment';

import { setupTestOrg } from './utils';
import {
  createMockServer,
  writeAISDKChunks,
  writeAISDKDone,
  writeAISDKSuccessHeaders,
  type MockServer,
} from './mockServer';
import {
  createGmailClient,
  sendEmail,
  waitForEmail,
  type GmailClient,
} from './gmailTestClient';

const { spawn } = require('child_process');

const PROXY_TIMEOUT = 15_000;
const TEST_TIMEOUT = PROXY_TIMEOUT + 30_000;

if (!process.env.AGENTVIEW_EMAIL_ROOT_DOMAIN) {
  throw new Error('AGENTVIEW_EMAIL_ROOT_DOMAIN is not set');
}

const SMOKE_AGENT_PORT = 3461;
const SMOKE_AGENT_URL = `http://localhost:${SMOKE_AGENT_PORT}/agent`;
const SMOKE_AGENT_EMAIL_DOMAIN = "agent." + process.env.AGENTVIEW_EMAIL_ROOT_DOMAIN;

const EMAIL_TURN_TIMEOUT_MS = 60_000;
const EMAIL_TEST_TIMEOUT_MS = EMAIL_TURN_TIMEOUT_MS * 2 + 30_000;

/**
 * Mock parrot handler: streams reasoning + token-by-token text echoing the
 * last user message. Shared by both the transport and email tests.
 */
function setParrotHandler(mockServer: MockServer) {
  mockServer.setHandler((body, res) => {
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
}

/**
 * Verifies Gmail credentials before any expensive setup runs. Throws an
 * actionable error if the env vars are missing or the refresh token has
 * expired (Google rotates these every 7 days for OAuth apps in Testing mode).
 */
async function assertGmailCredentialsOrThrow() {
  const clientId = process.env.SMOKE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.SMOKE_GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.SMOKE_GMAIL_REFRESH_TOKEN;
  const user = process.env.SMOKE_GMAIL_USER;

  const missing: string[] = [];
  if (!clientId) missing.push('SMOKE_GMAIL_CLIENT_ID');
  if (!clientSecret) missing.push('SMOKE_GMAIL_CLIENT_SECRET');
  if (!refreshToken) missing.push('SMOKE_GMAIL_REFRESH_TOKEN');
  if (!user) missing.push('SMOKE_GMAIL_USER');

  if (missing.length > 0) {
    throw new Error(
      [
        '',
        'Smoke test cannot run — Gmail credentials are missing.',
        `Missing env vars: ${missing.join(', ')}`,
        '',
        'To mint a refresh token, run:',
        '  pnpm --filter ./apps/tests mint-gmail-token',
        '',
        'Then add the printed values to .env.local.',
        '',
      ].join('\n')
    );
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  let profile;
  try {
    profile = await gmail.users.getProfile({ userId: 'me' });
  } catch (err: any) {
    const code = err?.response?.data?.error ?? err?.code ?? '';
    const msg = String(err?.message ?? '');
    if (code === 'invalid_grant' || msg.includes('invalid_grant')) {
      throw new Error(
        [
          '',
          'Gmail refresh token is invalid or expired (invalid_grant).',
          '',
          'OAuth apps in "Testing" mode expire refresh tokens after 7 days.',
          'Re-mint with:',
          '  pnpm --filter ./apps/tests mint-gmail-token',
          '',
          'Then update SMOKE_GMAIL_REFRESH_TOKEN in .env.local.',
          '',
          `Original error: ${msg}`,
        ].join('\n')
      );
    }
    throw err;
  }

  if (profile.data.emailAddress?.toLowerCase() !== user!.toLowerCase()) {
    throw new Error(
      `SMOKE_GMAIL_USER (${user}) does not match the account this refresh token belongs to (${profile.data.emailAddress}).`
    );
  }
}

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
    // Verify Gmail creds FIRST — fail fast before paying for org seeding,
    // mock server boot, or the 15s tunnel wait.
    await assertGmailCredentialsOrThrow();

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

    setParrotHandler(mockServer!);

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

  test('two turns via email channel', async () => {
    const client = org.admin.localClient;
    const gmail: GmailClient = createGmailClient();

    const agentAddress = `${org.organization.slug}.local-admin.smoke-agent@${SMOKE_AGENT_EMAIL_DOMAIN}`;

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
          // address is unused for agentview-email (derived from incoming email),
          // but the base config schema still requires it.
          channels: [{ type: 'agentview-email', address: '' }],
        }],
      },
    });

    setParrotHandler(mockServer!);

    // Unique markers per turn — we look for them in the reply body to confirm
    // the parrot saw and echoed the message we sent.
    const marker1 = `MARKER-${crypto.randomUUID()}`;
    const marker2 = `MARKER-${crypto.randomUUID()}`;
    const subject = `Smoke test ${crypto.randomUUID()}`;

    const body1 = [
      'Hi there,',
      '',
      `I have a question. Reference: ${marker1}`,
      '',
      'Best regards,',
      'Andrzej Testovich',
      'Senior Engineer at AgentView Inc.',
      '+1-555-0123',
      '',
      '--',
      'This message is confidential. If received in error, please delete.',
    ].join('\n');

    const beforeTurn1 = new Date();
    const sent1 = await sendEmail(gmail, {
      to: agentAddress,
      subject,
      body: body1,
    });

    const reply1 = await waitForEmail(gmail, {
      query: `from:${agentAddress} in:inbox`,
      newerThan: beforeTurn1,
      timeoutMs: EMAIL_TURN_TIMEOUT_MS,
    });

    expect(reply1.subject.toLowerCase()).toContain(subject.toLowerCase());
    expect(reply1.body).toContain('Parrot turn 1');
    expect(reply1.body).toContain(marker1);

    // Turn 2 — reply in-thread.
    const body2 = `One more question. Reference: ${marker2}\n\n— Andrzej`;
    const beforeTurn2 = new Date();
    await sendEmail(gmail, {
      to: agentAddress,
      subject: `Re: ${subject}`,
      body: body2,
      threadId: sent1.threadId,
      inReplyTo: reply1.messageId,
      references: [sent1.messageId, reply1.messageId],
    });

    const reply2 = await waitForEmail(gmail, {
      query: `from:${agentAddress} in:inbox`,
      newerThan: beforeTurn2,
      excludeGmailId: reply1.gmailId,
      timeoutMs: EMAIL_TURN_TIMEOUT_MS,
    });

    expect(reply2.body).toContain('Parrot turn 2');
    expect(reply2.body).toContain(marker2);

    // Gmail-side: both outgoing replies should land in the same thread as
    // the user's first message — proves Resend's References chain threaded
    // properly back to Gmail.
    expect(reply1.threadId).toBe(sent1.threadId);
    expect(reply2.threadId).toBe(sent1.threadId);

    // AgentView-side: there should be exactly one session for this user with
    // 4 alternating messages (2 turns × user+assistant) — proves the channel
    // thread resolver linked both incoming emails into a single conversation.
    const createdUser = await client.users.getByEmail(gmail.user);
    expect(createdUser).toBeDefined();
    expect(createdUser.email?.toLowerCase()).toBe(gmail.user.toLowerCase());

    const sessionsList = await client.sessions.list({ userId: createdUser.id });
    expect(sessionsList.sessions.length).toBe(1);

    const session = await client.sessions.get(sessionsList.sessions[0].id);
    expect(session.messages.length).toBe(4);
    expect(session.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  }, EMAIL_TEST_TIMEOUT_MS);
});

async function consumeChunks(stream: ReadableStream<UIMessageChunk<unknown, UIDataTypes>>) {
  const chunks: UIMessageChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}
