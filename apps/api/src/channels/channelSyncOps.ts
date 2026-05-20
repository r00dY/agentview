import { requireAgentConfigBySession } from 'agentview/baseConfigUtils';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ServicePrincipal } from 'src/authMiddleware';
import { getAdapter } from '../adapters/adapters';
import { db__dangerous } from '../db';
import { getConfigFromEnvironment } from '../environments';
import { log } from '../logger';
import { bossSendTx } from '../queues/pgboss';
import { createAutoRun2, terminateRun } from '../runs';
import { channelMessages, channelThreads, runs, sessions } from '../schemas/schema';
import { requireSessionBase } from '../sessions';
import { withOrg, withTenant, type OrgTransaction } from '../withOrg';
import { sendOutgoingChannelMessageQueue } from '../queues/sendOutgoingChannelMessage.queue';
import { formatChannelErrorBody } from './formatChannelErrorBody';
import { channelApps } from './registry';

type ChannelMessage = typeof channelMessages.$inferSelect;

/**
 * channel "domain" listens to run finish to react properly.
 *
 * Runs in its own transaction (deferred via afterCommit by the caller).
 * This should really be a queue job, but doing it inline-after-commit for now.
 */
export async function channelOnRunFinishHandler(params: {
  organizationId: string;
  runId: string;
  sessionId: string;
  status: string;
  channelReply?: { text: string };
  failReason?: any;
}) {
  await withOrg(params.organizationId, async (tx) => {
    await tx.acquireLock({ type: "edit_session", sessionId: params.sessionId });

    const sessionRow = await tx.query.sessions.findFirst({
      where: eq(sessions.id, params.sessionId),
      columns: { channelThreadId: true },
    });

    if (!sessionRow?.channelThreadId) {
      return; // not a channel session
    }

    const allMessages = await getAllMessages(tx, sessionRow.channelThreadId);

    /**
     * When we find out run was finished, but channel is already either in:
     * - LOCKED state (sending outgoing message or creating new run)
     * - DIRTY state (new messages arrived while run was creating)
     * 
     * We just ignore. New run will be created soon.
     */
    if (isLocked(allMessages)) {
      log.debug(`[${params.sessionId}] skipping: channel thread is locked`);
      return;
    }

    if (isDirty(allMessages)) {
      log.debug(`[${params.sessionId}] skipping: channel thread is dirty`);
      return;
    }

    // skip if active run is already different
    const activeRun = getActiveRun(allMessages);
    if (activeRun?.id !== params.runId) {
      log.debug(`[${params.sessionId}] skipping: active run is not the one we're finishing`);
      return;
    }


    if (params.status === 'completed') {
      const text = params.channelReply?.text ?? 'no response';

      await tx.update(channelMessages)
        .set({ status: 'done' })
        .where(inArray(channelMessages.id, activeRun.messages.map(m => m.id)));

      await insertAndQueueOutgoingMessage(tx, {
        channelThreadId: sessionRow.channelThreadId,
        text,
        runId: params.runId,
        internal: false,
      });

    } else if (params.status === 'failed') {
      const text = formatChannelErrorBody(params.failReason ?? new Error('Run failed'));

      await tx.update(channelMessages)
        .set({ status: 'error' })
        .where(inArray(channelMessages.id, activeRun.messages.map(m => m.id)));

      await insertAndQueueOutgoingMessage(tx, {
        channelThreadId: sessionRow.channelThreadId,
        text,
        runId: params.runId,
        internal: true,
      });
    } else {
      log.error({ runId: params.runId, status: params.status }, 'channelOnRunFinishHandler: forbidden run status');
    }
    // cancelled → no outgoing message (runId already cleaned above)
  });
}



// ─── Channel run creation ────────────────────────────────────────────────────

