export interface AgentErrorResponse {
  message: string
  [key: string]: any
}

export class AgentAPIError extends Error {
  object: { message: string; [key: string]: any }

  constructor(object: { message: string; [key: string]: any }) {
    super(object.message);
    this.name = 'AgentAPIError';
    this.object = object
  }
}

export type AgentAPIEvent = {
  name: string,
  data: any
}

export async function* callAgentAPI(request: { session: any }, url: string): AsyncGenerator<AgentAPIEvent, void, unknown> {
  let response : Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })

    const responseData : any = {
      request: {
        url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: request
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
      }
    };

    yield {
      name: "response_data",
      data: responseData
    }

    if (!response.ok) {
      const content = tryParseJSON(await response.text());
      responseData.response.body = content;

      yield {
        name: "response_data",
        data: responseData
      }

      const error = getErrorObject(content)
      throw new AgentAPIError({
        ...error,
        message: `HTTP error response (${response.status}): ${error.message}`,
      })
    }

    const contentType = response.headers.get('Content-Type');

    if (!contentType) {
      throw new AgentAPIError({
        message: 'No Content-Type header'
      })
    }

    if (!response.body) {
      throw new AgentAPIError({
        message: 'No response body'
      })
    }

      /** NON-STREAMING RESPONSE **/
    if (contentType.startsWith('application/json')) {
      let data: any;

      try {
        data = await response.json()
      } catch(e) {
        throw new AgentAPIError({
          message: 'Error parsing JSON response',
          eventData: data
        })
      }

      // emit manifest
      if (data.manifest) {
        yield {
          name: "manifest",
          data: data.manifest
        }
      }

      if (data.items) {
        for (const item of data.items) {
          yield {
            name: "item",
            data: item
          }
        }
      }
    }

    /** STREAMING RESPONSE **/
    else if (contentType.startsWith('text/event-stream')) {
      for await (const { event, data } of parseSSE(response.body)) {
        let parsedData: any;

        if (event === "ping") {
          continue
        }

        try {
          parsedData = JSON.parse(data)
        } catch(e) {
          throw new AgentAPIError({
            message: 'Error parsing SSE event (event data must be an object)',
            eventData: data
          })
        }

        if (event === "error") {
          const error = getErrorObject(parsedData)

          throw new AgentAPIError({
            ...error,
            message: `${error.message ?? "Unknown error event"}`
          })
        }
        else {
          yield {
            name: event,
            data: parsedData
          }
        }
      }

    }
    else {
      throw new AgentAPIError({
        message: `Expected Content-Type "application/json" or "text/event-stream", got "${contentType}"`
      })
    }

  }
  catch(error: unknown) {
    if (error instanceof AgentAPIError) { // our internal errors should be rethrown
      throw error
    }
    // the only errors that are left are network errors
    else if (error instanceof Error) {
      throw new AgentAPIError({
        message: "Agent API connection error: " + error.message,
        cause: error.cause
      })
    }
    // we rethrow unknown errors
    else {
      throw error;
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
    throw new AgentAPIError({
      message: 'Incorrect SSE block format',
      eventData: block
    })
  }
  
  // Only return an event if we have data
  return { event, data }
}