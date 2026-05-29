import { RunTerminationError, type FastPatchOp } from "../runs";
import { type LiveConnectionStreaming } from "./types";
import { log } from "../logger";

/**
 * Fire-and-forget keep-alive. Bumps run.expiresAt on the HTTP server so the
 * expired-runs worker doesn't kill a run that's still actively streaming.
 * Errors (network, 409 termination, etc.) are intentionally swallowed.
 */
export function ping(conn: LiveConnectionStreaming): void {
  saveData(conn, { type: 'ping' }).catch((err) => {
    log.debug({ runId: conn.run.id, err }, '[streaming] ping failed (ignored)');
  });
}

export async function saveData(
    conn: LiveConnectionStreaming,
    op: FastPatchOp,
  ) {
    log.info({ runId: conn.run.id }, '[streaming] saving data');
    const resp = await fetch(`${process.env.HTTP_SERVER_URL}/internal/fast-patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: conn.run.id,
        metadata: conn.metadata,
        op,
      }),
    });
  
    const body = await resp.json()
  
    if (resp.status === 409) {
      throw new RunTerminationError(body.reason);
    }
  
    if (!resp.ok) {
      log.error({ body }, '[streaming] fast-patch failed');
      throw new Error(`[streaming] fast-patch failed: ${body.message}`);
    }
  }
  

  export async function saveDataAll(
    conn: LiveConnectionStreaming,
    streamFinishReason: { type: 'error', message: string } | { type: 'abort' } | { type: 'complete' },
  ) {
    const parts = conn.state.message.parts;

    let channelReply: { text: string } | undefined = undefined;

    for (const part of parts) {
      if (part.type === 'data-agentview-state') {
        await saveData(conn, {
          type: 'state',
          content: part.data,
        });
      }
      else if (part.type === 'data-agentview-output') {
        channelReply = { text: typeof part.data === 'string' ? part.data : JSON.stringify(part.data) };
      }
      else {
        await saveData(conn, {
          type: 'item',
          content: part,
        });
      }
    }

    await saveData(conn, {
      type: 'metadata',
      metadata: {
        assistantMessage: {
          id: conn.state.message.id,
          metadata: conn.state.message.metadata,
        }
      },
    });

    if (streamFinishReason.type === 'error') {
      const { type, ...reason } = streamFinishReason;

      await saveData(conn, {
        type: 'fail',
        reason,
      });
    }
    else if (streamFinishReason.type === 'abort') {
      await saveData(conn, {
        type: 'cancel',
      });
    }
    else {
      let outputItemCount = 0;
      if (!channelReply) {
        const textParts : { type: 'text', text: string }[] = [];

        // we take text parts from the end of message, we stop with reasoning / tool / step-start
        for (const part of parts.reverse()) {
          if (part.type === 'text') {
            textParts.push(part);
          }
          else if (part.type === 'step-start' || part.type === 'reasoning' || part.type.startsWith('tool-')) {
            break;
          }
          else {
            // ignore other parts
          }
          outputItemCount++;
        }

        channelReply = { text: textParts.map(part => part.text).join('\n\n') };
      }
      
      await saveData(conn, {
        type: 'complete',
        outputItemCount,
        channelReply,
      });
    }
  }
  