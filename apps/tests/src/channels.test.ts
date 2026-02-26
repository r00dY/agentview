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

describe('Channels - basic operations', () => {
  let av: AgentView
  let avProd: AgentView
  let environmentId: string
  let channel: Channel
  const orgSlug = 'channels-test-' + Math.random().toString(36).slice(2)
  const ADDRESS = `inbox@${orgSlug}.com`

  beforeAll(async () => {
    const result = await seedUsers(orgSlug)

    av = new AgentView({ apiKey: result.apiKeyDev.key })
    avProd = new AgentView({ apiKey: result.apiKeyProd.key })

    // Set up production environment with an agent
    const env = await avProd.updateEnvironment({
      config: {
        agents: [{
          name: 'support-agent',
          url: 'http://localhost:19999/agent',
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
  })

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
})

describe('Channels - outgoing message on agent success', () => {
  const AGENT_PORT = 3459
  const AGENT_URL = `http://localhost:${AGENT_PORT}/agent`

  const SAFE_DELIVERY_TIMEOUT_MS = 5000 // the time between sending and getting outgoing message in test environment.

  let av: AgentView
  let avProd: AgentView
  let environmentId: string
  let channel: Channel
  const orgSlug = 'channels-outgoing-' + Math.random().toString(36).slice(2)
  const ADDRESS = `outgoing@${orgSlug}.com`

  let mockServer: MockServer | null = null

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

    channel = await av.__internal.mock.createChannel({ address: ADDRESS })
    await av.updateChannel(channel.id, {
      environmentId,
      agent: 'support-agent',
    })
  }, 30000)

  afterAll(async () => {
    if (mockServer) {
      await mockServer.close()
      mockServer = null
    }
  }, 30000)

  test('incoming message triggers agent run and produces outgoing message', async () => {
    // Mock agent responds with a text message
    mockServer!.setHandler((_body, res) => {
      writeAISDKStream(res, [
        { type: 'start', messageId: 'msg_1' },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Here is your answer' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: 'stop' },
      ], { version: '1.0.0' })
    })

    // Send incoming message
    const result = await av.__internal.mock.sendMessage({
      address: ADDRESS,
      sourceId: 'outgoing-msg-1',
      date: new Date().toISOString(),
      contactKind: 'email',
      contact: 'user@example.com',
      text: 'I need help',
    })

    expect(result.ingested).toBe(true)
    expect(result.message.direction).toBe('incoming')

    // Wait for agent fetch + outgoing message delivery
    await new Promise(r => setTimeout(r, SAFE_DELIVERY_TIMEOUT_MS))

    const outbox = await av.__internal.mock.getOutbox(ADDRESS)
    const entry = outbox.find(e => e.contact === 'user@example.com')

    expect(entry).toBeDefined()
    expect(entry!.text).toBe('Here is your answer')
    expect(entry!.contact).toBe('user@example.com')
    expect(entry!.address).toBe(ADDRESS)
  }, 15000)
})
