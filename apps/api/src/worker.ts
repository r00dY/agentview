import { initDb } from './initDb';
import { expiredRunsWorker } from './workers/expiredRuns';
import { webhookWorker } from './workers/webhooks';
import { agentFetchWorker } from './workers/agentFetch';
import { outgoingChannelMessageWorker } from './workers/outgoingChannelMessages';
import { channelApps } from './channels/registry';

await initDb();

/**
 * Worker processes run without user context and need to access data across all organizations.
 *
 * Pattern:
 * - Initial queries to find work (expired runs, pending jobs) use db__dangerous for cross-org scans
 * - Once a specific record is found, use withOrg(record.organizationId) for all subsequent operations
 *   to enforce RLS as defense-in-depth
 */

expiredRunsWorker.start();
webhookWorker.start();
agentFetchWorker.start();
// channelThreadWorker.start();
outgoingChannelMessageWorker.start();
for (const channel of channelApps) {
  for (const worker of channel.workers) {
    worker.start();
  }
}
