import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { log, setContext } from '../logger';
import { RunTerminationError, type RunTerminationReason } from '../runs';
import { type FastPatchOp } from '../runs';
import { startMeasuring } from '../performance';
import { parseJsonEventStream, uiMessageChunkSchema } from "ai";

const perf = startMeasuring();
perf.startPrinting('streaming-server');

// signal to shut down streaming gracefully (to distinguish from normal RunTerminationError)
class GracefulRunTerminationError extends RunTerminationError {}

if (!process.env.HTTP_SERVER_PORT) {
  throw new Error('HTTP_SERVER_PORT is not set');
}

if (!process.env.STREAMING_SERVER_PORT) {
  throw new Error('STREAMING_SERVER_PORT is not set');
}

interface LiveConnection {
  stream: ReadableStream<Uint8Array>;
  abortController: AbortController;
  runConfig: string;
  sessionId: string;
  runId: string
  organizationId: string;

  // In-memory stream buffer for GET /stream consumers
  streamBuffer: string[];
  streamDone: boolean;
  streamNotify: (() => void)[];
}

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

const app = new Hono();

app.get('/health', (c) => {
  const snap = perf.get();
  return c.json({
    ok: true,
    connections: liveConnections.size,
    elu: snap.elu,
    memory: {
      rss: snap.memory.rss,
      heapUsed: snap.memory.heapUsed,
    },
  });
});

let fetchCounter = 0;


app.post('/connect', async (c) => {
  const fetchId = `f${++fetchCounter}`

  const { body, runConfig, agentUrl, sessionId, runId, organizationId } = await c.req.json();

  setContext({ fetchId, runId, sessionId, organizationId });

  log.info(`LIVE CONNECTION run:${runId} session:${sessionId}`);

  // Fetch agent endpoint
  const abortController = new AbortController();
  let response: Response;

  log.info(`started!`);

  try {
    response = await fetch(agentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: abortController.signal,
    });
  } catch (error: unknown) {
    const fetchError = error instanceof TypeError
      ? (error.message ?? 'Connection error')
      : (error instanceof Error ? error.message : 'Connection error');

    log.info({ error }, `[streaming] fetch error: ${fetchError}`);

    return new Response(JSON.stringify({ message: fetchError }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const forwarded = Object.fromEntries(response.headers.entries());
  delete forwarded['transfer-encoding'];
  delete forwarded['content-length'];

  const headers: Record<string, string> = {
    ...forwarded,
    'X-Upstream-Response': 'true',
    'Access-Control-Expose-Headers': 'x-upstream-response',
  };

  // Check for error responses
  if (!response.body || !response.ok) {
    let errorText: string;
    try {
      errorText = await response.text();
    } catch {
      errorText = 'Error reading response body';
    }

    if (!response.body) {
      errorText = errorText || 'No response body';
    }

    // Strip hop-by-hop headers — they describe the upstream connection framing,
    // not our new response. Forwarding them causes Content-Length + Transfer-Encoding
    // to coexist, which violates HTTP/1.1 and makes strict clients (undici) reject the response.
    const forwarded = Object.fromEntries(response.headers.entries());
    delete forwarded['transfer-encoding'];
    delete forwarded['content-length'];

    log.info({ status: response.status, headers },`[streaming] error response ${response.status}: ${errorText}`);

    return new Response(errorText, {
      status: response.status,
      headers,
    });
  }

  // Success - store connection and start streaming in background
  const connection: LiveConnection = {
    stream: response.body,
    abortController,
    runConfig,
    sessionId,
    runId,
    organizationId,

    streamBuffer: [],
    streamDone: false,
    streamNotify: [],
  };

  liveConnections.set(runId, connection);

  // Start processing in background (don't await)
  processStream(connection).catch((err) => {
    log.error({ err, runId }, '[streaming] processStream unhandled error');
  });

  log.info({ runId }, '[streaming] connection established');

  return new Response(null, {
    status: response.status,
    headers,
  });
});


app.post('/terminate', async (c) => {
  const { runId, reason, graceful } : { runId: string, reason: RunTerminationReason, graceful: boolean } = await c.req.json()

  if (!runId) {
    return c.json({ message: 'Missing runId' }, 400);
  }

  const connection = liveConnections.get(runId);

  if (!connection) {
    return c.json({ message: 'Connection not found' }, 404);
  }

  if (!graceful) {
    connection.abortController.abort(new RunTerminationError(reason));
  }
  else {
    connection.abortController.abort(new GracefulRunTerminationError(reason));
  }

  /**
   * Here we wait max 5s for termination to be completed.
   * If it doesn't happen, we treat it as an error state. This should be immediate.
   */
  let time = 0;
  const TOTAL_WAIT_TIME = 5000;
  const INTERVAL = 100;

  while (!connection.streamDone) {
    if (time > TOTAL_WAIT_TIME) {
      log.error({ runId }, '[streaming] run not closed after 5 seconds after cancellation');
      return c.json({ message: 'Run not closed after 5 seconds after cancellation' }, 500);
    }

    await new Promise(resolve => setTimeout(resolve, INTERVAL));
    time += INTERVAL;
  }

  return c.json({ ok: true });
});


// --- SSE stream endpoint ---

app.get('/stream/:runId', async (c) => {
  const runId = c.req.param('runId');
  const conn = liveConnections.get(runId);

  if (!conn) {
    return c.json({ message: 'Stream not found' }, 404);
  }

  const signal = c.req.raw.signal;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let cursor = 0;
      let pendingResolve: (() => void) | null = null;

      const onAbort = () => { pendingResolve?.(); };
      signal.addEventListener('abort', onAbort, { once: true });

      try {
        while (!signal.aborted) {
          // Drain all buffered chunks
          while (cursor < conn.streamBuffer.length) {
            const data = conn.streamBuffer[cursor++];
            if (data === '[DONE]') {
              controller.close();
              return;
            }
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }

          if (conn.streamDone) {
            controller.close();
            return;
          }

          // Wait for new data or abort
          await new Promise<void>(resolve => {
            pendingResolve = resolve;
            conn.streamNotify.push(resolve);
            if (signal.aborted) resolve();
          });
          pendingResolve = null;
        }
      } catch {
        // Stream cancelled by consumer
      }

      try { controller.close(); } catch {}
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});


async function callFastPatch(
  conn: LiveConnection,
  op: FastPatchOp,
) {
  const resp = await fetch(`${process.env.HTTP_SERVER_URL}/internal/fast-patch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: conn.runId,
      sessionId: conn.sessionId,
      organizationId: conn.organizationId,
      runConfig: conn.runConfig,
      op,
    }),
  });

  const body = await resp.json()

  if (resp.status === 409) {
    throw new RunTerminationError(body.reason);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => 'unknown');
    throw new Error(`[streaming] fast-patch failed: ${text}`);
  }
}


async function processStream(conn: LiveConnection) {
  const { runId } = conn;

  try {
    log.info({ runId }, '[streaming] streaming started');

    const chunkStream = parseJsonEventStream({
      stream: conn.stream,
      schema: uiMessageChunkSchema,
    });

    for await (const result of chunkStream) {
      if (!result.success) {
        throw result.error;
      }
      const chunk = result.value;
      log.trace(chunk, 'stream event');
      pushToBuffer(conn, JSON.stringify(chunk));
    }

    log.info({ runId }, '[streaming] stream ended');

  } catch (error: unknown) {
    log.error({ err: error, runId }, '[streaming] error while streaming');
  } finally {
    // Nothing fancy: always call fast-patch with fail at the end.
    await callFastPatch(conn, {
      type: 'fail',
      failReason: { message: 'not implemented' },
    }).catch((err) => {
      log.error({ err, runId }, '[streaming] fast-patch failed');
    });

    log.info({ runId }, '[streaming] sending [DONE]');

    pushToBuffer(conn, '[DONE]');
    markStreamDone(conn);

    // Keep buffer available for late-connecting consumers, clean up after 60s
    setTimeout(() => {
      liveConnections.delete(runId);
    }, 60_000);

    log.info({ runId }, '[streaming] connection cleaned up');
  }
}

// Prevent unhandled rejections from crashing the process
process.on('unhandledRejection', (reason) => {
  log.error({ reason }, '[streaming-server] Unhandled rejection');
});

process.on('uncaughtException', (error) => {
  log.error({ err: error }, '[streaming-server] Uncaught exception');
});

const port = Number(process.env.STREAMING_SERVER_PORT);
serve({ fetch: app.fetch, port });
log.info(`[streaming-server] listening on port ${port}`);
