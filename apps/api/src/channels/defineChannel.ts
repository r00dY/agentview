import { OpenAPIHono } from '@hono/zod-openapi';
import type { ChannelRef } from 'agentview/apiTypes';
import { and, eq, isNull } from 'drizzle-orm';
import type { ServicePrincipal } from 'src/authMiddleware';
import { log } from '../logger';
import { db__dangerous } from '../db';
import { createRunForChannelThreadIfNecessary } from './channelRuns';
import { channelMessages, channels, channelThreads, sessions } from '../schemas/schema';
import { activateSession, createSession, setAgentForSession } from '../sessions';
import type { Transaction } from '../types';
import { createUser, findUser } from '../users';
import { withOrg, withTenant } from '../withOrg';
import type { WorkerHandle } from '../workers/utils';
import { requireConfig, requireEnvironment } from '../environments';
import type { ExternalChannelConfig } from 'agentview/baseConfigTypes';
import { createChannel as createChannelFn } from './channels';

export type Channel = typeof channels.$inferSelect;
type ChannelThread = typeof channelThreads.$inferSelect;
type ChannelMessage = typeof channelMessages.$inferSelect;

export type ChannelProvider = ReturnType<typeof channelProvider>;

/**
 * Agnostic send-message params — mirrors ingestMessage's shape: caller passes the
 * markdown text + a sourceThreadId anchor; channel-specific logic (e.g. building
 * email Re: chain from the persisted thread) lives inside each channel app.
 */
export type SendMessageParams = { address: string; text: string; sourceThreadId: string };
export type SendMessageResult = { sourceId: string; providerData?: any };
export type SendMessageFn = (params: SendMessageParams) => Promise<SendMessageResult>;

export interface ChannelApp {
  type: string;
  sendMessage: SendMessageFn;
  routes: OpenAPIHono | null;
  workers: WorkerHandle[];
}

export function defineChannelApp(
  type: string,
  creator: (provider: ChannelProvider) => {
    sendMessage: SendMessageFn;
    routes?: OpenAPIHono | null;
    workers?: WorkerHandle[];
  }
): ChannelApp {
  const provider = channelProvider(type);
  const app = creator(provider);

  return {
    type,
    sendMessage: app.sendMessage,
    routes: app.routes ?? null,
    workers: app.workers ?? [],
  }
}

type IngestMessageParams = {
  sourceId: string;
  sourceThreadId: string;
  date: string;

  text?: string;
  title?: string;

  author: {
    name?: string;
    headline?: string;
    details?: string
    email?: string
  }

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


// function ignoreMessage(reason: string): IngestMessageResult {
//   log.info({ reason }, 'ignoring message');
//   return {
//     ingested: false,
//     reason,
//   }
// }

export function parseAgentViewEmailAddress(address: string) {
  const base = address.split('@')[0];
  const parts = base.split('.');

  let parsed: { orgSlug: string; envSlug: string; agentName: string } | null = null;

  if (parts.length === 2) {
    parsed = { orgSlug: parts[0], envSlug: 'prod', agentName: 'default' };
  }
  else if (parts.length === 3) {
    parsed = { orgSlug: parts[0], envSlug: parts[1], agentName: parts[2] };
  }
  else {
    throw new Error(`Invalid agentview built-in email address format: ${address}. Expected {orgSlug}.{envSlug}.{agentName}@agent.agentview.app`);
  }

  return parsed;
}


export function channelProvider(type: string) {
  /**
   * Strict create — fails on conflict (unique constraint on type+address).
   */
  async function createChannel(orgId: string, address: string, config: any, environmentId: string | null = null): Promise<Channel> {
    return await createChannelFn(orgId, type, address, config, environmentId);
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

  async function ingestMessage(address: string, params: IngestMessageParams): Promise<IngestMessageResult> {
    log.info({ address, sourceId: params.sourceId, type, authorEmail: params.author.email }, 'ingesting message');

    const channel = await requireChannel(address);

    /**
     * Why we need environment handle?
     *
     * It's because ingestion might actually have to create a new user. And new user must be qualified to a space -> which is determined by environment.
     */
    let envHandle = channel.environment?.handle;
    if (!envHandle) {
      throw new Error(`Channel is not routed to any environment: type=${channel.type} address=${channel.address}`);
    }

    const principal : ServicePrincipal = {
      type: 'service' as const,
      organizationId: channel.organizationId,
      env: envHandle,
    } as ServicePrincipal;

    const channelRef: ChannelRef = { type: channel.type as 'gmail' | 'mock', address: channel.address }

    const result = await withTenant(principal, async (tx) => {
      await tx.acquireLock({ type: "create_resource" });

      const environment = await requireEnvironment(tx);

      log.info({ sourceId: params.sourceId, env: environment.user?.email ?? 'production' }, 'environment resolved');

      /**
       * Create or get channel thread and channel message
       */
      const thread = await getOrCreateThread(tx, channel, params);
      const { message, isNew } = await getOrCreateMessage(tx, channel, thread, params);

      if (!isNew) {
        return {
          ingested: false as const,
          reason: 'Duplicate message (sourceId already exists)',
        }
      }

      log.info({ sourceId: params.sourceId }, 'thread and message created');

      /**
       * Last run associated with the thread -> allows us to find sessionId too.
       */
      let session = await tx.query.sessions.findFirst({
        where: eq(sessions.channelThreadId, thread.id),
      });

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

        /**
         * WE CHECK CONFIG HERE
         * 
         * For now we allow for channel message ingestion only when following exist:
         * - environment
         * - agent config
         * - channel config!
         * - and channel config is correct (metadata, initialState, etc...)
         * 
         * If these conditions are not met, we throw which just ignores message.
         * 
         * IN THE FUTURE: ingestion could be separate from session creation.
         */
        const config = await requireConfig(tx);
        const matches: { agent: string, channelConfig: ExternalChannelConfig }[] = [];

        config.agents?.forEach((agent) => {
          if (!agent.channels) {
            return;
          }

          const channelConfigs = agent.channels?.filter((c) => {
            if (c.type === 'agentview-email') { // we ignore address for our internal email, since it's wildcarded
              const { agentName } = parseAgentViewEmailAddress(channel.address);
              return channel.type === 'agentview-email' && agent.name === agentName;
            }
            else {
              return c.type === channel.type && c.address === channel.address;
            }
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

        await setAgentForSession(tx, session.id, { agent, metadata: channelConfig!.metadata, initialState: channelConfig!.initialState });

        log.info({ sourceId: params.sourceId, sessionId: session.id }, 'new session created');
      }

      return { ingested: true as const, sessionId: session.id, thread, message };
    });

    /**
     * If message was properly ingested, we create a run for it. Async on purpose.
     */
    if (result.ingested) {
      createRunForChannelThreadIfNecessary(result.thread.id);
    }
    
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

