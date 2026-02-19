import { db__dangerous } from '../db';
import { withOrg } from '../withOrg';
import { webhookJobs, environments } from '../schemas/schema';
import { eq, and, lt, or, isNull } from 'drizzle-orm';
import { generateSessionSummary } from '../summaries';

// Webhook job retry delays: 5s, 30s, 2min
const RETRY_DELAYS = [5_000, 30_000, 120_000];

export async function processWebhookJobs() {
  try {
    const now = new Date().toISOString();

    // Find jobs ready to be processed (cross-org scan needs db__dangerous)
    const jobs = await db__dangerous
      .select()
      .from(webhookJobs)
      .where(
        and(
          eq(webhookJobs.status, 'pending'),
          or(isNull(webhookJobs.nextAttemptAt), lt(webhookJobs.nextAttemptAt, now))
        )
      )
      .limit(10);

    for (const job of jobs) {
      // CAS: claim job only if still pending
      const [claimed] = await db__dangerous
        .update(webhookJobs)
        .set({ status: 'processing', updatedAt: new Date().toISOString() })
        .where(and(eq(webhookJobs.id, job.id), eq(webhookJobs.status, 'pending')))
        .returning({ id: webhookJobs.id });

      if (!claimed) continue;

      const environment = await withOrg(job.organizationId, async (tx) => {
        return tx.query.environments.findFirst({
          where: eq(environments.id, job.environmentId),
        });
      });

      if (!environment) {
        console.error(`Environment ${job.environmentId} not found`);
        continue;
      }

      const config = environment.config as any;
      const webhookUrl = config?.webhookUrl;

      await processWebhookJob(job, config, webhookUrl);
    }
  } catch (error) {
    console.error('Error in webhook job processor:', error);
  }
}

async function processWebhookJob(job: typeof webhookJobs.$inferSelect, config: any, webhookUrl: string | undefined) {
  const now = new Date();

  try {
    // summary generation
    if (job.eventType === 'session.generate_summary') {
      const payload = job.payload as { session_id: string };
      const disableSummaries = config?.__internal?.disableSummaries;

      if (disableSummaries) {
        throw new Error(`Summary generation is disabled`);
      }

      await generateSessionSummary(payload.session_id, job.organizationId);
    }
    // webhook
    else {
      if (!webhookUrl) {
        throw new Error(`Webhook URL is not configured`); // if webhook url disappeared while job is pending -> fail the job.
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: job.eventType,
          payload: job.payload,
          job_id: job.id,
        }),
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}: ${await response.text()}`);
      }

      console.log(`Webhook job ${job.id} completed successfully`);
    }

    // Success - mark as completed
    await withOrg(job.organizationId, async (tx) => {
      await tx.update(webhookJobs)
        .set({ status: 'completed', updatedAt: new Date().toISOString() })
        .where(eq(webhookJobs.id, job.id));
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const newAttempts = job.attempts + 1;

    if (newAttempts >= job.maxAttempts) {
      // Failed permanently
      await withOrg(job.organizationId, async (tx) => {
        await tx.update(webhookJobs)
          .set({
            status: 'failed',
            attempts: newAttempts,
            lastError: errorMessage,
            updatedAt: new Date().toISOString()
          })
          .where(eq(webhookJobs.id, job.id));
      });

      console.error(`Webhook job ${job.id} failed permanently after ${newAttempts} attempts: ${errorMessage}`);
    } else {
      // Schedule retry with backoff
      const delay = RETRY_DELAYS[Math.min(newAttempts - 1, RETRY_DELAYS.length - 1)];
      const nextAttemptAt = new Date(now.getTime() + delay).toISOString();

      await withOrg(job.organizationId, async (tx) => {
        await tx.update(webhookJobs)
          .set({
            status: 'pending',
            attempts: newAttempts,
            nextAttemptAt,
            lastError: errorMessage,
            updatedAt: now.toISOString()
          })
          .where(eq(webhookJobs.id, job.id));
      });

      console.log(`Webhook job ${job.id} failed, scheduling retry ${newAttempts}/${job.maxAttempts} at ${nextAttemptAt}`);
    }
  }
}
