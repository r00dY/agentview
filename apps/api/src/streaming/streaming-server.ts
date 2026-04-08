import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { log, setContext } from '../logger';
import { parseAISDKStream, computeOutputItemCount, type AISDKChunk } from '../adapters/ai-sdk-utils';
import { publishAISDKStreamEvent, expireAISDKStream } from '../adapters/ai-sdk-stream';

// Lightweight termination error (avoids importing ../runs which pulls in DB/Redis)
class StreamTerminationError extends Error {
  constructor(public reason: { status: string; failReason?: any }) {
    super(reason.status);
    this.name = 'StreamTerminationError';
  }
}

type FastPatchOp =
  | { type: 'item'; id?: string; content: any }
  | { type: 'state'; content: any }
  | { type: 'metadata'; metadata: Record<string, any> }
  | { type: 'cancel' }
  | { type: 'fail'; failReason: { message: string; [key: string]: any } }
  | { type: 'complete'; outputItemCount: number; channelReply?: { text: string } };

const MAIN_API_URL = `http://localhost:${process.env.HTTP_SERVER_PORT ?? '80'}`;

interface LiveConnection {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  abortController: AbortController;
  runConfig: any;
  sessionId: string;
  runId: string
  organizationId: string;
  // environmentHandle: string;
  // isChannelRun: boolean;
}

const liveConnections = new Map<string, LiveConnection>();

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, connections: liveConnections.size }));

let fetchCounter = 0;

app.post('/connect', async (c) => {
  const fetchId = `f${++fetchCounter}`

  // const originalUrl = c.req.header('X-Original-Url');
  // const runId = c.req.header('X-Run-Id');
  // const sessionId = c.req.header('X-Session-Id');
  // const organizationId = c.req.header('X-Organization-Id');
  // const environmentHandle = c.req.header('X-Environment-Handle');

  // if (!originalUrl || !runId || !sessionId || !organizationId || !environmentHandle) {
  //   return c.json({ message: 'Missing required headers' }, 400);
  // }

  const { body, runConfig, agentUrl, sessionId, runId, organizationId } = await c.req.json();

  setContext({ fetchId, runId, sessionId, organizationId });

  log.info(`LIVE CONNECTION run:${runId} session:${sessionId}`);

  // const isChannelRun = (() => {
  //   const lastRun = session?.runs?.[session.runs.length - 1];
  //   if (!lastRun) return false;
  //   const incomingMessages = lastRun.channelMessages?.filter((cm: any) => cm.direction === 'incoming') ?? [];
  //   return incomingMessages.length > 0;
  // })();

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

    const headers: Record<string, string> = {
      ...forwarded,
      'X-Upstream-Response': 'true',
      'Access-Control-Expose-Headers': 'x-upstream-response',
    };

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
    organizationId
    // organizationId,
    // environmentHandle,
    // isChannelRun,
  };

  liveConnections.set(runId, connection);

  // Start processing in background (don't await)
  processStream(connection).catch((err) => {
    log.error({ err, runId }, '[streaming] processStream unhandled error');
  });

  log.info({ runId }, '[streaming] connection established');

  return c.body(null, 200);
});


app.post('/cancel', async (c) => {
  const runId = c.req.header('X-Run-Id') ?? c.req.query('runId');

  if (!runId) {
    return c.json({ message: 'Missing runId' }, 400);
  }

  const connection = liveConnections.get(runId);
  if (connection) {
    log.info({ runId }, '[streaming] cancelling connection');
    connection.abortController.abort(new StreamTerminationError({ status: 'cancelled' }));
  } else {
    log.debug({ runId }, '[streaming] cancel: connection not found (already finished or never existed)');
  }

  return c.json({ ok: true });
});


