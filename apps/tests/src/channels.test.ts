import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createStandardClient, configDefaults, type StandardAgentViewClient } from 'agentview/clientStandard'
import type { Channel, Environment } from 'agentview/apiTypes'
import { z } from 'zod'
import { seedUsers } from './seedUsers'
import { createMockServer, writeAISDKChunks, writeAISDKDone, writeAISDKSuccessHeaders } from './mockServer'
import type { MockServer } from './mockServer'
import { updateEnvironment } from 'agentview/updateEnvironment'

configDefaults.__internal = {
  disableSummaries: true,
}

describe('Channels', () => {
  const AGENT_PORT = 3459
  const AGENT_URL = `http://localhost:${AGENT_PORT}/agent`

  let av: StandardAgentViewClient
  let avProd: StandardAgentViewClient
  let channel: Channel
  let env: Environment
  let mockServer: MockServer | null = null
  const orgSlug = 'channels-test-' + Math.random().toString(36).slice(2)
  const ADDRESS = `inbox@${orgSlug}.com`

  beforeAll(async () => {
    mockServer = await createMockServer(AGENT_PORT)

    const result = await seedUsers(orgSlug)
    av = createStandardClient({ apiKey: result.apiKeySecret.key, env: 'local-bob' })
    avProd = createStandardClient({ apiKey: result.apiKeySecret.key, env: 'production' })

    // create environment
    env = await updateEnvironment(avProd, {
      config: {
        agents: [{
          name: 'support-agent',
          version: '1.0.0',
          url: AGENT_URL,
          adapter: 'ai-sdk',
          runs: [{
            input: { schema: z.looseObject({ role: z.literal('user'), parts: z.array(z.any()) }) },
            output: [{ schema: z.looseObject({ type: z.literal('text'), text: z.string() }) }],
          }],
          channels: [{
            type: 'mock',
            address: ADDRESS,
            agent: 'support-agent',
          }],
        }],
        __internal: { disableSummaries: true },
      },
    });

    // create channel without env connected
    channel = await av.__internal.mock.createChannel({
      address: ADDRESS,
    })

  }, 15000)

  afterAll(async () => {
    if (mockServer) {
      await mockServer.close()
      mockServer = null
    }
  }, 15000)

  test('mock channel created successfully', async () => {
    expect(channel.id).toBeDefined()
    expect(channel.type).toBe('mock')
    expect(channel.address).toBe(ADDRESS)
  })

  test('list channels includes new channel', async () => {
    const channels = await av.channels.list()
    expect(channels.length).toBeGreaterThanOrEqual(1)
    const found = channels.find(c => c.id === channel.id)
    expect(found).toBeDefined()
  })

  test('sending message to correct address without environment results in no ingestion', async () => {
    await expect(
      av.__internal.mock.sendMessage({
        address: ADDRESS,
        sourceId: 'msg-404',
        sourceThreadId: 'some-thread',
        date: new Date().toISOString(),
        text: 'hello',
        author: {
          email: 'someone@test.com',
        },
      })
    ).rejects.toThrowError()


    // const result = await av.__internal.mock.sendMessage({
    //   address: ADDRESS,
    //   sourceId: 'msg-404',
    //   date: new Date().toISOString(),
    //   text: 'hello',
    //   author: {
    //     email: 'someone@test.com',
    //   },
    // })

    // expect(result.ingested).toBe(false)
  })

  test('sending message to wrong address returns error', async () => {
    await expect(
      av.__internal.mock.sendMessage({
        address: 'nonexistent@example.com',
        sourceId: 'msg-404',
        sourceThreadId: 'some-thread',
        date: new Date().toISOString(),
        text: 'hello',
        author: {
          email: 'someone@test.com',
        },
      })
    ).rejects.toThrowError()
  })

  /**
   * Test all channel interactions with environment assigned to channel.
   */
  describe("with environment assigned to channel", () => {
    beforeAll(async () => {
      channel = await av.channels.update(channel.id, { // connect environment to channel
        environmentId: env.id,
      })
    })

    test('configure channel with environment', async () => {
      expect(channel.environment).not.toBeNull()
      expect(channel.environment!.id).toBe(env.id)
    })

    test('send to existing channel address returns success', async () => {
      const result = await av.__internal.mock.sendMessage({
        address: ADDRESS,
        sourceId: 'msg-1',
        date: new Date().toISOString(),
        text: 'I need help with my order',
        sourceThreadId: 'success-thread',
        author: {
          email: 'customer@example.com',
        },
      })

      expect(result.message).toBeDefined()
      expect(result.message.direction).toBe('incoming')
      expect(result.message.status).toBe('received')
      expect(result.message.text).toBe('I need help with my order')
      expect(result.message.authorEmail).toBe('customer@example.com')

      expect(result.thread).toBeDefined()
    })

    test('dedupe - do not ingest duplicate messages', async () => {
      const result = await av.__internal.mock.sendMessage({
        address: ADDRESS,
        sourceId: 'dedupe-1',
        date: new Date().toISOString(),
        text: 'I need help with my order',
        sourceThreadId: 'dedupe-thread',
        author: {
          email: 'customer@example.com',
        },
      })

      expect(result.ingested).toBe(true)
      expect(result.message).toBeDefined()

      const result2 = await av.__internal.mock.sendMessage({
        address: ADDRESS,
        sourceId: 'dedupe-1',
        date: new Date().toISOString(),
        text: 'I need help with my order',
        sourceThreadId: 'dedupe-thread',
        author: {
          email: 'customer@example.com',
        },
      })

      expect(result2.ingested).toBe(false)
    })


    describe("Session and User assignment", () => {

      test('same author email → same user (across different threads)', async () => {
        const r1 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'user-test-1',
          date: new Date().toISOString(),
          text: 'first message from alice',
          sourceThreadId: 'alice-thread-1',
          author: {
            email: 'alice@example.com',
          },
        })

        const r2 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'user-test-2',
          date: new Date().toISOString(),
          text: 'second message from alice',
          sourceThreadId: 'alice-thread-2',
          author: {
            email: 'alice@example.com',
          },
        })

        const s1 = await av.getSession({ id: r1.sessionId })
        const s2 = await av.getSession({ id: r2.sessionId })

        expect(s1.userId).toBe(s2.userId)
        expect(s1.user.email).toBe('alice@example.com')
      })

      test('different author email → different user', async () => {
        const r1 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'diff-user-1',
          date: new Date().toISOString(),
          text: 'hello from bob',
          sourceThreadId: 'bob-thread',
          author: {
            email: 'bob@example.com',
          },
        })

        const r2 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'diff-user-2',
          date: new Date().toISOString(),
          text: 'hello from carol',
          sourceThreadId: 'carol-thread',
          author: {
            email: 'carol@example.com',
          },
        })

        const s1 = await av.getSession({ id: r1.sessionId })
        const s2 = await av.getSession({ id: r2.sessionId })

        expect(s1.userId).not.toBe(s2.userId)
      })

      test('same sourceThreadId → same session (same default thread)', async () => {
        const r1 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'same-session-1',
          sourceThreadId: 'same-thread',
          date: new Date().toISOString(),
          text: 'message one',
          author: {
            email: 'dave@example.com',
          },
        })

        const r2 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'same-session-2',
          sourceThreadId: 'same-thread',
          date: new Date().toISOString(),
          text: 'message two',
          author: {
            email: 'dave@example.com',
          },
        })

        expect(r1.sessionId).toBe(r2.sessionId)
      })

      test('different sourceThreadId → different session, same user', async () => {
        const r1 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'thread-a-1',
          date: new Date().toISOString(),
          text: 'thread A message',
          sourceThreadId: 'thread-A',
          author: {
            email: 'eve@example.com',
          },
        })

        const r2 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'thread-b-1',
          date: new Date().toISOString(),
          text: 'thread B message',
          sourceThreadId: 'thread-B',
          author: {
            email: 'eve@example.com',
          },
        })

        // Different threads → different sessions
        expect(r1.sessionId).not.toBe(r2.sessionId)

        // But same author → same user
        const s1 = await av.getSession({ id: r1.sessionId })
        const s2 = await av.getSession({ id: r2.sessionId })
        expect(s1.userId).toBe(s2.userId)
        expect(s1.user.email).toBe('eve@example.com')
      })

      test('same sourceThreadId → same session', async () => {
        const r1 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'sticky-1',
          date: new Date().toISOString(),
          text: 'first in thread X',
          sourceThreadId: 'thread-X',
          author: {
            email: 'frank@example.com',
          },
        })

        const r2 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'sticky-2',
          date: new Date().toISOString(),
          text: 'second in thread X',
          sourceThreadId: 'thread-X',
          author: {
            email: 'frank@example.com',
          },
          })

        expect(r1.sessionId).toBe(r2.sessionId)
      })
    })

    describe('Outgoing messages', () => {

      /**
       * Parrot handler: echoes ALL user messages in the session.
       * Each user message's text parts are joined by " ", messages separated by " | ".
       * e.g. session with user("A B") then user("C") → "A B | C"
       */
      function setParrotHandler(opts?: { delayMs?: number }) {
        mockServer!.setHandler((body, res) => {
          const messages = body.messages ?? []
          const userMessages = messages.filter((m: any) => m.role === 'user')
          const reply = userMessages
            .map((m: any) => (m.parts ?? [])
              .filter((p: any) => p.type === 'text')
              .map((p: any) => p.text)
              .join(' '))
            .join(' | ')

          // we send headers quickly
          writeAISDKSuccessHeaders(res);

          const respond = () => {
            writeAISDKChunks(res, [
              { type: 'start', messageId: 'msg_1' },
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', delta: reply },
              { type: 'text-end', id: 't1' },
              { type: 'finish', finishReason: 'stop' },
            ])
            writeAISDKDone(res);
            res.end();
          }

          if (opts?.delayMs) {
            setTimeout(respond, opts.delayMs)
          } else {
            respond()
          }
        })
      }

      function setFailHandler() {
        mockServer!.setHandler((_body, res) => {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ message: 'Internal server error inside test suite.' }))
        })
      }

      // Wait for any async outgoing messages from previous tests to settle
      // (failed runs now produce internal error messages that need time to deliver)
      beforeAll(async () => {
        await new Promise(r => setTimeout(r, 6000))
      }, 15000)

      // Each outgoing test uses its own sourceThreadId for isolation
      async function send(sourceId: string, text: string, sourceThreadId: string, date?: string) {
        return av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId,
          date: date ?? new Date().toISOString(),
          text,
          sourceThreadId,
          author: {
            email: 'outgoing-test@test.com',
          },
        })
      }

      // clear outbox before each test
      beforeEach(async () => {
        await av.__internal.mock.clearOutbox()
      })

      async function getOutbox(sourceThreadId: string) {
        return await av.__internal.mock.getOutbox(ADDRESS, sourceThreadId)
      }

      async function waitForOutboxCount(sourceThreadId: string, count: number) {
        const timeoutMs = 15000;
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
          const entries = await getOutbox(sourceThreadId)
          if (entries.length >= count) return entries
          await new Promise(r => setTimeout(r, 1000))
        }
        const entries = await getOutbox(sourceThreadId)
        expect(entries).toHaveLength(count)
        return entries
      }

      test('single message → single outgoing reply', async () => {
        setParrotHandler()
        await send('out-1', 'hello', 'single-thread')
        const entries = await waitForOutboxCount('single-thread', 1)
        expect(entries[0].text).toBe('hello')
      }, 15000)

      test('two sequential messages → two outgoing replies with session history', async () => {
        setParrotHandler()
        const sourceThreadId = 'seq-thread'

        await send('seq-1', 'first', sourceThreadId)
        await waitForOutboxCount(sourceThreadId, 1)

        await send('seq-2', 'second', sourceThreadId)
        const entries = await waitForOutboxCount(sourceThreadId, 2)

        expect(entries[0].text).toBe('first')
        // Second reply sees full session history: first user msg + second user msg
        expect(entries[1].text).toBe('first | second')
      }, 15000)

      test('rapid messages while agent is processing → batched into single outgoing reply', async () => {
        // Agent takes 2s to respond, giving us time to send more messages
        setParrotHandler({ delayMs: 4000 })

        const sourceThreadId = 'rapid-thread'
        
        await send('rapid-1', 'A', sourceThreadId, '2025-01-01T00:00:01Z')
        // Wait just enough for the worker to pick up the run, then send more
        await new Promise(r => setTimeout(r, 2000))

        send('rapid-2', 'B', sourceThreadId, '2025-01-01T00:00:02Z')
        send('rapid-3', 'C', sourceThreadId, '2025-01-01T00:00:03Z')

        // First run gets cancelled, second run batches all 3 messages → single outgoing
        const entries = await waitForOutboxCount(sourceThreadId, 1)
        expect(entries[0].text).toBe('A B C')
      }, 15000)

      test('agent failure → internal error outgoing, next message retries with batch', async () => {
        const sourceThreadId = 'fail-thread';

        // First message: agent fails
        setFailHandler()
        await send('fail-1', 'X', sourceThreadId)
        // Wait for the failed run — produces an internal error outgoing message
        let entries = await waitForOutboxCount(sourceThreadId, 1)
        expect(entries[0].text).toBeDefined();

        // Second message: agent succeeds, should batch both messages
        // (internal error message is excluded from previousRunId calculation)
        setParrotHandler()
        await send('fail-2', 'Y', 'fail-thread')

        entries = await waitForOutboxCount(sourceThreadId, 2)
        expect(entries[1].text).toBe('X Y')
      }, 15000)

      test('rapid out-of-order messages → batched in date order', async () => {
        const sourceThreadId = 'ooo-thread';
        setParrotHandler({ delayMs: 4000 })

        // Send 3 messages quickly with out-of-order dates
        await send('ooo-1', 'C', sourceThreadId, '2025-01-01T00:00:03Z')
        await new Promise(r => setTimeout(r, 2000))
        send('ooo-2', 'A', sourceThreadId, '2025-01-01T00:00:01Z')
        send('ooo-3', 'B', sourceThreadId, '2025-01-01T00:00:02Z')

        // Messages should be sorted by date, not insertion order
        const entries = await waitForOutboxCount(sourceThreadId, 1)
        expect(entries[0].text).toBe('A B C')
      }, 15000)

      test('out-of-order messages where first is already processed → preserves order', async () => {
        const sourceThreadId = 'order-thread';
        setParrotHandler()
        // B arrives first (later date) and gets fully processed
        await send('order-1', 'B', sourceThreadId, '2025-01-01T00:00:02Z')
        await waitForOutboxCount(sourceThreadId, 1)

        // A arrives second (earlier date) and gets processed as a new run
        await send('order-2', 'A', sourceThreadId, '2025-01-01T00:00:01Z')
        const entries = await waitForOutboxCount(sourceThreadId, 2)
        // First outgoing is from B (processed first), second from A (arrived later)
        expect(entries[0].text).toBe('B')
        expect(entries[1].text).toBe('B | A')
      }, 15000)

      test('data-agentview-output: overrides default channel reply', async () => {
        const sourceThreadId = 'output-thread';

        // Agent streams both text AND data-agentview-output.
        // The output part should override the default text-based reply.
        mockServer!.setHandler((body, res) => {
          writeAISDKSuccessHeaders(res)
          writeAISDKChunks(res, [
            { type: 'start', messageId: 'msg_1' },
            { type: 'text-start', id: 't1' },
            { type: 'text-delta', id: 't1', delta: 'This is internal reasoning text' },
            { type: 'text-end', id: 't1' },
            { type: 'data-agentview-output', data: 'Custom reply for channel' },
            { type: 'finish', finishReason: 'stop' },
          ])
          writeAISDKDone(res)
          res.end()
        })

        await send('output-1', 'please help', sourceThreadId)

        const entries = await waitForOutboxCount(sourceThreadId, 1)
        // Should use the data-agentview-output value, NOT the text part
        expect(entries[0].text).toBe('Custom reply for channel')
      }, 15000)

      test('data-agentview-output: object data is JSON-stringified', async () => {
        const sourceThreadId = 'output-obj-thread';

        mockServer!.setHandler((_body, res) => {
          writeAISDKSuccessHeaders(res)
          writeAISDKChunks(res, [
            { type: 'start', messageId: 'msg_1' },
            { type: 'text-start', id: 't1' },
            { type: 'text-delta', id: 't1', delta: 'Some text' },
            { type: 'text-end', id: 't1' },
            { type: 'data-agentview-output', data: { subject: 'Re: Help', body: 'Here is your answer' } },
            { type: 'finish', finishReason: 'stop' },
          ])
          writeAISDKDone(res)
          res.end()
        })

        await send('output-obj-1', 'help me', sourceThreadId)

        const entries = await waitForOutboxCount(sourceThreadId, 1)
        expect(entries[0].text).toBe(JSON.stringify({ subject: 'Re: Help', body: 'Here is your answer' }))
      }, 15000)

    })
  })



})