/**
 * Idempotent — tries to create and execute a run based on the current channel thread state.
 * Never throws. Safe to call multiple times; skips silently when there is no work to do.
 *
 * Triggered from two places:
 * - New incoming channel message ingested (from ingestMessage in defineChannelApp)
 * - Outgoing channel message sent by worker (outgoingChannelMessages)
 *
 * Inside a transaction with session lock:
 * 1. If any outgoing message is pending/sending → skip (worker will re-trigger when resolved)
 * 2. If no incoming messages without a runId → skip (no new work)
 * 3. Terminate any active run (new messages make it stale)
 * 4. Select incoming messages using conversation boundary (last successful outgoing)
 * 5. Create and execute new run, set runId on consumed messages
 */
export async function createRunForChannelThreadIfNecessary(channelThreadId: string) {
  const [session, thread] = await Promise.all([
    db__dangerous.query.sessions.findFirst({
      where: eq(sessions.channelThreadId, channelThreadId),
    }),
    db__dangerous.query.channelThreads.findFirst({
      where: eq(channelThreads.id, channelThreadId),
      with: { channel: { with: { environment: true } } },
    }),
  ]);

  if (!session) return;

  const environment = thread?.channel?.environment;

  if (!environment) return;

  const organizationId = thread.organizationId;

  const sessionId = session.id;

  const principal = {
    type: 'service' as const,
    organizationId: thread.organizationId,
    env: environment.handle,
  } as ServicePrincipal;



  log.debug(`[${sessionId}] [createRunForChannelThread] start`);


  /**
   * STEP 1
   * 
   * Prepare for new run if necessary
   */

  let newRunParams: {
    messages: ChannelMessage[];
    previousRunId: string | null;
  } | undefined = undefined;

  try {
    newRunParams = await withTenant(principal, async (tx) => {
      await tx.acquireLock({ type: "edit_session", sessionId }); // probably should be channel_thread_lock

      const allMessages = await getAllMessages(tx, channelThreadId);

      // if locked (side effects pending) -> skip, gonna be retried
      if (isLocked(allMessages)) {
        log.debug(`[${sessionId}] skipping: channel thread is locked`);
        return;
      }

      // if not dirty, there's nothing to do
      if (!isDirty(allMessages)) {
        log.debug(`[${sessionId}] skipping: channel thread is not dirty`);
        return;
      }

      // If active run exists, terminate it ASAP.
      const activeRun = getActiveRun(allMessages);
      if (activeRun) {
        log.info({ sessionId, runId: activeRun.id }, 'terminating active run before creating new channel run');
        await terminateRun(tx, sessionId, activeRun.id as string, {
          status: 'discarded',
          failReason: { message: 'New message ingested, discarding active run' },
        });
      }

      // Let's find the last successful non-internal outgoing message. It's our boundary for a new run (we ignore internal messages!)
      const lastSuccessful = [...allMessages].reverse().find(m =>
        m.direction === 'outgoing' && m.status === 'sent' && !m.internal && m.runId
      );

      let previousRunId: string | null = null; // null means from ROOT
      let stagedMessages: typeof allMessages;

      if (lastSuccessful) {
        previousRunId = lastSuccessful.runId;
        stagedMessages = allMessages.filter(m =>
          m.direction === 'incoming' && m.createdAt > lastSuccessful.createdAt
        );
      } else {
        // No successful outgoing yet — first run, consume all incoming messages
        stagedMessages = allMessages.filter(m => m.direction === 'incoming');
      }

      if (stagedMessages.length === 0) {
        // Shouldn't happen (gate 2 passed), but guard anyway
        log.debug(`[${sessionId}] skipping: no incoming messages after conversation boundary`);
        return;
      }

      /**
       * Update channel state -> no pending messages, the rest is 'creating_run'
       * 
       * THIS IS LOCK!!!! Setting 'creating_run' is a lock.
       */

      // Remove any pending outgoing messages
      await tx.delete(channelMessages)
        .where(and(
          eq(channelMessages.channelThreadId, channelThreadId),
          eq(channelMessages.direction, 'outgoing'),
          eq(channelMessages.status, 'pending'),
        ));

      await tx.update(channelMessages)
        .set({
          status: 'creating_run',
          runId: null,
        })
        .where(inArray(channelMessages.id, stagedMessages.map(m => m.id)));

      log.info({ sessionId, count: stagedMessages.length }, 'incoming messages found');

      return {
        messages: stagedMessages,
        previousRunId,
      };
    });
  } catch (error) {
    log.error({ err: error, channelThreadId }, 'createRunForChannelThreadIfNecessary failed for unexpected reason');
    return;
  }

  // no new run needed
  if (!newRunParams) {
    return;
  }


  /**
   * STEP 2
   * 
   * Create input and create a run
   * 
   * Btw, above transaction is closed but there's NO RACE CONDITION.
   * 
   * If we have like "messages states": A, AB and ABC and they come in random order... ABC alwyas will be the last one.
   * - first, above transaction is serialized
   * - if messages come in order A, AB, ABC, then all will reach this point, but ABC will terminate both A and AB (since it's the last one).
   * - if they come in order ABC, AB, A, then AB and A will be ignored by above transaction (return will be reached).
   */


  const messageIds = newRunParams.messages.map(m => m.id);
  
  try {
    // Create input
    const sessionBase = await withOrg(thread.organizationId, async (tx) => {
      return await requireSessionBase(tx, sessionId);
    });

    const config = getConfigFromEnvironment(environment);
    const agentConfig = requireAgentConfigBySession(config, sessionBase);
    const adapter = getAdapter(agentConfig.adapter);
    const input = adapter.createDefaultInputForChannelMessages(newRunParams.messages);

    const result = await createAutoRun2(principal, sessionId, input, newRunParams.previousRunId);

    // If success -> just assign active runId to incoming messages
    if (result.success) {
      await withOrg(thread.organizationId, async (tx) => {
        await tx.update(channelMessages)
          .set({ status: 'streaming', runId: result.runId })
          .where(inArray(channelMessages.id, messageIds));
      });
    }
    else { // failure -> send error message to channel
      const text = `Error response from AI Endpoint: ${result.response.status}. Body:

  ${await result.response.text()}
  `;

      throw new Error(text);
    }

  } catch (error) {
    await withOrg(organizationId, async (tx) => {
      await tx.update(channelMessages)
        .set({ status: 'error', runId: null })
        .where(inArray(channelMessages.id, messageIds));

      await insertAndQueueOutgoingMessage(tx, {
        channelThreadId,
        text: formatChannelErrorBody(error),
        runId: null,
        internal: true,
      });
    });

    log.debug({ err: error, channelThreadId }, 'createRunForChannelThreadIfNecessary failed for unexpected reason');
  }
}


