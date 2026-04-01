import { setupWatch, createTokenRefreshHandler } from './api';
import type { GmailChannelConfig } from './types';
import { log } from '../../logger';
import { createPeriodicWorker, type WorkerHandle } from '../../workers/utils';
import { type ChannelProvider } from '../defineChannel';

export function createGmailWorkers(gmail: ChannelProvider): WorkerHandle[] {
  const worker = createPeriodicWorker({
    name: 'gmail-watch-renewal',
    intervalMs: 60 * 60 * 1000,
    run: processGmailWatchRenewals,
  });

  async function processGmailWatchRenewals() {
    try {
      // Find all active Gmail channels
      const gmailChannels = await gmail.listChannels();

      // Filter in JS: watchExpiresAt < oneDayFromNow
      const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const expiring = gmailChannels.filter((ch) => {
        const config = ch.config as GmailChannelConfig;
        return config.watchExpiresAt && config.watchExpiresAt < oneDayFromNow;
      });

      for (const channel of expiring) {
        try {
          const config = channel.config as GmailChannelConfig;

          const watch = await setupWatch(
            config.accessToken,
            config.refreshToken,
            createTokenRefreshHandler(gmail, channel.address),
          );

          const current = await gmail.requireChannel(channel.address);
          const currentConfig = current.config as GmailChannelConfig;
          await gmail.updateChannel(channel.address, {
            ...currentConfig,
            historyId: watch.historyId,
            watchExpiresAt: watch.expiration,
          });

          log.info({ address: channel.address }, 'renewed gmail watch');
        } catch (error) {
          log.error({ address: channel.address, err: error }, 'failed to renew gmail watch');
        }
      }
    } catch (error) {
      log.error({ err: error }, 'error in gmail watch renewal processor');
    }
  }

  return [worker];
}