async function callFastPatch(
  conn: LiveConnection,
  op: FastPatchOp,
): Promise<{ terminated: boolean }> {
  try {
    const resp = await fetch(`${MAIN_API_URL}/internal/fast-patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: conn.runId,
        sessionId: conn.sessionId,
        organizationId: conn.organizationId,
        // environmentHandle: conn.environmentHandle,
        runConfig: conn.runConfig,
        op,
      }),
    });

    if (resp.status === 409) {
      return { terminated: true };
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => 'unknown');
      log.error({ runId: conn.runId, status: resp.status, text }, '[streaming] fast-patch failed');
    }

    return { terminated: false };
  } catch (error) {
    log.error({ runId: conn.runId, err: error }, '[streaming] fast-patch call failed');
    return { terminated: false };
  }
}


async function processStream(conn: LiveConnection) {
  const { reader, runId /*, isChannelRun*/ } = conn;

  let finalOp: FastPatchOp | undefined = undefined;

  try {
    log.info({ runId }, '[streaming] streaming started');

    const textBuffers = new Map<string, string>();
    const reasoningBuffers = new Map<string, string>();
    const toolStates = new Map<string, { toolName: string; inputText: string; input?: any }>();
    const emittedItemTypes: string[] = [];
    const outputTexts: string[] = [];

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
          textBuffers.set(chunk.id, '');
          break;
        }

        case 'text-delta': {
          const current = textBuffers.get(chunk.id) ?? '';
          textBuffers.set(chunk.id, current + chunk.delta);
          break;
        }

        case 'text-end': {
          const text = textBuffers.get(chunk.id) ?? '';
          textBuffers.delete(chunk.id);
          emittedItemTypes.push('text');
          outputTexts.push(text);

          log.debug({ runId }, '[streaming] fast.patch for "text"');
          const { terminated } = await callFastPatch(conn, { type: 'item', content: { type: 'text', text } });
          if (terminated) throw new StreamTerminationError({ status: 'discarded', failReason: { message: 'Run terminated' } });
          break;
        }

        case 'reasoning-start': {
          reasoningBuffers.set(chunk.id, '');
          break;
        }

        case 'reasoning-delta': {
          const current = reasoningBuffers.get(chunk.id) ?? '';
          reasoningBuffers.set(chunk.id, current + chunk.delta);
          break;
        }

        case 'reasoning-end': {
          const text = reasoningBuffers.get(chunk.id) ?? '';
          reasoningBuffers.delete(chunk.id);
          emittedItemTypes.push('reasoning');

          log.debug({ runId }, '[streaming] fast.patch for "reasoning"');
          const { terminated } = await callFastPatch(conn, { type: 'item', content: { type: 'reasoning', text } });
          if (terminated) throw new StreamTerminationError({ status: 'discarded', failReason: { message: 'Run terminated' } });
          break;
        }

        case 'tool-input-start': {
          toolStates.set(chunk.toolCallId, {
            toolName: chunk.toolName,
            inputText: '',
          });
          break;
        }

        case 'tool-input-delta': {
          const state = toolStates.get(chunk.toolCallId);
          if (state) {
            state.inputText += chunk.inputTextDelta;
          }
          break;
        }

        case 'tool-input-available': {
          const state = toolStates.get(chunk.toolCallId);
          if (state) {
            state.input = chunk.input;
          }
          break;
        }

        case 'tool-output-available': {
          const state = toolStates.get(chunk.toolCallId);
          if (state) {
            emittedItemTypes.push('tool-call');
            log.debug({ runId }, '[streaming] fast.patch for "tool-output-available"');
            const { terminated } = await callFastPatch(conn, {
              type: 'item',
              content: { type: 'tool-call', toolCallId: chunk.toolCallId, toolName: state.toolName, state: 'output-available', input: state.input, output: chunk.output },
            });
            if (terminated) throw new StreamTerminationError({ status: 'discarded', failReason: { message: 'Run terminated' } });
            toolStates.delete(chunk.toolCallId);
          }
          break;
        }

        case 'tool-output-error': {
          const state = toolStates.get(chunk.toolCallId);
          if (state) {
            emittedItemTypes.push('tool-call');
            log.debug({ runId }, '[streaming] fast.patch for "tool-output-error"');
            const { terminated } = await callFastPatch(conn, {
              type: 'item',
              content: { type: 'tool-call', toolCallId: chunk.toolCallId, toolName: state.toolName, state: 'output-error', input: state.input, errorText: chunk.errorText },
            });
            if (terminated) throw new StreamTerminationError({ status: 'discarded', failReason: { message: 'Run terminated' } });
            toolStates.delete(chunk.toolCallId);
          }
          break;
        }

        case 'finish': {
          const outputCount = computeOutputItemCount(emittedItemTypes);

          finalOp = {
            type: 'complete',
            outputItemCount: outputCount,
            // channelReply: isChannelRun ? { text: outputTexts.filter(Boolean).join('\n\n') } : undefined,
          };
          break;
        }

        case 'error': {
          finalOp = {
            type: 'fail',
            failReason: {
              message: chunk.errorText ?? 'Unknown error from AI SDK stream',
            },
          };
          break;
        }

        case 'data-session-state': {
          emittedItemTypes.push('data');
          log.debug({ runId }, '[streaming] fast.patch for state');
          const { terminated } = await callFastPatch(conn, {
            type: 'state',
            content: chunk.data,
          });
          if (terminated) throw new StreamTerminationError({ status: 'discarded', failReason: { message: 'Run terminated' } });
          break;
        }

        default:
          if (chunk.type.startsWith('data-')) {
            log.debug({ runId }, `[streaming] fast.patch for "${chunk.type}"`);
            emittedItemTypes.push('data');
            const { terminated } = await callFastPatch(conn, {
              type: 'item',
              content: chunk,
            });
            if (terminated) throw new StreamTerminationError({ status: 'discarded', failReason: { message: 'Run terminated' } });
          }
          log.trace(chunk, 'ignored chunk');
          break;
      }

      // Mirror native chunks to Redis stream
      log.trace(chunk, 'stream event');
      await publishAISDKStreamEvent(runId, JSON.stringify(chunk));
    }

    if (!finalOp) {
      log.info({ runId }, '[streaming] stream ended incomplete');
      finalOp = {
        type: 'fail',
        failReason: {
          message: 'Agent stream ended without completing',
        },
      };
    } else {
      log.info({ runId }, '[streaming] stream ended complete');
    }

    log.debug({ runId }, '[streaming] fast.patch for completion');
    await callFastPatch(conn, finalOp);

  } catch (error: unknown) {
    if (error instanceof StreamTerminationError) {
      if (error.reason.status === 'discarded') {
        log.info({ runId }, '[streaming] run discarded, returning');
        return;
      } else if (error.reason.status === 'cancelled') {
        finalOp = { type: 'cancel' };
      } else {
        finalOp = {
          type: 'fail',
          failReason: { message: error.message ?? 'Connection error' },
        };
      }
    } else if (error instanceof TypeError) {
      finalOp = {
        type: 'fail',
        failReason: { message: error.message ?? 'Connection error' },
      };
    } else {
      finalOp = {
        type: 'fail',
        failReason: { message: error instanceof Error ? error.message : String(error) },
      };
    }

    log.info({ runId, finalOp }, `[streaming] error while streaming`);
    await callFastPatch(conn, finalOp);

    if (finalOp.type === 'cancel') {
      await publishAISDKStreamEvent(runId, JSON.stringify({ type: 'abort', reason: 'Cancelled by user' }));
    } else {
      const failReason = (finalOp as any).failReason?.message ?? 'Unknown error';
      await publishAISDKStreamEvent(runId, JSON.stringify({ type: 'error', errorText: failReason }));
    }

  } finally {
    await reader?.cancel().catch(() => {});

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
