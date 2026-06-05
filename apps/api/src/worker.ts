import { initDb } from './initDb';
import { log } from './logger';
import { startBoss, startBossWorkers } from './queues/pgboss';
import { expiredRunsWorker } from './workers/expiredRuns';
import { channelApps } from './channels/registry';

await initDb();
await startBoss();

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

startBossWorkers();

log.info('worker process started');