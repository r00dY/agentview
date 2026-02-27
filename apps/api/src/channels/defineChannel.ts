import { OpenAPIHono } from '@hono/zod-openapi';
import type { WorkerHandle } from '../workers/utils';
import { and, eq, inArray, isNull, not, or } from 'drizzle-orm';
import { channels, channelThreads, channelMessages, endUsers, sessions } from '../schemas/schema';
import { withOrg } from '../withOrg';
import { db__dangerous } from '../db';
import type { Transaction } from '../types';
import { BaseConfigSchemaToZod } from 'agentview/configUtils';
import { applyRunPatch, createRun } from '../runs';
import { randomBytes } from 'crypto';
import { createSession } from '../sessions';

export type Channel = typeof channels.$inferSelect;
type ChannelThread = typeof channelThreads.$inferSelect;
type ChannelMessage = typeof channelMessages.$inferSelect;

export type ChannelProvider = ReturnType<typeof channelProvider>;

export type SendMessageParams = { channelThread: ChannelThread; channel: Channel; message: ChannelMessage };
export type SendMessageResult = { sourceId: string; providerData?: any };
export type SendMessageFn = (params: SendMessageParams) => Promise<SendMessageResult>;

export interface ChannelApp {
  type: string;
  routes: OpenAPIHono | null;
  workers: WorkerHandle[];
  sendMessage?: SendMessageFn;
}

export function defineChannel(config: {
  type: string;
  routes?: (provider: ChannelProvider) => OpenAPIHono;
  workers?: (provider: ChannelProvider) => WorkerHandle[];
  sendMessage?: (provider: ChannelProvider) => SendMessageFn;
}): ChannelApp {
  const provider = channelProvider(config.type);
  return {
    type: config.type,
    routes: config.routes ? config.routes(provider) : null,
    workers: config.workers ? config.workers(provider) : [],
    sendMessage: config.sendMessage ? config.sendMessage(provider) : undefined,
  };
}

type IngestMessageParams = {
  sourceId: string;
  sourceThreadId?: string;
  date: string;

  contact: string;
  contactKind: string;

  text?: string;
  providerData?: any;
}

type IngestMessageResultSuccess = {
  ingested: true;
  thread: ChannelThread;
  message: ChannelMessage;
  sessionId: string;
}

type IngestMessageResultError = {
  ingested: false;
  reason: string;
}

