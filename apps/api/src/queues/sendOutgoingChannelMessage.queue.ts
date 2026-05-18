import type { Queue } from './types';
import { sendOutgoingChannelMessage } from '../channels/sendOutgoingChannelMessage';
import { setContext } from '../logger';

type SendOutgoingChannelMessageJobData = {
  messageId: string;
  organizationId: string;
}

export const sendOutgoingChannelMessageQueue : Queue<SendOutgoingChannelMessageJobData> = {
  name: 'send-outgoing-channel-message',
  options: {
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true
  },
  workOptions: {
    localConcurrency: 10,
  },
  handler: async (jobs) => { // jobs should be array of 1 in all cases, loop for safety
    for (const job of jobs) {
      setContext({ pgBossJobId: job.id, channelMessageId: job.data.messageId, organizationId: job.data.organizationId });
      await sendOutgoingChannelMessage(job.data.messageId, job.data.organizationId);
    }
  },
}
