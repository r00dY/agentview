import { and, eq, isNull } from 'drizzle-orm';
import { channels, channelThreads, channelMessages } from '../schemas/schema';
import { withOrg } from '../withOrg';

export type Channel = typeof channels.$inferSelect;
type ChannelThread = typeof channelThreads.$inferSelect;
type ChannelMessage = typeof channelMessages.$inferSelect;

/**
 * Upsert a channel (insert or update on conflict by org+type+address).
 */
export async function upsertChannel(params: {
  organizationId: string;
  type: string;
  name?: string | null;
  address: string;
  config: any;
}): Promise<Channel> {
  return withOrg(params.organizationId, async (tx) => {
    const [channel] = await tx
      .insert(channels)
      .values({
        organizationId: params.organizationId,
        type: params.type,
        name: params.name ?? null,
        address: params.address,
        status: 'active',
        config: params.config,
      })
      .onConflictDoUpdate({
        target: [channels.organizationId, channels.type, channels.address],
        set: {
          config: params.config,
          name: params.name ?? null,
          status: 'active',
          updatedAt: new Date().toISOString(),
        },
      })
      .returning();

    return channel;
  });
}

/**
 * Ingest an incoming (or outgoing) message into a channel.
 * Finds or creates the thread, marks it dirty, inserts the message.
 */
export async function ingestMessage(channel: Channel, params: {
  contact: string;
  contactKind: string;
  sourceThreadId?: string | null;
  direction: 'incoming' | 'outgoing';
  sourceId?: string | null;
  text?: string | null;
  providerData?: any;
}): Promise<{ thread: ChannelThread; message: ChannelMessage }> {
  return withOrg(channel.organizationId, async (tx) => {
    // Find or create thread
    const threadWhere = params.sourceThreadId
      ? and(
          eq(channelThreads.channelId, channel.id),
          eq(channelThreads.sourceThreadId, params.sourceThreadId),
          eq(channelThreads.contact, params.contact),
          eq(channelThreads.contactKind, params.contactKind),
        )
      : and(
          eq(channelThreads.channelId, channel.id),
          isNull(channelThreads.sourceThreadId),
          eq(channelThreads.contact, params.contact),
          eq(channelThreads.contactKind, params.contactKind),
        );

    let thread = await tx.query.channelThreads.findFirst({
      where: threadWhere,
    });

    if (!thread) {
      const [newThread] = await tx
        .insert(channelThreads)
        .values({
          organizationId: channel.organizationId,
          channelId: channel.id,
          sourceThreadId: params.sourceThreadId ?? null,
          contact: params.contact,
          contactKind: params.contactKind,
          status: 'dirty',
        })
        .returning();
      thread = newThread;
    } else if (thread.status !== 'processing') {
      await tx
        .update(channelThreads)
        .set({ status: 'dirty', updatedAt: new Date().toISOString() })
        .where(eq(channelThreads.id, thread.id));
    }

    // Insert message
    const insertResult = await tx
      .insert(channelMessages)
      .values({
        organizationId: channel.organizationId,
        channelThreadId: thread.id,
        direction: params.direction,
        sourceId: params.sourceId ?? null,
        text: params.text ?? null,
        providerData: params.providerData ?? null,
        status: 'received',
      })
      .onConflictDoNothing({
        target: [channelMessages.channelThreadId, channelMessages.sourceId],
      })
      .returning();

    // onConflictDoNothing returns empty if duplicate — fetch existing
    const message = insertResult[0] ?? await tx.query.channelMessages.findFirst({
      where: and(
        eq(channelMessages.channelThreadId, thread.id),
        eq(channelMessages.sourceId, params.sourceId!),
      ),
    });

    return { thread, message: message! };
  });
}