export async function sendOutgoingChannelMessage(messageId: string, organizationId: string) {
  const message = await withOrg(organizationId, async (tx) => {
    return tx.query.channelMessages.findFirst({
      where: eq(channelMessages.id, messageId),
      with: {
        channelThread: {
          with: {
            channel: true,
          }
        }
      }
    });
  });

  if (!message) {
    log.debug({ messageId }, 'sendOutgoingChannelMessage: message not found');
    return; // message could have been deleted
  }

  const session = await db__dangerous.query.sessions.findFirst({
    where: eq(sessions.channelThreadId, message.channelThreadId),
  });

  if (!session) {
    log.debug({ messageId }, 'sendOutgoingChannelMessage: session not found');
    return; // session could have been deleted
  }

  const channelThread = message.channelThread;
  const channel = channelThread.channel;
  const channelApp = channelApps.find((app) => app.type === channel.type);
  const sendFn = channelApp?.sendMessage;

  if (!sendFn) {
    throw new Error(`No send function registered for channel type '${channel.type}'`);
  }

  const readyToSend = await withOrg(organizationId, async (tx) => {
    await tx.acquireLock({ type: "edit_session", sessionId: session.id });

    const allMessages = await getAllMessages(tx, channelThread.id);

    if (isLocked(allMessages)) {
      log.debug({ messageId }, 'sendOutgoingChannelMessage: channel thread is locked');
      return false;
    }

    if (isDirty(allMessages)) {
      log.debug({ messageId }, 'sendOutgoingChannelMessage: channel thread is dirty');
      return false;
    }

    // LOCK!!!
    await tx.update(channelMessages).set({
      status: 'sending',
    }).where(eq(channelMessages.id, messageId));

    return true;
  }); 

  if (!readyToSend) {
    return;
  }

  try {
    log.info('sending outgoing message');

    const result = await sendFn({
      address: channel.address,
      text: message.text ?? '',
      sourceThreadId: channelThread.sourceThreadId ?? undefined,
    });

    log.info({ sourceId: result.sourceId }, 'message sent');

    // RELEASE LOCK (atomic)
    await withOrg(organizationId, async (tx) => {
      await tx.update(channelMessages).set({
        status: 'sent',
        ...(result?.sourceId ? { sourceId: result.sourceId } : {}),
        ...(result?.providerData ? { providerData: result.providerData } : {}),
        updatedAt: new Date().toISOString(),
      }).where(eq(channelMessages.id, messageId));
    });

    log.info('outgoing message sent and saved');

    // Re-trigger run creation in case incoming messages arrived while this
    // outgoing was pending/sending. Only for non-internal messages — internal
    // messages (error notifications) must not retrigger to avoid infinite loops
    // (failed run → error msg → retrigger → failed run → ...).
    if (!message.internal) {
      createRunForChannelThreadIfNecessary(message.channelThreadId);
    }
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    log.error({ err: e }, `failed to send message: ${errorMessage}`);

    // RELEASE LOCK (atomic)
    await withOrg(organizationId, async (tx) => {
      await tx.update(channelMessages).set({
        status: 'error',
        failReason: { message: errorMessage },
        updatedAt: new Date().toISOString(),
      }).where(eq(channelMessages.id, messageId));
    });

    throw e; // re-throw so pg-boss retries
  }
}

