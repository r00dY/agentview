import { defineEmailChannel } from '../defineEmailChannel';
import { sendEmail, createTokenRefreshHandler } from './api';
import { createGmailRoutes } from './routes';
import type { GmailChannelConfig } from './types';
import { createGmailWorkers } from './worker';

export const gmailChannel = defineEmailChannel({
  type: 'gmail',
  routes: (provider) => createGmailRoutes(provider),
  workers: (provider) => createGmailWorkers(provider),
  sendEmail: (gmail) => async ({ channel, to, from, subject, textBody, inReplyTo, references, providerData }) => {
    const config = channel.config as GmailChannelConfig;

    const result = await sendEmail(
      config.accessToken,
      config.refreshToken,
      {
        from,
        to,
        subject,
        textBody,
        threadId: providerData?.gmailThreadId ?? undefined,
        inReplyTo,
        references,
      },
      createTokenRefreshHandler(gmail, channel.address),
    );

    return {
      sourceId: result.messageId,
      providerData: {
        gmailId: result.gmailId,
        gmailThreadId: result.threadId,
      },
    };
  },
});
