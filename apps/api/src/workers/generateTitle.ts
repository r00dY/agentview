import type { PgBoss } from 'pg-boss';
import { generateSessionSummary } from '../summaries';
import { log, setContext } from '../logger';

export const SESSION_GENERATE_TITLE_QUEUE = 'session.generate-title';

export type GenerateTitleJobData = {
  sessionId: string;
  organizationId: string;
};

export function registerGenerateTitleWorker(boss: PgBoss) {
  boss.work<GenerateTitleJobData>(
    SESSION_GENERATE_TITLE_QUEUE,
    { localConcurrency: 5 },
    async (jobs) => {
      for (const job of jobs) {
        const { sessionId, organizationId } = job.data;
        setContext({ pgBossJobId: job.id, sessionId, organizationId });
        await generateSessionSummary(sessionId, organizationId);
        log.info('title generated');
      }
    }
  );
}
