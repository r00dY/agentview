import { initDb } from './initDb';
import { expiredRunsWorker } from './workers/expiredRuns';
import { webhookWorker } from './workers/webhooks';
import { agentFetchWorker } from './workers/agentFetch';
import { channelMessageWorker } from './workers/channelMessages';
import { createPeriodicWorker } from './workers/createPeriodicWorker';
import { processGmailWatchRenewals } from './gmail/index';

await initDb();

/**
 * Worker processes run without user context and need to access data across all organizations.
 *
 * Pattern:
 * - Initial queries to find work (expired runs, pending jobs) use db__dangerous for cross-org scans
 * - Once a specific record is found, use withOrg(record.organizationId) for all subsequent operations
 *   to enforce RLS as defense-in-depth
 */

const gmailWorker = createPeriodicWorker({
  name: 'gmail-watch-renewal',
  intervalMs: 60 * 60 * 1000,
  run: processGmailWatchRenewals,
});

expiredRunsWorker.start();
webhookWorker.start();
agentFetchWorker.start();
channelMessageWorker.start();
gmailWorker.start();
