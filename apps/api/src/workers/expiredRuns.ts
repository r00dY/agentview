import { db__dangerous } from '../db';
import { withOrg } from '../withOrg';
import { runs } from '../schemas/schema';
import { eq, and, lt } from 'drizzle-orm';
import { createWorker } from './createWorker';

type ExpiredRun = typeof runs.$inferSelect;

export const expiredRunsWorker = createWorker<ExpiredRun>({
  name: 'expired-runs',
  pollIntervalMs: 1000,
  maxConcurrency: 20,
  async claim(limit) {
    const now = new Date().toISOString();
    return db__dangerous
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.status, 'in_progress'),
          lt(runs.expiresAt, now)
        )
      )
      .limit(limit);
  },
  async process(run) {
    const now = new Date().toISOString();
    await withOrg(run.organizationId, async (tx) => {
      await tx
        .update(runs)
        .set({
          expiresAt: null,
          finishedAt: now,
          status: 'failed',
          failReason: { message: 'Timeout' },
          fetchStatus: null,
        })
        .where(and(eq(runs.id, run.id), eq(runs.status, 'in_progress')));
    });
  },
});
