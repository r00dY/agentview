import { RunTerminationError, type FastPatchOp } from "../runs";
import { type LiveConnection } from "./types";
import { log } from "../logger";

export async function saveData(
    conn: LiveConnection,
    op: FastPatchOp,
  ) {
    log.info({ runId: conn.runId, op }, '[streaming] saving data');
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
      log.error({ body }, '[streaming] fast-patch failed');
      throw new Error(`[streaming] fast-patch failed: ${body.message}`);
    }
  }
  

  export async function saveDataAll(
    conn: LiveConnection,
    streamFinishReason: { type: 'error', message: string } | { type: 'abort' } | { type: 'complete' },
  ) {
    const parts = conn.state.message.parts;

    for (const part of parts) {
      await saveData(conn, {
        type: 'item',
        content: part,
      });
    }

    conn.state.message.metadata

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
      const { type, ...failReason } = streamFinishReason;

      await saveData(conn, {
        type: 'fail',
        failReason,
      });
    }
    else if (streamFinishReason.type === 'abort') {
      await saveData(conn, {
        type: 'cancel',
      });
    }
    else {
      // TODO: make this algo better
      const textParts : { type: 'text', text: string }[] = [];

      for (const part of parts.reverse()) {
        if (part.type === 'text') {
          textParts.push(part);
        }
      }

      await saveData(conn, {
        type: 'complete',
        outputItemCount: textParts.length,
        channelReply: { text: textParts.map(part => part.text).join('\n\n') },
      });
    }
  }
  