import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { createStandardClient, configDefaults, type StandardAgentViewClient } from 'agentview/clientStandard'
import type { Channel, Environment } from 'agentview/apiTypes'
import { z } from 'zod'
import { seedUsers } from './seedUsers'
import { createMockServer, writeAISDKStream } from './mockServer'
import type { MockServer } from './mockServer'

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
    av = createStandardClient({ apiKey: result.apiKeySecret.key, env: `dev:bob@${orgSlug}.com` })
    avProd = createStandardClient({ apiKey: result.apiKeySecret.key, env: 'production' })

    // create environment
    env = await avProd.updateEnvironment({
      config: {
        agents: [{
          name: 'support-agent',
          version: '1.0.0',
          url: AGENT_URL,
          adapter: 'ai-sdk',
          runs: [{
            input: { schema: z.looseObject({ role: z.literal('user'), parts: z.array(z.any()) }) },
            output: { schema: z.looseObject({ type: z.literal('text'), text: z.string() }) },
          }],
        }],
        channels: [{
          type: 'mock',
          address: ADDRESS,
          agent: 'support-agent',
        }],
        __internal: { disableSummaries: true },
      },
    });

    // create channel without env connected
    channel = await av.__internal.mock.createChannel({
      address: ADDRESS,
    })

    // // assign environment to channel
    // channel = await av.updateChannel(channel.id, {
    //   environmentId: env.id
    // })

  }, 30000)

  afterAll(async () => {
    if (mockServer) {
      await mockServer.close()
      mockServer = null
    }
  }, 30000)

  test('mock channel created successfully', async () => {
    expect(channel.id).toBeDefined()
    expect(channel.type).toBe('mock')
    expect(channel.address).toBe(ADDRESS)
  })

  test('list channels includes new channel', async () => {
    const channels = await av.getChannels()
    expect(channels.length).toBeGreaterThanOrEqual(1)
    const found = channels.find(c => c.id === channel.id)
    expect(found).toBeDefined()
  })

  test('sending message to correct address without environment results in no ingestion', async () => {
    const result = await av.__internal.mock.sendMessage({
      address: ADDRESS,
      sourceId: 'msg-404',
      date: new Date().toISOString(),
      contactKind: 'email',
      contact: 'someone@test.com',
      text: 'hello',
    })

    expect(result.ingested).toBe(false)
  })

  test('sending message to wrong address returns error', async () => {
    await expect(
      av.__internal.mock.sendMessage({
        address: 'nonexistent@example.com',
        sourceId: 'msg-404',
        date: new Date().toISOString(),
        contactKind: 'email',
        contact: 'someone@test.com',
        text: 'hello',
      })
    ).rejects.toThrowError(
      expect.objectContaining({ statusCode: 404 })
    )
  })

  /**
   * Test all channel interactions with environment assigned to channel.
   */
  describe("with environment assigned to channel", () => {
    beforeAll(async () => {
      channel = await av.updateChannel(channel.id, { // connect environment to channel
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
        contactKind: 'email',
        contact: 'customer@example.com',
        text: 'I need help with my order',
      })

      expect(result.message).toBeDefined()
      expect(result.message.direction).toBe('incoming')
      expect(result.message.status).toBe('received')
      expect(result.message.text).toBe('I need help with my order')

      expect(result.thread).toBeDefined()
      expect(result.thread.contact).toBe('customer@example.com')
      expect(result.thread.contactKind).toBe('email')
    })

    test('dedupe - do not ingest duplicate messages', async () => {
      const result = await av.__internal.mock.sendMessage({
        address: ADDRESS,
        sourceId: 'dedupe-1',
        date: new Date().toISOString(),
        contactKind: 'email',
        contact: 'customer@example.com',
        text: 'I need help with my order',
      })

      expect(result.ingested).toBe(true)
      expect(result.message).toBeDefined()

      const result2 = await av.__internal.mock.sendMessage({
        address: ADDRESS,
        sourceId: 'dedupe-1',
        date: new Date().toISOString(),
        contactKind: 'email',
        contact: 'customer@example.com',
        text: 'I need help with my order',
      })

      expect(result2.ingested).toBe(false)
    })


    describe("Session and User assignment", () => {

      test('same contact+contactKind → same user', async () => {
        const r1 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'user-test-1',
          date: new Date().toISOString(),
          contactKind: 'email',
          contact: 'alice@example.com',
          text: 'first message from alice',
        })

        const r2 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'user-test-2',
          date: new Date().toISOString(),
          contactKind: 'email',
          contact: 'alice@example.com',
          text: 'second message from alice',
        })

        const s1 = await av.getSession({ id: r1.sessionId })
        const s2 = await av.getSession({ id: r2.sessionId })

        expect(s1.userId).toBe(s2.userId)
        expect(s1.user.email).toBe('alice@example.com')
      })

      test('different contact → different user', async () => {
        const r1 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'diff-user-1',
          date: new Date().toISOString(),
          contactKind: 'email',
          contact: 'bob@example.com',
          text: 'hello from bob',
        })

        const r2 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'diff-user-2',
          date: new Date().toISOString(),
          contactKind: 'email',
          contact: 'carol@example.com',
          text: 'hello from carol',
        })

        const s1 = await av.getSession({ id: r1.sessionId })
        const s2 = await av.getSession({ id: r2.sessionId })

        expect(s1.userId).not.toBe(s2.userId)
      })

      test('same contact without sourceThreadId → same session', async () => {
        const r1 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'same-session-1',
          date: new Date().toISOString(),
          contactKind: 'email',
          contact: 'dave@example.com',
          text: 'message one',
        })

        const r2 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'same-session-2',
          date: new Date().toISOString(),
          contactKind: 'email',
          contact: 'dave@example.com',
          text: 'message two',
        })

        expect(r1.sessionId).toBe(r2.sessionId)
      })

      test('different sourceThreadId → different session, same user', async () => {
        const r1 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'thread-a-1',
          date: new Date().toISOString(),
          contactKind: 'email',
          contact: 'eve@example.com',
          text: 'thread A message',
          sourceThreadId: 'thread-A',
        })

        const r2 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'thread-b-1',
          date: new Date().toISOString(),
          contactKind: 'email',
          contact: 'eve@example.com',
          text: 'thread B message',
          sourceThreadId: 'thread-B',
        })

        // Different threads → different sessions
        expect(r1.sessionId).not.toBe(r2.sessionId)

        // But same contact → same user
        const s1 = await av.getSession({ id: r1.sessionId })
        const s2 = await av.getSession({ id: r2.sessionId })
        expect(s1.userId).toBe(s2.userId)
        expect(s1.user.email).toBe('eve@example.com')
      })

      test('same contact+contactKind+sourceThreadId → same session', async () => {
        const r1 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'sticky-1',
          date: new Date().toISOString(),
          contactKind: 'email',
          contact: 'frank@example.com',
          text: 'first in thread X',
          sourceThreadId: 'thread-X',
        })

        const r2 = await av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId: 'sticky-2',
          date: new Date().toISOString(),
          contactKind: 'email',
          contact: 'frank@example.com',
          text: 'second in thread X',
          sourceThreadId: 'thread-X',
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

          const respond = () => {
            writeAISDKStream(res, [
              { type: 'start', messageId: 'msg_1' },
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', delta: reply },
              { type: 'text-end', id: 't1' },
              { type: 'finish', finishReason: 'stop' },
            ])
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

      async function send(sourceId: string, contact: string, text: string, date?: string) {
        return av.__internal.mock.sendMessage({
          address: ADDRESS,
          sourceId,
          date: date ?? new Date().toISOString(),
          contactKind: 'email',
          contact,
          text,
        })
      }

      async function getOutboxFor(contact: string) {
        const outbox = await av.__internal.mock.getOutbox(ADDRESS)
        return outbox.filter(e => e.contact === contact)
      }

      async function waitForOutbox(contact: string, count: number, timeoutMs = 15000) {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
          const entries = await getOutboxFor(contact)
          if (entries.length >= count) return entries
          await new Promise(r => setTimeout(r, 1000))
        }
        const entries = await getOutboxFor(contact)
        expect(entries).toHaveLength(count)
        return entries
      }

      test('single message → single outgoing reply', async () => {
        setParrotHandler()

        await send('out-1', 'single@test.com', 'hello')

        const entries = await waitForOutbox('single@test.com', 1)
        expect(entries[0].text).toBe('hello')
      }, 20000)

      test('two sequential messages → two outgoing replies with session history', async () => {
        setParrotHandler()

        await send('seq-1', 'sequential@test.com', 'first')
        await waitForOutbox('sequential@test.com', 1)

        await send('seq-2', 'sequential@test.com', 'second')
        const entries = await waitForOutbox('sequential@test.com', 2)
        expect(entries[0].text).toBe('first')
        // Second reply sees full session history: first user msg + second user msg
        expect(entries[1].text).toBe('first | second')
      }, 30000)

      test('rapid messages while agent is processing → batched into single outgoing reply', async () => {
        // Agent takes 2s to respond, giving us time to send more messages
        setParrotHandler({ delayMs: 4000 })


        await send('rapid-1', 'rapid@test.com', 'A', '2025-01-01T00:00:01Z')
        // Wait just enough for the worker to pick up the run, then send more
        await new Promise(r => setTimeout(r, 2000))

        send('rapid-2', 'rapid@test.com', 'B', '2025-01-01T00:00:02Z')
        send('rapid-3', 'rapid@test.com', 'C', '2025-01-01T00:00:03Z')

        // First run gets cancelled, second run batches all 3 messages → single outgoing
        const entries = await waitForOutbox('rapid@test.com', 1)
        expect(entries[0].text).toBe('A B C')
      }, 20000)

      test('agent failure → no outgoing, next message retries with batch', async () => {
        // First message: agent fails
        setFailHandler()
        await send('fail-1', 'fail-retry@test.com', 'X')
        // Wait for the failed run to complete (no outgoing expected)
        await new Promise(r => setTimeout(r, 7000))

        // No outgoing message should exist
        let entries = await getOutboxFor('fail-retry@test.com')
        expect(entries).toHaveLength(0)

        // Second message: agent succeeds, should batch both messages
        setParrotHandler()
        await send('fail-2', 'fail-retry@test.com', 'Y')

        entries = await waitForOutbox('fail-retry@test.com', 1)
        expect(entries[0].text).toBe('X Y')
      }, 20000)

      test('rapid out-of-order messages → batched in date order', async () => {
        setParrotHandler({ delayMs: 4000 })

        // Send 3 messages quickly with out-of-order dates
        await send('ooo-1', 'out-of-order@test.com', 'C', '2025-01-01T00:00:03Z')
        await new Promise(r => setTimeout(r, 2000))
        send('ooo-2', 'out-of-order@test.com', 'A', '2025-01-01T00:00:01Z')
        send('ooo-3', 'out-of-order@test.com', 'B', '2025-01-01T00:00:02Z')

        // Messages should be sorted by date, not insertion order
        const entries = await waitForOutbox('out-of-order@test.com', 1)
        expect(entries[0].text).toBe('A B C')
      }, 20000)

      test('out-of-order messages where first is already processed → preserves order', async () => {
        setParrotHandler()

        // B arrives first (later date) and gets fully processed
        await send('order-1', 'order-preserved@test.com', 'B', '2025-01-01T00:00:02Z')
        await waitForOutbox('order-preserved@test.com', 1)

        // A arrives second (earlier date) and gets processed as a new run
        await send('order-2', 'order-preserved@test.com', 'A', '2025-01-01T00:00:01Z')
        const entries = await waitForOutbox('order-preserved@test.com', 2)
        // First outgoing is from B (processed first), second from A (arrived later)
        expect(entries[0].text).toBe('B')
        expect(entries[1].text).toBe('B | A')
      }, 20000)

    })
  })



})
