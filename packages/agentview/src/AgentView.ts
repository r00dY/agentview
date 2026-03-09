import {
  type Session,
  type User,
  type UserCreate,
  type Run,
  type RunCreate,
  type RunUpdate,
  type SessionCreate,
  type SessionUpdate,
  type EnvironmentBase,
  type Environment,
  type EnvironmentCreate,
  type Space,
  type SessionsGetQueryParams,
  type SessionsPaginatedResponse,
  type PublicSessionsGetQueryParams,
  type CommentMessage,
  type Score,
  type SessionsStatsQueryParams,
  type SessionsStats,
  type RunDetails,
  type CommentMessageCreate,
  type ScoreCreate,
  type SessionStreamEvent,
  type Channel,
  type ChannelThread,
  type ChannelMessage,
  type Pagination,
  type InputTarget,
} from './apiTypes.js'

import { type AgentViewErrorBody, AgentViewError } from './AgentViewError.js'
import { serializeConfig } from './configUtils.js'
import { enhanceSession } from './sessionUtils.js'
import type { InternalConfig } from './configTypes.js'
import { getApiUrl } from './urls.js'
import { parseSSE } from './parseSSE.js'

export interface AgentViewOptions {
  apiKey?: string
  userToken?: string
  headers?: HeadersInit | (() => HeadersInit)
}

export const configDefaults: {
  __internal?: InternalConfig
} = { __internal: undefined }

export class AgentView {
  private apiKey?: string
  private userToken?: string
  private customHeaders?: HeadersInit | (() => HeadersInit)
  private credentials?: RequestCredentials

  constructor(options?: AgentViewOptions) {
    // If custom headers are provided (browser mode), don't require apiKey
    if (options?.headers) {
      this.customHeaders = options.headers
    } else {
      const apiKey = options?.apiKey ?? process.env.AGENTVIEW_API_KEY
      if (!apiKey) {
        throw new Error("AgentView: Missing API Key. Set it either via apiKey property of AgentView constructor or via AGENTVIEW_API_KEY environment variable.")
      }
      this.apiKey = apiKey
    }

    this.userToken = options?.userToken
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.customHeaders) {
      const customHeaders = typeof this.customHeaders === 'function' ? this.customHeaders() : this.customHeaders
      Object.assign(headers, customHeaders)
    } else {
      if (this.userToken) {
        headers['X-User-Token'] = this.userToken
      }
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    return headers
  }

  private async request<T>(
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

  async createSession(options: SessionCreate) {
    return enhanceSession(await this.request<Session>('POST', `/api/sessions`, options))
  }

  async getSession(options: { id: string }) {
    return enhanceSession(await this.request<Session>('GET', `/api/sessions/${options.id}`, undefined))
  }

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

  async updateSession(options: { id: string } & SessionUpdate) {
    return enhanceSession(await this.request<Session>('PATCH', `/api/sessions/${options.id}`, options))
  }

  async createRun(options: RunCreate): Promise<Run> {
    return await this.request<Run>('POST', `/api/runs`, options)
  }

  async updateRun(options: RunUpdate & { id: string }): Promise<Run> {
    return await this.request<Run>('PATCH', `/api/runs/${options.id}`, options)
  }

  async keepAliveRun(options: { id: string }): Promise<{ expiresAt: string | null }> {
    return await this.request<{ expiresAt: string | null }>('POST', `/api/runs/${options.id}/keep-alive`, undefined)
  }

  async createUser(options?: UserCreate): Promise<User> {
    return await this.request<User>('POST', `/api/users`, options ?? {})
  }

  async getUser(options?: { id: string } | { token: string } | { externalId: string } | undefined): Promise<User> {
    if (!options) {
      return await this.request<User>('GET', `/api/users/me`)
    }
    if ('id' in options) {
      return await this.request<User>('GET', `/api/users/${options.id}`)
    }
    if ('token' in options) {
      if (this.userToken && this.userToken !== options.token) {
        throw new Error('Cannot get user with token when scoped with another user\'s token')
      }
      return await this.as(options.token).request<User>('GET', `/api/users/me`)
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

  async getChannelThreads(channelId: string): Promise<ChannelThread[]> {
    return await this.request<ChannelThread[]>('GET', `/api/channels/${channelId}/threads`)
  }

  // --- Mock-email (internal/testing) ---

  __internal = {
    mock: {
      createChannel: async (data: { address: string }): Promise<Channel> => {
        return await this.request<Channel>('POST', `/api/channels/mock/create-channel`, data)
      },
      sendMessage: async (data: { address: string, sourceId: string, date: string, contact: string, contactKind: string, text: string, sourceThreadId?: string, providerData?: any }): Promise<any> => {
        return await this.request<{ message: ChannelMessage, thread: ChannelThread }>('POST', `/api/channels/mock/send-message`, data)
      },
      getOutbox: async (address?: string): Promise<Array<{ id: string, address: string, contact: string, contactKind: string, text: string | null, timestamp: number }>> => {
        const params = address ? `?address=${encodeURIComponent(address)}` : ''
        return await this.request('GET', `/api/channels/mock/outbox${params}`)
      },
    }
  }

  as(userOrToken: User | string) {
    const userToken = typeof userOrToken === 'string' ? userOrToken : userOrToken.token;

    return new AgentView({
      apiKey: this.apiKey,
      userToken,
      headers: this.customHeaders,
    })
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

  async updateComment(commentId: string, options: { content: string }): Promise<void> {
    return await this.request<void>('PUT', `/api/comments/${commentId}`, options)
  }

  async deleteComment(commentId: string): Promise<void> {
    return await this.request<void>('DELETE', `/api/comments/${commentId}`, undefined)
  }

  async updateScores(options: InputTarget & { scores: ScoreCreate[] }): Promise<void> {
    return await this.request<void>('PATCH', `/api/scores`, options)
  }


  async getSessionStream(options: { id: string, signal?: AbortSignal, wait?: boolean }): Promise<AsyncGenerator<{
    event: SessionStreamEvent;
    session: Session;
  }> | null> {
    const queryParams = options.wait ? '?wait=true' : ''

    const response = await fetch(`${getApiUrl()}/api/sessions/${options.id}/stream${queryParams}`, {
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

    let session: Session | undefined

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
}





export interface PublicAgentViewOptions {
  userToken: string
}

export class PublicAgentView {
  private userToken: string

  constructor(options: PublicAgentViewOptions) {
    this.userToken = options.userToken
  }

  private async request<T>(
    method: string,
    path: string,
    body?: any
  ): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    }

    headers['X-User-Token'] = this.userToken;

    const response = await fetch(`${getApiUrl()}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const errorBody: AgentViewErrorBody = await response.json()
      const { message, ...details } = errorBody;
      throw new AgentViewError(message ?? "Unknown error", response.status, details)
    }

    return await response.json()
  }

  async getMe(): Promise<User> {
    return await this.request<User>('GET', `/api/public/me`)
  }

  async getSession(options: { id: string }) {
    return enhanceSession(await this.request<Session>('GET', `/api/public/sessions/${options.id}`))
  }

  async getSessions(options?: PublicSessionsGetQueryParams) {
    let path = `/api/public/sessions`;
    const params = new URLSearchParams();
    if (options?.page) params.append('page', options.page.toString());
    if (options?.limit) params.append('limit', options.limit.toString());

    const queryString = params.toString();
    if (queryString) {
      path += `?${queryString}`;
    }

    return await this.request<SessionsPaginatedResponse>('GET', path)
  }
}