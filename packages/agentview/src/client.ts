import {
  type StandardSession,
  type User,
  type UserCreate,
  type StandardRun,
  type StandardRunCreate,
  type ManualRunCreate,
  type ManualRunUpdate,
  type StandardSessionCreate,
  type SessionUpdate,
  type EnvironmentBase,
  type Environment,
  type EnvironmentCreate,
  type SessionsGetQueryParams,
  type SessionsPaginatedResponse,
  type CommentMessage,
  type Score,
  type SessionsStatsQueryParams,
  type SessionsStats,
  type ScoreCreate,
  type SessionStreamEvent,
  type Channel,
  type InputTarget,
  type Session,
  type SessionCreate,
  type Run,
  type RunCreate,
} from './apiTypes.js'

import { type AgentViewErrorBody, AgentViewError } from './AgentViewError.js'
import { serializeConfig } from './baseConfigUtils.js'
import { enhanceSession } from './sessionUtils.js'
import type { InternalConfig } from './baseConfigTypes.js'
import { getApiUrl } from './urls.js'
import { parseSSE } from './parseSSE.js'
import { parseAISDKDataStream } from './parseAISDKDataStream.js'

export interface AgentViewOptions {
  apiKey?: string
  userToken?: string
  env?: string
  headers?: HeadersInit | (() => HeadersInit)
}

export const configDefaults: {
  __internal?: InternalConfig
} = { __internal: undefined }

export class AgentViewBase {
  protected apiKey: string
  protected userToken?: string
  protected customHeaders?: HeadersInit | (() => HeadersInit)
  protected env?: string

  constructor(options?: AgentViewOptions) {
    this.apiKey = options?.apiKey ?? ''
    this.userToken = options?.userToken
    this.env = options?.env
    this.customHeaders = options?.headers
  }

  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    headers['Authorization'] = `Bearer ${this.apiKey}`

    if (this.env) {
      headers['X-Env'] = this.env
    }

    if (this.userToken) {
      headers['X-User-Token'] = this.userToken
    }

    if (this.customHeaders) {
      const customHeaders = typeof this.customHeaders === 'function' ? this.customHeaders() : this.customHeaders
      Object.assign(headers, customHeaders)
    }

