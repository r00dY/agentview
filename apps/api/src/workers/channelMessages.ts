import { db__dangerous } from '../db';
import { withOrg } from '../withOrg';
import { channelMessages, channels, sessions, endUsers } from '../schemas/schema';
import { eq, and, isNull, inArray, sql } from 'drizzle-orm';
import { BaseConfigSchemaToZod } from 'agentview/configUtils';
import { findUser } from '../users';
import { randomBytes } from 'crypto';
import { createWorker } from './utils';
import { createSession } from '../sessions';
import { AgentViewError } from 'agentview/AgentViewError';

type ChannelMessage = typeof channelMessages.$inferSelect;

const NAME = 'channel-messages';

export const channelMessageWorker = createWorker<ChannelMessage>({
  name: NAME,
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
      console.error(`[${NAME}] Error processing message ${message.id}:`, msgError);

      const failReason: Record<string, any> = {
        message: msgError instanceof Error ? msgError.message : String(msgError),
      };
      if (msgError instanceof AgentViewError) {
        failReason.statusCode = msgError.statusCode;
        if (msgError.details) failReason.details = msgError.details;
      }

      await withOrg(message.organizationId, async (tx) => {
        await tx.update(channelMessages).set({
          status: 'failed',
          failReason,
          updatedAt: new Date().toISOString(),
        }).where(eq(channelMessages.id, message.id));
      });
    }
  },
});

async function processChannelMessage(message: ChannelMessage) {
  const subject = (message.providerData as any)?.subject;
  console.log(`[${NAME}] Processing → subject: ${subject ?? '-'}`);

  // Look up the channel
  const channel = await withOrg(message.organizationId, async (tx) => {
    return tx.query.channels.findFirst({
      where: eq(channels.id, message.channelId),
      with: {
        environment: true,
      },
    });
  });

  if (!channel || channel.status !== 'active') {
    throw new Error(`Channel inactive or not found`);
  }

  // Find environment and space
  const environment = channel.environment;
  if (!environment) {
    throw new Error(`Channel is not routed to any environment`);
  }

  const space = environment.userId ? 'playground' : 'production';
  const createdBy = environment.userId;

  console.log('environment userId', environment.userId);
  console.log(`[${NAME}] Space: ${space} | Created by: ${createdBy}`);

  // Find agent
  const agentName = channel.agent;

  const config = BaseConfigSchemaToZod.parse(environment.config);
  const agentConfig = config.agents?.find((a) => a.name === channel.agent);
  if (!agentConfig) {
    throw new Error(`Agent '${agentName}' not found in config`);
  }

  await withOrg(message.organizationId, async (tx) => {
    // Find or create user
    let user: typeof endUsers.$inferSelect | undefined;

    if (message.contactKind === 'email') {
      // user = await findUser(tx, { email: message.contact, organizationId: message.organizationId });

      user = await tx.query.endUsers.findFirst({
        where: and(
          eq(endUsers.email, message.contact),
          eq(endUsers.space, space),
          createdBy
            ? eq(endUsers.createdBy, createdBy)
            : isNull(endUsers.createdBy)
        ),
      });

      if (!user) {
        const [newUser] = await tx.insert(endUsers).values({
          organizationId: message.organizationId,
          email: message.contactKind === 'email' ? message.contact : null,
          space,
          createdBy,
          token: randomBytes(32).toString('hex'),
        }).returning();

        user = newUser;
      }

    }
    else {
      throw new Error(`Unsupported contact kind: ${message.contactKind}`);
    }

    if (!user) {
      throw new Error(`Unreachable error: user not found and not created`);
    }

    // Find existing session by channelId + channelThreadId + agent
    const existingSession = await tx.query.sessions.findFirst({
      where: and(
        eq(sessions.channelId, message.channelId),
        eq(sessions.agent, channel.agent!),
        eq(sessions.userId, user.id),
        message.threadId
          ? eq(sessions.channelThreadId, message.threadId)
          : isNull(sessions.channelThreadId),
      ),
    });

    if (!existingSession) {
      await createSession(tx, {
        organizationId: message.organizationId,
        agentConfig,
        userId: user.id,
        channelId: message.channelId,
        channelThreadId: message.threadId ?? null,
      });
    }

    console.log(`[${NAME}] Processed → user: ${user.email ?? user.id} | subject: ${subject ?? '-'}`);

    // Set status → processed
    await tx.update(channelMessages).set({
      status: 'processed',
      updatedAt: new Date().toISOString(),
    }).where(eq(channelMessages.id, message.id));
  });
}
