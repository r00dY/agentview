import { fromDrizzle, PgBoss } from 'pg-boss';
import { getDatabaseURL } from '../getDatabaseURL';
import { log, runWithContext } from '../logger';

import { sendOutgoingChannelMessageQueue } from './sendOutgoingChannelMessage.queue';
import { webhookQueue } from './webhook.queue';
import { generateTitleQueue } from './generateTitle.queue';
import type { Queue } from './types';
import type { OrgTransaction } from '../withOrg';
import { sql } from 'drizzle-orm';

let boss: PgBoss | null = null;

const queues: Queue<any>[] = [sendOutgoingChannelMessageQueue, webhookQueue, generateTitleQueue]

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

  for (const queue of queues) {
    await boss.createQueue(queue.name, queue.options ?? {});
  }

  log.info('pg-boss started');
  return boss;
}

export async function startBossWorkers(): Promise<void> {
  const boss = getBoss();

  for (const queue of queues) {
    boss.work(queue.name, queue.workOptions ?? {}, async (jobs) => {
      for (const job of jobs) {
        const data = job.data as { organizationId?: string } | null | undefined;
        const ctx: Record<string, unknown> = { jobId: job.id, workerName: queue.name };
        if (data?.organizationId) ctx.organizationId = data.organizationId;

        await runWithContext(ctx, async () => {
          const start = Date.now();
          try {
            await queue.handler([job]);
            log.info({ status: 'success', duration: Date.now() - start }, 'job completed');
          } catch (err) {
            log.warn({ err, status: 'failure', duration: Date.now() - start }, 'job completed');
            throw err; // let pg-boss handle retry
          }
        });
      }
    });
  }

  log.info({ count: queues.length, queues: queues.map((q) => q.name) }, 'pg-boss workers started');
}

export async function bossSendTx<T>(tx: OrgTransaction, queue: Queue<T>, data: T): Promise<void> {
  await getBoss().send(queue.name, data as any, { db: fromDrizzle(tx, sql) });
}
