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
  OrganizationBase,
  UserWithToken,
} from './apiTypes.js'

import { AgentViewError } from './AgentViewError.js'
import { getApiUrl } from './urls.js'
import { DefaultChatTransport } from 'ai'

export type UserIdentifier = { id: string } | { externalId: string } | { token: string }

export interface AgentViewClientOptions {
  apiKey: string
  user?: UserIdentifier
  env?: string
  organizationId?: string
}

export class AgentViewBase {
  protected apiKey: string
  protected user?: UserIdentifier
  protected customHeaders?: HeadersInit | (() => HeadersInit)
  protected env?: string
  protected organizationId?: string

  users: UsersResource;

  constructor(options: AgentViewClientOptions) {
    this.apiKey = options.apiKey
    this.env = options.env
    this.organizationId = options.organizationId
    this.user = options.user
    this.users = new UsersResource(this);
  }

  _getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    headers['Authorization'] = `Bearer ${this.apiKey}`

    if (this.env) {
      headers['X-Env'] = this.env
    }

    if (this.user) {
      if ('token' in this.user) {
        headers['X-User-Token'] = this.user.token
      }
      if ('id' in this.user) {
        headers['X-User-Id'] = this.user.id
      }
      if ('externalId' in this.user) {
        headers['X-User-External-Id'] = this.user.externalId
      }
    }

    if (this.organizationId) {
      headers['X-Organization-Id'] = this.organizationId
    }

    return headers
  }

  async _request<T>(
    method: string,
    path: string,
    body?: any
  ): Promise<T> {
    const response = await fetch(`${getApiUrl()}${path}`, {
      method,
      headers: this._getHeaders(),
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

    // upstream response
    if (response.headers.get('X-Upstream-Response') === 'true') {
      const text = await response.text();
      if (!response.ok) {
        throw new Error(text);
      }
      return JSON.parse(text);
    }
    // agentview response
    else {
      const body = await response.json()
      if (!response.ok) {
        throw new AgentViewError(body.message ?? "Unknown error", response.status, body)
      }
      return body;
    }
  }




  // --- Shared methods ---

  async getOrganization(): Promise<OrganizationBase> {
    return await this._request<OrganizationBase>('GET', `/api/organization`)
  }

  async getSessionComments(options: { id: string }) {
    return await this._request<CommentMessage[]>('GET', `/api/sessions/${options.id}/comments`, undefined)
  }

  async getSessionScores(options: { id: string }) {
    return await this._request<Score[]>('GET', `/api/sessions/${options.id}/scores`, undefined)
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

    return await this._request<SessionsPaginatedResponse>('GET', path, undefined)
  }

  async getEnvironment(): Promise<Environment> {
    return await this._request<Environment>('GET', `/api/environment`)
  }

}

export class AgentViewClient extends AgentViewBase {
  async createSession(options: SessionCreate) {
    return await this._request<Session>('POST', `/api/sessions`, options)
  }

  async getSession(options: { id: string }) {
    return await this._request<Session>('GET', `/api/sessions/${options.id}`)
  }

  async updateSession(options: { id: string } & SessionUpdate) {
    return await this._request<Session>('PATCH', `/api/sessions/${options.id}`, options)
  }

  async createRun(options: RunCreate & { sessionId: string }) {
    const { sessionId, ...body } = options;
    return await this._request<Run>('POST', `/api/sessions/${sessionId}/runs`, body)
  }

  async cancelRun(options: { sessionId: string }) {
    return await this._request<Session>('POST', `/api/sessions/${options.sessionId}/cancel`)
  }

  createTransport() {
    const baseUrl = getApiUrl();
    /**
     * Here we leave "vanilla" error handling. It's because:
     * - 
     */
    return new DefaultChatTransport({
      headers: this._getHeaders(),
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

  asUser(userIdentifier: UserIdentifier): AgentViewClient {
    return new AgentViewClient({
      apiKey: this.apiKey,
      user: userIdentifier,
      env: this.env,
      organizationId: this.organizationId,
    })
  }
}

class UsersResource {
  constructor(private client: AgentViewBase) { }

  async create(options?: UserCreate): Promise<UserWithToken> {
    return await this.client._request<UserWithToken>('POST', `/api/users`, options ?? {})
  }

  async createAnon(): Promise<UserWithToken> {
    return await this.client._request<UserWithToken>('POST', `/api/users/anonymous`, {})
  }

  async me(): Promise<User> {
    return await this.client._request<User>('GET', `/api/users/me`)
  }

  async get(id: string) {
    return await this.client._request<User>('GET', `/api/users/${id}`)
  }

  async getByExternalId(externalId: string) {
    return await this.client._request<User>('GET', `/api/users/by-external-id/${externalId}`)
  }

  async update(options: UserCreate & { id: string }): Promise<User> {
    return await this.client._request<User>('PATCH', `/api/users/${options.id}`, options)
  }
}


export function createClient(options: AgentViewClientOptions): AgentViewClient {
  return new AgentViewClient(options)
}

