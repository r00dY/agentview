import { db__dangerous } from '../db';
import { withOrg } from '../withOrg';
import { runs } from '../schemas/schema';
import { eq, and, lt } from 'drizzle-orm';

export async function processExpiredRuns() {
  try {
    const now = new Date().toISOString();

    // Find all runs that are in_progress and have expired
    const expiredRuns = await db__dangerous
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.status, 'in_progress'),
          lt(runs.expiresAt, now)
        )
      );

    if (expiredRuns.length === 0) {
      return;
    }

    // Update each expired run (using withOrg for RLS enforcement)
    for (const run of expiredRuns) {
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
          .where(eq(runs.id, run.id));
      });
    }

    if (expiredRuns.length > 0) {
      console.log(`Processed ${expiredRuns.length} expired run(s)`);
    }

  } catch (error) {
    console.error('Error processing expired runs:', error);
  }
}
