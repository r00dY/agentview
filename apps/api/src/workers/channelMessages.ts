import { db__dangerous } from '../db';
import { withOrg } from '../withOrg';
import { channelMessages, channels, environments, sessions, endUsers } from '../schemas/schema';
import { eq, and, isNull, inArray, sql } from 'drizzle-orm';
import { BaseConfigSchemaToZod } from 'agentview/configUtils';
import { findUser } from '../users';
import { randomBytes } from 'crypto';
import { createWorker } from './utils';

type ChannelMessage = typeof channelMessages.$inferSelect;

export const channelMessageWorker = createWorker<ChannelMessage>({
  name: 'channel-messages',
  pollIntervalMs: 2000,
  maxConcurrency: 20,
  async claim(limit) {
    return db__dangerous
      .update(channelMessages)
      .set({ status: 'processing', updatedAt: new Date().toISOString() })
      .where(
        inArray(
          channelMessages.id,
          sql`(SELECT ${channelMessages.id} FROM ${channelMessages} WHERE ${channelMessages.status} = 'received' LIMIT ${sql.raw(String(limit))} FOR UPDATE SKIP LOCKED)`
        )
      )
      .returning();
  },
  async process(message) {
    try {
      await processChannelMessage(message);
    } catch (msgError) {
      console.error(`[channel-message] Error processing message ${message.id}:`, msgError);
      try {
        await withOrg(message.organizationId, async (tx) => {
          await tx.update(channelMessages).set({
            status: 'failed',
            updatedAt: new Date().toISOString(),
          }).where(eq(channelMessages.id, message.id));
        });
      } catch { /* best-effort */ }
    }
  },
});

async function processChannelMessage(message: ChannelMessage) {
  // Look up the channel
  const channel = await db__dangerous.query.channels.findFirst({
    where: eq(channels.id, message.channelId),
  });

  if (!channel || channel.status !== 'active') {
    console.warn(`[channel-message] Skipping message ${message.id}: channel inactive or not found`);
    await withOrg(message.organizationId, async (tx) => {
      await tx.update(channelMessages).set({
        status: 'failed',
        updatedAt: new Date().toISOString(),
      }).where(eq(channelMessages.id, message.id));
    });
    return;
  }

  if (!channel.environmentId || !channel.agent) {
    console.warn(`[channel-message] Skipping message ${message.id}: channel has no routing configured`);
    await withOrg(message.organizationId, async (tx) => {
      await tx.update(channelMessages).set({
        status: 'failed',
        updatedAt: new Date().toISOString(),
      }).where(eq(channelMessages.id, message.id));
    });
    return;
  }

  // Look up environment and validate agent
  const environment = await withOrg(message.organizationId, async (tx) => {
    return tx.query.environments.findFirst({
      where: eq(environments.id, channel.environmentId!),
    });
  });

  if (!environment) {
    console.warn(`[channel-message] Skipping message ${message.id}: environment ${channel.environmentId} not found`);
    await withOrg(message.organizationId, async (tx) => {
      await tx.update(channelMessages).set({
        status: 'failed',
        updatedAt: new Date().toISOString(),
      }).where(eq(channelMessages.id, message.id));
    });
    return;
  }

  const config = BaseConfigSchemaToZod.parse(environment.config);
  const agentConfig = config.agents?.find((a) => a.name === channel.agent);

  if (!agentConfig) {
    console.warn(`[channel-message] Skipping message ${message.id}: agent '${channel.agent}' not found in config`);
    await withOrg(message.organizationId, async (tx) => {
      await tx.update(channelMessages).set({
        status: 'failed',
        updatedAt: new Date().toISOString(),
      }).where(eq(channelMessages.id, message.id));
    });
    return;
  }

  // Find or create end user
  await withOrg(message.organizationId, async (tx) => {
    let user: typeof endUsers.$inferSelect | undefined;

    if (message.contactKind === 'email') {
      user = await findUser(tx, { email: message.contact, organizationId: message.organizationId });
    }

    if (!user) {
      const [newUser] = await tx.insert(endUsers).values({
        organizationId: message.organizationId,
        email: message.contactKind === 'email' ? message.contact : null,
        createdBy: null,
        space: 'production',
        token: randomBytes(32).toString('hex'),
      }).returning();
      user = newUser;
    }

    // Find existing session by channelId + channelThreadId + agent
    let session = await tx.query.sessions.findFirst({
      where: and(
        eq(sessions.channelId, message.channelId),
        eq(sessions.agent, channel.agent!),
        eq(sessions.userId, user.id),
        message.threadId
          ? eq(sessions.channelThreadId, message.threadId)
          : isNull(sessions.channelThreadId),
      ),
    });

    if (!session) {
      // Generate handle number — production users have empty suffix
      const handleSuffix = '';
      const sessionWithHighestHandle = await tx.query.sessions.findFirst({
        orderBy: (sessions, { desc }) => [desc(sessions.handleNumber)],
        where: eq(sessions.handleSuffix, handleSuffix),
      });
      const newHandleNumber = sessionWithHighestHandle ? sessionWithHighestHandle.handleNumber + 1 : 1;

      const [newSession] = await tx.insert(sessions).values({
        organizationId: message.organizationId,
        handleNumber: newHandleNumber,
        handleSuffix,
        agent: channel.agent!,
        userId: user.id,
        channelId: message.channelId,
        channelThreadId: message.threadId ?? null,
      }).returning();
      session = newSession;
    }

    const providerData = message.providerData as any;
    const handle = session.handleNumber.toString() + (session.handleSuffix ?? '');
    console.log(`[channel-message] Processed → session #${handle} | user: ${user.email ?? user.id} | subject: ${providerData?.subject ?? '-'}`);

    // Set status → processed
    await tx.update(channelMessages).set({
      status: 'processed',
      updatedAt: new Date().toISOString(),
    }).where(eq(channelMessages.id, message.id));
  });
}
