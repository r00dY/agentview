import http from 'node:http';
import { log, setContext } from '../logger';
import { startMeasuring } from '../performance';
import { startCpuProfiling, stopCpuProfiling } from './profiler';

import { RunTerminationError, type RunTerminationReason } from '../runs';
import { type FastPatchOp } from '../runs';
import { uiMessageChunkSchema } from "ai";

if (!process.env.HTTP_SERVER_PORT) {
  throw new Error('HTTP_SERVER_PORT is not set');
}

if (!process.env.STREAMING_SERVER_PORT) {
  throw new Error('STREAMING_SERVER_PORT is not set');
}

// Resolve the LazySchema once — gives us a Schema with a `.validate()` method.
const uiMessageChunkValidator = uiMessageChunkSchema();

async function parseChunk(data: string) {
  const obj = JSON.parse(data);

  // simplified parsing for text-delta
  if (obj.type === 'text-delta') {
    if (typeof obj.delta !== 'string' || typeof obj.id !== 'string') {
      throw new Error('Invalid text-delta chunk');
    }
    return obj;
  }

  const validationResult = await uiMessageChunkValidator.validate!(JSON.parse(data));
  if (!validationResult.success) {
    throw validationResult.error;
  }
  return validationResult.value;
}

async function processChunk(conn: LiveConnection, chunk: Awaited<ReturnType<typeof parseChunk>>) {
  if (chunk.type === 'start' && !chunk.messageId) {
    chunk.messageId = conn.runId;
  }

  switch (chunk.type) {
    case 'start': {
      break;
    }

    case 'text-start': {
      conn.state.textBuffers.set(chunk.id, '');
      break;
    }

    case 'text-delta': {
      const current = conn.state.textBuffers.get(chunk.id) ?? '';
      conn.state.textBuffers.set(chunk.id, current + chunk.delta);
      break;
    }

    case 'text-end': {
      const text = conn.state.textBuffers.get(chunk.id) ?? '';
      conn.state.textBuffers.delete(chunk.id);
      conn.state.emittedItemTypes.push('text');
      conn.state.outputTexts.push(text);

      await callFastPatch(conn, { type: 'item', content: { type: 'text', text } });
      break;
    }

    case 'reasoning-start': {
      conn.state.reasoningBuffers.set(chunk.id, '');
      break;
    }

    case 'reasoning-delta': {
      const current = conn.state.reasoningBuffers.get(chunk.id) ?? '';
      conn.state.reasoningBuffers.set(chunk.id, current + chunk.delta);
      break;
    }

    case 'reasoning-end': {
      const text = conn.state.reasoningBuffers.get(chunk.id) ?? '';
      conn.state.reasoningBuffers.delete(chunk.id);
      conn.state.emittedItemTypes.push('reasoning');

      await callFastPatch(conn, { type: 'item', content: { type: 'reasoning', text } });
      break;
    }

    case 'tool-input-start': {
      conn.state.toolStates.set(chunk.toolCallId, {
        toolName: chunk.toolName,
        inputText: '',
      });
      break;
    }

    case 'tool-input-delta': {
      const state = conn.state.toolStates.get(chunk.toolCallId);
      if (state) {
        state.inputText += chunk.inputTextDelta;
      }
      break;
    }

    case 'tool-input-available': {
      const state = conn.state.toolStates.get(chunk.toolCallId);
      if (state) {
        state.input = chunk.input;
      }
      break;
    }

    case 'tool-output-available': {
      const state = conn.state.toolStates.get(chunk.toolCallId);
      if (state) {
        conn.state.emittedItemTypes.push('tool-call');
        await callFastPatch(conn, {
          type: 'item',
          content: { type: 'tool-call', toolCallId: chunk.toolCallId, toolName: state.toolName, state: 'output-available', input: state.input, output: chunk.output },
        });
        conn.state.toolStates.delete(chunk.toolCallId);
      }
      break;
    }

    case 'tool-output-error': {
      const state = conn.state.toolStates.get(chunk.toolCallId);
      if (state) {
        conn.state.emittedItemTypes.push('tool-call');
        await callFastPatch(conn, {
          type: 'item',
          content: { type: 'tool-call', toolCallId: chunk.toolCallId, toolName: state.toolName, state: 'output-error', input: state.input, errorText: chunk.errorText },
        });
        conn.state.toolStates.delete(chunk.toolCallId);
      }
      break;
    }

    case 'finish': {
      const outputCount = computeOutputItemCount(conn.state.emittedItemTypes);

      conn.state.finalOp = {
        type: 'complete',
        outputItemCount: outputCount,
        channelReply: { text: conn.state.outputTexts.filter(Boolean).join('\n\n') }, // we can always send channel reply, even for non-channel runs, who cares
      };
      break;
    }

    case 'error': {
      conn.state.finalOp = {
        type: 'fail',
        failReason: {
          message: chunk.errorText ?? 'Unknown error from AI SDK stream',
        },
      };
      break;
    }

    case 'data-session-state': {
      conn.state.emittedItemTypes.push('data');
      await callFastPatch(conn, {
        type: 'state',
        content: chunk.data,
      });
      break;
    }

    default:
      if (chunk.type.startsWith('data-')) {
        conn.state.emittedItemTypes.push('data');
        await callFastPatch(conn, {
          type: 'item',
          content: chunk,
        });
      }
      break;
  }
}


const perf = startMeasuring();
perf.startPrinting('streaming-server');

// signal to shut down streaming gracefully (to distinguish from normal RunTerminationError)
class GracefulRunTerminationError extends RunTerminationError {}


interface LiveConnection {
  runId: string;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  abortController: AbortController;
  metadata: string;