    return headers
  }

  protected async request<T>(
    method: string,
    path: string,
    body?: any
  ): Promise<T> {
    const response = await fetch(`${getApiUrl()}${path}`, {
      method,
      headers: this.getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    })

    // artificial delay
    if (typeof import.meta !== 'undefined') {
      // @ts-ignore
      const artificialDelayMs = import.meta.env?.VITE_AGENTVIEW_ARTIFICIAL_DELAY_MS;
      if (artificialDelayMs) {
        await new Promise(resolve => setTimeout(resolve, parseInt(artificialDelayMs)))
      }
    }

    if (!response.ok) {
      const errorBody: AgentViewErrorBody = await response.json()
      const { message, ...details } = errorBody;
      throw new AgentViewError(message ?? "Unknown error", response.status, details)
    }

    return await response.json()
  }

  // --- Shared methods ---

  async getSessionComments(options: { id: string }) {
    return await this.request<CommentMessage[]>('GET', `/api/sessions/${options.id}/comments`, undefined)
  }

  async getSessionScores(options: { id: string }) {
    return await this.request<Score[]>('GET', `/api/sessions/${options.id}/scores`, undefined)
  }

  async getSessions(options?: SessionsGetQueryParams) {
    let path = `/api/sessions`;
    const params = new URLSearchParams();

    if (options?.page) params.append('page', options.page.toString());
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.userId) params.append('userId', options.userId);
    if (options?.space) params.append('space', options.space);

    const queryString = params.toString();
    if (queryString) {
      path += `?${queryString}`;
    }

    return await this.request<SessionsPaginatedResponse>('GET', path, undefined)
  }

  async createManualRun(options: ManualRunCreate & { sessionId: string }): Promise<StandardRun> {
    const { sessionId, ...body } = options;
    return await this.request<StandardRun>('POST', `/api/sessions/${sessionId}/runs/manual`, body)
  }

  async updateManualRun(options: ManualRunUpdate & { id: string }): Promise<StandardRun> {
    return await this.request<StandardRun>('PATCH', `/api/runs/${options.id}/manual`, options)
  }

  async cancelRun(options: { id: string }): Promise<StandardRun> {
    return await this.request<StandardRun>('POST', `/api/runs/${options.id}/cancel`)
  }

  async keepAliveRun(options: { id: string }): Promise<{ expiresAt: string | null }> {
    return await this.request<{ expiresAt: string | null }>('POST', `/api/runs/${options.id}/keep-alive`, undefined)
  }

  async createUser(options?: UserCreate): Promise<User> {
    return await this.request<User>('POST', `/api/users`, options ?? {})
  }

  async getMe(): Promise<User> {
    return await this.request<User>('GET', `/api/users/me`)
  }

  async getUser(options: { id: string } | { token: string } | { externalId: string }): Promise<User> {
    if ('id' in options) {
      return await this.request<User>('GET', `/api/users/${options.id}`)
    }
    if ('token' in options) {
      if (this.userToken && this.userToken !== options.token) {
        throw new Error('Cannot get user with token when scoped with another user\'s token')
      }
      const scoped = new AgentViewBase({
        apiKey: this.apiKey,
        userToken: options.token,
        env: this.env,
        headers: this.customHeaders,
      })
      return await scoped.request<User>('GET', `/api/users/me`)
    }
    if ('externalId' in options) {
      return await this.request<User>('GET', `/api/users/by-external-id/${options.externalId}`)
    }
    throw new Error('Invalid options')
  }

  async updateUser(options: UserCreate & { id: string }): Promise<User> {
    return await this.request<User>('PATCH', `/api/users/${options.id}`, options)
  }

  async getEnvironments(): Promise<EnvironmentBase[]> {
    return await this.request<EnvironmentBase[]>('GET', `/api/environments`)
  }

  async getEnvironment(): Promise<Environment> {
    return await this.request<Environment>('GET', `/api/environment`)
  }

  async updateEnvironment(body: EnvironmentCreate): Promise<Environment> {
    let config = body.config;

    if (configDefaults.__internal) {
      config = {
        ...config,
        __internal: {
          ...configDefaults.__internal,
          ...(config.__internal ?? {}),
        }
      }
    }

    return await this.request<Environment>('PATCH', `/api/environment`, { ...body, config: serializeConfig(config) })
  }

  async getChannels(): Promise<Channel[]> {
    return await this.request<Channel[]>('GET', `/api/channels`)
  }

  async updateChannel(channelId: string, data: { environmentId?: string | null }): Promise<Channel> {
    return await this.request<Channel>('PATCH', `/api/channels/${channelId}`, data)
  }

  // --- Mock-email (internal/testing) ---

  __internal = {
    mock: {
      createChannel: async (data: { address: string }): Promise<Channel> => {
        return await this.request<Channel>('POST', `/api/channels/mock/create-channel`, data)
      },
      sendMessage: async (data: { address: string, sourceId: string, date: string, contact: string, contactKind: string, text: string, sourceThreadId?: string, providerData?: any }): Promise<any> => {
        return await this.request<any>('POST', `/api/channels/mock/send-message`, data)
      },
      getOutbox: async (address?: string): Promise<Array<{ id: string, address: string, contact: string, contactKind: string, text: string | null, timestamp: number }>> => {
        const params = address ? `?address=${encodeURIComponent(address)}` : ''
        return await this.request('GET', `/api/channels/mock/outbox${params}`)
      },
    }
  }

  async markSeen(options: InputTarget): Promise<void> {
    return await this.request<void>('POST', `/api/seen`, options)
  }

  async getSessionsStats(options?: SessionsStatsQueryParams): Promise<SessionsStats> {
    let path = `/api/sessions/stats`
    const params = new URLSearchParams()

    if (options?.space) params.append('space', options.space)
    if (options?.page) params.append('page', options.page.toString())
    if (options?.limit) params.append('limit', options.limit.toString())
    if (options?.userId) params.append('userId', options.userId)
    if (options?.granular) params.append('granular', 'true')

    const queryString = params.toString()
    if (queryString) {
      path += `?${queryString}`
    }

    return await this.request<SessionsStats>('GET', path, undefined)
  }

  async createComment(options: InputTarget & { content: string }): Promise<void> {
    return await this.request<void>('POST', `/api/comments`, options)
  }

  async updateComment(options: { id: string, content: string }): Promise<void> {
    const { id, ...rest } = options
    return await this.request<void>('PUT', `/api/comments/${id}`, rest)
  }

  async deleteComment(options: { id: string }): Promise<void> {
    return await this.request<void>('DELETE', `/api/comments/${options.id}`, undefined)
  }

  async updateScores(options: InputTarget & { scores: ScoreCreate[] }): Promise<void> {
    return await this.request<void>('PATCH', `/api/scores`, options)
  }
}

export class StandardAgentViewClient extends AgentViewBase {
  async createSession(options: StandardSessionCreate) {
    return enhanceSession(await this.request<StandardSession>('POST', `/api/sessions/standard`, options))
  }

  async getSession(options: { id: string }) {
    return enhanceSession(await this.request<StandardSession>('GET', `/api/sessions/${options.id}/standard`, undefined))
  }

  async updateSession(options: { id: string } & SessionUpdate) {
    return enhanceSession(await this.request<StandardSession>('PATCH', `/api/sessions/${options.id}`, options))
  }

