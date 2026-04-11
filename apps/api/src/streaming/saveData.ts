import { RunTerminationError, type FastPatchOp } from "../runs";
import { type LiveConnection } from "./types";

export async function saveData(
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
  