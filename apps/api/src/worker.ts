import { initDb } from './initDb';
import { startBoss } from './pgboss';
import { registerWebhookWorker } from './workers/webhooks';
import { registerOutgoingChannelMessageWorker } from './workers/outgoingChannelMessages';
import { registerGenerateTitleWorker } from './workers/generateTitle';
import { expiredRunsWorker } from './workers/expiredRuns';
import { channelApps } from './channels/registry';

await initDb();
const boss = await startBoss();

/**
 * pg-boss queues
 */
registerWebhookWorker(boss);
registerOutgoingChannelMessageWorker(boss);
registerGenerateTitleWorker(boss);

/**
 * Periodic scan — not a queue pattern (expiresAt changes on every event).
 */
expiredRunsWorker.start();

/**
 * Channel-specific workers (periodic maintenance tasks like Gmail watch renewal).
 */
for (const channel of channelApps) {
  for (const worker of channel.workers) {
    worker.start();
  }
}
