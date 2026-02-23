import { db__dangerous } from '../db';
import { withOrg } from '../withOrg';
import { channelMessages } from '../schemas/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { createWorker } from './utils';

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
    console.log(`[${NAME}] Sending message ${message.id} to ${message.contact}: ${message.text?.substring(0, 100) ?? '(empty)'}...`);

    // TODO: integrate with actual channel provider (e.g. Gmail send)
    // For now, just mark as sent

    await withOrg(message.organizationId, async (tx) => {
      await tx.update(channelMessages).set({
        status: 'sent',
        updatedAt: new Date().toISOString(),
      }).where(eq(channelMessages.id, message.id));
    });

    console.log(`[${NAME}] Sent message ${message.id}`);
  },
});
