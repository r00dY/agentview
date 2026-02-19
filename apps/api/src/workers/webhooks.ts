import { db__dangerous } from '../db';
import { withOrg } from '../withOrg';
import { webhookJobs, environments } from '../schemas/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { generateSessionSummary } from '../summaries';
import { createWorker } from './utils';

// Webhook job retry delays: 5s, 30s, 2min
const RETRY_DELAYS = [5_000, 30_000, 120_000];

type WebhookJob = typeof webhookJobs.$inferSelect;

export const webhookWorker = createWorker<WebhookJob>({
  name: 'webhooks',
  pollIntervalMs: 3000,
  maxConcurrency: 10,
  async claim(limit) {
    const now = new Date().toISOString();
    return db__dangerous
      .update(webhookJobs)
      .set({ status: 'processing', updatedAt: now })
      .where(
        inArray(
          webhookJobs.id,
          sql`(SELECT ${webhookJobs.id} FROM ${webhookJobs} WHERE ${webhookJobs.status} = 'pending' AND (${webhookJobs.nextAttemptAt} IS NULL OR ${webhookJobs.nextAttemptAt} < ${now}) LIMIT ${sql.raw(String(limit))} FOR UPDATE SKIP LOCKED)`
        )
      )
      .returning();
  },
  async process(job) {
    await processWebhookJob(job);
  },
});

async function processWebhookJob(job: WebhookJob) {
  const now = new Date();

  try {
    const environment = await withOrg(job.organizationId, async (tx) => {
      return tx.query.environments.findFirst({
        where: eq(environments.id, job.environmentId),
      });
    });

    if (!environment) {
      throw new Error(`Environment ${job.environmentId} not found`);
    }

    const config = environment.config as any;
    const webhookUrl = config?.webhookUrl;

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
        throw new Error(`Webhook URL is not configured`);
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
