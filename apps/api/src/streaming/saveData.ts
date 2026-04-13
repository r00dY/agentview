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
  