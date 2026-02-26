import { defineChannel } from '../defineChannel';
import { sendEmail } from './api';
import { createGmailRoutes } from './routes';
import type { GmailChannelConfig } from './types';
import { createGmailWorkers } from './worker';

export const gmailChannel = defineChannel({
  type: 'gmail',
  routes: (provider) => createGmailRoutes(provider),
  workers: (provider) => createGmailWorkers(provider),
  sendMessage: (gmail) => async ({ channelThread, channel, message }) => {
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

    // Use the thread's first incoming message subject, or fall back to "No subject"
    const subject = (message.providerData as any)?.subject ?? 'No subject';

    const result = await sendEmail(
      config.accessToken,
      config.refreshToken,
      {
        from: channel.address,
        to: channelThread.contact,
        subject,
        textBody: message.text ?? '',
        threadId: channelThread.sourceThreadId ?? undefined,
      },
      onTokenRefresh,
    );

    return { sourceId: result.messageId };
  },
});