  state: {
    textBuffers: Map<string, string>,
    reasoningBuffers: Map<string, string>,
    toolStates: Map<string, { toolName: string; inputText: string; input?: any }>,
    emittedItemTypes: string[],
    outputTexts: string[],
    finalOp?: FastPatchOp
  }

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

let fetchCounter = 0;

async function handleCreateStream(req: http.IncomingMessage, res: http.ServerResponse) {
  const fetchId = `f${++fetchCounter}`;

  const { runId, url, body, metadata } = await readJsonBody(req);

  setContext({ fetchId, runId });

  log.info(`LIVE CONNECTION run:${runId}`);

  // Fetch agent endpoint
  const abortController = new AbortController();
  let response: Response;

  log.info(`started!`);

  try {
    response = await fetch(url, {
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

    sendJson(res, 400, { message: fetchError });
    return;
  }

  // Strip hop-by-hop headers — they describe the upstream connection framing,
  // not our new response. Forwarding them causes Content-Length + Transfer-Encoding
  // to coexist, which violates HTTP/1.1 and makes strict clients (undici) reject the response.
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key !== 'transfer-encoding' && key !== 'content-length') {
      headers[key] = value;
    }
  });
  headers['X-Upstream-Response'] = 'true';
  headers['Access-Control-Expose-Headers'] = 'x-upstream-response';

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

    log.info({ status: response.status, headers }, `[streaming] error response ${response.status}: ${errorText}`);

    res.writeHead(response.status, headers);
    res.end(errorText);
    return;
  }

  // Success - store connection and start streaming in background
  const reader = response.body.getReader();

  const connection: LiveConnection = {
    runId,
    metadata,

    reader,
    abortController,

    state: {
      textBuffers: new Map<string, string>(),
      reasoningBuffers: new Map<string, string>(),
      toolStates: new Map<string, { toolName: string; inputText: string; input?: any }>(),
      emittedItemTypes: [],
      outputTexts: [],
    },

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

  res.writeHead(response.status, headers);
  res.end();
}

async function handleDeleteStream(req: http.IncomingMessage, res: http.ServerResponse, runId: string) {
  const { reason, graceful }: { reason: RunTerminationReason; graceful: boolean } = await readJsonBody(req);

  if (!runId) {
    sendJson(res, 400, { message: 'Missing runId' });
    return;
  }

  const connection = liveConnections.get(runId);

  if (!connection) {
    sendJson(res, 404, { message: 'Connection not found' });
    return;
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

  try { res.end(); } catch {}
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
      try { res.end(); } catch {}
    }
  }
};


async function processStream(conn: LiveConnection) {
  const { reader, runId } = conn;

  try {
    log.info({ runId }, '[streaming] streaming started');

    for await (const data of parseAISDKStream(reader)) {
      if (data === '[DONE]') {
        log.debug({ runId }, '[streaming] [DONE] received');
        break;
      }

      // parse
      const chunk = await parseChunk(data);

      // update chunk (rare)
      let chunkUpdated = false;
      if (chunk.type === 'start' && !chunk.messageId) {
        chunk.messageId = conn.runId;
        chunkUpdated = true;
      }
      
      // update state
      await processChunk(conn, chunk);

      // Buffer chunk for GET /stream consumers
      pushToBuffer(conn, chunkUpdated ? JSON.stringify(chunk) : data); // strinfiy only updated chunks
    }

    if (!conn.state.finalOp) {
      log.info({ runId }, '[streaming] stream ended incomplete');
      conn.state.finalOp = {
        type: 'fail',
        failReason: {
          message: 'Agent stream ended without completing',
        },
      };
    } else {
      log.info({ runId }, '[streaming] stream ended complete');
    }

    log.debug({ runId }, '[streaming] fast.patch for completion');
    await callFastPatch(conn, conn.state.finalOp);

  } catch (error: unknown) {

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

    await callFastPatch(conn, conn.state.finalOp);

  } finally {
    await reader?.cancel().catch(() => {});

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


async function callFastPatch(
  conn: LiveConnection,
  op: FastPatchOp,
) {
  const resp = await fetch(`${process.env.HTTP_SERVER_URL}/internal/fast-patch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: conn.runId,
      metadata: conn.metadata,
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





export interface AISDKChunk {
  type: string;
  [key: string]: any;
}

/**
* Parse an AI SDK SSE stream.
* AI SDK uses `data: <json>\n\n` format (no `event:` field).
* Stream ends with `data: [DONE]\n\n`.
*/
async function* parseAISDKStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string, void, unknown> {

  const decoder = new TextDecoder();

  let buffer = '';

  while (true) {
      const { done, value } = await reader.read();

      if (done) {
          // Process remaining buffer
          if (buffer.trim()) {
              const lines = buffer.split('\n\n');
              for (const block of lines) {
                  const chunk = parseDataLine(block.trim());
                  if (chunk) yield chunk;
              }
          }
          break;
      }

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';

      for (const block of blocks) {
          const trimmed = block.trim();
          if (!trimmed) continue;
          const chunk = parseDataLine(trimmed);
          if (chunk) yield chunk;
      }
  }
}

function parseDataLine(line: string): string | null {
  if (!line.startsWith('data: ')) return null;
  const payload = line.substring(6).trim();
  return payload;
}

/**
 * Counts consecutive 'text' items from the end of the emitted item types array.
 * This determines how many items should be marked as output on completion.
 */
function computeOutputItemCount(emittedItemTypes: string[]): number {
  let count = 0;
  for (let i = emittedItemTypes.length - 1; i >= 0; i--) {
      if (emittedItemTypes[i] === 'text') {
          count++;
      } else {
          break;
      }
  }
  return Math.max(count, 1); // at least 1
}
