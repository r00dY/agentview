import { db__dangerous } from '../db';
import { runs } from '../schemas/schema';
import { eq, and, lt } from 'drizzle-orm';
import { createPeriodicWorker } from './utils';
import { publishRunStreamEvent, expireRunStream } from '../runStream';

export const expiredRunsWorker = createPeriodicWorker({
  name: 'expired-runs',
  intervalMs: 1000,
  async run() {
    const now = new Date().toISOString();
    const expiredRuns = await db__dangerous
      .update(runs)
      .set({
        expiresAt: null,
        finishedAt: now,
        updatedAt: now,
        status: 'failed',
        failReason: { message: 'Timeout' },
        fetchStatus: null,
      })
      .where(
        and(
          eq(runs.status, 'in_progress'),
          lt(runs.expiresAt, now)
        )
      )
      .returning({ id: runs.id });

    for (const expiredRun of expiredRuns) {
      await publishRunStreamEvent(expiredRun.id, {
        updatedAt: now,
        status: 'failed',
        failReason: { message: 'Timeout' },
      });
      await expireRunStream(expiredRun.id);
    }
  },
});
