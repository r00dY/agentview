import type {
  User,
  UserCreate,
  SessionUpdate,
  Environment,
  SessionsGetQueryParams,
  SessionsPaginatedResponse,
  CommentMessage,
  Score,
  Session,
  SessionCreate,
  Run,
  RunCreate,
} from './apiTypes.js'

import { type AgentViewErrorBody, AgentViewError } from './AgentViewError.js'
import { getApiUrl } from './urls.js'
import { DefaultChatTransport } from 'ai'

export interface AgentViewClientOptions {
  apiKey: string
  userToken?: string
  env?: string
  organizationId?: string
}

export class AgentViewBase {
  protected apiKey: string
  protected userToken?: string
  protected customHeaders?: HeadersInit | (() => HeadersInit)
  protected env?: string
  protected organizationId?: string

  constructor(options: AgentViewClientOptions) {
    this.apiKey = options.apiKey
    this.userToken = options.userToken
    this.env = options.env
    this.organizationId = options.organizationId
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

    if (this.organizationId) {
      headers['X-Organization-Id'] = this.organizationId
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
      if (response.headers.get('X-Upstream-Response') === 'true') {
        const text = await response.text();
        throw new Error(text);
      }

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
        env: this.env
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

  async getEnvironment(): Promise<Environment> {
    return await this.request<Environment>('GET', `/api/environment`)
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

  async createRun(options: RunCreate & { sessionId: string }) {
    const { sessionId, ...body } = options;
    return await this.request<Run>('POST', `/api/sessions/${sessionId}/runs`, body)
  }

  async cancelRun(options: { sessionId: string }) {
    return await this.request<Session>('POST', `/api/sessions/${options.sessionId}/cancel`)
  }

  createTransport() {
    const baseUrl = getApiUrl();
    return new DefaultChatTransport({
      headers: this.getHeaders(),
      prepareSendMessagesRequest: ({ id, messages }) => ({
        api: `${baseUrl}/api/sessions/${id}/runs`,
        body: {
          input: messages[messages.length - 1],
          stream: true
        },
      }),
      prepareReconnectToStreamRequest: ({ id }) => ({
        api: `${baseUrl}/api/sessions/${id}/stream`,
      })
    })
  }

  as(userOrToken: User | string): AgentViewClient {
    const userToken = typeof userOrToken === 'string' ? userOrToken : userOrToken.token;
    return new AgentViewClient({
      apiKey: this.apiKey,
      userToken,
      env: this.env,
      organizationId: this.organizationId,
    })
  }
}

export function createClient(options: AgentViewClientOptions): AgentViewClient {
  return new AgentViewClient(options)
}

