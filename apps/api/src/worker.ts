import { initDb } from './initDb';
import { log } from './logger';
import { getBoss, startBoss, startBossWorkers } from './queues/pgboss';
import { expiredRunsWorker } from './workers/expiredRuns';
import { channelApps } from './channels/registry';
import { startWorkerHeartbeat, stopWorkerHeartbeat } from './workerHeartbeat';

await initDb();
await startBoss();
await startWorkerHeartbeat();

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

// On SIGTERM (e.g. render redeploy), stop picking new jobs and wait for in-flight ones.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  log.info({ signal }, 'received signal, stopping workers');

  expiredRunsWorker.stop();
  for (const channel of channelApps) {
    for (const worker of channel.workers) {
      worker.stop();
    }
  }

  await stopWorkerHeartbeat();

  try {
    // graceful: stop fetching new jobs, let in-flight ones finish, then close pool
    await getBoss().stop({ graceful: true, close: true, timeout: 25_000 });
  } catch (err) {
    log.error({ err }, 'error stopping pg-boss');
  }

  log.info('worker shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });
