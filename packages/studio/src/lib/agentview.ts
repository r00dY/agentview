import { AgentViewError } from 'agentview'
import { config } from '../config'
import { CachedAgentView } from './cached-agentview'

let cachedClient : CachedAgentView | undefined = undefined

export function agentview() {
  if (!cachedClient) {
    const token = localStorage.getItem("agentview_token");
    if (!token) {
      throw new Error("No token found");
    }

    cachedClient = new CachedAgentView({
      apiKey: token,
      env: config.env,
      organizationId: config.organizationId,
    })
  }
  return cachedClient
}

// Re-export AgentViewError for error handling
export { AgentViewError }

// Utility for actions that need { ok, error } pattern
export async function withErrorHandling<T>(
  fn: () => Promise<T>
): Promise<{ ok: true; data: T } | { ok: false; error: { message: string; statusCode: number; [key: string]: any } }> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    if (error instanceof AgentViewError) {
      return {
        ok: false,
        error: { message: error.message, statusCode: error.statusCode, ...error.details },
      }
    }
    throw error
  }
}