type IngestMessageResult = IngestMessageResultSuccess | IngestMessageResultError;

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
          config,
        })
        .returning();
      return channel;
    });
  }

  /**
   * Cross-org lookup by (type, address).
   */
  async function getChannel(address: string) {
    const channelRows = await db__dangerous.query.channels.findMany({
      where: and(eq(channels.type, type), eq(channels.address, address)),
      with: {
        environment: {
          with: {
            user: true,
          },
        }
      },
    });

    if (channelRows.length === 0) {
      return null;
    }

    if (channelRows.length > 1) {
      throw new Error(`Multiple channels found for type=${type} address=${address}. THIS IS VERY SEVERE ERROR.`);
    }

    return channelRows[0]!;
  }

  /**
   * Cross-org lookup that throws if not found.
   */
  async function requireChannel(address: string) {
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


  function ignoreMessage(reason: string): IngestMessageResult {
    console.log('[ingestMessage] ignoring message: ', reason);
    return {
      ingested: false,
      reason,
    }
  }

  /**
   * Find channel by address, then ingest message within the channel's org.
   */
  async function ingestMessage(address: string, params: IngestMessageParams): Promise<IngestMessageResult> {
    console.log(`[ingestMessage] ingesting message to '${address}', from '${params.contactKind}:${params.contact}', text: '${params.text?.slice(0, 20)}...'`);

    const channel = await getChannel(address);
    if (!channel) {
      return ignoreMessage('Channel not found');
    }

    /**
     * IGNORE ALL MESSAGES THAT DO NOT COME FROM MY EMAILS
     */
    if (channel.type === 'gmail'/* && params.contact !== 'a.r.dabrowski@gmail.com' && params.contact !== 'andrzej@commerce-ui.com'*/) {
      return ignoreMessage(`Ignoring gmail email from ${params.contact}`);
    }

    // if (params.contactKind === 'email' && params.contact !== 'a.r.dabrowski@gmail.com' && params.contact !== 'andrzej@commerce-ui.com') {
    //   return ignoreMessage(`Ignored because comes from ${params.contact}.`);
    // }

    /**
     * Find environment. If no environment connected, ignore.
     */
    const environment = channel.environment;
    if (!environment) {
      return ignoreMessage('Channel is not routed to any environment');
    }

    const space = environment.userId ? 'playground' : 'production';
    const createdBy = environment.userId;

    console.log('[ingestMessage] environment: ', environment.user?.email ?? 'production');

    /**
     * Find agent via channel config (type + address lookup)
     */
    const config = BaseConfigSchemaToZod.parse(environment.config);
    const channelConfig = config.channels?.find((c: any) => c.type === channel.type && c.address === channel.address);
    if (!channelConfig) {
      return ignoreMessage(`No channel config for type=${channel.type} address=${channel.address}`);
    }
    const agentName = channelConfig.agent;
    const agentConfig = config.agents?.find((a: any) => a.name === agentName);
    if (!agentConfig) {
      return ignoreMessage(`Agent '${agentName}' not found in config`);
    }

    /**
     * For now, only ai-sdk agents are supported for channels
     */
    if (agentConfig.protocol !== 'ai-sdk') {
      return ignoreMessage(`Unsupported agent protocol: ${agentConfig.protocol}. Only 'ai-sdk' is supported for channels.`);
    }

    console.log('[ingestMessage] config and agent exists, agent name: ', agentName);

    return withOrg(channel.organizationId, async (tx) => {
      /**
       * Create or get channel thread and channel message
       */
      const thread = await getOrCreateThread(tx, channel, params);
      const { message, isNew } = await getOrCreateMessage(tx, channel, thread, params);

      if (!isNew) {
        return ignoreMessage('Duplicate message (sourceId already exists)');
      }

      console.log('[ingestMessage] thread and message created');


      /**
       * Last run associated with the thread -> allows us to find sessionId too.
       */
      const lastRun = (await tx.query.channelMessages.findFirst({
        columns: {
        },
        where: and(
          eq(channelMessages.channelThreadId, thread.id),
          not(isNull(channelMessages.runId)),
        ),
        orderBy: (cm, { desc }) => [desc(cm.createdAt)],
        with: {
          run: true,
        }
      }))?.run ?? null;

      let sessionId = lastRun?.sessionId;

      console.log('[ingestMessage] last run status: ', lastRun?.status);
      console.log('[ingestMessage] sessionId: ', sessionId);

      /**
       * Cancel the last run if it is in progress
       */
      if (lastRun?.status === 'in_progress') {
        console.log('[ingestMessage] cancelling last run');

        applyRunPatch(tx, lastRun.id, agentConfig, { status: 'cancelled' });
      }
      else {
        console.log('[ingestMessage] last run is not in progress');
      }

      /**
   * Get all messages that are staged for next run
   * - no run_id (fresh ones)
   * - all messages from the last run that was not completed
   */
      const inputMessages = await tx.query.channelMessages.findMany({
        where: and(
          eq(channelMessages.channelThreadId, thread.id),
          or(
            isNull(channelMessages.runId),
            (lastRun && lastRun.status !== 'completed') ? eq(channelMessages.runId, lastRun.id) : undefined,
          )
        ),
        orderBy: (cm, { asc }) => [asc(cm.date)],
      });

      console.log('[ingestMessage] inputMessages: ', inputMessages.length);

      if (inputMessages.length === 0) {
        return ignoreMessage(`No input messages found for channel thread ${thread.id}`);
      }

      /**
       * Find or create USER
       */

      let userId: string | undefined;

      // If session exists, let's just use it's userId
      if (sessionId) {
        const session = await tx.query.sessions.findFirst({
          where: eq(sessions.id, sessionId),
        });
        if (!session) {
          throw new Error(`Unreachable: Session not found: ${sessionId}`);
        }
        userId = session.userId;
      }
      else {

        if (thread.contactKind === 'email') {
          let user = await tx.query.endUsers.findFirst({
            where: and(
              eq(endUsers.email, thread.contact),
              eq(endUsers.space, space),
              createdBy
                ? eq(endUsers.createdBy, createdBy)
                : isNull(endUsers.createdBy)
            ),
          });

          console.log('[ingestMessage] user: ', user?.id);

          if (!user) {
            const [newUser] = await tx.insert(endUsers).values({
              organizationId: thread.organizationId,
              email: thread.contact,
              space,
              createdBy,
              token: randomBytes(32).toString('hex'),
            }).returning();
            user = newUser;

            console.log('[ingestMessage] creating new user: ', user?.id);

          }

          userId = user?.id;

        } else {
          throw new Error(`Unsupported contact kind: ${thread.contactKind}`);
        }
      }

      if (!userId) {
        throw new Error(`Unreachable error: user not found and not created`);
      }


      /**
       * Create SESSION
       */
      if (!sessionId) {
        const newSession = await createSession(tx, {
          organizationId: thread.organizationId,
          channelConfig,
          userId,
          channelThreadId: thread.id,
        });
        sessionId = newSession.id;
        console.log('[ingestMessage] new session created: ', newSession.id);

      }



      /**
       * Create RUN
       */
      const newRun = await createRun(tx, thread.organizationId, environment, {
        sessionId,
        items: [
          channelMessagesToInputItems(inputMessages),
        ]
      });

      console.log('[ingestMessage] new run created: ', newRun.id);

      /**
       * Assign run_id to all input messages
       */
      await tx.update(channelMessages).set({
        runId: newRun.id,
        updatedAt: new Date().toISOString(),
      }).where(inArray(channelMessages.id, inputMessages.map(m => m.id)));

      /**
       * Set thread status
       */
      // await tx.update(channelThreads).set({
      //   status: 'idle',
      //   updatedAt: new Date().toISOString(),
      // }).where(eq(channelThreads.id, thread.id));


      console.log('[ingestMessage] finished ');

      return { ingested: true, sessionId, thread, message };
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






async function getOrCreateThread(tx: Transaction, channel: Channel, params: IngestMessageParams) {
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
      })
      .returning();
    thread = newThread;
  }

  return thread
}

async function getOrCreateMessage(tx: Transaction, channel: Channel, thread: ChannelThread, params: IngestMessageParams) {
  const insertResult = await tx
    .insert(channelMessages)
    .values({
      organizationId: channel.organizationId,
      channelThreadId: thread.id,
      direction: 'incoming',
      status: 'received',
      sourceId: params.sourceId ?? null,
      date: params.date,
      text: params.text ?? null,
      providerData: params.providerData ?? null,
    })
    .onConflictDoNothing({
      target: [channelMessages.channelThreadId, channelMessages.sourceId],
    })
    .returning();

  if (insertResult[0]) {
    return { message: insertResult[0], isNew: true };
  }

  // onConflictDoNothing returns empty if duplicate — fetch existing
  const existing = await tx.query.channelMessages.findFirst({
    where: and(
      eq(channelMessages.channelThreadId, thread.id),
      eq(channelMessages.sourceId, params.sourceId!),
    ),
  });

  return { message: existing!, isNew: false };
}


function channelMessagesToInputItems(inputMessages: ChannelMessage[]) {
  return {
    role: 'user',
    parts: inputMessages.map(m => ({
      type: 'text',
      text: m.text ?? "",
    })),
  }
}