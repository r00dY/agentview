import { OpenAPIHono } from '@hono/zod-openapi';
import type { ChannelRef } from 'agentview/apiTypes';
import { and, eq, isNull } from 'drizzle-orm';
import type { ServicePrincipal } from 'src/authMiddleware';
import { log } from '../logger';
import { db__dangerous } from '../db';
import { createAutoRun2ForChannel, terminateRun } from '../runs';
import { channelMessages, channels, channelThreads, runs, sessions } from '../schemas/schema';
import { activateSession, createSession, setAgentForSession } from '../sessions';
import type { Transaction } from '../types';
import { createUser, findUser } from '../users';
import { withOrg, withTenant } from '../withOrg';
import type { WorkerHandle } from '../workers/utils';
import { getConfigFromEnvironment, getEnvironment, getEnvironmentByHandleAndOrgId, requireEnvironment } from '../environments';
import type { ExternalChannelConfig } from 'agentview/baseConfigTypes';
import { createChannel as createChannelFn, getChannel as getChannelFn } from './channels';
import { organizations } from 'src/schemas/auth-schema';

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
  sourceThreadId: string;
  date: string;

  text?: string;
  providerData?: any;
  title?: string;

  author: {
    name?: string;
    headline?: string;
    details?: string
    email?: string
  }
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


function ignoreMessage(reason: string): IngestMessageResult {
  log.info({ reason }, 'ignoring message');
  return {
    ingested: false,
    reason,
  }
}

export async function resolveChannel(type: string, address: string)  {
  let channel = await getChannelFn(type, address);
  if (channel) return channel;

  if (type === 'resend') {
    const base = address.split('@')[0];
    const parts = base.split('.');

    if (parts.length < 3) {
      throw new Error(`Invalid resend address format: ${address}. Expected {orgSlug}.{envSlug}.{agentName}@domain`);
    }

    const orgSlug = parts[0];
    const envSlug = parts[1];

    const org = await db__dangerous.query.organizations.findFirst({
      where: eq(organizations.slug, orgSlug),
    });
    if (!org) {
      throw new Error(`Organization not found: org.slug=${orgSlug}`);
    }

    const environment = await getEnvironmentByHandleAndOrgId(org.id, envSlug);
    if (!environment) {
      throw new Error(`Environment not found: org.id=${org.id} envSlug=${envSlug}`);
    }

    await createChannelFn(org.id, type, address, {}, environment.id);
    channel = await getChannelFn(type, address);

    if (!channel) {
      throw new Error(`Channel not created for address: ${address}`);
    }

    return channel;
  }

  throw new Error(`Channel not found for address: ${address}`);
}


export function channelProvider(type: string) {
  /**
   * Strict create — fails on conflict (unique constraint on type+address).
   */
  async function createChannel(orgId: string, address: string, config: any): Promise<Channel> {
    return await createChannelFn(orgId, type, address, config);
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
    log.info({ address, sourceId: params.sourceId, type, authorEmail: params.author.email }, 'ingesting message');

    /**
     * Resend has special treatment. Automatically creates a channel if it doesn't exist.
     */
    let channel: Awaited<ReturnType<typeof resolveChannel>>;
    try {
      channel = await resolveChannel(type, address);
    }
    catch (error) {
      console.log('ERROR', error);
      return ignoreMessage((error as Error).message);
    }

    /**
     * Find environment. If no environment connected, ignore.
     * 
     * TODO:
     * 
     * If it's RESEND -> we can INFER environment and organization from the EMAIL ADDRESS.
     */
    let envHandle = channel.environment?.handle;
    if (!envHandle) {
      return ignoreMessage(`Channel is not routed to any environment: type=${channel.type} address=${channel.address}`);
    }
    
    const principal : ServicePrincipal = {
      type: 'service',
      organizationId: channel.organizationId,
      env: envHandle,
    };

    const channelRef : ChannelRef = { type: channel.type as 'gmail' | 'mock', address: channel.address }

    const result: IngestMessageResult = await withTenant(principal, async (tx) => {
      await tx.acquireLock({ type: "create_resource" });
      
      const environment = await requireEnvironment(tx);

      log.info({ sourceId: params.sourceId, env: environment.user?.email ?? 'production' }, 'environment resolved');

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
        if (!params.author.email) {
          throw new Error(`Author email is required to create a session`);
        }

        userId = (await findUser(tx, { email: params.author.email }))?.id;

        if (!userId) {
          userId = (await createUser(tx, params.author)).user.id;
        }

        log.info({ sourceId: params.sourceId, authorEmail: params.author.email, userId }, 'user resolved from email');
      }

      if (!userId) {
        throw new Error(`Unreachable error: user not found and not created`);
      }

      /**
       * Ensure session
       */
      if (!session) {
        log.info({ sourceId: params.sourceId }, 'creating new session');
        session = await createSession(tx, {
          channel: channelRef,
          channelThreadId: thread.id,
          userId,
          title: params.title,
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


    /**
     * This is on purpose async, it should not block and should go to the worker soon.
     * 
     * IMPORTANT: It's not perfect, and requires improvement.
     * 
     * There's no retry here, IF THERE IS NO AGENT ASSIGNED IT MEANS ERROR.
     * 
     * But actually also, if for some reason run can't be run, then it's also final error.
     * 
     * Needs work.
     */

    (async () => {
      try {
        // Set up session agent, metadata, initialState
        await withTenant(principal, async (tx) => {
          const environment = await requireEnvironment(tx);
          const config = getConfigFromEnvironment(environment);
    
          // let channelConfig: ExternalChannelConfig | undefined = undefined;
          // let agentName: string | undefined = undefined;

          const matches : { agent: string, channelConfig: ExternalChannelConfig }[] = [];
    
          config.agents?.forEach((agent) => {
            if (!agent.channels) {
              return;
            }

            const channelConfigs = agent.channels?.filter((c) => {
              return (c.type === channel.type && c.address === channel.address) || (c.type === 'resend' && channel.type === 'resend'); // resend doesn't check for address, as it's wildcarded
            })
            channelConfigs.forEach((channelConfig) => {
              matches.push({ agent: agent.name, channelConfig })
            })
          });

          if (matches.length === 0) {
            throw new Error(`No agent found for this channel: ${channel.type} ${channel.address}`);
          }
          if (matches.length > 1) {
            throw new Error(`Multiple agents found for this channel: ${channel.type} ${channel.address}`);
          }
    
          const { agent, channelConfig } = matches[0];
    
          await setAgentForSession(tx, result.sessionId, { agent, metadata: channelConfig!.metadata, initialState: channelConfig!.initialState });
        })

        // Start run
        await createAutoRun2ForChannel(principal, result.sessionId);
      }
      catch (error) {
        log.warn({ sourceId: params.sourceId, err: error }, 'failed to create run from channel messages');
      }
    })();
   
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
    )
    : and(
      eq(channelThreads.channelId, channel.id),
      isNull(channelThreads.sourceThreadId),
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
      authorEmail: params.author.email ?? null,
      authorName: params.author.name ?? null,
      authorHeadline: params.author.headline ?? null,
      authorDetails: params.author.details ?? null,
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

