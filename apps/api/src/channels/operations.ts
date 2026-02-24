import { and, eq, isNull } from 'drizzle-orm';
import { channels, channelThreads, channelMessages } from '../schemas/schema';
import { withOrg } from '../withOrg';
import { db__dangerous } from '../db';

export type Channel = typeof channels.$inferSelect;
type ChannelThread = typeof channelThreads.$inferSelect;
type ChannelMessage = typeof channelMessages.$inferSelect;

export function channelProvider(type: string) {
  /**
   * Strict create — fails on conflict (unique constraint on type+address).
   */
  async function createChannel(orgId: string, address: string, config: any): Promise<Channel> {
    return withOrg(orgId, async (tx) => {
      const [channel] = await tx
        .insert(channels)
        .values({
          organizationId: orgId,
          type,
          address,
          status: 'active',
          config,
        })
        .returning();
      return channel;
    });
  }

  /**
   * Cross-org lookup by (type, address).
   */
  async function getChannel(address: string): Promise<Channel | null> {
    const channel = await db__dangerous.query.channels.findFirst({
      where: and(eq(channels.type, type), eq(channels.address, address)),
    });
    return channel ?? null;
  }

  /**
   * Cross-org lookup that throws if not found.
   */
  async function requireChannel(address: string): Promise<Channel> {
    const channel = await getChannel(address);
    if (!channel) {
      throw new Error(`Channel not found: type=${type} address=${address}`);
    }
    return channel;
  }

  /**
   * Find by (type, address) cross-org, then update config via withOrg.
   */
  async function updateChannel(address: string, config: any): Promise<Channel> {
    const channel = await requireChannel(address);
    return withOrg(channel.organizationId, async (tx) => {
      const [updated] = await tx
        .update(channels)
        .set({
          config,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(channels.id, channel.id))
        .returning();
      return updated;
    });
  }

  /**
   * List all channels of this type across orgs (for workers).
   */
  async function listChannels(): Promise<Channel[]> {
    return db__dangerous
      .select()
      .from(channels)
      .where(eq(channels.type, type));
  }

  /**
   * Find channel by address, then ingest message within the channel's org.
   */
  async function ingestMessage(address: string, params: {
    contact: string;
    contactKind: string;
    sourceThreadId?: string | null;
    sourceId?: string | null;
    text?: string | null;
    providerData?: any;
  }): Promise<{ thread: ChannelThread; message: ChannelMessage }> {
    const channel = await requireChannel(address);

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
          direction: 'incoming',
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

  return {
    createChannel,
    getChannel,
    requireChannel,
    updateChannel,
    listChannels,
    ingestMessage,
  };
}
