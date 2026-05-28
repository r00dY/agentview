import { parseJsonEventStream, uiMessageChunkSchema, type ChatTransport, type UIMessage, type UIMessageChunk } from 'ai'

import { AgentViewError } from './AgentViewError.js'
import { throwIfNotOk } from './apiResponse.js'
import { getApiUrl } from './urls.js'
import type { Session, SessionCreate } from './apiTypes.js'
import type { AgentViewBase } from './client.js'

export type NewSessionParams = Omit<SessionCreate, 'id' | 'input'>

export interface CreateTransportOptions {
  newSession?: NewSessionParams
  onSessionCreated?: (event: { session: Session }) => void
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseUIMessageStream(response: Response): ReadableStream<UIMessageChunk> {
  if (!response.body) {
    throw new Error("The response body is empty.")
  }
  return parseJsonEventStream({
    stream: response.body,
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream({
      async transform(chunk, controller) {
        if (!chunk.success) {
          throw chunk.error
        }
        controller.enqueue(chunk.value)
      }
    })
  )
}

export class AgentViewChatTransport implements ChatTransport<UIMessage> {
  constructor(
    private readonly client: AgentViewBase,
    private readonly options: CreateTransportOptions = {}
  ) { }

  async sendMessages(opts: {
    trigger: 'submit-message' | 'regenerate-message'
    chatId: string
    messageId: string | undefined
    messages: UIMessage[]
    abortSignal: AbortSignal | undefined
  }): Promise<ReadableStream<UIMessageChunk>> {
    const { chatId, messages, trigger, abortSignal } = opts

    /**
     * ai-sdk guarantees:
     * - messages is already truncated to current UI state
     * - messages can't be empty (aisdk throws)
     * - last message is the user message (covers submit-message, regenerate-message, and edits)
     */
    const lastMessage = messages[messages.length - 1]
    if (!lastMessage) {
      throw new AgentViewError("Messages array is empty", 400)
    }
    if (lastMessage.role !== 'user') {
      throw new AgentViewError("Last message is not a user message", 400)
    }

    // null -> regenerate from root. undefined -> continue from last run.
    let previousRunId: string | null | undefined = undefined
    if (trigger === 'regenerate-message') {
      if (messages.length <= 1) {
        previousRunId = null
      } else {
        previousRunId = (messages[messages.length - 2].metadata as any)?._agentview?.id
        if (!previousRunId) {
          throw new AgentViewError("Previous run id is not found in messages history", 500)
        }
      }
    }

    const baseUrl = getApiUrl()
    const headers = this.client._getHeaders()

    // Optimistically post a new run to the assumed-existing session.
    const runsResponse = await fetch(`${baseUrl}/api/sessions/${chatId}/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input: lastMessage, previousRunId, stream: true }),
      signal: abortSignal,
    })

    // Session doesn't exist + newSession configured -> create it (transactional session+run)
    // and subscribe to the live stream of the run.
    if (runsResponse.status === 404 && this.options.newSession) {
      if (!UUID_REGEX.test(chatId)) {
        throw new AgentViewError("Cannot create a new session: chat id must be a valid UUID.", 400)
      }
      if (messages.length !== 1) {
        throw new AgentViewError("Cannot create a new session: messages must contain exactly one user message", 400)
      }

      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...this.options.newSession,
          id: chatId,
          input: lastMessage,
        }),
        signal: abortSignal,
      })

      await throwIfNotOk(createResponse)

      const session = await createResponse.json() as Session
      this.options.onSessionCreated?.({ session })

      const streamResponse = await fetch(`${baseUrl}/api/sessions/${chatId}/stream`, {
        method: 'GET',
        headers,
        signal: abortSignal,
      })
      await throwIfNotOk(streamResponse)
      return parseUIMessageStream(streamResponse)
    }

    await throwIfNotOk(runsResponse)
    return parseUIMessageStream(runsResponse)
  }

  async reconnectToStream(opts: { chatId: string }): Promise<ReadableStream<UIMessageChunk> | null> {
    const response = await fetch(`${getApiUrl()}/api/sessions/${opts.chatId}/stream`, {
      method: 'GET',
      headers: this.client._getHeaders(),
    })
    if (response.status === 204) return null
    await throwIfNotOk(response)
    return parseUIMessageStream(response)
  }
}
