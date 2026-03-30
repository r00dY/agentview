import { db__dangerous } from '../db';
import { runs } from '../schemas/schema';
import { inArray, sql } from 'drizzle-orm';
import { createWorker } from './utils';
import { terminateRun, type RunTerminationReason } from '../runs';
import { withOrg } from '../withOrg';
import { publishRunTerminationEvent } from '../runStream';

type Run = typeof runs.$inferSelect;

const TERMINATION_DELAY_MS = 5000;
const TERMINATION_REASON : RunTerminationReason = { status: 'failed', failReason: { message: 'Timeout' } };

export const expiredRunsWorker = createWorker<Run>({
  name: 'expired-runs',
  pollIntervalMs: 1000,
  maxConcurrency: 100,
  async claim(limit) {
    const now = new Date().toISOString();
    return db__dangerous
      .update(runs)
      .set({
        expiresAt: sql`${runs.expiresAt} + INTERVAL '${sql.raw(String(TERMINATION_DELAY_MS * 2))} milliseconds'` // when claiming we set expiration to 2x the termination delay. It should be done by then, but if it's not, it will be reclaimed.
      })
      .where(
        inArray(
          runs.id,
          sql`(SELECT ${runs.id} FROM ${runs} WHERE ${runs.status} IN ('init', 'pending', 'in_progress') AND ${runs.expiresAt} < ${now} LIMIT ${sql.raw(String(limit))} FOR UPDATE SKIP LOCKED)`
        )
      )
      .returning();
  },
  async process(run) {
    if (!run.manual) {
      // we send signal for auto-fetcher, it should clean up the run.
      await publishRunTerminationEvent(run.id, TERMINATION_REASON); // signal timeout
      await new Promise((resolve) => setTimeout(resolve, TERMINATION_DELAY_MS));
    }

    await withOrg(run.organizationId, async (tx) => {
      await terminateRun(tx, run.sessionId, run.id, TERMINATION_REASON);
    });
  },
});

