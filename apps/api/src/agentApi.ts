
const AGENT_API_URL = 'http://localhost:8000/run'

export interface SSEEvent {
  event?: string
  data: string
}

export interface VersionManifest {
  type: 'manifest'
  version: string
  env?: string
  metadata?: any
}

export interface ActivityResponse {
  type: string
  role: string
  content: any
}

export interface AgentErrorResponse {
  message: string
  [key: string]: any
}


function parseText(text: string): any {
  try {
    return JSON.parse(text)
  } catch (e) {
    return text
  }
}

function getErrorObject(input: any): AgentErrorResponse {
  if (typeof input === 'object' && 'message' in input) {
    return input
  }
  return {
    message: "Unknown error",
    details: input
  }
}

export async function* parseSSE(body: ReadableStream<Uint8Array<ArrayBufferLike>>): AsyncGenerator<SSEEvent, void, unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder()


  try {
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      
      if (done) {
        // Process any remaining data in buffer
        if (buffer.trim()) {
          const blocks = buffer.split('\n\n')
          for (const block of blocks) {
            if (block.trim()) {
              const event = parseSSEBlock(block)
              if (event) {
                yield event
              }
            }
          }
        }
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split('\n\n')
      
      // Keep the last (potentially incomplete) block in buffer
      buffer = blocks.pop() || ''

      // Process complete blocks
      for (const block of blocks) {
        if (block.trim()) {
          const event = parseSSEBlock(block)
          if (event) {
            yield event
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}


/**
 * Parse a single SSE block (separated by \n\n)
 * Returns null if the block is empty or invalid
 */
function parseSSEBlock(block: string): SSEEvent | null {
  const lines = block.split('\n')
  let event: string | undefined
  let data = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('event:')) {
      event = trimmed.substring(6).trim()
    } else if (trimmed.startsWith('data:')) {
      data = trimmed.substring(5).trim()
    }
  }

  // Only return an event if we have data
  return data ? { event, data } : null
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
    const error = getErrorObject(parseText(await response.text()))
    console.log("error", error)
    throw {
      ...error,
      message: `HTTP error response (${response.status}): ${error.message}`,
    }
  }

  const contentType = response.headers.get('Content-Type');
  if (!contentType || !contentType.startsWith('text/event-stream')) {
    throw {
      message: `Expected Content-Type "text/event-stream", got "${contentType}"`
    }
  }


  if (!response.body) {
    throw {
      message: 'No response body'
    }
  }

  console.log("------- STREAMING -------")
  for await (const { event, data } of parseSSE(response.body)) {
    console.log("event:", event)
    console.log("data:", data)

    let parsedData: any;

    try {
      parsedData = JSON.parse(data)
    } catch(e) {
      throw {
        message: 'Error parsing SSE event (event data must be an object)',
        eventData: data
      }
    }

    if (event === "error") {
      const error = getErrorObject(parsedData)

      throw {
        ...error,
        message: `${error.message ?? "Unknown error event"}`
      }
    }
    else {
      yield {
        type: event,
        data: parsedData
      }
    }
  }
  console.log("------- STREAMING ENDS -------")
}