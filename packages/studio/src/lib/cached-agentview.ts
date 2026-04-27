import { type AgentViewClientOptions } from 'agentview'
import { StandardAgentViewClient } from 'agentview/clientStandard'
import type { InputTarget, ScoreCreate, EnvironmentCreate, UserCreate } from 'agentview/apiTypes'
import { updateEnvironment as _updateEnvironment } from 'agentview/updateEnvironment'
import { invalidateByPrefix, invalidateCache, swr, swrSync } from './swr-cache'

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

export class CachedAgentView extends StandardAgentViewClient {
  constructor(options: AgentViewClientOptions) {
    super(options)
  }

  // === CACHED READS (methods on StandardAgentViewClient) ===

  override async getSession(...args: Parameters<StandardAgentViewClient['getSession']>) {
    return await swr(cacheKeys.session(args[0].id), () => super.getSession(...args))
  }

  getSessionSync(...args: Parameters<StandardAgentViewClient['getSession']>) {
    return swrSync(cacheKeys.session(args[0].id), () => super.getSession(...args))
  }

  override async getSessions(...args: Parameters<StandardAgentViewClient['getSessions']>) {
    const paramKey = JSON.stringify(args[0] ?? {})
    return swr(cacheKeys.sessions(paramKey), () => super.getSessions(...args))
  }

  getSessionsSync(...args: Parameters<StandardAgentViewClient['getSessions']>) {
    const paramKey = JSON.stringify(args[0] ?? {})
    return swrSync(cacheKeys.sessions(paramKey), () => super.getSessions(...args))
  }

  // === CACHED READS (methods moved to subresources) ===

  override async getSessionsStats(...args: Parameters<StandardAgentViewClient['getSessionsStats']>) {
    const paramKey = JSON.stringify(args[0] ?? {})
    return swr(cacheKeys.sessionsStats(paramKey), () => super.getSessionsStats(...args))
  }

  getSessionsStatsSync(...args: Parameters<StandardAgentViewClient['getSessionsStats']>) {
    const paramKey = JSON.stringify(args[0] ?? {})
    return swrSync(cacheKeys.sessionsStats(paramKey), () => super.getSessionsStats(...args))
  }

  async getEnvironment() {
    return swr(cacheKeys.environment(), () => this.environments.getActive())
  }

  async getSessionComments(options: { id: string }) {
    return swr(cacheKeys.sessionComments(options.id), () => this.comments.list({ sessionId: options.id }))
  }

  getSessionCommentsSync(options: { id: string }) {
    return swrSync(cacheKeys.sessionComments(options.id), () => this.comments.list({ sessionId: options.id }))
  }

  async getSessionScores(options: { id: string }) {
    return swr(cacheKeys.sessionScores(options.id), () => this.scores.list({ sessionId: options.id }))
  }

  getSessionScoresSync(options: { id: string }) {
    return swrSync(cacheKeys.sessionScores(options.id), () => this.scores.list({ sessionId: options.id }))
  }

  async getOrganization() {
    return this.organization.get()
  }

  // === MUTATIONS (methods on StandardAgentViewClient) ===

  override async createSession(...args: Parameters<StandardAgentViewClient['createSession']>) {
    const result = await super.createSession(...args)
    invalidateByPrefix('sessions')
    invalidateByPrefix('sessions-stats')
    return result
  }

  override async updateSession(...args: Parameters<StandardAgentViewClient['updateSession']>) {
    const result = await super.updateSession(...args)
    invalidateCache(cacheKeys.session(args[0].id))
    invalidateByPrefix('sessions')
    invalidateByPrefix('sessions-stats')
    return result
  }

  override async createRun(...args: Parameters<StandardAgentViewClient['createRun']>) {
    const result = await super.createRun(...args)
    invalidateCache(cacheKeys.session(args[0].sessionId))
    return result
  }

  override async createManualRun(...args: Parameters<StandardAgentViewClient['createManualRun']>) {
    const result = await super.createManualRun(...args)
    invalidateCache(cacheKeys.session(args[0].sessionId))
    return result
  }

  // cached version of updateRun need extra param sessionId to invalidate the correct cache
  override async updateManualRun(options_: Parameters<StandardAgentViewClient['updateManualRun']>[0] & { sessionId: string }) {
    const { sessionId, ...options } = options_;
    const result = await super.updateManualRun(options)
    invalidateCache(cacheKeys.session(sessionId))
    return result
  }

  override async cancelRun(options: Parameters<StandardAgentViewClient['cancelRun']>[0]) {
    const result = await super.cancelRun(options)
    invalidateCache(cacheKeys.session(options.sessionId))
    return result
  }

  // === MUTATIONS (methods moved to subresources) ===

  async createComment(options: WithRequired<InputTarget & { content: string }, 'sessionId'>) { // we make sessionId mandatory in Target to simplify cache invalidation
    const result = await this.comments.create(options)
    invalidateCache(cacheKeys.sessionScores(options.sessionId))
    invalidateCache(cacheKeys.sessionComments(options.sessionId))
    return result
  }

  async updateComment(options: { id: string, content: string, sessionId: string }) {
    const { sessionId, id, ...rest } = options
    const result = await this.comments.update(id, rest)
    invalidateCache(cacheKeys.sessionScores(sessionId))
    invalidateCache(cacheKeys.sessionComments(sessionId))
    return result
  }

  async deleteComment(options: { id: string, sessionId: string }) {
    const { sessionId, id } = options
    const result = await this.comments.delete(id)
    invalidateCache(cacheKeys.sessionScores(sessionId))
    invalidateCache(cacheKeys.sessionComments(sessionId))
    return result
  }

  async updateScores(options: WithRequired<InputTarget, 'sessionId'> & { scores: ScoreCreate[] }) {
    const result = await this.scores.update(options)
    if (options.sessionId) {
      invalidateCache(cacheKeys.sessionScores(options.sessionId))
      invalidateCache(cacheKeys.sessionComments(options.sessionId))
    }
    return result
  }

  async updateEnvironment(body: EnvironmentCreate) {
    const result = await _updateEnvironment(this, body)
    invalidateCache(cacheKeys.environment())
    return result
  }

  async updateUser(options: UserCreate & { id: string }) {
    const result = await this.users.update(options.id, options)
    // .user is part of session list and also single session object. That's why we literally nuke cache here. Good for now.
    invalidateByPrefix('session');
    invalidateByPrefix('sessions');
    invalidateByPrefix('sessions-stats')
    return result
  }

  async markSeen(options: InputTarget) {
    const result = await this.comments.markSeen(options)
    invalidateByPrefix('sessions-stats')
    return result
  }
}

type WithRequired<T, K extends keyof T> = T & Required<Pick<T, K>>;
