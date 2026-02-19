import { db__dangerous } from '../db';
import { runs } from '../schemas/schema';
import { eq, and, lt } from 'drizzle-orm';
import { createPeriodicWorker } from './createPeriodicWorker';

export const expiredRunsWorker = createPeriodicWorker({
  name: 'expired-runs',
  intervalMs: 1000,
  async run() {
    const now = new Date().toISOString();
    await db__dangerous
      .update(runs)
      .set({
        expiresAt: null,
        finishedAt: now,
        status: 'failed',
        failReason: { message: 'Timeout' },
        fetchStatus: null,
      })
      .where(
        and(
          eq(runs.status, 'in_progress'),
          lt(runs.expiresAt, now)
        )
      );
  },
});
