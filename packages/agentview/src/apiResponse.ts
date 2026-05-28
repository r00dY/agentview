import { AgentViewError } from './AgentViewError.js'

/**
 * Throw on a non-OK Response, using the AgentView API's error conventions.
 *
 * - Upstream responses (proxied from the agent endpoint, marked with
 *   `X-Upstream-Response: true`) have a plain-text body — throw a vanilla
 *   `Error` carrying that text.
 * - AgentView's own error responses are JSON like `{ message, ...rest }` —
 *   throw `AgentViewError(message, status, body)` so callers can match on
 *   `err.statusCode` and `err.details.code`.
 */
export async function throwIfNotOk(response: Response): Promise<void> {
  if (response.ok) return
  if (response.headers.get('X-Upstream-Response') === 'true') {
    const text = await response.text()
    throw new Error(text)
  }
  const body = await response.json()
  throw new AgentViewError(body.message ?? "Unknown error", response.status, body)
}
