import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { log, setContext } from '../logger';
import { parseAISDKStream, computeOutputItemCount, type AISDKChunk } from '../adapters/ai-sdk-utils';
import { publishAISDKStreamEvent, expireAISDKStream } from '../adapters/ai-sdk-stream';
import { RunTerminationError, type RunTerminationReason } from '../runs';
import { type FastPatchOp } from '../runs';

// signal to shut down streaming gracefully (to distinguish from normal RunTerminationError)
class GracefulRunTerminationError extends RunTerminationError {}

const HTTP_SERVER_BASE_URL = `http://localhost:${process.env.HTTP_SERVER_PORT ?? '80'}`;

interface LiveConnection {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  abortController: AbortController;
  runConfig: any;
  sessionId: string;
  runId: string
  organizationId: string;

  state: {
    textBuffers: Map<string, string>,
    reasoningBuffers: Map<string, string>,
    toolStates: Map<string, { toolName: string; inputText: string; input?: any }>,
    emittedItemTypes: string[],
    outputTexts: string[],
    finalOp?: FastPatchOp
  }
}


const liveConnections = new Map<string, LiveConnection>();

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, connections: liveConnections.size }));

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
      body: JSON.stringify(body),
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
  const reader = response.body.getReader();

  const connection: LiveConnection = {
    reader,
    abortController,
    runConfig,
    sessionId,
    runId,
    organizationId,

    state: {
      textBuffers: new Map<string, string>(),
      reasoningBuffers: new Map<string, string>(),
      toolStates: new Map<string, { toolName: string; inputText: string; input?: any }>(),
      emittedItemTypes: [],
      outputTexts: [],
    }
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
   * Here we wait 10s for run to be closed (check is liveConnections.has(runId)).
   * But this is TOTAL EXCEPTION AND THIS CODE *HAS TO* WORK.
   * Basically if this code doesn't work then termination of live connections doesn't work at all.
   * 
   * Above abort was triggered, so connection must be dead. The only thing we wait for is last fast patch.
   */
  let time = 0;
  const TOTAL_WAIT_TIME = 5000;
  const INTERVAL = 100;

  while (liveConnections.has(runId)) {
    if (time > TOTAL_WAIT_TIME) {
      log.error({ runId }, '[streaming] run not closed after 5 seconds after cancellation');
      return c.json({ message: 'Run not closed after 10 seconds after cancellation' }, 500);
    }
    
    await new Promise(resolve => setTimeout(resolve, INTERVAL));
    time += INTERVAL;
  }

  return c.json({ ok: true });
});


async function callFastPatch(
  conn: LiveConnection,
  op: FastPatchOp,
) {
  const resp = await fetch(`${HTTP_SERVER_BASE_URL}/internal/fast-patch`, {
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
  const { reader, runId /*, isChannelRun*/ } = conn;

  try {
    log.info({ runId }, '[streaming] streaming started');

    for await (const data of parseAISDKStream(reader)) {
      if (data === '[DONE]') {
        log.debug({ runId }, '[streaming] [DONE] received');
        break;
      }

      const chunk = JSON.parse(data) as AISDKChunk;
      if (chunk.type === 'start' && !chunk.messageId) {
        chunk.messageId = runId;
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

          log.debug({ runId }, '[streaming] fast.patch for "text"');
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

          log.debug({ runId }, '[streaming] fast.patch for "reasoning"');
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
            log.debug({ runId }, '[streaming] fast.patch for "tool-output-available"');
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
            log.debug({ runId }, '[streaming] fast.patch for "tool-output-error"');
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
          log.debug({ runId }, '[streaming] fast.patch for state');
          await callFastPatch(conn, {
            type: 'state',
            content: chunk.data,
          });
          break;
        }

        default:
          if (chunk.type.startsWith('data-')) {
            log.debug({ runId }, `[streaming] fast.patch for "${chunk.type}"`);
            conn.state.emittedItemTypes.push('data');
            await callFastPatch(conn, {
              type: 'item',
              content: chunk,
            });
          }
          log.trace(chunk, 'ignored chunk');
          break;
      }

      // Mirror native chunks to Redis stream
      log.trace(chunk, 'stream event');
      await publishAISDKStreamEvent(runId, JSON.stringify(chunk));
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
      await publishAISDKStreamEvent(runId, JSON.stringify({ type: 'abort', reason: 'Cancelled by user' }));
    } else if (conn.state.finalOp.type === 'fail') {
      const failReason = conn.state.finalOp.failReason.message ?? 'Unknown error';
      await publishAISDKStreamEvent(runId, JSON.stringify({ type: 'error', errorText: failReason }));
    }

    await callFastPatch(conn, conn.state.finalOp);

  } finally {
    await reader?.cancel().catch(() => {});

    log.info({ runId }, '[streaming] sending [DONE]');

    try {
      await publishAISDKStreamEvent(runId, '[DONE]');
      await expireAISDKStream(runId);
    } catch (e) {}

    liveConnections.delete(runId);
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

const port = Number(process.env.STREAMING_SERVER_PORT ?? '1999');
serve({ fetch: app.fetch, port });
log.info(`[streaming-server] listening on port ${port}`);
