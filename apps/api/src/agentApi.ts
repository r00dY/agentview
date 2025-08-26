
const AGENT_API_URL = 'http://localhost:8000/run'

export interface AgentErrorResponse {
  message: string
  [key: string]: any
}

export type AgentAPIEvent = {
  name: string,
  data: any
}

export async function* callAgentAPI(request: { thread: any }): AsyncGenerator<AgentAPIEvent, void, unknown> {
  const response = await fetch(AGENT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const error = getErrorObject(tryParseJSON(await response.text()))
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

  for await (const { event, data } of parseSSE(response.body)) {
    let parsedData: any;

    if (event === "ping") {
      continue
    }

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
        name: event,
        data: parsedData
      }
    }
  }
}


function tryParseJSON(text: string): any {
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

interface SSERawEvent {
  event: string
  data: string
}

async function* parseSSE(body: ReadableStream<Uint8Array<ArrayBufferLike>>): AsyncGenerator<SSERawEvent, void, unknown> {
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


function parseSSEBlock(block: string): SSERawEvent {
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

  if (!event) {
    throw {
      message: 'Incorrect SSE block format',
      eventData: block
    }
  }
  
  // Only return an event if we have data
  return { event, data }
}