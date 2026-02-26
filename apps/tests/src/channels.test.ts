import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { AgentView, configDefaults } from 'agentview'
import type { Channel } from 'agentview'
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
  const SAFE_DELIVERY_TIMEOUT_MS = 5000

  let av: AgentView
  let avProd: AgentView
  let environmentId: string
  let channel: Channel
  let mockServer: MockServer | null = null
  const orgSlug = 'channels-test-' + Math.random().toString(36).slice(2)
  const ADDRESS = `inbox@${orgSlug}.com`

  beforeAll(async () => {
    mockServer = await createMockServer(AGENT_PORT)

    const result = await seedUsers(orgSlug)
    av = new AgentView({ apiKey: result.apiKeyDev.key })
    avProd = new AgentView({ apiKey: result.apiKeyProd.key })

    const env = await avProd.updateEnvironment({
      config: {
        agents: [{
          name: 'support-agent',
          url: AGENT_URL,
          protocol: 'ai-sdk',
          runs: [{
            input: { schema: z.looseObject({ role: z.literal('user'), parts: z.array(z.any()) }) },
            output: { schema: z.looseObject({ type: z.literal('text'), text: z.string() }) },
          }],
        }],
        __internal: { disableSummaries: true },
      },
    })
    environmentId = env.id
  }, 30000)

  afterAll(async () => {
    if (mockServer) {
      await mockServer.close()
      mockServer = null
    }
  }, 30000)

  test('create mock channel', async () => {
    channel = await av.__internal.mock.createChannel({
      address: ADDRESS,
    })
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

  test('unconnected environment or agent', async () => {
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

  test('configure channel with environment + agent', async () => {
    const updated = await av.updateChannel(channel.id, {
      environmentId,
      agent: 'support-agent',
    })

    expect(updated.environment).not.toBeNull()
    expect(updated.environment!.id).toBe(environmentId)
    expect(updated.agent).toBe('support-agent')
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

    /** Handler that parrots all user text parts back, joined by spaces */
    function setParrotHandler(opts?: { delayMs?: number }) {
      mockServer!.setHandler((body, res) => {
        const messages = body.messages ?? []
        const userMsg = messages.findLast((m: any) => m.role === 'user')
        const texts = (userMsg?.parts ?? [])
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
        const reply = texts.join(' ')

        const respond = () => {
          writeAISDKStream(res, [
            { type: 'start', messageId: 'msg_1' },
            { type: 'text-start', id: 't1' },
            { type: 'text-delta', id: 't1', delta: reply },
            { type: 'text-end', id: 't1' },
            { type: 'finish', finishReason: 'stop' },
          ], { version: '1.0.0' })
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
        res.end(JSON.stringify({ message: 'Internal server error' }))
      })
    }

    async function send(sourceId: string, contact: string, text: string) {
      return av.__internal.mock.sendMessage({
        address: ADDRESS,
        sourceId,
        date: new Date().toISOString(),
        contactKind: 'email',
        contact,
        text,
      })
    }

    async function getOutboxFor(contact: string) {
      const outbox = await av.__internal.mock.getOutbox(ADDRESS)
      return outbox.filter(e => e.contact === contact)
    }

    test('single message → single outgoing reply', async () => {
      setParrotHandler()

      await send('out-1', 'single@test.com', 'hello')

      await new Promise(r => setTimeout(r, SAFE_DELIVERY_TIMEOUT_MS))

      const entries = await getOutboxFor('single@test.com')
      expect(entries).toHaveLength(1)
      expect(entries[0].text).toBe('hello')
    }, 15000)

    test('two sequential messages → two outgoing replies', async () => {
      setParrotHandler()

      await send('seq-1', 'sequential@test.com', 'first')
      await new Promise(r => setTimeout(r, SAFE_DELIVERY_TIMEOUT_MS))

      await send('seq-2', 'sequential@test.com', 'second')
      await new Promise(r => setTimeout(r, SAFE_DELIVERY_TIMEOUT_MS))

      const entries = await getOutboxFor('sequential@test.com')
      expect(entries).toHaveLength(2)
      expect(entries[0].text).toBe('first')
      expect(entries[1].text).toBe('second')
    }, 30000)

    test('rapid messages while agent is processing → batched into single outgoing reply', async () => {
      // Agent takes 2s to respond, giving us time to send more messages
      setParrotHandler({ delayMs: 2000 })

      await send('rapid-1', 'rapid@test.com', 'A')
      // Wait just enough for the worker to pick up the run, then send more
      await new Promise(r => setTimeout(r, 500))
      await send('rapid-2', 'rapid@test.com', 'B')
      await send('rapid-3', 'rapid@test.com', 'C')

      await new Promise(r => setTimeout(r, SAFE_DELIVERY_TIMEOUT_MS + 3000))

      const entries = await getOutboxFor('rapid@test.com')
      // First run gets cancelled, second run batches all 3 messages → single outgoing
      expect(entries).toHaveLength(1)
      expect(entries[0].text).toBe('A B C')
    }, 20000)

    test('agent failure → no outgoing, next message retries with batch', async () => {
      // First message: agent fails
      setFailHandler()
      await send('fail-1', 'fail-retry@test.com', 'X')
      await new Promise(r => setTimeout(r, SAFE_DELIVERY_TIMEOUT_MS))

      // No outgoing message should exist
      let entries = await getOutboxFor('fail-retry@test.com')
      expect(entries).toHaveLength(0)

      // Second message: agent succeeds, should batch both messages
      setParrotHandler()
      await send('fail-2', 'fail-retry@test.com', 'Y')
      await new Promise(r => setTimeout(r, SAFE_DELIVERY_TIMEOUT_MS))

      entries = await getOutboxFor('fail-retry@test.com')
      expect(entries).toHaveLength(1)
      expect(entries[0].text).toBe('X Y')
    }, 20000)

  })
})
