import { db__dangerous } from '../db';
import { withOrg } from '../withOrg';
import { channelMessages, channels, environments, sessions, endUsers } from '../schemas/schema';
import { eq, and, isNull, inArray, sql } from 'drizzle-orm';
import { BaseConfigSchemaToZod } from 'agentview/configUtils';
import { findUser } from '../users';
import { randomBytes } from 'crypto';
import { createWorker } from './utils';

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
      user = await findUser(tx, { email: message.contact, organizationId: message.organizationId });
    }

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

    // // Find existing session by channelId + channelThreadId + agent
    // let session = await tx.query.sessions.findFirst({
    //   where: and(
    //     eq(sessions.channelId, message.channelId),
    //     eq(sessions.agent, channel.agent!),
    //     eq(sessions.userId, user.id),
    //     message.threadId
    //       ? eq(sessions.channelThreadId, message.threadId)
    //       : isNull(sessions.channelThreadId),
    //   ),
    // });

    // if (!session) {
    //   // Generate handle number — production users have empty suffix
    //   const handleSuffix = '';
    //   const sessionWithHighestHandle = await tx.query.sessions.findFirst({
    //     orderBy: (sessions, { desc }) => [desc(sessions.handleNumber)],
    //     where: eq(sessions.handleSuffix, handleSuffix),
    //   });
    //   const newHandleNumber = sessionWithHighestHandle ? sessionWithHighestHandle.handleNumber + 1 : 1;

    //   const [newSession] = await tx.insert(sessions).values({
    //     organizationId: message.organizationId,
    //     handleNumber: newHandleNumber,
    //     handleSuffix,
    //     agent: channel.agent!,
    //     userId: user.id,
    //     channelId: message.channelId,
    //     channelThreadId: message.threadId ?? null,
    //   }).returning();
    //   session = newSession;
    // }

    // const providerData = message.providerData as any;
    // const handle = session.handleNumber.toString() + (session.handleSuffix ?? '');

    const subject = (message.providerData as any)?.subject;
    console.log(`[${NAME}] Processed → user: ${user.email ?? user.id} | subject: ${subject ?? '-'}`);

    // Set status → processed
    await tx.update(channelMessages).set({
      status: 'processed',
      updatedAt: new Date().toISOString(),
    }).where(eq(channelMessages.id, message.id));
  });

  // // Find or create session





  // // Find or create end user
  // await withOrg(message.organizationId, async (tx) => {
  //   let user: typeof endUsers.$inferSelect | undefined;

  //   if (message.contactKind === 'email') {
  //     user = await findUser(tx, { email: message.contact, organizationId: message.organizationId });
  //   }

  //   if (!user) {
  //     const [newUser] = await tx.insert(endUsers).values({
  //       organizationId: message.organizationId,
  //       email: message.contactKind === 'email' ? message.contact : null,
  //       createdBy: null,
  //       space: 'production',
  //       token: randomBytes(32).toString('hex'),
  //     }).returning();
  //     user = newUser;
  //   }

  //   // Find existing session by channelId + channelThreadId + agent
  //   let session = await tx.query.sessions.findFirst({
  //     where: and(
  //       eq(sessions.channelId, message.channelId),
  //       eq(sessions.agent, channel.agent!),
  //       eq(sessions.userId, user.id),
  //       message.threadId
  //         ? eq(sessions.channelThreadId, message.threadId)
  //         : isNull(sessions.channelThreadId),
  //     ),
  //   });

  //   if (!session) {
  //     // Generate handle number — production users have empty suffix
  //     const handleSuffix = '';
  //     const sessionWithHighestHandle = await tx.query.sessions.findFirst({
  //       orderBy: (sessions, { desc }) => [desc(sessions.handleNumber)],
  //       where: eq(sessions.handleSuffix, handleSuffix),
  //     });
  //     const newHandleNumber = sessionWithHighestHandle ? sessionWithHighestHandle.handleNumber + 1 : 1;

  //     const [newSession] = await tx.insert(sessions).values({
  //       organizationId: message.organizationId,
  //       handleNumber: newHandleNumber,
  //       handleSuffix,
  //       agent: channel.agent!,
  //       userId: user.id,
  //       channelId: message.channelId,
  //       channelThreadId: message.threadId ?? null,
  //     }).returning();
  //     session = newSession;
  //   }

  //   const providerData = message.providerData as any;
  //   const handle = session.handleNumber.toString() + (session.handleSuffix ?? '');
  //   console.log(`[channel-message] Processed → session #${handle} | user: ${user.email ?? user.id} | subject: ${providerData?.subject ?? '-'}`);

  //   // Set status → processed
  //   await tx.update(channelMessages).set({
  //     status: 'processed',
  //     updatedAt: new Date().toISOString(),
  //   }).where(eq(channelMessages.id, message.id));
  // });
}
