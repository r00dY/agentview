import { AgentViewError, createClient } from 'agentview'
import { config } from '../config'
import { CachedAgentViewClient } from './cached-agentview'

let cachedClient : CachedAgentViewClient | undefined = undefined

export const publicClient = createClient({
  apiKey: config.publicApiKey,
  env: config.env,
})

export function agentview() {
  if (!cachedClient) {
    const token = localStorage.getItem("agentview_token");
    const organizationId = localStorage.getItem("agentview_organization_id");

    if (!token) {
      throw new Error("No token found");
    }
    if (!organizationId) {
      throw new Error("No organization ID found");
    }

    const client = createClient({
      apiKey: token,
      env: config.env,
      organizationId: organizationId,
    })

    cachedClient = new CachedAgentViewClient(client)
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
