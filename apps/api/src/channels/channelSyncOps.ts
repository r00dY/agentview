import { requireAgentConfigBySession } from 'agentview/baseConfigUtils';
import { and, eq, inArray } from 'drizzle-orm';
import type { ServicePrincipal } from 'src/authMiddleware';
import { getAdapter } from '../adapters/adapters';
import { getConfigFromEnvironment } from '../environments';
import { log } from '../logger';
import { bossSendTx } from '../queues/pgboss';
import { createAutoRun2, terminateRun } from '../runs';
import { channelMessages, channelThreads, sessions } from '../schemas/schema';
import { requireSessionBase } from '../sessions';
import { withOrg, withTenant, type OrgTransaction } from '../withOrg';
import { sendOutgoingChannelMessageQueue } from '../queues/sendOutgoingChannelMessage.queue';
import { formatChannelErrorBody } from './formatChannelErrorBody';
import { channelApps } from './registry';

type ChannelMessage = typeof channelMessages.$inferSelect;
type ChannelThread = Awaited<ReturnType<typeof requireChannelThread>>;



/**
 * onInboxUpdated
 */
export async function checkInbox(organizationId: string, channelThreadId: string) {
  log.debug(`[${channelThreadId}] [createRunForChannelThread] start`);

  /**
   * Preparation (check session, environmen etc)
   */
  const { session, environment } = await withOrg(organizationId, async (tx) => {
    const channelThread = await requireChannelThread(tx, channelThreadId);
    const session = await requireSession(tx, channelThreadId);
    const environment = channelThread.channel.environment;
    if (!environment) {
      throw new Error(`[${channelThreadId}] skipping: channel thread has no environment`);
    }

    return { session, environment };
  })

  const principal: ServicePrincipal = {
    type: 'service' as const,
    organizationId,
    env: environment.handle,
  }

  /**
   * STEP 1
   * 
   * Prepare for new run if necessary
   */
  let newRunParams: {
    stagedMessages: ChannelMessage[];
    previousRunId: string | null;
  } | undefined = undefined;

  try {
    newRunParams = await withTenant(principal, async (tx) => {
      await tx.acquireLock({ type: "edit_channel_thread", channelThreadId });

      const channelThread = await requireChannelThread(tx, channelThreadId);

      // if locked (side effects pending) -> skip, gonna be retried
      if (isSideEffectCallInProgress(channelThread)) {
        log.debug(`[${channelThreadId}] skipping: channel thread is locked`);
        return;
      }

      const session = await requireSession(tx, channelThreadId);
      const environment = channelThread.channel.environment;
      if (!environment) {
        log.error(`[${channelThreadId}] skipping: channel thread has no environment`);
        return;
      }

      if (!isDirty(channelThread)) {
        log.debug(`[${channelThreadId}] skipping: channel thread is dirty`);
        return;
      }

      // If active run exists, terminate it ASAP.
      const activeRun = getActiveRun(channelThread);
      if (activeRun) {
        log.info({ sessionId: session.id, runId: activeRun.id }, 'terminating active run before creating new channel run');
        await terminateRun(tx, session.id, activeRun.id as string, {
          status: 'discarded',
          failReason: { message: 'New message ingested, discarding active run' },
        });
      }

      // Let's find the last successful non-internal outgoing message. It's our boundary for a new run (we ignore internal messages!)
      const lastSuccessful = [...channelThread.messages].reverse().find(m =>
        m.direction === 'outgoing' && m.status === 'done' && !m.internal && m.runId
      );

      let previousRunId: string | null = null; // null means from ROOT
      let stagedMessages: typeof channelThread.messages;

      if (lastSuccessful) {
        previousRunId = lastSuccessful.runId;
        stagedMessages = channelThread.messages.filter(m =>
          m.direction === 'incoming' && m.createdAt > lastSuccessful.createdAt
        );
      } else {
        // No successful outgoing yet — first run, consume all incoming messages
        stagedMessages = channelThread.messages.filter(m => m.direction === 'incoming');
      }

      if (stagedMessages.length === 0) {
        // Shouldn't happen (gates above passed). Belt and suspenders
        log.error(`[${channelThreadId}] skipping: no incoming messages after conversation boundary`);
        return;
      }

      /**
       * This is total reset of state.
       * 
       * 1. We remove all 'pending' outgoing messages
       * 2. We set all incoming messages starting from last successful one to 'creating_run'.
       * 
       * IT TRIGGERS SIDE EFFECT (isSideEffectCallInProgress() will be true after that)
       */

      // Remove any pending outgoing messages
      await tx.delete(channelMessages)
        .where(and(
          eq(channelMessages.channelThreadId, channelThreadId),
          eq(channelMessages.direction, 'outgoing'),
          eq(channelMessages.status, 'pending'),
        ));

      // SETS LOCK
      await tx.update(channelMessages)
        .set({
          status: 'run_connecting',
          runId: null,
        })
        .where(inArray(channelMessages.id, stagedMessages.map(m => m.id)));

      log.info({ channelThreadId, count: stagedMessages.length }, 'incoming messages found');

      return {
        stagedMessages,
        previousRunId,
        session,
        environment,
        channelThread
      };
    });
  } catch (error) {
    log.error({ err: error, channelThreadId }, 'checkInbox failed for unexpected reason');
    return;
  }

  // no new run needed
  if (!newRunParams) {
    return;
  }


  /**
   * STEP 2
   * 
   * RUN SIDE EFFECT -> Create a run.
   */

  const { stagedMessages, previousRunId } = newRunParams;

  const messageIds = stagedMessages.map(m => m.id);

  try {
    // Compute input
    const config = getConfigFromEnvironment(environment);
    const agentConfig = requireAgentConfigBySession(config, session);
    const adapter = getAdapter(agentConfig.adapter);
    const input = adapter.createDefaultInputForChannelMessages(stagedMessages);

    // CreateRun API CALL started
    const result = await createAutoRun2(principal, session.id, input, previousRunId);

    // CreateRun API CALL finished
    if (result.success) {
      await withOrg(organizationId, async (tx) => {
        await tx.acquireLock({ type: "edit_channel_thread", channelThreadId });

        await tx.update(channelMessages)
          .set({ status: 'run_streaming', runId: result.runId }) // setting status back from 'creating_run' releases lock
          .where(inArray(channelMessages.id, messageIds));
      });
    }
    else {
      const errorText = `Error response from AI Endpoint: ${result.response.status}. Response body:\n\n${await result.response.text()}`
      throw new Error(errorText);
    }

  } catch (error) {

    await withOrg(organizationId, async (tx) => {
      await tx.acquireLock({ type: "edit_channel_thread", channelThreadId });

      await tx.update(channelMessages)
        .set({ status: 'error', runId: null }) // set to streaming (not creating_run) -> releases lock
        .where(inArray(channelMessages.id, messageIds));

      await insertAndQueueOutgoingMessage(tx, {
        channelThreadId,
        text: formatChannelErrorBody(error),
        runId: null,
        internal: true,
      });
    });

    log.debug({ err: error, channelThreadId }, 'checkInbox failed for unexpected reason');

  } finally {
    /**
     * We must always re-trigger this function at the end, because while side effect was in progress, new messages could have arrived.
     */
    checkInbox(organizationId, channelThreadId);
  }
}




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
  const channelThreadId = await withOrg(params.organizationId, async (tx) => {
    const session = await requireSessionBase(tx, params.sessionId);
    return session.channelThreadId;
  });
  if (!channelThreadId) { // not a channel thread -> ignore
    return;
  }

  /**
   * 
   */
  await withOrg(params.organizationId, async (tx) => {
    await tx.acquireLock({ type: "edit_channel_thread", channelThreadId });

    const channelThread = await requireChannelThread(tx, channelThreadId);

    if (isSideEffectCallInProgress(channelThread)) {
      log.debug(`[${params.sessionId}] skipping: channel thread is locked`);
      return;
    }

    // skip if active run is already different -> it means it was overriden
    const activeRun = getActiveRun(channelThread);
    if (activeRun?.id !== params.runId) {
      log.debug(`[${params.sessionId}] skipping: active run is not the one we're finishing`);
      return;
    }

    // Now we know that active run is the one we're finishing, so we can update the channel thread
    if (params.status === 'completed') {
      const text = params.channelReply?.text ?? 'no response';

      await tx.update(channelMessages)
        .set({ status: 'done' })
        .where(inArray(channelMessages.id, activeRun.messages.map(m => m.id)));

      await insertAndQueueOutgoingMessage(tx, {
        channelThreadId,
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
        channelThreadId,
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


export async function sendOutgoingChannelMessage(messageId: string, organizationId: string) {
  const message = await withOrg(organizationId, async (tx) => {
    return tx.query.channelMessages.findFirst({
      where: eq(channelMessages.id, messageId)
    });
  });

  if (!message) {
    log.debug({ messageId }, 'sendOutgoingChannelMessage: message not found');
    return; // message could have been deleted
  }

  const channelThreadId = message.channelThreadId;



  const result = await withOrg(organizationId, async (tx) => {
    await tx.acquireLock({ type: "edit_channel_thread", channelThreadId });

    const channelThread = await requireChannelThread(tx, channelThreadId);

    if (isSideEffectCallInProgress(channelThread)) {
      log.debug({ messageId }, 'sendOutgoingChannelMessage: channel thread is locked');
      return;
    }

    const message = channelThread.messages.find(m => m.id === messageId);
    if (!message) {
      log.debug({ messageId }, 'sendOutgoingChannelMessage: message not found');
      return; // message deleted -> not doing job -> marking as done
    }

    // Preparing for send
    const channel = channelThread.channel;
    const channelApp = channelApps.find((app) => app.type === channel.type);
    const sendFn = channelApp?.sendMessage;
  
    if (!sendFn) {
      throw new Error(`No send function registered for channel type '${channel.type}'`);
    }

    // Side effect lock on
    await tx.update(channelMessages).set({
      status: 'sending',
    }).where(eq(channelMessages.id, messageId));

    return { sendFn, channelThread };
  });

  if (!result) {
    return;
  }

  const { sendFn, channelThread } = result;

  try {
    log.info('sending outgoing message');

    const { sourceId, providerData } = await sendFn({
      address: channelThread.channel.address,
      text: message.text ?? '',
      sourceThreadId: channelThread.sourceThreadId,
    });

    log.info({ sourceId }, 'message sent');

    // RELEASE LOCK (atomic)
    await withOrg(organizationId, async (tx) => {
      await tx.update(channelMessages).set({
        status: 'done',
        sourceId,
        providerData,
        updatedAt: new Date().toISOString(),
      }).where(eq(channelMessages.id, messageId));
    });

    log.info({ sourceId }, 'outgoing message sent and saved');
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

  } finally {
    // after side effect we should run checkInbox
    checkInbox(organizationId, channelThreadId);
  }
}




async function requireChannelThread(tx: OrgTransaction, channelThreadId: string) {
  const channelThread = await tx.query.channelThreads.findFirst({
    where: eq(channelThreads.id, channelThreadId),
    with: {
      channel: {
        with: {
          environment: true,
        }
      },
      messages: true,
    },
  });

  if (!channelThread) {
    throw new Error(`Channel thread ${channelThreadId} not found`);
  }
  return channelThread;
}

async function requireSession(tx: OrgTransaction, channelThreadId: string) {
  const session = await tx.query.sessions.findFirst({
    columns: {
      id: true,
    },
    where: eq(sessions.channelThreadId, channelThreadId),
  });
  if (!session) {
    throw new Error(`Session for channel thread ${channelThreadId} not found`);
  }

  return requireSessionBase(tx, session.id);
}

// dirty means new messages that weren't processed yet (added by defineChannel)
function isDirty(channelThread: ChannelThread) {
  return channelThread.messages.some(m => m.direction === 'incoming' && m.status === 'pending')
}




// lock means there's external system operation in progress (side effect). We shouldn't do operations while channel thread is locked.
function isSideEffectCallInProgress(channelThread: ChannelThread) {
  return channelThread.messages.some(m =>
    (m.direction === 'outgoing' && m.status === 'sending') || // sending to external channel is in progress
    (m.direction === 'incoming' && m.status === 'run_connecting') // establishment of connection is in progress
  );
}

// This function *only checks whether there's active run in external service!!! The only source of truth is 'incoming' + 'streaming' (+ run_id).
// When streaming is finished, and outgoing message is 'pending', it's still *NO ACTIVE RUN*.
function getActiveRun(channelThread: ChannelThread) {
  const messagesBeingProcessedWithRun = channelThread.messages.filter(m => m.direction === 'incoming' && m.status === 'run_streaming');

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

