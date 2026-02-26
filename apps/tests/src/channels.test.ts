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

describe('Channels (mock)', () => {
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

  test('send to nonexistent channel address returns error', async () => {
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
  // test('send incoming email → thread + message created', async () => {
  //   const result = await av.__internal.mock.sendMessage({
  //     address,
  //     sourceId: 'msg-1',
  //     date: new Date().toISOString(),
  //     contactKind: 'email',
  //     contact: 'customer@example.com',
  //     text: 'I need help with my order',
  //   })

  //   expect(result.message).toBeDefined()
  //   expect(result.message.direction).toBe('incoming')
  //   expect(result.message.status).toBe('received')
  //   expect(result.message.text).toBe('I need help with my order')

  //   expect(result.thread).toBeDefined()
  //   expect(result.thread.contact).toBe('customer@example.com')
  //   expect(result.thread.contactKind).toBe('email')
  // })










  // test('send another email to same contact → reuses thread', async () => {
  //   const result1 = await av.__internal.mock.sendMessage({
  //     address,
  //     sourceId: 'msg-2',
  //     date: new Date().toISOString(),
  //     contactKind: 'email',
  //     contact: 'customer@example.com',
  //     text: 'Still waiting on that order',
  //   })

  //   // Should reuse the same thread (same contact, no threadId, contactKind=email)
  //   const firstResult = await av.__internal.mock.sendMessage({
  //     address,
  //     sourceId: 'msg-3',
  //     date: new Date().toISOString(),
  //     contactKind: 'email',
  //     contact: 'customer@example.com',
  //     text: 'dummy to get thread id',
  //   })

  //   // All messages with no explicit threadId and same contact go to same thread
  //   expect(result1.thread.id).toBe(firstResult.thread.id)
  // })

  // test('send email with explicit threadId → creates separate thread', async () => {
  //   const result = await av.__internal.mock.sendMessage({
  //     address,
  //     sourceId: 'msg-4',
  //     date: new Date().toISOString(),
  //     contactKind: 'email',
  //     contact: 'customer@example.com',
  //     text: 'This is a different thread',
  //     sourceThreadId: 'thread-abc-123',
  //   })

  //   // Should create a new thread because of the explicit threadId
  //   const noThreadResult = await av.__internal.mock.sendMessage({
  //     address,
  //     sourceId: 'msg-5',
  //     date: new Date().toISOString(),
  //     contactKind: 'email',
  //     contact: 'customer@example.com',
  //     text: 'no thread id message',
  //   })

  //   expect(result.thread.id).not.toBe(noThreadResult.thread.id)
  //   expect(result.thread.sourceThreadId).toBe('thread-abc-123')
  // })

  // test('get channel threads with messages', async () => {
  //   const threads = await av.getChannelThreads(channel.id)
  //   expect(threads.length).toBeGreaterThan(0)

  //   // Each thread should have messages
  //   for (const thread of threads) {
  //     expect(thread.messages).toBeDefined()
  //     expect(thread.messages.length).toBeGreaterThan(0)
  //   }

  //   // All messages should be incoming (we only sent incoming emails)
  //   const allMessages = threads.flatMap(t => t.messages)
  //   expect(allMessages.length).toBeGreaterThan(0)
  //   for (const msg of allMessages) {
  //     expect(msg.direction).toBe('incoming')
  //   }
  // })

})

// describe('Channels outgoing messages', () => {
//   const AGENT_PORT = 3459
//   const AGENT_URL = `http://localhost:${AGENT_PORT}/agent`

//   let av: AgentView
//   let avProd: AgentView
//   let environmentId: string
//   let channel: Channel
//   const orgSlug = 'channels-outgoing-' + Math.random().toString(36).slice(2)
//   const address = `outgoing@${orgSlug}.com`

//   let mockServer: MockServer | null = null

//   beforeAll(async () => {
//     mockServer = await createMockServer(AGENT_PORT)

//     const result = await seedUsers(orgSlug)
//     av = new AgentView({ apiKey: result.apiKeyDev.key })
//     avProd = new AgentView({ apiKey: result.apiKeyProd.key })

//     // Set up production environment with ai-sdk agent pointing to mock server
//     const inputSchema = z.looseObject({ role: z.literal('user'), parts: z.array(z.any()) })
//     const outputSchema = z.looseObject({ type: z.literal('text'), text: z.string() })

//     const env = await avProd.updateEnvironment({
//       config: {
//         agents: [{
//           name: 'support-agent',
//           url: AGENT_URL,
//           protocol: 'ai-sdk',
//           runs: [{
//             input: { schema: inputSchema },
//             output: { schema: outputSchema },
//           }],
//         }],
//         __internal: { disableSummaries: true },
//       },
//     })
//     environmentId = env.id

//     // Create and configure channel
//     channel = await av.__internal.mock.createChannel({ address })
//     await av.updateChannel(channel.id, {
//       environmentId,
//       agent: 'support-agent',
//     })
//   }, 30000)

//   afterAll(async () => {
//     if (mockServer) {
//       await mockServer.close()
//       mockServer = null
//     }
//   }, 30000)

//   test('incoming email triggers run, outgoing message sent on completion', async () => {
//     // Set up mock agent to respond with text
//     mockServer!.setHandler((_body, res) => {
//       writeAISDKStream(res, [
//         { type: 'start', messageId: 'msg_1' },
//         { type: 'text-start', id: 't1' },
//         { type: 'text-delta', id: 't1', delta: 'Here is your answer' },
//         { type: 'text-end', id: 't1' },
//         { type: 'finish', finishReason: 'stop' },
//       ], { version: '1.0.0' })
//     })

//     // Send incoming email
//     const result = await av.__internal.mock.sendMessage({
//       address,
//       sourceId: 'outgoing-msg-1',
//       date: new Date().toISOString(),
//       contactKind: 'email',
//       contact: 'user@example.com',
//       text: 'I need help',
//     })

//     expect(result.message.direction).toBe('incoming')

//     // Poll channel threads until outgoing message appears with status 'sent'
//     const startTime = Date.now()
//     const timeoutMs = 30000
//     let outgoingMessage: any = null

//     while (Date.now() - startTime < timeoutMs) {
//       const threads = await av.getChannelThreads(channel.id)
//       const thread = threads.find(t => t.id === result.thread.id)
//       if (thread) {
//         outgoingMessage = thread.messages.find(
//           m => m.direction === 'outgoing' && m.status === 'sent'
//         )
//         if (outgoingMessage) break
//       }
//       await new Promise(r => setTimeout(r, 500))
//     }

//     expect(outgoingMessage).toBeDefined()
//     expect(outgoingMessage.direction).toBe('outgoing')
//     expect(outgoingMessage.status).toBe('sent')
//     expect(outgoingMessage.text).toBe('Here is your answer')
//   }, 60000)
// })
