import { PgBoss } from 'pg-boss';
import { getDatabaseURL } from './getDatabaseURL';
import { log } from './logger';
import { WEBHOOK_QUEUE } from './workers/webhooks';
import { OUTGOING_CHANNEL_MESSAGE_QUEUE } from './workers/outgoingChannelMessages';
import { SESSION_GENERATE_TITLE_QUEUE } from './workers/generateTitle';

let boss: PgBoss | null = null;

export function getBoss(): PgBoss {
  if (!boss) {
    throw new Error('pg-boss not initialized. Call startBoss() first.');
  }
  return boss;
}

export async function startBoss(): Promise<PgBoss> {
  boss = new PgBoss({
    connectionString: getDatabaseURL(),
  });

  boss.on('error', (error) => {
    log.error({ err: error }, 'pg-boss error');
  });

  await boss.start();

  await boss.createQueue(WEBHOOK_QUEUE, {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
  });

  await boss.createQueue(OUTGOING_CHANNEL_MESSAGE_QUEUE, {
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
  });

  await boss.createQueue(SESSION_GENERATE_TITLE_QUEUE, {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
  });

  log.info('pg-boss started');
  return boss;
}
