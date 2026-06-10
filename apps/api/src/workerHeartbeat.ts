import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { sql } from 'drizzle-orm';
import { db__dangerous } from './db';
import { workerHeartbeats } from './schemas/schema';
import { log } from './logger';

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_STALE_MS = 30_000;

const workerId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

let timer: NodeJS.Timeout | null = null;

async function writeHeartbeat() {
  try {
    await db__dangerous
      .insert(workerHeartbeats)
      .values({ workerId, lastBeatAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: workerHeartbeats.workerId,
        set: { lastBeatAt: sql`now()` },
      });
  } catch (err) {
    log.warn({ err }, 'failed to write worker heartbeat');
  }
}

export async function startWorkerHeartbeat() {
  await writeHeartbeat();
  timer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
  timer.unref();
  log.info({ workerId, intervalMs: HEARTBEAT_INTERVAL_MS }, 'worker heartbeat started');
}

export async function stopWorkerHeartbeat() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  try {
    await db__dangerous.delete(workerHeartbeats).where(sql`${workerHeartbeats.workerId} = ${workerId}`);
  } catch (err) {
    log.warn({ err }, 'failed to remove worker heartbeat');
  }
}
