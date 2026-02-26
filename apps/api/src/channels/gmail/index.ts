import { defineEmailChannel } from '../defineEmailChannel';
import { sendEmail } from './api';
import { createGmailRoutes } from './routes';
import type { GmailChannelConfig } from './types';
import { createGmailWorkers } from './worker';

export const gmailChannel = defineEmailChannel({
  type: 'gmail',
  routes: (provider) => createGmailRoutes(provider),
  workers: (provider) => createGmailWorkers(provider),
  sendEmail: (gmail) => async ({ channel, messageId, to, from, subject, textBody, inReplyTo, references, providerData }) => {
    const config = channel.config as GmailChannelConfig;

    const onTokenRefresh = async (tokens: { access_token: string; expiry_date: number | null }) => {
      const current = await gmail.requireChannel(channel.address);
      const currentConfig = current.config as GmailChannelConfig;
      await gmail.updateChannel(channel.address, {
        ...currentConfig,
        accessToken: tokens.access_token,
        tokenExpiresAt: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
      });
    };

    const result = await sendEmail(
      config.accessToken,
      config.refreshToken,
      {
        messageId,
        from,
        to,
        subject,
        textBody,
        threadId: providerData?.gmailThreadId ?? undefined,
        inReplyTo,
        references,
      },
      onTokenRefresh,
    );

    return {
      messageId,
      providerData: {
        gmailId: result.gmailId,
        gmailThreadId: result.threadId,
      },
    };
  },
});
