
const AGENT_API_URL = 'http://localhost:8000/run'

// export interface AgentRunRequest {
//   thread: {
//     id: string
//     created_at: Date
//     updated_at: Date
//     metadata: any
//     client_id: string
//     type: string
//     activities: any[]
//   }
// }

// export interface VersionManifest {
//   type: 'manifest'
//   version: string
//   env?: string
//   metadata?: any
// }

// export interface ActivityResponse {
//   type: string
//   role: string
//   content: any
// }

// export interface AgentErrorResponse {
//   message: string
//   details?: any
// }

// export interface AgentRunResult {
//   manifest: VersionManifest
//   activities: ActivityResponse[]
// }

// export async function callAgentApi(request: AgentRunRequest): Promise<AgentRunResult> {
//   const response = await fetch(`${AGENT_API_URL}/run`, {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//     },
//     body: JSON.stringify(request),
//   })

//   if (!response.ok) {
//     const errorData = await response.json().catch(() => ({ message: 'Unknown error' }))
//     throw new Error(errorData.message || `HTTP ${response.status}`)
//   }

//   return await response.json()
// }

export interface SSEEvent {
  event?: string
  data: string
}

export function parseSSE(line: string): SSEEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  let event: string | undefined
  let data = ''

  if (trimmed.startsWith('event:')) {
    event = trimmed.substring(6).trim()
  } else if (trimmed.startsWith('data:')) {
    data = trimmed.substring(5).trim()
  } else {
    return null
  }

  return { event, data }
} 




export async function* callAgentAPI(request: { thread: any }): AsyncGenerator<any, void, unknown> {
  const response = await fetch(AGENT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    try {
      const data = await response.json()

      if (typeof data === 'object') {
        throw {
          ...data,
          message: `[Agent API] Error response (${response.status}): ${data.message ?? 'Unknown error'}`
        }
      } else {
        throw {
          message: `[Agent API] Error response (${response.status}): Unknown error`,
          body: data ?? undefined
        }
      }
    } catch (e) {
      throw {
        message: `[Agent API] Error response (${response.status}): Unknown error`,
      }
    }
  }

  if (!response.body) {
    throw {
      message: `[Agent API] No response body`,
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  try {
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.trim() === '') continue

        const parsed = parseSSE(line)
        if (!parsed) continue

        if (parsed.event === 'error') {
          const errorData: AgentErrorResponse = JSON.parse(parsed.data)
          throw new Error(errorData.message)
        }

        if (parsed.event === 'activity') {
          const activity: ActivityResponse = JSON.parse(parsed.data)
          yield activity
        } else if (!parsed.event) {
          // This is the manifest (no event specified)
          const manifest: VersionManifest = JSON.parse(parsed.data)
          yield manifest
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
} 