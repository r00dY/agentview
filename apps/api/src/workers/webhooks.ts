import type { PgBoss } from 'pg-boss';
import { withOrg } from '../withOrg';
import { environments } from '../schemas/schema';
import { eq } from 'drizzle-orm';
import { generateSessionSummary } from '../summaries';
import { log, setContext } from '../logger';

export const WEBHOOK_QUEUE = 'webhook';

export type WebhookJobData = {
  organizationId: string;
  environmentId: string;
  eventType: string;
  payload: any;
  sessionId?: string;
};

export function registerWebhookWorker(boss: PgBoss) {
  boss.work<WebhookJobData>(
    WEBHOOK_QUEUE,
    { localConcurrency: 10 },
    async (jobs) => {
      for (const job of jobs) {
        const { organizationId, environmentId, eventType, payload } = job.data;
        setContext({ pgBossJobId: job.id, organizationId });

        const environment = await withOrg(organizationId, async (tx) => {
          return tx.query.environments.findFirst({
            where: eq(environments.id, environmentId),
          });
        });

        if (!environment) {
          throw new Error(`Environment ${environmentId} not found`);
        }

        const config = environment.config as any;
        const webhookUrl = config?.webhookUrl;

        if (eventType === 'session.generate_summary') {
          if (config?.__internal?.disableSummaries) {
            throw new Error('Summary generation is disabled');
          }
          await generateSessionSummary((payload as { session_id: string }).session_id, organizationId);
        } else {
          if (!webhookUrl) {
            throw new Error('Webhook URL is not configured');
          }

          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: eventType,
              payload,
              job_id: job.id,
            }),
          });

          if (!response.ok) {
            throw new Error(`Webhook returned ${response.status}: ${await response.text()}`);
          }

          log.info('webhook job completed successfully');
        }
      }
    }
  );
}
