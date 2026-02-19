import { initDb } from './initDb';
import { processExpiredRuns } from './jobs/expiredRuns';
import { processWebhookJobs } from './jobs/webhooks';
import { processAgentFetches } from './jobs/agentFetch';
import { processChannelMessages } from './jobs/channelMessages';
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

// Run expired runs processor every second
setInterval(() => {
  processExpiredRuns();
}, 1000);

// Run webhook job processor every 3 seconds
setInterval(() => {
  processWebhookJobs();
}, 3000);

// Run agent fetch processor every second
setInterval(() => {
  processAgentFetches();
}, 1000);

// Run channel message processor every 2 seconds
setInterval(() => {
  processChannelMessages();
}, 2000);

// Run Gmail watch renewal every hour
setInterval(() => {
  processGmailWatchRenewals();
}, 60 * 60 * 1000);

// Run immediately on startup
processExpiredRuns();
processWebhookJobs();
processAgentFetches();
processChannelMessages();
processGmailWatchRenewals();
