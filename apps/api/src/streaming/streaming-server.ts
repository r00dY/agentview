import http from 'node:http';
import https from 'node:https';
import { log, runWithContext, setContext } from '../logger';
import { startMeasuring } from '../performance';
import { startCpuProfiling, stopCpuProfiling } from './profiler';

import { RunTerminationError, type RunTerminationReason } from '../runs';
import { createState, processChunk, StreamUpstreamError } from './processEvent';
import { GracefulRunTerminationError, type LiveConnection, type LiveConnectionStreaming } from './types';
import { ping, saveDataAll } from './saveData';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { ChunkParseError, parseUIMessageChunk, type ExtendedUIMessageChunk } from './parseUIMessageChunk';
import { UIMessageStreamError, isToolUIPart } from 'ai';
import { cleanupStreamingUIMessageState } from './processUIMessageStream';

if (!process.env.STREAMING_SERVER_PORT) {
  throw new Error('STREAMING_SERVER_PORT is not set');
}

if (!process.env.HTTP_SERVER_URL) {
  throw new Error('HTTP_SERVER_URL is not set');
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
// perf.startPrinting('streaming-server');

// --- Buffer helpers ---

function pushToBuffer(conn: LiveConnectionStreaming, data: string) {
  conn.streamBuffer.push(data);
  for (const listener of conn.streamListeners) listener(data);
}

function markStreamDone(conn: LiveConnectionStreaming) {
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

/**
 * TODO: res.on('close')??? What happens when user closes the connection?
 */
async function handleCreateStream(req: http.IncomingMessage, res: http.ServerResponse) {
  const startedAt = Date.now();
  let chunkCount = 0;

  const { run, url, body, metadata, headers: extraHeaders } = await readJsonBody(req);
  const runId = run.id;
  setContext({ runId });

  log.info({ url, bodySize: Buffer.byteLength(body) }, 'received');

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
    const upstreamDuration = Date.now() - startedAt;

    // If we have response, we just pipe headers and status
    res.writeHead(statusCode, {
      ...upstreamRes.headers,
      'X-Upstream-Response': 'true',
      'X-Upstream-URL': url,
      'Access-Control-Expose-Headers': 'x-upstream-response, x-upstream-url',
    });

    if (statusCode >= 400) {
      upstreamRes.pipe(res);
      liveConnections.delete(runId); // never made it to streaming phase
      log.warn({ status: statusCode, duration: upstreamDuration }, 'upstream returned error');
      return;
    }

    res.end();
    log.info({ status: statusCode, duration: upstreamDuration }, 'upstream connected, streaming');

    /**
     * Connection established
     */
    let conn: LiveConnectionStreaming;

    const state = createState(crypto.randomUUID()); // random message id (it can be overriden by user anyway in 'start' chunk)

    upstreamRes.setEncoding('utf-8'); // automatic decoding of stream to the string

    let streamFinishReason: { type: 'error', message: string, code: string, [key: string]: any } | { type: 'abort' } | { type: 'complete' } | undefined = undefined;

    function sendInternalMetadata(metadata: Record<string, any>) {
      const newChunk: ExtendedUIMessageChunk = {
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
          /**
           * IMPORTANT
           *
           * In case of successful finish, we must check whether there are any "pending" tool calls. THIS IS ERROR STATE FOR US.
           * Rationale: it's much better to explicitly show error than to make error states invisible.
           *
           * It's error state ONLY FOR 'completed' runs. In case of cancellation or error -> we expect that tools might be broken mid-way.
           */
          const pendingToolCalls: number[] = [];

          for (let i = 0; i < conn.state.message.parts.length; i++) {
            const part = conn.state.message.parts[i];
            if (isToolUIPart(part) && (part.state === 'input-streaming' || part.state === 'input-available' || part.state === 'approval-requested')) {
              pendingToolCalls.push(i);
            }
          }

          if (pendingToolCalls.length > 0) {
            streamFinishReason = { type: 'error', code: "STREAM_INCOMPLETE_TOOL_CALLS", message: `Stream finished with incomplete tool calls. Part indexes of incomplete tools:  [${pendingToolCalls.join(', ')}]. Please keep in mind Agentview doesn't support client-side tool calls and tool approvals yet.` };
          }
          else {
            streamFinishReason = { type: 'complete' };
          }

          upstreamRes.destroy(); // will trigger 'close' event without 'error' event
          return;
        }

        try {
          const chunk = parseUIMessageChunk(data);
          processChunk({ state, chunk });
          pushToBuffer(conn, data);
          chunkCount++;

          // add runId to message metadata
          if (chunk.type === 'start') {
            sendInternalMetadata(run)
          }

        } catch (error) {

          // Can't process chunk -> error.
          if (error instanceof ChunkParseError || error instanceof UIMessageStreamError) {
            log.warn({ err: error, data }, 'failed to parse chunk');
            streamFinishReason = { type: 'error', code: "STREAM_INVALID_CHUNK", message: error.message, data }; // just pass 'data' for debugging, it's enough
            upstreamRes.destroy(); // custom error handling
          }
          // Upstream error (sent by user) -> okay. No code.
          else if (error instanceof StreamUpstreamError) { // errors by user ('error' chunk in the upstream stream)
            log.info({ err: error }, 'upstream sent error chunk');
            streamFinishReason = { type: 'error', code: "STREAM_UPSTREAM_ERROR", message: error.message }; // upstream error has no code, no source
            upstreamRes.destroy();
          }
          // unexpected errors fallback
          else {
            log.error({ err: error }, 'unexpected error processing chunk');
            streamFinishReason = { type: 'error', code: "STREAM_INTERNAL_ERROR", message: (error as Error).message ?? String(error) }
          }

          upstreamRes.destroy();  // we can bypass on('error'), as we handled errors already (streamFinishReason is set)
        }

      },
    });

    upstreamRes.on('data', function onData(chunk: string) { // chunk is string thanks to setEncoding('utf-8')
      // Keep run.expiresAt fresh while upstream is actively sending data.
      // Throttled to once per 5s; if upstream goes silent, pings stop and the
      // expired-runs worker terminates the run after idleTimeout. Fire-and-forget.
      const now = Date.now();
      if (now - conn.lastActivityAt >= 5000) {
        conn.lastActivityAt = now;
        ping(conn);
      }
      sseParser.feed(chunk);
    });


    upstreamRes.on('error', function onError(error) {
      if (error instanceof GracefulRunTerminationError) { // graceful termination (aka sigterm)
        log.info({ status: error.reason.status }, 'graceful termination signal received');

        if (error.reason.status === 'cancelled') {
          streamFinishReason = { type: 'abort' };
        }
        else if (error.reason.status === 'failed') {
          streamFinishReason = { type: 'error', code: "STREAM_TERMINATED", message: error.message };
        }
      }
      else if (error instanceof RunTerminationError) { // run already killed
        log.info({ status: error.reason.status }, 'run already terminated, stream stopping');
        return;
      }
      // Network errors
      else if (isNodeHttpConnectionError(error)) { // in node you gotta check for 'code' property to know whether it's network error
        log.warn({ err: error, code: (error as any).code }, 'network error while streaming');
        streamFinishReason = { type: 'error', code: "STREAM_NETWORK_ERROR", detailedCode: (error as any).code, message: error.message };
      }
      // Unexpected errors fallback
      else {
        log.error({ err: error }, 'unexpected error while streaming');
        streamFinishReason = { type: 'error', code: "STREAM_INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) };
      }
    });

    // Lack of [done] is treated as unfinished stream -> therefore error.
    upstreamRes.on('end', () => {
      if (streamFinishReason) { return } // prevents race conditions (maybe [done] was just set before end event)

      streamFinishReason = { type: 'error', code: "STREAM_INCOMPLETE", message: "Stream ended incomplete" };
    });

    function cleanup(conn: LiveConnectionStreaming) {
      pushToBuffer(conn, DONE_MSG);
      markStreamDone(conn);

      // Keep buffer available for late-connecting consumers, clean up after 60s
      setTimeout(() => {
        liveConnections.delete(runId);
      }, 60_000);
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

      // Can't happen.
      if (!streamFinishReason) {
        log.error('unknown finish reason, setting to error');
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

      const finishedAt = new Date().toISOString();

      if (streamFinishReason.type === 'complete') {

        /**
         * In case of successful finish, we must check whether there are any "pending" tool calls.
         */


        sendInternalMetadata({
          ...run,
          status: 'completed',
          reason: null,
          finishedAt,
        })
      }
      else if (streamFinishReason.type === 'abort') {
        sendInternalMetadata({
          ...run,
          status: 'cancelled',
          reason: null,
          finishedAt,
        })
      }
      else {
        const { type, ...reason } = streamFinishReason;
        sendInternalMetadata({
          ...run,
          status: 'failed',
          reason,
          finishedAt,
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

      // Summary log: one line that captures the whole stream lifecycle.
      const duration = Date.now() - startedAt;
      const status = streamFinishReason.type === 'complete' ? 'completed'
        : streamFinishReason.type === 'abort' ? 'cancelled'
        : 'failed';
      const summary: Record<string, any> = { status, duration, chunks: chunkCount };
      if (streamFinishReason.type === 'error') {
        summary.code = streamFinishReason.code;
      }
      const summaryLevel = streamFinishReason.type === 'error' ? 'warn' : 'info';
      log[summaryLevel](summary, 'stream ended');

      // here we write async fun for easiness, on('close') is not hot path, a single promise won't hurt
      async function close() {
        const saveStart = Date.now();
        try {
          await cleanupStreamingUIMessageState(conn.state); // we need to clean up partial tool calls
          await saveDataAll(conn, streamFinishReason!);
          log.info({ duration: Date.now() - saveStart }, 'stream data saved');
        } catch (err) {
          log.error({ err, duration: Date.now() - saveStart }, 'failed to save stream data');
        } finally {
          cleanup(conn);
        }
      }

      close();
    });

    conn = {
      phase: 'streaming',
      run,
      metadata,

      upstreamReq,
      upstreamRes,

      state,

      lastActivityAt: 0,

      streamBuffer: [],
      streamDone: false,
      streamListeners: new Set(),
      streamDoneListeners: new Set(),
    };

    liveConnections.set(runId, conn);
  });

  // Track the connection from the moment we kick off the upstream request, so
  // DELETE /streams/:runId can find and terminate it during the connecting phase.
  liveConnections.set(runId, { phase: 'connecting', upstreamReq });

  // If this connection is closed before upstream started streaming (for example run POST call aborted by user), we should just close upstreamReq.
  // We should do this without argument, then 'error' event won't be called.
  req.on('close', () => {
    const current = liveConnections.get(runId);
    if (current && current.phase === 'streaming') return; // already streaming (or gone) - do nothing.

    log.info('client disconnected before upstream responded, aborting upstream');
    upstreamReq.destroy(); // doesn't trigger 'error' event
    liveConnections.delete(runId);
  });

  upstreamReq.on('error', (err) => {
    // Destroying upstreamRes (e.g. on cancellation) kills the shared socket,
    // which also triggers this error — but res is already finished by then.
    if (res.headersSent) return;

    const current = liveConnections.get(runId);
    if (!current) return; // nothing to do
    if (current.phase === 'streaming') return; // rather unreachable. belts and suspenders.

    if (err instanceof RunTerminationError) {
      log.info({ status: err.reason.status }, 'connection terminated during connecting');
      // err.message comes from terminationReasonText, e.g. "cancelled" or "failed (Timeout)".
      sendJson(res, 409, { code: "CONNECTION_TERMINATED", message: err.message });
    } else if (isNodeHttpConnectionError(err)) {
      log.warn({ err, code: (err as any).code }, 'failed to reach upstream');
      sendJson(res, 502, { code: "CONNECTION_NETWORK_ERROR", message: err.message, detailedCode: (err as any).code });
      liveConnections.delete(runId);
      return;
    }
    else {
      log.error({ err }, 'unexpected error reaching upstream');
      sendJson(res, 500, { code: "CONNECTION_INTERNAL_ERROR", message: err.message });
    }

    liveConnections.delete(runId);
  });

  upstreamReq.write(body);
  upstreamReq.end();
}

async function handleDeleteStream(req: http.IncomingMessage, res: http.ServerResponse, runId: string) {
  const startedAt = Date.now();
  const { reason, graceful }: { reason: RunTerminationReason; graceful: boolean } = await readJsonBody(req);

  if (!runId) {
    sendJson(res, 400, { message: 'Missing runId' });
    return;
  }

  log.info({ graceful, status: reason.status }, 'termination requested');

  const conn = liveConnections.get(runId);

  if (!conn) {
    log.info('stream not found');
    sendJson(res, 404, { message: 'conn not found' });
    return;
  }

  if (conn.phase === 'connecting') {
    conn.upstreamReq.destroy(new RunTerminationError(reason));
    log.info({ phase: 'connecting', duration: Date.now() - startedAt }, 'terminated');
    sendJson(res, 200, { ok: true });
    return;
  }
  else if (conn.phase === 'streaming') {
    const terminationError = graceful
      ? new GracefulRunTerminationError(reason)
      : new RunTerminationError(reason);

    conn.upstreamRes.destroy(terminationError);

    /**
     * Here we wait max 5s for termination to be completed.
     * If it doesn't happen, we treat it as an error state. This should be immediate.
     */
    let time = 0;
    const TOTAL_WAIT_TIME = 5000;
    const INTERVAL = 100;

    while (!conn.streamDone) {
      if (time > TOTAL_WAIT_TIME) {
        log.error({ duration: Date.now() - startedAt }, 'termination timed out');
        sendJson(res, 500, { message: 'Run not closed after 5 seconds after cancellation' });
        return;
      }

      await new Promise(resolve => setTimeout(resolve, INTERVAL));
      time += INTERVAL;
    }
  }

  log.info({ phase: 'streaming', duration: Date.now() - startedAt }, 'terminated');
  sendJson(res, 200, { ok: true });
}


// --- SSE stream endpoint ---

function handleGetStream(req: http.IncomingMessage, res: http.ServerResponse, runId: string) {
  const startedAt = Date.now();
  let chunksWritten = 0;
  let cleanedUp = false;

  const conn = liveConnections.get(runId);

  if (!conn || conn.phase !== 'streaming') {
    log.info('stream not found');
    sendJson(res, 404, { message: 'Stream not found' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.flushHeaders();

  log.info({ bufferSize: conn.streamBuffer.length, streamDone: conn.streamDone }, 'subscriber attached');

  function cleanup(reason: 'streamDone' | 'clientClose') {
    if (cleanedUp) return;
    cleanedUp = true;
    conn!.streamListeners.delete(onChunk);
    conn!.streamDoneListeners.delete(onDone);
    try { res.end(); } catch { }
    log.info({ duration: Date.now() - startedAt, chunksWritten, reason }, 'subscriber detached');
  }

  function writeChunk(data: string): boolean {
    res.write(`data: ${data}\n\n`);

    if (data === DONE_MSG) {
      cleanup('streamDone');
      return false;
    }
    chunksWritten++;
    return true;
  }

  const onChunk = (data: string) => writeChunk(data);
  const onDone = () => cleanup('streamDone');

  // Drain existing buffer
  for (const data of conn.streamBuffer) {
    if (!writeChunk(data)) return;
  }

  if (conn.streamDone) {
    cleanup('streamDone');
    return;
  }

  // Listen for new chunks
  conn.streamListeners.add(onChunk);
  conn.streamDoneListeners.add(onDone);

  req.once('close', () => cleanup('clientClose'));
}


// --- Request router ---

const requestHandler: http.RequestListener = async (req, res) => {
  await runWithContext({}, async () => {
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
        setContext({ method: 'POST', path: '/streams' });
        await handleCreateStream(req, res);
        return;
      }
      if (path.startsWith('/streams/')) {
        const runId = decodeURIComponent(path.slice('/streams/'.length));
        if (method === 'GET') {
          setContext({ method: 'GET', path: '/streams', runId });
          handleGetStream(req, res, runId);
          return;
        }
        if (method === 'DELETE') {
          setContext({ method: 'DELETE', path: '/streams', runId });
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
  });
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



