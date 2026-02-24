import { describe, test, expect, beforeAll } from 'vitest'
import { AgentView, configDefaults } from 'agentview'
import type { Channel } from 'agentview'
import { seedUsers } from './seedUsers'

configDefaults.__internal = {
  disableSummaries: true,
}

describe('Channels (mock-email)', () => {
  let av: AgentView
  let avProd: AgentView
  let environmentId: string
  let channel: Channel
  const orgSlug = 'channels-test-' + Math.random().toString(36).slice(2)
  const address = `inbox@${orgSlug}.com`

  beforeAll(async () => {
    const result = await seedUsers(orgSlug)

    av = new AgentView({ apiKey: result.apiKeyDev.key })
    avProd = new AgentView({ apiKey: result.apiKeyProd.key })

    // Set up production environment with an agent
    const env = await avProd.updateEnvironment({
      config: {
        agents: [{ name: 'support-agent' }],
        __internal: { disableSummaries: true },
      },
    })
    environmentId = env.id
  })

  test('create mock-email channel', async () => {
    channel = await av.__internal.createMockEmailChannel({
      address,
    })

    expect(channel.id).toBeDefined()
    expect(channel.type).toBe('mock-email')
    expect(channel.address).toBe(address)
    expect(channel.status).toBe('active')
  })

  test('list channels includes new channel', async () => {
    const channels = await av.getChannels()
    expect(channels.length).toBeGreaterThanOrEqual(1)
    const found = channels.find(c => c.id === channel.id)
    expect(found).toBeDefined()
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

  test('send incoming email → thread + message created', async () => {
    const result = await av.__internal.sendMockEmail({
      address,
      contact: 'customer@example.com',
      subject: 'Hello',
      body: 'I need help with my order',
    })

    expect(result.message).toBeDefined()
    expect(result.message.direction).toBe('incoming')
    expect(result.message.status).toBe('received')
    expect(result.message.text).toBe('I need help with my order')

    expect(result.thread).toBeDefined()
    expect(result.thread.contact).toBe('customer@example.com')
    expect(result.thread.contactKind).toBe('email')
    expect(result.thread.status).toBe('dirty')
  })

  test('send another email to same contact → reuses thread', async () => {
    const result1 = await av.__internal.sendMockEmail({
      address,
      contact: 'customer@example.com',
      subject: 'Follow up',
      body: 'Still waiting on that order',
    })

    // Should reuse the same thread (same contact, no threadId, contactKind=email)
    const firstResult = await av.__internal.sendMockEmail({
      address,
      contact: 'customer@example.com',
      body: 'dummy to get thread id',
    })

    // All messages with no explicit threadId and same contact go to same thread
    expect(result1.thread.id).toBe(firstResult.thread.id)
  })

  test('send email with explicit threadId → creates separate thread', async () => {
    const result = await av.__internal.sendMockEmail({
      address,
      contact: 'customer@example.com',
      subject: 'Different conversation',
      body: 'This is a different thread',
      threadId: 'thread-abc-123',
    })

    // Should create a new thread because of the explicit threadId
    const noThreadResult = await av.__internal.sendMockEmail({
      address,
      contact: 'customer@example.com',
      body: 'no thread id message',
    })

    expect(result.thread.id).not.toBe(noThreadResult.thread.id)
    expect(result.thread.sourceThreadId).toBe('thread-abc-123')
  })

  test('get channel threads with messages', async () => {
    const threads = await av.getChannelThreads(channel.id)
    expect(threads.length).toBeGreaterThan(0)

    // Each thread should have messages
    for (const thread of threads) {
      expect(thread.messages).toBeDefined()
      expect(thread.messages.length).toBeGreaterThan(0)
    }

    // All messages should be incoming (we only sent incoming emails)
    const allMessages = threads.flatMap(t => t.messages)
    expect(allMessages.length).toBeGreaterThan(0)
    for (const msg of allMessages) {
      expect(msg.direction).toBe('incoming')
    }
  })

  test('archive and reactivate channel', async () => {
    const archived = await av.updateChannel(channel.id, {
      status: 'archived',
    })
    expect(archived.status).toBe('archived')

    const reactivated = await av.updateChannel(channel.id, {
      status: 'active',
    })
    expect(reactivated.status).toBe('active')
  })

  test('update nonexistent channel returns 404', async () => {
    await expect(
      av.updateChannel('00000000-0000-0000-0000-000000000000', {
        status: 'archived',
      })
    ).rejects.toThrowError(
      expect.objectContaining({ statusCode: 404 })
    )
  })

  test('send to nonexistent channel address returns 404', async () => {
    await expect(
      av.__internal.sendMockEmail({
        address: 'nonexistent@example.com',
        contact: 'someone@test.com',
        body: 'hello',
      })
    ).rejects.toThrowError(
      expect.objectContaining({ statusCode: 404 })
    )
  })
})
