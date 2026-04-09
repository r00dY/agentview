import { OpenAPIHono } from '@hono/zod-openapi';
import type { ChannelRef } from 'agentview/apiTypes';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ServicePrincipal } from 'src/authMiddleware';
import { log } from '../logger';
import { db__dangerous } from '../db';
import { createAutoRun2, terminateRun } from '../runs';
import { channelMessages, channels, channelThreads, runs, sessions } from '../schemas/schema';
import { activateSession, createInactiveSession } from '../sessions';
import type { Transaction } from '../types';
import { ensureUserForEmail } from '../users';
import { withOrg, withTenant } from '../withOrg';
import type { WorkerHandle } from '../workers/utils';

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
    log.info({ reason }, 'ignoring message');
    return {
      ingested: false,
      reason,
    }
  }

  /**
   * Find channel by address, then ingest message within the channel's org.
   * 
   * TODO:
   * - Concurrency, race conditions!!! This method might run concurrently for the same channel, we must make sure we don't duplicate sessions etc.
   * - bug nr 2 -> finding session id by runs? This is bad, since run might not be created yet.
   * - RACE?
   *    - ingest message A, discard "no run" (run A not yet created)
   *    - ingest message B, discard "no run" (run B not yet created)
   *    - run A is created
   *    - run B is created
   *    - (do we even have some "safety check" for createing multiple `pending` runs?)
   * 
   */
  async function ingestMessage(address: string, params: IngestMessageParams): Promise<IngestMessageResult> {
    log.info({ address, contactKind: params.contactKind, contact: params.contact, sourceId: params.sourceId }, 'ingesting message');

    const channel = await getChannel(address);
    if (!channel) {
      return ignoreMessage('Channel not found');
    }

    /**
     * Find environment. If no environment connected, ignore.
     */
    const environment = channel.environment;
    if (!environment) {
      return ignoreMessage('Channel is not routed to any environment');
    }

    const channelRef : ChannelRef = { type: channel.type as 'gmail' | 'mock', address: channel.address }

    log.info({ sourceId: params.sourceId, env: environment.user?.email ?? 'production' }, 'environment resolved');

    const principal : ServicePrincipal = {
      type: 'service',
      organizationId: channel.organizationId,
      env: environment.handle,
    };

    const result: IngestMessageResult = await withTenant(principal, async (tx) => {
      await tx.acquireLock({ type: "create_resource" });

      /**
       * Create or get channel thread and channel message
       */
      const thread = await getOrCreateThread(tx, channel, params);
      const { message, isNew } = await getOrCreateMessage(tx, channel, thread, params);

      if (!isNew) {
        return ignoreMessage('Duplicate message (sourceId already exists)');
      }

      log.info({ sourceId: params.sourceId }, 'thread and message created');

      /**
       * Last run associated with the thread -> allows us to find sessionId too.
       */
      let session = await tx.query.sessions.findFirst({
        where: eq(sessions.channelThreadId, thread.id),
      });

      /**
       * TODO: We should aquire SESSION LOCK TOO HERE.
       */
      if (session) {
        await tx.acquireLock({ type: "edit_session", sessionId: session.id });

        log.info({ sourceId: params.sourceId, sessionId: session.id }, 'session found');
        const activeRun = await tx.query.runs.findFirst({
          where: and(
            eq(runs.sessionId, session?.id),
            eq(runs.status, 'in_progress')
          )
        })
        
        if (activeRun) {
          log.info({ sourceId: params.sourceId, runId: activeRun.id }, 'active run found, terminating');
          await terminateRun(tx, session.id, activeRun.id, { status: 'discarded', failReason: { message: 'New message ingested, discarding active run' } });
        } else {
          log.debug({ sourceId: params.sourceId }, 'no active run found');
        }
      }
      else {
        log.info({ sourceId: params.sourceId }, 'no session found');
      }

      /**
       * Ensure user
       */
      let userId: string | undefined;

      // If session exists, let's just use it's userId
      if (session) {
        userId = session.userId;
      }
      else {
        if (thread.contactKind === 'email') {
          const user = await ensureUserForEmail(tx, thread.contact);
          userId = user?.id;
          log.info({ sourceId: params.sourceId, contact: thread.contact, userId }, 'user resolved from email');
        } else {
          throw new Error(`Unsupported contact kind: ${thread.contactKind}`);
        }
      }

      if (!userId) {
        throw new Error(`Unreachable error: user not found and not created`);
      }

      /**
       * Ensure session
       */
      if (!session) {
        log.info({ sourceId: params.sourceId }, 'creating new session');
        session = await createInactiveSession(tx, {
          environment,
          channelRef,
          userId,
          channelThreadId: thread.id,
        });
        await activateSession(tx, session.id); // channel sessions should be active immediately

        log.info({ sourceId: params.sourceId, sessionId: session.id }, 'new session created');
      }

      return { ingested: true, sessionId: session.id, thread, message };
    });

    /**
     * we close transaction here. It's on purpose
     * 1. we already ingested message, created a user & session for it. Those operations MUST succeed, not succeeding is internal error.
     * 2. next step -> creating run... it could actually not succeed, because the channel is not connected to an agent. The message pops in, it's directed to environment = ingestion. The fact there's no agent connected is normal and shouldn't discard the message.
     * 3. If we can't create run, it will leave us with a session connected to channel_thread. channel_messages connected to channel_thread will be without run_id.
     * 4. So essentially, if the code below fails, we should still keep the code above commited. (potential retries later)
     */

    if (!result.ingested) {
      return result; // if not ingested, return
    }

    createAutoRun2(principal, result.sessionId, undefined).catch((error) => {
      log.warn({ sourceId: params.sourceId, err: error }, 'failed to create run from channel messages');
    });

    return result;
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

