import { db__dangerous } from '../db';
import { withOrg } from '../withOrg';
import { channelMessages, channelThreads } from '../schemas/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { createWorker } from './utils';
import { channelApps } from '../channels/registry';

type ChannelMessage = typeof channelMessages.$inferSelect;

const NAME = 'outgoing-channel-messages';

export const outgoingChannelMessageWorker = createWorker<ChannelMessage>({
  name: NAME,
  pollIntervalMs: 2000,
  maxConcurrency: 10,
  async claim(limit) {
    return db__dangerous
      .update(channelMessages)
      .set({ status: 'sending', updatedAt: new Date().toISOString() })
      .where(
        inArray(
          channelMessages.id,
          sql`(SELECT ${channelMessages.id} FROM ${channelMessages} WHERE ${channelMessages.direction} = 'outgoing' AND ${channelMessages.status} = 'pending' LIMIT ${sql.raw(String(limit))} FOR UPDATE SKIP LOCKED)`
        )
      )
      .returning();
  },
  async process(message) {
    console.log(`[${NAME}] Processing message ${message.id}: ${message.text?.substring(0, 100) ?? '(empty)'}...`);

    try {
      // Look up the channel thread with its channel
      const channelThread = await db__dangerous.query.channelThreads.findFirst({
        where: eq(channelThreads.id, message.channelThreadId),
        with: {
          channel: true,
        },
      });

      if (!channelThread) {
        throw new Error(`Channel thread ${message.channelThreadId} not found`);
      }

      const channel = channelThread.channel;
      const channelApp = channelApps.find((app) => app.type === channel.type);
      const sendFn = channelApp?.sendMessage;

      if (!sendFn) {
        throw new Error(`No send function registered for channel type '${channel.type}'`);
      }

      console.log(`[${NAME}] Sending outgoing message`);

      const result = await sendFn({ channel, channelThread, message });

      console.log(`[${NAME}] sourceId: ${result.sourceId}`);

      // On success: mark as sent, optionally store sourceId/providerData
      await withOrg(message.organizationId, async (tx) => {
        await tx.update(channelMessages).set({
          status: 'sent',
          ...(result?.sourceId ? { sourceId: result.sourceId } : {}),
          ...(result?.providerData ? { providerData: result.providerData } : {}),
          updatedAt: new Date().toISOString(),
        }).where(eq(channelMessages.id, message.id));
      });

      console.log(`[${NAME}] Outgoing message send and saved with sourceId: ${message.id}`);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error(`[${NAME}] Failed to send message ${message.id}:`, errorMessage);

      await withOrg(message.organizationId, async (tx) => {
        await tx.update(channelMessages).set({
          status: 'failed',
          failReason: { message: errorMessage },
          updatedAt: new Date().toISOString(),
        }).where(eq(channelMessages.id, message.id));
      });
    }
  },
});
