import http from 'node:http';
import https from 'node:https';
import { log } from '../logger';
import { startMeasuring } from '../performance';
import { startCpuProfiling, stopCpuProfiling } from './profiler';

import { RunTerminationError, type RunTerminationReason } from '../runs';
import { createState, processChunk, StreamUpstreamError } from './processEvent';
import { GracefulRunTerminationError, type LiveConnection } from './types';
import { saveDataAll } from './saveData';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { ChunkParseError, parseUIMessageChunk, type ExtendedUIMessageChunk } from './parseUIMessageChunk';
import { UIMessageStreamError } from 'ai';
import { cleanupStreamingUIMessageState } from './processUIMessageStream';

if (!process.env.HTTP_SERVER_PORT) {
  throw new Error('HTTP_SERVER_PORT is not set');
}

if (!process.env.STREAMING_SERVER_PORT) {
  throw new Error('STREAMING_SERVER_PORT is not set');
}

const NETWORK_ERROR_CODES = [
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH',
  'EPIPE', 'EAI_AGAIN'
];

function isNodeHttpConnectionError(error: unknown): boolean {
  return error instanceof Error && NETWORK_ERROR_CODES.includes((error as any)?.code)
}

const DONE_MSG = '[DONE]';

const perf = startMeasuring();
perf.startPrinting('streaming-server');

// --- Buffer helpers ---

function pushToBuffer(conn: LiveConnection, data: string) {
  conn.streamBuffer.push(data);
  for (const listener of conn.streamListeners) listener(data);
}

function markStreamDone(conn: LiveConnection) {
  conn.streamDone = true;
  for (const listener of conn.streamDoneListeners) listener();
}


const liveConnections = new Map<string, LiveConnection>();

