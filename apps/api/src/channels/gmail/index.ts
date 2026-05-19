import { defineEmailChannelApp } from '../defineEmailChannel';
import { sendEmail, createTokenRefreshHandler } from './api';
import { createGmailRoutes } from './routes';
import type { GmailChannelConfig } from './types';
import { createGmailWorkers } from './worker';

export const gmailChannel = defineEmailChannelApp('gmail', (provider) => ({
  routes: createGmailRoutes(provider),
  workers: createGmailWorkers(provider),
  sendEmail: async ({ address, email, sourceThreadId }) => {
    const channel = await provider.requireChannel(address);
    const config = channel.config as GmailChannelConfig;

    const { messageId, to, from, subject, textBody, htmlBody, inReplyTo, references } = email;

    const result = await sendEmail(
      config.accessToken,
      config.refreshToken,
      {
        from,
        to,
        subject,
        textBody: textBody ?? '',
        htmlBody,
        threadId: sourceThreadId,
        inReplyTo,
        references,
      },
      createTokenRefreshHandler(provider, channel.address),
    );

    return {
      sourceId: result.messageId,
      providerData: {
        gmailId: result.gmailId,
      },
    };
  },
}));
