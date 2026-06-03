import { AgentViewClient, type UserIdentifier } from 'agentview'
import { invalidateByPrefix, invalidateCache, swr, swrCached } from './swr-cache'

// Cache key helpers
export const cacheKeys = {
  session: (id: string) => `session:${id}`,
  sessionScores: (id: string) => `session-scores:${id}`,
  sessionComments: (id: string) => `session-comments:${id}`,
  sessions: (params: string) => `sessions:${params}`,
  sessionsStats: (params: string) => `sessions-stats:${params}`,
  user: (id: string) => `user:${id}`,
  environment: () => `environment`,
}

type Cached<M extends (...args: any) => any> = (...args: Parameters<M>) => Awaited<ReturnType<M>> | null

export class CachedAgentViewClient {
  client: AgentViewClient

  sessions: {
    get: AgentViewClient['sessions']['get']
    list: AgentViewClient['sessions']['list']
    getStats: AgentViewClient['sessions']['getStats']
    create: AgentViewClient['sessions']['create']
    update: AgentViewClient['sessions']['update']
    createRun: AgentViewClient['sessions']['createRun']
    updateRun: AgentViewClient['sessions']['updateRun']
    cancelRun: AgentViewClient['sessions']['cancelRun']

    // Cached
    getCached: Cached<AgentViewClient['sessions']['get']>
    listCached: Cached<AgentViewClient['sessions']['list']>
    getStatsCached: Cached<AgentViewClient['sessions']['getStats']>
  }

  comments: {
    list: AgentViewClient['comments']['list']
    create: AgentViewClient['comments']['create']
    update(id: string, options: { content: string }, cacheOptions: { sessionId: string }): Promise<void>
    delete(id: string, cacheOptions: { sessionId: string }): Promise<void>
    markSeen: AgentViewClient['comments']['markSeen']

    // Cached
    listCached: Cached<AgentViewClient['comments']['list']>
  }

  scores: {
    list: AgentViewClient['scores']['list']
    update: AgentViewClient['scores']['update']

    // Cached
    listCached: Cached<AgentViewClient['scores']['list']>
  }

  environments: {
    getActive: AgentViewClient['environments']['getActive']
  }

  organization: AgentViewClient['organization']
  channels: AgentViewClient['channels']

  users: {
    create: AgentViewClient['users']['create']
    createAnon: AgentViewClient['users']['createAnon']
    me: AgentViewClient['users']['me']
    get: AgentViewClient['users']['get']
    getByExternalId: AgentViewClient['users']['getByExternalId']
    update: AgentViewClient['users']['update']

    // Cached
    getCached: Cached<AgentViewClient['users']['get']>
  }

  constructor(client: AgentViewClient) {
    this.client = client;

    this.organization = this.client.organization
    this.channels = this.client.channels

    // === Sessions ===

    const { sessions } = this.client

    this.sessions = {
      get: (id) =>
        swr(cacheKeys.session(id), () => sessions.get(id)),
      
      getCached: (id) =>
        swrCached(cacheKeys.session(id), () => sessions.get(id)),

      list: (options?) => {
        const paramKey = JSON.stringify(options ?? {})
        return swr(cacheKeys.sessions(paramKey), () => sessions.list(options))
      },
      listCached: (options?) => {
        const paramKey = JSON.stringify(options ?? {})
        return swrCached(cacheKeys.sessions(paramKey), () => sessions.list(options))
      },

      getStats: (options?) => {
        const paramKey = JSON.stringify(options ?? {})
        return swr(cacheKeys.sessionsStats(paramKey), () => sessions.getStats(options))
      },
      getStatsCached: (options?) => {
        const paramKey = JSON.stringify(options ?? {})
        return swrCached(cacheKeys.sessionsStats(paramKey), () => sessions.getStats(options))
      },

      create: async (options) => {
        const result = await sessions.create(options)
        invalidateByPrefix('sessions')
        invalidateByPrefix('sessions-stats')
        return result
      },
      update: async (id, options) => {
        const result = await sessions.update(id, options)
        invalidateCache(cacheKeys.session(id))
        invalidateByPrefix('sessions')
        invalidateByPrefix('sessions-stats')
        return result
      },
      createRun: async (id, options) => {
        const result = await sessions.createRun(id, options)
        invalidateCache(cacheKeys.session(id))
        return result
      },
      updateRun: async (sessionId, runId, options) => {
        const result = await sessions.updateRun(sessionId, runId, options)
        invalidateCache(cacheKeys.session(sessionId))
        return result
      },
      cancelRun: async (id) => {
        const result = await sessions.cancelRun(id)
        invalidateCache(cacheKeys.session(id))
        return result
      },
    }

    // === Comments ===

    const { comments } = this.client

    this.comments = {
      list: (options) =>
        swr(cacheKeys.sessionComments(options.sessionId), () => comments.list(options)),
      listCached: (options) =>
        swrCached(cacheKeys.sessionComments(options.sessionId), () => comments.list(options)),

      create: async (options) => {
        const result = await comments.create(options)
        if (options.sessionId) {
          invalidateCache(cacheKeys.sessionScores(options.sessionId))
          invalidateCache(cacheKeys.sessionComments(options.sessionId))
        }
        return result
      },
      update: async (id, options, cacheOptions) => {
        const result = await comments.update(id, options)
        invalidateCache(cacheKeys.sessionScores(cacheOptions.sessionId))
        invalidateCache(cacheKeys.sessionComments(cacheOptions.sessionId))
        return result
      },
      delete: async (id, cacheOptions) => {
        const result = await comments.delete(id)
        invalidateCache(cacheKeys.sessionScores(cacheOptions.sessionId))
        invalidateCache(cacheKeys.sessionComments(cacheOptions.sessionId))
        return result
      },
      markSeen: async (options) => {
        const result = await comments.markSeen(options)
        invalidateByPrefix('sessions-stats')
        return result
      },
    }

    // === Scores ===

    const { scores } = this.client

    this.scores = {
      list: (options) =>
        swr(cacheKeys.sessionScores(options.sessionId), () => scores.list(options)),
      listCached: (options) =>
        swrCached(cacheKeys.sessionScores(options.sessionId), () => scores.list(options)),

      update: async (options) => {
        const result = await scores.update(options)
        if (options.sessionId) {
          invalidateCache(cacheKeys.sessionScores(options.sessionId))
          invalidateCache(cacheKeys.sessionComments(options.sessionId))
        }
        return result
      },
    }

    // === Environments ===

    const { environments } = this.client

    this.environments = {
      getActive: () => environments.getActive(),
    }

    // === Users (wrap update for invalidation, delegate the rest) ===

    const { users } = this.client

    this.users = {
      create: (options?) => users.create(options),
      createAnon: () => users.createAnon(),
      me: () => users.me(),
      get: (id) => swr(cacheKeys.user(id), () => users.get(id)),
      getCached: (id) => swrCached(cacheKeys.user(id), () => users.get(id)),
      getByExternalId: (externalId) => users.getByExternalId(externalId),
      update: async (id, options) => {
        const result = await users.update(id, options)
        invalidateCache(cacheKeys.user(id))
        // .user is part of session list and single session object — nuke cache
        invalidateByPrefix('session')
        invalidateByPrefix('sessions')
        invalidateByPrefix('sessions-stats')
        return result
      },
    }
  }

  createTransport() {
    return this.client.createTransport()
  }

  asUser(userIdentifier: UserIdentifier): CachedAgentViewClient {
    const client = this.client.asUser(userIdentifier)
    return new CachedAgentViewClient(client)
  }
}