async function getAllMessages(tx: OrgTransaction, channelThreadId: string) {
  return await tx.query.channelMessages.findMany({
    where: eq(channelMessages.channelThreadId, channelThreadId),
    orderBy: (cm, { asc }) => [asc(cm.date)],
  });
}

// dirty means new messages that weren't processed yet (added by defineChannel)
function isDirty(allMessages: ChannelMessage[]) {
  return allMessages.some(m => m.direction === 'incoming' && m.status === 'received')
}

// lock means there's external system operation in progress (side effect). We shouldn't do operations while channel thread is locked.
function isLocked(allMessages: ChannelMessage[]) {
  return allMessages.some(m =>
    (m.direction === 'outgoing' && m.status === 'sending') || // sending to external channel is in progress
    (m.direction === 'incoming' && m.status === 'creating_run') // establishment of connection is in progress
  )
}

// This function *only checks whether there's active run in external service!!! The only source of truth is 'incoming' + 'streaming' (+ run_id).
// When streaming is finished, and outgoing message is 'pending', it's still *NO ACTIVE RUN*.
function getActiveRun(allMessages: ChannelMessage[]) {
  const messagesBeingProcessedWithRun = allMessages.filter(m => m.direction === 'incoming' && m.status === 'streaming');

  if (messagesBeingProcessedWithRun.length === 0) {
    return null;
  }

  const runId = messagesBeingProcessedWithRun[0].runId;
  if (!runId) {
    throw new Error("[SEVERE ERORR] channel message in 'streaming' state without a run");
  }

  return {
    id: runId,
    messages: messagesBeingProcessedWithRun
  };
}





async function insertAndQueueOutgoingMessage(tx: OrgTransaction, values: {
  channelThreadId: string;
  text: string;
  runId: string | null;
  internal: boolean;
}) {
  const [msg] = await tx.insert(channelMessages).values({
    ...values,
    organizationId: tx.organizationId,
    direction: 'outgoing',
    status: 'pending',
    date: new Date().toISOString(),
  }).returning();

  await bossSendTx(tx, sendOutgoingChannelMessageQueue, { messageId: msg.id, organizationId: tx.organizationId });
}

