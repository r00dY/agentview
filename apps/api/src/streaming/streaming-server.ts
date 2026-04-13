import http from 'node:http';
import https from 'node:https';
import { log } from '../logger';
import { startMeasuring } from '../performance';
import { startCpuProfiling, stopCpuProfiling } from './profiler';

import { RunTerminationError, type RunTerminationReason } from '../runs';
import { processEvent, type State } from './processEvent';
import { GracefulRunTerminationError, type LiveConnection } from './types';
import { saveData } from './saveData';
import { createParser, type EventSourceMessage } from 'eventsource-parser';

if (!process.env.HTTP_SERVER_PORT) {
  throw new Error('HTTP_SERVER_PORT is not set');
}

if (!process.env.STREAMING_SERVER_PORT) {
  throw new Error('STREAMING_SERVER_PORT is not set');
}

const perf = startMeasuring();
perf.startPrinting('streaming-server');

// --- Buffer helpers ---

function pushToBuffer(conn: LiveConnection, data: string) {
  conn.streamBuffer.push(data);
  const waiters = conn.streamNotify.splice(0);
  for (const resolve of waiters) resolve();
}

function markStreamDone(conn: LiveConnection) {
  conn.streamDone = true;
  const waiters = conn.streamNotify.splice(0);
  for (const resolve of waiters) resolve();
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

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
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
  const { runId, url, body, metadata } = await readJsonBody(req);

  log.info(`LIVE CONNECTION run:${runId}`);

  const requester = url.startsWith('https') ? https : http;
  const upstreamReq = requester.request(url, {
    method: 'POST',
    headers: {
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

    const state: State = {
      textBuffers: new Map<string, string>(),
      reasoningBuffers: new Map<string, string>(),
      toolStates: new Map<string, { toolName: string; inputText: string; input?: any }>(),
      emittedItemTypes: [],
      outputTexts: [],
    }

    upstreamRes.setEncoding('utf-8'); // automatic decoding of stream to the string

    const sseParser = createParser({
      onEvent: function onSSEEvent(event: EventSourceMessage) {
        const data = event.data;

        if (data === '[DONE]') {
          log.debug({ runId }, '[streaming] [DONE] received');

          // After done we just drain the stream and close the connection
          upstreamRes.removeAllListeners('data');
          upstreamRes.resume();
          return;
        }

        // parse
        const { data: processedData, op } = processEvent(runId, state, data);

        if (op) {
          saveData(conn, op); // todo: this is fire & forget -> we need better handling
        }

        // Buffer chunk for GET /stream consumers
        pushToBuffer(conn, processedData);
      },
    });

    upstreamRes.on('data', function onData(chunk: string) { // chunk is string thanks to setEncoding('utf-8')
      sseParser.feed(chunk);
    });

    upstreamRes.on('error', function onError(error) {
      if (error instanceof GracefulRunTerminationError) { // graceful termination (aka sigterm)
        log.info({ runId }, '[streaming] graceful termination');

        if (error.reason.status === 'cancelled') {
          conn.state.finalOp = { type: 'cancel' };
        }
        else if (error.reason.status === 'failed') {
          conn.state.finalOp = {
            type: 'fail',
            failReason: { message: error.message ?? 'Connection error' },
          };
        }
      }
      else if (error instanceof RunTerminationError) { // run already killed
        log.info({ runId }, '[streaming] run killed while streaming');
        return;
      }
      else if (error instanceof TypeError) { // connection error while streaming
        log.info({ runId }, '[streaming] connection error while streaming');

        conn.state.finalOp = {
          type: 'fail',
          failReason: { message: error.message ?? 'Connection error' },
        };
      } else { // unexpected error while streaming
        log.error({ runId }, '[streaming] unexpected error while streaming');
        conn.state.finalOp = {
          type: 'fail',
          failReason: { message: error instanceof Error ? error.message : String(error) },
        };
      }

      if (!conn.state.finalOp) {
        log.error({ runId, error }, 'Unreachable: no finalOp set');
        return;
      }

      if (conn.state.finalOp.type === 'cancel') {
        pushToBuffer(conn, JSON.stringify({ type: 'abort', reason: 'Cancelled by user' }));
      } else if (conn.state.finalOp.type === 'fail') {
        const failReason = conn.state.finalOp.failReason.message ?? 'Unknown error';
        pushToBuffer(conn, JSON.stringify({ type: 'error', errorText: failReason }));
      }

      saveData(conn, conn.state.finalOp); // TODO: this is fire & forget -> we need better handling
    });

    upstreamRes.on('end', () => {
      if (!state.finalOp) {
        log.info({ runId }, '[streaming] stream ended incomplete');
        state.finalOp = {
          type: 'fail',
          failReason: {
            message: 'Agent stream ended without completing',
          },
        };
      } else {
        log.info({ runId }, '[streaming] stream ended complete');
      }

      log.debug({ runId }, '[streaming] fast.patch for completion');
      saveData(conn, state.finalOp); // TODO: this is fire & forget -> we need better handling
    });

    upstreamRes.on('close', () => {
      upstreamRes.destroy();

      log.info({ runId }, '[streaming] sending [DONE]');

      pushToBuffer(conn, '[DONE]');
      markStreamDone(conn);

      // Keep buffer available for late-connecting consumers, clean up after 60s
      setTimeout(() => {
        liveConnections.delete(runId);
      }, 60_000);

      log.info({ runId }, '[streaming] connection cleaned up');
    });

    conn = {
      runId,
      metadata,

      upstreamRes,

      state,

      streamBuffer: [],
      streamDone: false,
      streamNotify: [],
    };

    liveConnections.set(runId, conn);

    log.info({ runId }, '[streaming] connection established');
  });

  upstreamReq.on('error', (err) => {
    log.error({ err }, '[streaming] upstream request error');

    const code = 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
    sendJson(res, 502, { code, message: err.message });
    return;
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

async function handleGetStream(req: http.IncomingMessage, res: http.ServerResponse, runId: string) {
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

  let cursor = 0;
  let pendingResolve: (() => void) | null = null;
  let aborted = false;

  const onClose = () => {
    aborted = true;
    pendingResolve?.();
  };
  req.once('close', onClose);

  try {
    while (!aborted) {
      // Drain all buffered chunks
      while (cursor < conn.streamBuffer.length) {
        const data = conn.streamBuffer[cursor++];
        if (data === '[DONE]') {
          res.end();
          return;
        }
        res.write(`data: ${data}\n\n`);
      }

      if (conn.streamDone) {
        res.end();
        return;
      }

      // Wait for new data or abort
      await new Promise<void>(resolve => {
        pendingResolve = resolve;
        conn.streamNotify.push(resolve);
        if (aborted) resolve();
      });
      pendingResolve = null;
    }
  } catch {
    // Stream cancelled by consumer
  }

  try { res.end(); } catch { }
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
        await handleGetStream(req, res, runId);
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


