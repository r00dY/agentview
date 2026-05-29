import {
    type StandardSession,
    type StandardRun,
    type StandardRunCreate,
    type ManualRunCreate,
    type ManualRunUpdate,
    type RunUpdate,
    type StandardSessionCreate,
    type SessionUpdate,
    type SessionStreamEvent,
    type SessionsGetQueryParams,
    type SessionsPaginatedResponse,
    type SessionsStatsQueryParams,
    type SessionsStats,
} from './apiTypes.js'

import { type AgentViewErrorBody, AgentViewError } from './AgentViewError.js'
import { enhanceSession } from './sessionUtils.js'
import type { InternalConfig } from './baseConfigTypes.js'
import { getApiUrl } from './urls.js'
import { parseSSE } from './parseSSE.js'
import { AgentViewBase, type AgentViewClientOptions, type UserIdentifier } from './client.js'

export const configDefaults: {
    __internal?: InternalConfig
} = { __internal: undefined }

export class StandardAgentViewClient extends AgentViewBase {
    async createSession(options: StandardSessionCreate) {
        return enhanceSession(await this._request<StandardSession>('POST', `/api/sessions/standard`, options))
    }

    async getSession(options: { id: string }) {
        return enhanceSession(await this._request<StandardSession>('GET', `/api/sessions/${options.id}/standard`, undefined))
    }

    async updateSession(options: { id: string } & SessionUpdate) {
        return enhanceSession(await this._request<StandardSession>('PATCH', `/api/sessions/${options.id}`, options))
    }

    async createRun(options: StandardRunCreate & { sessionId: string }) {
        const { sessionId, ...body } = options;
        return await this._request<StandardRun>('POST', `/api/sessions/${sessionId}/runs/standard`, body)
    }

    async createManualRun(options: ManualRunCreate & { sessionId: string }) {
        const { sessionId, ...body } = options;
        return await this._request<StandardRun>('POST', `/api/sessions/${sessionId}/runs/manual`, body)
    }

    async updateManualRun(options: ManualRunUpdate & { id: string }) {
        return await this._request<StandardRun>('PATCH', `/api/runs/${options.id}/manual`, options)
    }

    async updateRun(options: RunUpdate & { sessionId: string, runId: string }) {
        const { sessionId, runId, ...body } = options;
        return await this._request<StandardSession>('PATCH', `/api/sessions/${sessionId}/runs/${runId}`, body)
    }

    async cancelRun(options: { sessionId: string }) {
        return enhanceSession(await this._request<StandardSession>('POST', `/api/sessions/${options.sessionId}/cancel/standard`))
    }

    async keepAliveRun(options: { id: string }): Promise<{ expiresAt: string | null }> {
        return await this._request<{ expiresAt: string | null }>('POST', `/api/runs/${options.id}/keep-alive`, undefined)
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

    async getSessionStream(options: { id: string, signal?: AbortSignal }): Promise<AsyncGenerator<{
        event: SessionStreamEvent;
        session: StandardSession;
    }> | null> {
        let url = `${getApiUrl()}/api/sessions/${options.id}/stream/standard`;

        const response = await fetch(url, {
            method: 'GET',
            headers: this._getHeaders(),
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
                                    ...(rawEvent.data.reason !== undefined && { reason: rawEvent.data.reason }),
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

    // async getChannels(): Promise<Channel[]> {
    //     return await this._request<Channel[]>('GET', `/api/channels`)
    // }

    // async updateChannel(channelId: string, data: { environmentId?: string | null }): Promise<Channel> {
    //     return await this._request<Channel>('PATCH', `/api/channels/${channelId}`, data)
    // }

    // --- Mock-email (internal/testing) ---

    // __internal = {
    //     mock: {
    //         createChannel: async (data: { address: string }): Promise<Channel> => {
    //             return await this._request<Channel>('POST', `/api/channels/mock/create-channel`, data)
    //         },
    //         sendMessage: async (data: { address: string, sourceId: string, date: string, contact: string, contactKind: string, text: string, sourceThreadId?: string, providerData?: any }): Promise<any> => {
    //             return await this._request<any>('POST', `/api/channels/mock/send-message`, data)
    //         },
    //         getOutbox: async (address?: string): Promise<Array<{ id: string, address: string, contact: string, contactKind: string, text: string | null, timestamp: number }>> => {
    //             const params = address ? `?address=${encodeURIComponent(address)}` : ''
    //             return await this._request('GET', `/api/channels/mock/outbox${params}`)
    //         },
    //     }
    // }

    // async markSeen(options: InputTarget): Promise<void> {
    //     return await this._request<void>('POST', `/api/seen`, options)
    // }

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

        return await this._request<SessionsStats>('GET', path, undefined)
    }

    // async createComment(options: InputTarget & { content: string }): Promise<void> {
    //     return await this._request<void>('POST', `/api/comments`, options)
    // }

    // async updateComment(options: { id: string, content: string }): Promise<void> {
    //     const { id, ...rest } = options
    //     return await this._request<void>('PUT', `/api/comments/${id}`, rest)
    // }

    // async deleteComment(options: { id: string }): Promise<void> {
    //     return await this._request<void>('DELETE', `/api/comments/${options.id}`, undefined)
    // }

    // async updateScores(options: InputTarget & { scores: ScoreCreate[] }): Promise<void> {
    //     return await this._request<void>('PATCH', `/api/scores`, options)
    // }


    // async getEnvironments(): Promise<EnvironmentBase[]> {
    //     return await this._request<EnvironmentBase[]>('GET', `/api/environments`)
    // }

    // async updateEnvironment(body: EnvironmentCreate): Promise<Environment> {
    //     const payload: Record<string, any> = { ...body };

    //     if (body.config !== undefined) {
    //         let config = body.config;

    //         if (configDefaults.__internal) {
    //             config = {
    //                 ...config,
    //                 __internal: {
    //                     ...configDefaults.__internal,
    //                     ...(config.__internal ?? {}),
    //                 }
    //             }
    //         }

    //         payload.config = serializeConfig(config);
    //     }

    //     return await this._request<Environment>('PATCH', `/api/environment`, payload)
    // }

    asUser(userIdentifier: UserIdentifier): StandardAgentViewClient {
        return new StandardAgentViewClient({
            apiKey: this.apiKey,
            user: userIdentifier,
            env: this.env,
            organizationId: this.organizationId,
        })
    }
}

export function createStandardClient(options: AgentViewClientOptions): StandardAgentViewClient {
    return new StandardAgentViewClient(options)
}
