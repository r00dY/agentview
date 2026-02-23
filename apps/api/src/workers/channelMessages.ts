import { db__dangerous } from '../db';
import { withOrg } from '../withOrg';
import { channelMessages, channelThreads, channels, sessions, endUsers, runs } from '../schemas/schema';
import { eq, and, isNull, inArray, sql, or } from 'drizzle-orm';
import { BaseConfigSchemaToZod } from 'agentview/configUtils';
import { randomBytes } from 'crypto';
import { createWorker } from './utils';
import { createSession, fetchSession } from '../sessions';
import { AgentViewError } from 'agentview/AgentViewError';
import { applyRunPatch, createRun } from '../runs';
import { getLastRun } from 'agentview/sessionUtils';

type ChannelThread = typeof channelThreads.$inferSelect;

const NAME = 'channel-threads';

export const channelThreadWorker = createWorker<ChannelThread>({
  name: NAME,
  pollIntervalMs: 2000,
  maxConcurrency: 20,
  async claim(limit) {
    return db__dangerous
      .update(channelThreads)
      .set({ status: 'processing', updatedAt: new Date().toISOString() })
      .where(
        inArray(
          channelThreads.id,
          sql`(SELECT ${channelThreads.id} FROM ${channelThreads} WHERE ${channelThreads.status} = 'dirty' LIMIT ${sql.raw(String(limit))} FOR UPDATE SKIP LOCKED)`
        )
      )
      .returning();
  },
  async process(thread) {
    try {
      await processChannelThread(thread);
    } catch (err) {
      console.error(`[${NAME}] Error processing thread ${thread.id}:`, err);

      // Mark received messages as failed, set thread idle
      await withOrg(thread.organizationId, async (tx) => {
        await tx.update(channelMessages).set({
          status: 'failed',
          failReason: { message: err instanceof Error ? err.message : String(err) },
          updatedAt: new Date().toISOString(),
        }).where(
          and(
            eq(channelMessages.channelThreadId, thread.id),
            eq(channelMessages.status, 'received'),
          )
        );

        await tx.update(channelThreads).set({
          status: 'idle',
          updatedAt: new Date().toISOString(),
        }).where(eq(channelThreads.id, thread.id));
      });
    }
  },
});

async function processChannelThread(thread: ChannelThread) {
  console.log(`[${NAME}] Processing thread ${thread.id} (contact: ${thread.contact})`);

  // Look up the channel
  const channel = await withOrg(thread.organizationId, async (tx) => {
    return tx.query.channels.findFirst({
      where: eq(channels.id, thread.channelId),
      with: {
        environment: {
          with: {
            user: true,
          },
        },
      },
    });
  });

  if (!channel || channel.status !== 'active') {
    throw new Error(`Channel inactive or not found`);
  }

  const environment = channel.environment;
  if (!environment) {
    throw new Error(`Channel is not routed to any environment`);
  }

  const space = environment.userId ? 'playground' : 'production';
  const createdBy = environment.userId;

  const agentName = channel.agent;
  const config = BaseConfigSchemaToZod.parse(environment.config);
  const agentConfig = config.agents?.find((a) => a.name === channel.agent);
  if (!agentConfig) {
    throw new Error(`Agent '${agentName}' not found in config`);
  }

  if (agentConfig.protocol !== 'ai-sdk') {
    throw new Error(`Unsupported agent protocol: ${agentConfig.protocol}`);
  }

  await withOrg(thread.organizationId, async (tx) => {
    // Fetch all received messages for this thread
    const receivedMessages = await tx.query.channelMessages.findMany({
      where: and(
        eq(channelMessages.channelThreadId, thread.id),
        eq(channelMessages.status, 'received'),
      ),
      orderBy: (cm, { asc }) => [asc(cm.createdAt)],
    });

    if (receivedMessages.length === 0) {
      // No messages to process, set thread idle
      await tx.update(channelThreads).set({
        status: 'idle',
        updatedAt: new Date().toISOString(),
      }).where(eq(channelThreads.id, thread.id));
      return;
    }

    // Find or create end user
    let user: typeof endUsers.$inferSelect | undefined;

    if (thread.contactKind === 'email') {
      user = await tx.query.endUsers.findFirst({
        where: and(
          eq(endUsers.email, thread.contact),
          eq(endUsers.space, space),
          createdBy
            ? eq(endUsers.createdBy, createdBy)
            : isNull(endUsers.createdBy)
        ),
      });

      if (!user) {
        const [newUser] = await tx.insert(endUsers).values({
          organizationId: thread.organizationId,
          email: thread.contact,
          space,
          createdBy,
          token: randomBytes(32).toString('hex'),
        }).returning();
        user = newUser;
      }
    } else {
      throw new Error(`Unsupported contact kind: ${thread.contactKind}`);
    }

    if (!user) {
      throw new Error(`Unreachable error: user not found and not created`);
    }

    // Find existing session by channelThreadId + agent + userId
    const existingSession = await tx.query.sessions.findFirst({
      where: and(
        eq(sessions.channelThreadId, thread.id),
        eq(sessions.agent, channel.agent!),
        eq(sessions.userId, user.id),
      ),
    });

    let sessionId: string | undefined = existingSession?.id;

    if (!existingSession) {
      const newSession = await createSession(tx, {
        organizationId: thread.organizationId,
        agentConfig,
        userId: user.id,
        channelThreadId: thread.id,
      });
      sessionId = newSession.id;
    }

    if (sessionId === undefined) {
      throw new Error('Unreachable: session not found and not created');
    }

    const session = await fetchSession(tx, sessionId);
    if (!session) {
      throw new Error('Unreachable: full session not found');
    }

    // Cancel in-progress run if one exists
    const lastRun = getLastRun(session);
    if (lastRun?.status === 'in_progress') {
      applyRunPatch(tx, lastRun.id, agentConfig, { status: 'cancelled' });
    }

    // Mark messages as processed
    const messageIds = receivedMessages.map(m => m.id);
    await tx.update(channelMessages).set({
      status: 'processed',
      updatedAt: new Date().toISOString(),
    }).where(inArray(channelMessages.id, messageIds));

    // Check for remaining received messages (could have arrived during processing)
    const remaining = await tx.query.channelMessages.findFirst({
      where: and(
        eq(channelMessages.channelThreadId, thread.id),
        eq(channelMessages.status, 'received'),
      ),
    });

    await tx.update(channelThreads).set({
      status: remaining ? 'dirty' : 'idle',
      updatedAt: new Date().toISOString(),
    }).where(eq(channelThreads.id, thread.id));

    console.log(`[${NAME}] Processed thread ${thread.id} → user: ${user.email ?? user.id} | messages: ${receivedMessages.length}`);
  });
}
