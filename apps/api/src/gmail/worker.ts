import { eq } from 'drizzle-orm';
import { db__dangerous } from '../db';
import { withOrg } from '../withOrg';
import { channels } from '../schemas/schema';
import { setupWatch } from './api';
import type { GmailChannelConfig } from './types';
import { createPeriodicWorker } from '../workers/utils';

export const gmailWorker = createPeriodicWorker({
  name: 'gmail-watch-renewal',
  intervalMs: 60 * 60 * 1000,
  run: processGmailWatchRenewals,
});

async function processGmailWatchRenewals() {
  try {
    // Find all active Gmail channels
    const gmailChannels = await db__dangerous
      .select()
      .from(channels)
      .where(eq(channels.type, 'gmail'));

    // Filter in JS: watchExpiresAt < oneDayFromNow
    const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const expiring = gmailChannels.filter((ch) => {
      if (ch.status !== 'active') return false;
      const config = ch.config as GmailChannelConfig;
      return config.watchExpiresAt && config.watchExpiresAt < oneDayFromNow;
    });

    for (const channel of expiring) {
      try {
        const config = channel.config as GmailChannelConfig;

        const onTokenRefresh = async (tokens: { access_token: string; expiry_date: number | null }) => {
          await withOrg(channel.organizationId, async (tx) => {
            const current = await tx.query.channels.findFirst({ where: eq(channels.id, channel.id) });
            if (!current) return;
            const currentConfig = current.config as GmailChannelConfig;
            await tx.update(channels).set({
              config: {
                ...currentConfig,
                accessToken: tokens.access_token,
                tokenExpiresAt: tokens.expiry_date
                  ? new Date(tokens.expiry_date).toISOString()
                  : null,
              },
              updatedAt: new Date().toISOString(),
            }).where(eq(channels.id, channel.id));
          });
        };

        const watch = await setupWatch(
          config.accessToken,
          config.refreshToken,
          onTokenRefresh,
        );

        await withOrg(channel.organizationId, async (tx) => {
          const current = await tx.query.channels.findFirst({ where: eq(channels.id, channel.id) });
          if (!current) return;
          const currentConfig = current.config as GmailChannelConfig;
          await tx.update(channels).set({
            config: {
              ...currentConfig,
              historyId: watch.historyId,
              watchExpiresAt: watch.expiration,
            },
            updatedAt: new Date().toISOString(),
          }).where(eq(channels.id, channel.id));
        });

        console.log(`[gmail] Renewed watch for ${channel.address}`);
      } catch (error) {
        console.error(`[gmail] Failed to renew watch for ${channel.address}:`, error);
      }
    }
  } catch (error) {
    console.error('[gmail] Error in watch renewal processor:', error);
  }
}