// --- HTTP helpers ---

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: Record<string, any>) {
  const payload = JSON.stringify(status >= 400 ? { source: "agentview", ...body } : body);
  
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// --- Route handlers ---

function handleHealth(res: http.ServerResponse) {
  const snap = perf.get();
  sendJson(res, 200, {
    ok: true,
    connections: liveConnections.size,
    elu: snap.elu,
    memory: {
      rss: snap.memory.rss,
      heapUsed: snap.memory.heapUsed,
    },
  });
}

async function handleProfileStart(res: http.ServerResponse) {
  await startCpuProfiling();
  sendJson(res, 200, { ok: true });
}

async function handleProfileStop(res: http.ServerResponse) {
  const filepath = await stopCpuProfiling();
  sendJson(res, 200, { ok: true, filepath });
}

async function handleCreateStream(req: http.IncomingMessage, res: http.ServerResponse) {
  const { runId, url, body, metadata, headers: extraHeaders } = await readJsonBody(req);

  log.info(`LIVE CONNECTION run:${runId}`);

  const requester = url.startsWith('https') ? https : http;
  const upstreamReq = requester.request(url, {
    method: 'POST',
    headers: {
      ...(extraHeaders ?? {}),
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    }
  }, (upstreamRes) => {
    const statusCode = upstreamRes.statusCode!;

    // If we have response, we just pipe headers and status
    res.writeHead(statusCode, {
      ...upstreamRes.headers,
      'X-Upstream-Response': 'true',
      'Access-Control-Expose-Headers': 'x-upstream-response',
    });

    if (statusCode >= 400) {
      upstreamRes.pipe(res);
      return;
    }
    else {
      res.end();
    }

    /**
     * Connection established
     */
    let conn: LiveConnection;

    const state = createState(crypto.randomUUID()); // random message id (it can be overriden by user anyway in 'start' chunk)

    upstreamRes.setEncoding('utf-8'); // automatic decoding of stream to the string

    let streamFinishReason : { type: 'error', message: string, code: string, [key: string]: any } | { type: 'abort' } | { type: 'complete' } | undefined = undefined;

    function sendInternalMetadata(metadata: Record<string, any>) {
      const newChunk : ExtendedUIMessageChunk = {
        type: 'message-metadata',
        messageMetadata: {
          _agentview: metadata
        },
      };
      processChunk({ state, chunk: newChunk })
      pushToBuffer(conn, JSON.stringify(newChunk));
    }

    const sseParser = createParser({
      onEvent: function onSSEEvent(event: EventSourceMessage) {
        if (streamFinishReason) { return } // prevents race conditions. There's a possibility that previous error set streamFinishReason and on('end') / on('error') / on('close') hasn't been called yet.

        const data = event.data;

        if (data === DONE_MSG) {
          log.info({ runId }, `[streaming] ${DONE_MSG} received`);
          streamFinishReason = { type: 'complete' };
          upstreamRes.destroy(); // will trigger 'close' event without 'error' event
          return;
        }

        try {
          const chunk = parseUIMessageChunk(data);
          processChunk({ state, chunk });
          pushToBuffer(conn, data);

          // add runId to message metadata
          if (chunk.type === 'start') {
            sendInternalMetadata({
              id: runId,
              status: 'in_progress'
            })
          }

        } catch (error) {

          // Can't process chunk -> error.
          if (error instanceof ChunkParseError || error instanceof UIMessageStreamError) {
            streamFinishReason = { type: 'error', code: "STREAM_INVALID_CHUNK", message: error.message, data }; // just pass 'data' for debugging, it's enough
            upstreamRes.destroy(); // custom error handling
          }
          // Upstream error (sent by user) -> okay. No code.
          else if (error instanceof StreamUpstreamError) { // errors by user ('error' chunk in the upstream stream)
            streamFinishReason = { type: 'error', code: "STREAM_UPSTREAM_ERROR", message: error.message }; // upstream error has no code, no source
            upstreamRes.destroy();
          }
          // unexpected errors fallback
          else {
            log.error({ runId, error }, '[streaming] unexpected error while streaming');
            streamFinishReason = { type: 'error', code: "STREAM_INTERNAL_ERROR", message: (error as Error).message ?? String(error) }
          }

          upstreamRes.destroy();  // we can bypass on('error'), as we handled errors already (streamFinishReason is set)
        }

      },
    });

    upstreamRes.on('data', function onData(chunk: string) { // chunk is string thanks to setEncoding('utf-8')
      sseParser.feed(chunk);
    });


    upstreamRes.on('error', function onError(error) {
      if (error instanceof GracefulRunTerminationError) { // graceful termination (aka sigterm)
        log.info({ runId, error }, '[streaming] graceful termination');

        if (error.reason.status === 'cancelled') {
          streamFinishReason = { type: 'abort' };
        }
        else if (error.reason.status === 'failed') {
          streamFinishReason = { type: 'error', code: "STREAM_TERMINATED", message: error.message };
        }
      }
      else if (error instanceof RunTerminationError) { // run already killed
        log.info({ runId, error }, '[streaming] run killed while streaming');
        return;
      }
      // Network errors
      else if (isNodeHttpConnectionError(error)) { // in node you gotta check for 'code' property to know whether it's network error 
        log.info({ runId, error }, '[streaming] network error while streaming');
        streamFinishReason = { type: 'error', code: "STREAM_NETWORK_ERROR", detailedCode: (error as any).code, message: error.message };
      }
      // Unexpected errors fallback
      else {
        log.error({ runId, error }, '[streaming] unexpected error while streaming');
        streamFinishReason = { type: 'error', code: "STREAM_INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) };
      }
    });

    // Lack of [done] is treated as unfinished stream -> therefore error.
    upstreamRes.on('end', () => {
      if (streamFinishReason) { return } // prevents race conditions (maybe [done] was just set before end event)

      log.info({ runId }, '[streaming] stream ended incomplete');
      streamFinishReason = { type: 'error', code: "STREAM_INCOMPLETE", message: "Stream ended incomplete" };
    });

    function cleanup(conn: LiveConnection) {
      log.info({ runId }, `[streaming] sending ${DONE_MSG}`);

      pushToBuffer(conn, DONE_MSG);
      markStreamDone(conn);

      // Keep buffer available for late-connecting consumers, clean up after 60s
      setTimeout(() => {
        liveConnections.delete(runId);
      }, 60_000);

      log.info({ runId }, '[streaming] connection cleaned up');
    }

    /**
     * At this point the state of buffer is as follows:
     * - last chunk: 'error' -> there was error (of any kind)
     * - last chunk 'abort' -> user cancelled the stream
     * - last chunk: [done] -> nice finish -> complete.
     * 
     * If stream ended without [done] and without error, we trigger error in on('end')
     */
    upstreamRes.on('close', () => {
      upstreamRes.destroy();

      log.info({ runId }, '[streaming] connection closed, closing');

      // Can't happen.
      if (!streamFinishReason) {
        log.error({ runId }, '[streaming] unknown finish reason, setting to error');
        streamFinishReason = { type: 'error', code: "STREAM_INTERNAL_ERROR", message: "Unknown finish reason. It's internal error, please report." };
      }

      /**
       * Let's also send updated status in metadata 
       * 
       * IMPORTANT: WE NEED TO ADD 'id' here!!!
       * 
       * It's a cleanup phase which *always runs* (unless the machine goes down), but we can't assume 'start' was already sent.
       * It means that there is a scenario where the front-end doesn't have runId in the metadata. This prevents this scenario.
       */
      if (streamFinishReason.type === 'complete') {
        sendInternalMetadata({
          id: runId,
          status: 'completed'
        })
      }
      else if (streamFinishReason.type === 'abort') {
        sendInternalMetadata({
          id: runId,
          status: 'cancelled'
        })
      }
      else {
        const { type, ...failReason } = streamFinishReason;
        sendInternalMetadata({
          id: runId,
          status: 'failed',
          failReason
        })
      }




      // The only case when we push to buffer ourselves.
      if (streamFinishReason.type === 'abort') {
        pushToBuffer(conn, JSON.stringify({ type: 'abort', reason: 'Cancelled by user' }));
      }
      else if (streamFinishReason.type === 'error') {
        const { type, ...fields } = streamFinishReason;

        const errorText = fields.code === 'STREAM_UPSTREAM_ERROR' ? fields.message : JSON.stringify({ ...fields, source: 'agentview' });
        pushToBuffer(conn, JSON.stringify({ type: 'error', errorText })); // this is a bit tricky but it's the only way we can send more error details so user can distinguish between them. no providerData on error :(
      }

      // here we write async fun for easiness, on('close') is not hot path, a single promise won't hurt
      async function close() {
        try {
          await cleanupStreamingUIMessageState(conn.state); // we need to clean up partial tool calls
          await saveDataAll(conn, streamFinishReason!);
        } catch (err) {
          log.error({ runId, err }, '[streaming] error saving data');
        } finally {
          cleanup(conn);
        }
      }

      close();
    });

    conn = {
      runId,
      metadata,

      upstreamRes,

      state,

      streamBuffer: [],
      streamDone: false,
      streamListeners: new Set(),
      streamDoneListeners: new Set(),
    };

    liveConnections.set(runId, conn);

    log.info({ runId }, '[streaming] connection established');
  });

  upstreamReq.on('error', (err) => {
    log.info({ err }, '[streaming] upstream request error');

    // Destroying upstreamRes (e.g. on cancellation) kills the shared socket,
    // which also triggers this error — but res is already finished by then.
    if (res.headersSent) return;

    if (isNodeHttpConnectionError(err)) {
      sendJson(res, 502, { code: "CONNECTION_NETWORK_ERROR", message: err.message, detailedCode: (err as any).code });
      return;
    }
    else {
      log.error({ err }, '[streaming] unexpected error while streaming');
      sendJson(res, 500, { code: "CONNECTION_INTERNAL_ERROR", message: err.message });
    }
  });

  upstreamReq.write(body);
  upstreamReq.end();
}

async function handleDeleteStream(req: http.IncomingMessage, res: http.ServerResponse, runId: string) {
  const { reason, graceful }: { reason: RunTerminationReason; graceful: boolean } = await readJsonBody(req);

  if (!runId) {
    sendJson(res, 400, { message: 'Missing runId' });
    return;
  }

  const conn = liveConnections.get(runId);

  if (!conn) {
    sendJson(res, 404, { message: 'conn not found' });
    return;
  }

  if (!graceful) {
    conn.upstreamRes.destroy(new RunTerminationError(reason));
  }
  else {
    conn.upstreamRes.destroy(new GracefulRunTerminationError(reason));
  }

  /**
   * Here we wait max 5s for termination to be completed.
   * If it doesn't happen, we treat it as an error state. This should be immediate.
   */
  let time = 0;
  const TOTAL_WAIT_TIME = 5000;
  const INTERVAL = 100;

  while (!conn.streamDone) {
    if (time > TOTAL_WAIT_TIME) {
      log.error({ runId }, '[streaming] run not closed after 5 seconds after cancellation');
      sendJson(res, 500, { message: 'Run not closed after 5 seconds after cancellation' });
      return;
    }

    await new Promise(resolve => setTimeout(resolve, INTERVAL));
    time += INTERVAL;
  }

  sendJson(res, 200, { ok: true });
}


// --- SSE stream endpoint ---

function handleGetStream(req: http.IncomingMessage, res: http.ServerResponse, runId: string) {
  const conn = liveConnections.get(runId);

  if (!conn) {
    sendJson(res, 404, { message: 'Stream not found' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.flushHeaders();

  function cleanup() {
    conn!.streamListeners.delete(onChunk);
    conn!.streamDoneListeners.delete(onDone);
    try { res.end(); } catch { }
  }

  function writeChunk(data: string): boolean {
    res.write(`data: ${data}\n\n`);

    if (data === DONE_MSG) {
      cleanup();
      return false;
    }
    return true;
  }

  const onChunk = (data: string) => writeChunk(data);
  const onDone = () => cleanup();

  // Drain existing buffer
  for (const data of conn.streamBuffer) {
    if (!writeChunk(data)) return;
  }

  if (conn.streamDone) {
    cleanup();
    return;
  }

  // Listen for new chunks
  conn.streamListeners.add(onChunk);
  conn.streamDoneListeners.add(onDone);

  req.once('close', cleanup);
}


// --- Request router ---

const requestHandler: http.RequestListener = async (req, res) => {
  const rawUrl = req.url ?? '/';
  const qIdx = rawUrl.indexOf('?');
  const path = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
  const method = req.method;

  try {
    if (method === 'GET' && path === '/health') {
      handleHealth(res);
      return;
    }
    if (method === 'POST' && path === '/profile/start') {
      await handleProfileStart(res);
      return;
    }
    if (method === 'POST' && path === '/profile/stop') {
      await handleProfileStop(res);
      return;
    }
    if (method === 'POST' && path === '/streams') {
      await handleCreateStream(req, res);
      return;
    }
    if (path.startsWith('/streams/')) {
      const runId = decodeURIComponent(path.slice('/streams/'.length));
      if (method === 'GET') {
        handleGetStream(req, res, runId);
        return;
      }
      if (method === 'DELETE') {
        await handleDeleteStream(req, res, runId);
        return;
      }
    }

    sendJson(res, 404, { message: 'Not found' });
  } catch (err) {
    log.error({ err }, '[streaming-server] request handler error');
    if (!res.headersSent) {
      sendJson(res, 500, { message: 'Internal server error' });
    } else {
      try { res.end(); } catch { }
    }
  }
};


// Prevent unhandled rejections from crashing the process
process.on('unhandledRejection', (reason) => {
  log.error({ reason }, '[streaming-server] Unhandled rejection');
});

process.on('uncaughtException', (error) => {
  log.error({ err: error }, '[streaming-server] Uncaught exception');
});

const port = Number(process.env.STREAMING_SERVER_PORT);
const server = http.createServer(requestHandler);
server.listen(port, () => {
  log.info(`[streaming-server] listening on port ${port}`);
});


