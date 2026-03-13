import type { Server, ServerResponse, IncomingMessage } from 'http'
import type { Socket } from 'net'

export type MockServerHandler = (body: any, res: ServerResponse, req: IncomingMessage) => void

export type MockServer = {
  requests: Array<{ body: any; timestamp: number }>
  close: () => Promise<void>
  setHandler: (handler: MockServerHandler) => void
  resetRequests: () => void
}

export async function createMockServer(port: number): Promise<MockServer> {
  const http = await import('http')
  const requests: Array<{ body: any; timestamp: number }> = []
  const openSockets = new Set<Socket>()
  let handler: MockServerHandler = (_body, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end()
  }

  const server = await new Promise<Server>((resolve) => {
    const srv = http.createServer((req, res) => {
      let bodyStr = ''
      req.on('data', (chunk: Buffer) => bodyStr += chunk.toString())
      req.on('end', () => {
        let parsedBody: any
        try { parsedBody = JSON.parse(bodyStr) } catch { parsedBody = bodyStr }
        requests.push({ body: parsedBody, timestamp: Date.now() })
        handler(parsedBody, res, req)
      })
    })
    srv.on('connection', (socket) => {
      openSockets.add(socket)
      socket.on('close', () => openSockets.delete(socket))
    })
    srv.listen(port, () => resolve(srv))
  })

  return {
    requests,
    close: () => {
      for (const socket of openSockets) socket.destroy()
      return new Promise<void>(r => server.close(r as () => void))
    },
    setHandler: (h: MockServerHandler) => { handler = h },
    resetRequests: () => { requests.length = 0 },
  }
}

// SSE helpers

export type SSEEvent = { event: string; data: any }

function writeSSEHeaders(res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })
}

/** Named-event SSE format: `event: name\ndata: {...}\n\n` */
export function writeSSE(res: ServerResponse, events: SSEEvent[]) {
  writeSSEHeaders(res)
  for (const ev of events) {
    res.write(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`)
  }
  res.end()
}

/** AI SDK streaming format: `data: {...}\n\n` with `data: [DONE]\n\n` sentinel */
export function writeAISDKStream(res: ServerResponse, chunks: any[]) {
  writeSSEHeaders(res)
  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  }
  res.write('data: [DONE]\n\n')
  res.end()
}