  async createRun(options: StandardRunCreate & { sessionId: string }): Promise<StandardRun> {
    const { sessionId, ...body } = options;
    return await this.request<StandardRun>('POST', `/api/sessions/${sessionId}/runs/standard`, body)
  }

  async getSessionStream(options: { id: string, signal?: AbortSignal }): Promise<AsyncGenerator<{
    event: SessionStreamEvent;
    session: StandardSession;
  }> | null> {
    let url = `${getApiUrl()}/api/sessions/${options.id}/stream/standard`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: options.signal
    })

    if (!response.ok) {
      const errorBody: AgentViewErrorBody = await response.json()
      const { message, ...details } = errorBody
      console.log("Error watching session", message, details);
      throw new AgentViewError(message ?? "Unknown error", response.status, details)
    }

    if (response.status === 204) {
      return null;
    }

    let session: StandardSession | undefined

    return (async function* () {
      for await (const rawEvent of parseSSE(response)) {
        const event: SessionStreamEvent = {
          type: rawEvent.event,
          data: rawEvent.data
        }

        if (rawEvent.event === 'session.snapshot') {
          session = rawEvent.data
        } else if (rawEvent.event === 'run.updated' && session) {
          session = {
            ...session,
            runs: session.runs.map(run => {
              if (run.id === rawEvent.data.id) {
                return {
                  ...run,
                  ...rawEvent.data,
                  sessionItems: [
                    ...run.sessionItems,
                    ...(rawEvent.data.sessionItems ?? [])
                  ]
                }
              }
              return run
            })
          }
        } else if (rawEvent.event === 'run.patch' && session) {
          const lastRun = session.runs[session.runs.length - 1];
          if (lastRun) {
            session = {
              ...session,
              runs: session.runs.map(run => {
                if (run.id !== lastRun.id) return run;
                return {
                  ...run,
                  ...(rawEvent.data.status && { status: rawEvent.data.status }),
                  ...(rawEvent.data.metadata && { metadata: rawEvent.data.metadata }),
                  ...(rawEvent.data.failReason !== undefined && { failReason: rawEvent.data.failReason }),
                  updatedAt: rawEvent.data.updatedAt,
                  sessionItems: [
                    ...run.sessionItems,
                    ...(rawEvent.data.items ?? [])
                  ]
                }
              })
            }
          }
        }

        if (session) {
          yield {
            event,
            session: enhanceSession(session)
          }
        }
      }
    })();
  }

  as(userOrToken: User | string): StandardAgentViewClient {
    const userToken = typeof userOrToken === 'string' ? userOrToken : userOrToken.token;
    return new StandardAgentViewClient({
      apiKey: this.apiKey,
      userToken,
      env: this.env,
      headers: this.customHeaders,
    })
  }
}

export class AgentViewClient extends AgentViewBase {
  async createSession(options: SessionCreate) {
    return await this.request<Session>('POST', `/api/sessions`, options)
  }

  async getSession(options: { id: string }) {
    return await this.request<Session>('GET', `/api/sessions/${options.id}`)
  }

  async updateSession(options: { id: string } & SessionUpdate) {
    return await this.request<Session>('PATCH', `/api/sessions/${options.id}`, options)
  }

  async createRun(options: RunCreate & { sessionId: string }): Promise<Run> {
    const { sessionId, ...body } = options;
    return await this.request<Run>('POST', `/api/sessions/${sessionId}/runs`, body)
  }

  /**
   * Creates a run and returns the raw AI SDK SSE stream.
   * Each yielded value is a parsed AI SDK chunk (the JSON from `data: <json>`).
   * The stream ends when `data: [DONE]` is received.
   */
  async createRunStream(options: RunCreate & { sessionId: string, signal?: AbortSignal }): Promise<AsyncGenerator<any, void, unknown>> {
    const { sessionId, signal, ...body } = options;
    const response = await fetch(`${getApiUrl()}/api/sessions/${sessionId}/runs`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        ...body,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const errorBody: AgentViewErrorBody = await response.json();
      const { message, ...details } = errorBody;
      throw new AgentViewError(message ?? "Unknown error", response.status, details);
    }

    return parseAISDKDataStream(response);
  }

  as(userOrToken: User | string): AgentViewClient {
    const userToken = typeof userOrToken === 'string' ? userOrToken : userOrToken.token;
    return new AgentViewClient({
      apiKey: this.apiKey,
      userToken,
      env: this.env,
      headers: this.customHeaders,
    })
  }
}

export function createStandardClient(options?: AgentViewOptions): StandardAgentViewClient {
  return new StandardAgentViewClient(options)
}

export function createClient(options?: AgentViewOptions): AgentViewClient {
  return new AgentViewClient(options)
}
