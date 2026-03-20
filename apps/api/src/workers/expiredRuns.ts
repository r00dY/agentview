import { db__dangerous } from '../db';
import { runs } from '../schemas/schema';
import { inArray, sql } from 'drizzle-orm';
import { createWorker } from './utils';
import { terminateRun } from '../runs';

type Run = typeof runs.$inferSelect;

export const expiredRunsWorker = createWorker<Run>({
  name: 'expired-runs',
  pollIntervalMs: 1000,
  maxConcurrency: 100,
  async claim(limit) {
    const now = new Date().toISOString();
    return db__dangerous
      .update(runs)
      .set({ expiresAt: null })
      .where(
        inArray(
          runs.id,
          sql`(SELECT ${runs.id} FROM ${runs} WHERE ${runs.status} = 'in_progress' AND ${runs.expiresAt} < ${now} LIMIT ${sql.raw(String(limit))} FOR UPDATE SKIP LOCKED)`
        )
      )
      .returning();
  },
  async process(run) {
    await terminateRun(
      run.id,
      run.organizationId,
      {
        status: 'failed',
        failReason: { message: 'Timeout' },
      }
    );
  },
});
