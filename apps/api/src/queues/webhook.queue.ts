import { eq } from 'drizzle-orm';
import { environments } from '../schemas/schema';
import { withOrg } from '../withOrg';
import type { Queue } from './types';

export type WebhookJobData = {
  organizationId: string;
  environmentId: string;
  eventType: string;
  payload: any;
  sessionId?: string;
};

export const webhookQueue: Queue<WebhookJobData> = {
  name: 'webhook',
  options: {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
  },
  workOptions: {
    localConcurrency: 10,
  },
  handler: async (jobs) => {
    for (const job of jobs) {
      const { organizationId, environmentId, eventType, payload } = job.data;

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
    }
  },
};
