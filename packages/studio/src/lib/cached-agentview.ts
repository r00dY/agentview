import { AgentView, type Session, type InputTarget } from 'agentview'
import { getAuthHeaders } from './agentview'
import { invalidateByPrefix, invalidateCache, swr, getCachedValue, revalidate, swrSync } from './swr-cache'

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

export class CachedAgentView extends AgentView {
  constructor() {
    super({ headers: getAuthHeaders })
  }

  // === CACHED READS ===

  override async getSession(...args: Parameters<AgentView['getSession']>) {
    return await swr(cacheKeys.session(args[0].id), () => super.getSession(...args))
  }

  getSessionSync(...args: Parameters<AgentView['getSession']>) {
    return swrSync(cacheKeys.session(args[0].id), () => super.getSession(...args))
  }

  override async getSessions(...args: Parameters<AgentView['getSessions']>) {
    const paramKey = JSON.stringify(args[0] ?? {})
    return swr(cacheKeys.sessions(paramKey), () => super.getSessions(...args))
  }

  getSessionsSync(...args: Parameters<AgentView['getSessions']>) {
    const paramKey = JSON.stringify(args[0] ?? {})
    return swrSync(cacheKeys.sessions(paramKey), () => super.getSessions(...args))
  }

  override async getSessionsStats(...args: Parameters<AgentView['getSessionsStats']>) {
    const paramKey = JSON.stringify(args[0] ?? {})
    return swr(cacheKeys.sessionsStats(paramKey), () => super.getSessionsStats(...args))
  }

  getSessionsStatsSync(...args: Parameters<AgentView['getSessionsStats']>) {
    const paramKey = JSON.stringify(args[0] ?? {})
    return swrSync(cacheKeys.sessionsStats(paramKey), () => super.getSessionsStats(...args))
  }

  override async getEnvironment(...args: Parameters<AgentView['getEnvironment']>) {
    return swr(cacheKeys.environment(), () => super.getEnvironment(...args))
  }

  // === MUTATIONS (invalidate cache) ===

  override async createSession(...args: Parameters<AgentView['createSession']>) {
    const result = await super.createSession(...args)
    invalidateByPrefix('sessions')
    invalidateByPrefix('sessions-stats')
    return result
  }

  override async updateSession(...args: Parameters<AgentView['updateSession']>) {
    const result = await super.updateSession(...args)
    invalidateCache(cacheKeys.session(args[0].id))
    invalidateByPrefix('sessions')
    invalidateByPrefix('sessions-stats')
    return result
  }

  override async createRun(...args: Parameters<AgentView['createRun']>) {
    const result = await super.createRun(...args)
    invalidateCache(cacheKeys.session(args[0].sessionId))
    return result
  }

  override async createManualRun(...args: Parameters<AgentView['createManualRun']>) {
    const result = await super.createManualRun(...args)
    invalidateCache(cacheKeys.session(args[0].sessionId))
    return result
  }

  // cached version of updateRun need extra param sessionId to invalidate the correct cache
  override async updateRun(options_: Parameters<AgentView['updateRun']>[0] & { sessionId: string }) {
    const { sessionId, ...options } = options_;
    const result = await super.updateRun(options)
    invalidateCache(cacheKeys.session(sessionId))
    return result
  }

  override async getSessionComments(...args: Parameters<AgentView['getSessionComments']>) {
    return swr(cacheKeys.sessionComments(args[0].id), () => super.getSessionComments(...args))
  }

  getSessionCommentsSync(...args: Parameters<AgentView['getSessionComments']>) {
    return swrSync(cacheKeys.sessionComments(args[0].id), () => super.getSessionComments(...args))
  }

  override async getSessionScores(...args: Parameters<AgentView['getSessionScores']>) {
    return swr(cacheKeys.sessionScores(args[0].id), () => super.getSessionScores(...args))
  }

  getSessionScoresSync(...args: Parameters<AgentView['getSessionScores']>) {
    return swrSync(cacheKeys.sessionScores(args[0].id), () => super.getSessionScores(...args))
  }

  override async createComment(options_: WithRequired<Parameters<AgentView['createComment']>[0], 'sessionId'>) { // we make sessionId mandatory in Target to simplify cache invalidation
    const { sessionId, ...options } = options_
    const result = await super.createComment(options)
    invalidateCache(cacheKeys.sessionScores(sessionId))
    invalidateCache(cacheKeys.sessionComments(sessionId))
    return result
  }

  override async updateComment(options_: Parameters<AgentView['updateComment']>[0] & { sessionId: string }) {
    const { sessionId, ...options } = options_
    const result = await super.updateComment(options)

    invalidateCache(cacheKeys.sessionScores(sessionId))
    invalidateCache(cacheKeys.sessionComments(sessionId))
    return result
  }

  override async deleteComment(options_: Parameters<AgentView['deleteComment']>[0] & { sessionId: string }) {
    const { sessionId, ...options } = options_
    const result = await super.deleteComment(options)
    invalidateCache(cacheKeys.sessionScores(sessionId))
    invalidateCache(cacheKeys.sessionComments(sessionId))
    return result
  }

  override async updateScores(options: WithRequired<InputTarget, 'sessionId'> & { scores: any[] }) {
    const result = await super.updateScores(options)
    if (options.sessionId) {
      invalidateCache(cacheKeys.sessionScores(options.sessionId))
      invalidateCache(cacheKeys.sessionComments(options.sessionId))
    }
    return result
  }

  override async updateEnvironment(...args: Parameters<AgentView['updateEnvironment']>) {
    const result = await super.updateEnvironment(...args)
    invalidateCache(cacheKeys.environment())
    return result
  }

  override async updateUser(...args: Parameters<AgentView['updateUser']>) {
    const result = await super.updateUser(...args)

    // .user is part of session list and also single session object. That's why we literally nuke cache here. Good for now.
    invalidateByPrefix('session');
    invalidateByPrefix('sessions');
    invalidateByPrefix('sessions-stats')
    return result
  }

  override async markSeen(...args: Parameters<AgentView['markSeen']>) {
    const result = await super.markSeen(...args)
    invalidateByPrefix('sessions-stats')
    return result
  }
}

type WithRequired<T, K extends keyof T> = T & Required<Pick<T, K>>;
