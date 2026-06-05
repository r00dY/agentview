import { generateSessionSummary } from '../summaries';
import type { Queue } from './types';

export type GenerateTitleJobData = {
  sessionId: string;
  organizationId: string;
};

export const generateTitleQueue: Queue<GenerateTitleJobData> = {
  name: 'session.generate-title',
  options: {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
  },
  workOptions: {
    localConcurrency: 5,
  },
  handler: async (jobs) => {
    for (const job of jobs) {
      const { sessionId, organizationId } = job.data;
      await generateSessionSummary(sessionId, organizationId);
    }
  },
};
