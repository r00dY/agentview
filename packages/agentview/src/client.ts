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
  SessionsStatsQueryParams,
  SessionsStats,
  InputTarget,
  ScoreCreate,
  Channel,
  RunUpdate,
  Token,
  TokenWithSecret
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
  protected organizationId?: string // required only for session auth

  users: UsersResource;
  auth: AuthResource;
  comments: CommentsResource;
  scores: ScoresResource;
  channels: ChannelsResource;
  organization: OrganizationsResource;
  environments: EnvironmentsResource;

  constructor(options: AgentViewClientOptions) {
    this.apiKey = options.apiKey
    this.env = options.env
    this.organizationId = options.organizationId
    this.user = options.user

    this.users = new UsersResource(this);
    this.auth = new AuthResource(this);
    this.comments = new CommentsResource(this);
    this.scores = new ScoresResource(this);
    this.channels = new ChannelsResource(this);
    this.organization = new OrganizationsResource(this);
    this.environments = new EnvironmentsResource(this);
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
    body?: any,
    options?: { signal?: AbortSignal }
  ): Promise<T> {
    const response = await fetch(`${getApiUrl()}${path}`, {
      method,
      headers: this._getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      signal: options?.signal,
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

  __internal = {
    mock: {
      createChannel: async (data: { address: string }): Promise<Channel> => {
        return await this._request<Channel>('POST', `/api/channels/mock/create-channel`, data)
      },
      sendMessage: async (data: { address: string, sourceId: string, date: string, text: string, sourceThreadId: string, providerData?: any, author: { email: string, name?: string, headline?: string, details?: string } }): Promise<any> => {
        return await this._request<any>('POST', `/api/channels/mock/send-message`, data)
      },
      getOutbox: async (address: string, sourceThreadId: string): Promise<Array<{ sourceId: string, sourceThreadId: string, address: string, text: string | null, timestamp: number }>> => {
        return await this._request('GET', `/api/channels/mock/outbox?address=${encodeURIComponent(address)}&sourceThreadId=${encodeURIComponent(sourceThreadId)}`)
      },
      clearOutbox: async (): Promise<void> => {
        return await this._request<void>('POST', `/api/channels/mock/clear-outbox`, undefined)
      },
    }
  } 

  // --- Shared methods ---

  // async getOrganization(): Promise<OrganizationBase> {
  //   return await this._request<OrganizationBase>('GET', `/api/organization`)
  // }

  // async getSessionComments(options: { id: string }) {
  //   return await this._request<CommentMessage[]>('GET', `/api/sessions/${options.id}/comments`, undefined)
  // }

  // async getSessionScores(options: { id: string }) {
  //   return await this._request<Score[]>('GET', `/api/sessions/${options.id}/scores`, undefined)
  // }


  // async getEnvironment(): Promise<Environment> {
  //   return await this._request<Environment>('GET', `/api/environment`)
  // }
}

export class AgentViewClient extends AgentViewBase {
  sessions: SessionsResource;

  constructor(options: AgentViewClientOptions) {
    super(options);
    this.sessions = new SessionsResource(this);
  }

  createTransport() {
    const baseUrl = getApiUrl();
    /**
     * Here we leave "vanilla" error handling. It's because:
     * - 
     */
    return new DefaultChatTransport({
      headers: this._getHeaders(),
      prepareSendMessagesRequest: ({ id, messages, trigger }) => {
        /**
         * Here we rely on some facts about ai-sdk:
         * - messages is already truncated
         * - `messages` can't be empty (aisdk throws)
         * - ai-sdk makes sure last message is user message. It's technically possible to make last message assistant but we can safely throw on this case (it's incorrect for us anyway).
         * 
         * Essentially, if messages is already after truncation, so it's literally ui state, then we must keep it anyway. And we should assume last message is user message. It covers all cases:
         * - new item
         * - regeneration
         * - edit message (sendMessage with proper messageId)
         */

        const lastMessage = messages[messages.length - 1];

        if (!lastMessage) {
          throw new AgentViewError("Messages array is empty", 400);
        }
        if (lastMessage?.role !== 'user') {
          throw new AgentViewError("Last message is not a user message", 400);
        }

        // Technically we could omit previousRunId for submit-message but this behaviour is even more consistent. Very universal and minimalistic, like it.
        let previousRunId : string | null | undefined = undefined; // null -> regenerate from root. undefined -> continue from last run.
        if (trigger === 'regenerate-message') {
          if (messages.length <= 1) {
            previousRunId = null;
          }
          else {
            previousRunId = (messages[messages.length - 2].metadata as any)?._agentview?.id;
            if (!previousRunId) {
              throw new AgentViewError("Previous run id is not found in messages history", 500);
            }
          }
        }

        return {
          api: `${baseUrl}/api/sessions/${id}/runs`,
          body: {
            input: lastMessage,
            previousRunId,
            stream: true
          },
        }

        // if (trigger === 'submit-message') {
        //   return {
        //     api: `${baseUrl}/api/sessions/${id}/runs`,
        //     body: {
        //       input: lastMessage,
        //       stream: true
        //     },
        //   }
        // } else if (trigger === 'regenerate-message') {
        //   const previousRunId = (messages[messages.length - 2]?.metadata as any)?._agentview?.id;
          
        //   return {
        //     api: `${baseUrl}/api/sessions/${id}/runs`,
        //     body: {
        //       input: lastMessage,
        //       stream: true
        //     },
        //   }
        // } else {
        //   throw new AgentViewError("unknown trigger: " + trigger, 500);
        // }

        // let previousRunId: string | undefined = undefined;
        // if (trigger === 'regenerate-message') {
        //   const message = messageId ? messages.find(m => m.id === messageId) : messages[messages.length - 1];
        // }

        // return {
        //   api: `${baseUrl}/api/sessions/${id}/runs`,
        //   body: {
        //     input: messages[messages.length - 1],
        //     stream: true
        //   },
        // }
      },
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

class OrganizationsResource {
  constructor(private client: AgentViewBase) { }

  async get(): Promise<OrganizationBase> {
    return await this.client._request<OrganizationBase>('GET', `/api/organization`)
  }
}

class EnvironmentsResource {
  constructor(private client: AgentViewBase) { }

  async getActive(): Promise<Environment> {
    return await this.client._request<Environment>('GET', `/api/environment`)
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

  async getByEmail(email: string) {
    return await this.client._request<User>('GET', `/api/users/by-email/${encodeURIComponent(email)}`)
  }

  async update(id: string, options: UserCreate): Promise<User> {
    return await this.client._request<User>('PATCH', `/api/users/${id}`, options)
  }
}

class SessionsResource {
  constructor(private client: AgentViewBase) { }

  async create(options: SessionCreate) {
    return await this.client._request<Session>('POST', `/api/sessions`, options)
  }

  async get(id: string) {
    return await this.client._request<Session>('GET', `/api/sessions/${id}`)
  }

  async update(id: string, options: SessionUpdate) {
    return await this.client._request<Session>('PATCH', `/api/sessions/${id}`, options)
  }

  async createRun(id: string, options: RunCreate, requestOptions?: { signal?: AbortSignal }) {
    return await this.client._request<Run>('POST', `/api/sessions/${id}/runs`, options, requestOptions)
  }

  async cancelRun(id: string) {
    return await this.client._request<Session>('POST', `/api/sessions/${id}/cancel`)
  }

  async updateRun(sessionId: string, runId: string, options: RunUpdate) {
    return await this.client._request<Run>('PATCH', `/api/sessions/${sessionId}/runs/${runId}`, options)
  }

  async list(options?: SessionsGetQueryParams) {
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

    return await this.client._request<SessionsPaginatedResponse>('GET', path, undefined)
  }

  async getStats(options?: SessionsStatsQueryParams): Promise<SessionsStats> {
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

    return await this.client._request<SessionsStats>('GET', path, undefined)
  }
}


class CommentsResource {
  constructor(private client: AgentViewBase) { }

  async create(options: InputTarget & { content: string }): Promise<void> {
    return await this.client._request<void>('POST', `/api/comments`, options)
  }

  async update(id: string, options: { content: string }): Promise<void> {
    return await this.client._request<void>('PUT', `/api/comments/${id}`, options)
  }

  async delete(id: string): Promise<void> {
    return await this.client._request<void>('DELETE', `/api/comments/${id}`, undefined)
  }

  async markSeen(options: InputTarget): Promise<void> {
    return await this.client._request<void>('POST', `/api/seen`, options)
  }

  async list(options: { sessionId: string }) {
    return await this.client._request<CommentMessage[]>('GET', `/api/sessions/${options.sessionId}/comments`, undefined)
  }
}

class ScoresResource {
  constructor(private client: AgentViewBase) { }

  async update(options: InputTarget & { scores: ScoreCreate[] }): Promise<void> {
    return await this.client._request<void>('PATCH', `/api/scores`, options)
  }

  async list(options: { sessionId: string }) {
    return await this.client._request<Score[]>('GET', `/api/sessions/${options.sessionId}/scores`, undefined)
  }
}

class AuthResource {
  constructor(private client: AgentViewBase) { }

  async issueToken(userId: string): Promise<TokenWithSecret> {
    return await this.client._request<TokenWithSecret>('POST', `/api/users/${userId}/tokens`, {})
  }

  async revokeToken(tokenId: string): Promise<Token> {
    return await this.client._request<Token>('DELETE', `/api/tokens/${tokenId}`, undefined)
  }

  async listTokens(userId: string): Promise<Token[]> {
    return await this.client._request<Token[]>('GET', `/api/users/${userId}/tokens`, undefined)
  }
}

class ChannelsResource {
  constructor(private client: AgentViewBase) { }

  async list(): Promise<Channel[]> {
    return await this.client._request<Channel[]>('GET', `/api/channels`)
  }

  async update(id: string, data: { environmentId?: string | null }): Promise<Channel> {
    return await this.client._request<Channel>('PATCH', `/api/channels/${id}`, data)
  }
}


export function createClient(options: AgentViewClientOptions): AgentViewClient {
  return new AgentViewClient(options)
}

