import { AgentViewError } from 'agentview/AgentViewError';
import { requireAgentConfigBySession } from 'agentview/baseConfigUtils';
import { and, eq, inArray } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import { sql } from 'drizzle-orm';
import type { Principal } from 'src/authMiddleware';
import { getAdapter } from '../adapters/adapters';
import { getConfigFromEnvironment, requireEnvironment } from '../environments';
import { log } from '../logger';
import { getBoss } from '../pgboss';
import { createAutoRunInTx, executeAutoRun, terminateRun } from '../runs';
import { channelMessages, runs, sessions } from '../schemas/schema';
import { requireSessionBase } from '../sessions';
import { withOrg, withTenant, type OrgTransaction } from '../withOrg';
import { OUTGOING_CHANNEL_MESSAGE_QUEUE } from '../workers/outgoingChannelMessages';

const PENDING_OUTGOING_POLL_INTERVAL = 1000;
const PENDING_OUTGOING_TIMEOUT = 30000;

async function insertAndQueueOutgoingMessage(tx: OrgTransaction, values: {
  channelThreadId: string;
  text: string;
  runId: string;
  internal: boolean;
}) {
  const [msg] = await tx.insert(channelMessages).values({
    ...values,
    organizationId: tx.organizationId,
    direction: 'outgoing',
    status: 'pending',
    date: new Date().toISOString(),
  }).returning();

  await getBoss().send(
    OUTGOING_CHANNEL_MESSAGE_QUEUE,
    { messageId: msg.id, organizationId: tx.organizationId },
    { db: fromDrizzle(tx, sql) },
  );
}


/**
 * channel "domain" listens to run finish to react properly
 */
export async function channelOnRunFinishHandler(tx: OrgTransaction, params: {
  runId: string;
  sessionId: string;
  status: string;
  channelReply?: { text: string };
  failReason?: any;
}) {
  await tx.acquireLock({ type: "edit_session", sessionId: params.sessionId });
  
  const sessionRow = await tx.query.sessions.findFirst({
    where: eq(sessions.id, params.sessionId),
    columns: { channelThreadId: true },
  });

  if (!sessionRow?.channelThreadId) {
    return; // not a channel session
  }

  // Clean runId from channel messages for unsuccessful runs
  // This releases incoming messages so the next run can pick them up
  if (params.status !== 'completed') {
    await tx.update(channelMessages)
      .set({ runId: null })
      .where(eq(channelMessages.runId, params.runId));
  }

  if (params.status === 'completed') {
    const text = params.channelReply?.text ?? '';
    if (!text) {
      log.warn({ runId: params.runId }, 'channelOnRunFinishHandler: no reply text for completed run');
      return;
    }

    await insertAndQueueOutgoingMessage(tx, {
      channelThreadId: sessionRow.channelThreadId,
      text,
      runId: params.runId,
      internal: false,
    });
  } else if (params.status === 'failed') {
    const text = params.failReason?.message ?? 'Run failed';

    await insertAndQueueOutgoingMessage(tx, {
      channelThreadId: sessionRow.channelThreadId,
      text,
      runId: params.runId,
      internal: true,
    });
  }
  // discarded, cancelled → no outgoing message (runId already cleaned above)
}

// ─── Channel run creation ────────────────────────────────────────────────────

/**
 * Creates and executes a run for a channel session.
 *
 * 1. Locks the session, checks for pending outgoing messages (retries if found)
 * 2. Terminates any active run for the session
 * 3. Determines previousRunId from last successful (sent, non-internal) outgoing message
 * 4. Creates a new run from unprocessed incoming messages
 * 5. Sets runId on consumed incoming messages
 * 6. If run fails immediately, sends an internal error message
 */
export async function createRunForChannel(
  principal: Principal,
  sessionId: string,
  signal?: AbortSignal
) {
  log.debug(`[${sessionId}] [createRunForChannel] start`);

  const startTime = Date.now();

  while (true) {
    const txResult = await withTenant(principal, async (tx) => {
      await tx.acquireLock({ type: "edit_session", sessionId });

      const session = await requireSessionBase(tx, sessionId);
      const channelThreadId = session.channelThreadId;
      if (typeof channelThreadId !== 'string') {
        throw new AgentViewError("Session has no channel thread.", 422);
      }

      // Check for pending outgoing messages under the lock — no race condition
      const unresolvedOutgoing = await tx.query.channelMessages.findFirst({
        where: and(
          eq(channelMessages.channelThreadId, channelThreadId),
          eq(channelMessages.direction, 'outgoing'),
          inArray(channelMessages.status, ['pending', 'sending']),
        ),
      });

      if (unresolvedOutgoing) {
        return { pending: true as const };
      }

      // Terminate any active run
      const activeRun = await tx.query.runs.findFirst({
        where: and(
          eq(runs.sessionId, sessionId),
          eq(runs.status, 'in_progress'),
        ),
      });

      if (activeRun) {
        log.info({ sessionId, runId: activeRun.id }, 'terminating active run before creating new channel run');
        await terminateRun(tx, sessionId, activeRun.id, {
          status: 'discarded',
          failReason: { message: 'New message ingested, discarding active run' },
        });
      }

      // Get all channel messages for this thread
      const allMessages = await tx.query.channelMessages.findMany({
        where: eq(channelMessages.channelThreadId, channelThreadId),
        orderBy: (cm, { asc }) => [asc(cm.date)],
      });

      // Find the last successfully sent, non-internal outgoing message — conversation boundary
      const lastSuccessful = [...allMessages].reverse().find(m =>
        m.direction === 'outgoing' && m.status === 'sent' && !m.internal && m.runId
      );

      let previousRunId: string | null = null; // null means from ROOT
      let incomingMessages: typeof allMessages;

      if (lastSuccessful) {
        previousRunId = lastSuccessful.runId;

        // Incoming messages that arrived after the last successful outgoing was created
        incomingMessages = allMessages.filter(m =>
          m.direction === 'incoming' && m.createdAt > lastSuccessful.createdAt
        );
      } else {
        // No successful outgoing — first run, consume all incoming messages
        incomingMessages = allMessages.filter(m => m.direction === 'incoming');
      }

      if (incomingMessages.length === 0) {
        throw new AgentViewError("No incoming messages to create a run from.", 422);
      }

      log.info({ sessionId, count: incomingMessages.length }, 'incoming messages found');

      // Build input from channel messages
      const newRunId = crypto.randomUUID();
      const environment = await requireEnvironment(tx);
      const config = getConfigFromEnvironment(environment);
      const agentConfig = requireAgentConfigBySession(config, session);
      const adapter = getAdapter(agentConfig.adapter);
      const input = adapter.createDefaultInputForChannelMessages(incomingMessages, newRunId);

      // Create the run
      const result = await createAutoRunInTx(tx, sessionId, input, {
        id: newRunId,
        previousRunId,
      });

      // Set runId on consumed incoming messages
      const incomingIds = incomingMessages.map(m => m.id);
      if (incomingIds.length > 0) {
        await tx.update(channelMessages)
          .set({ runId: newRunId })
          .where(inArray(channelMessages.id, incomingIds));
      }

      return { pending: false as const, txResult: result, channelThreadId };
    });

    if (txResult.pending) {
      if (Date.now() - startTime > PENDING_OUTGOING_TIMEOUT) {
        throw new AgentViewError("Timed out waiting for pending outgoing message.", 408);
      }
      log.debug(`[${sessionId}] waiting for pending outgoing message...`);
      await new Promise(r => setTimeout(r, PENDING_OUTGOING_POLL_INTERVAL));
      continue;
    }

    // Execute the run (streaming connection)
    let result: { runId: string; response: Response; success: boolean };
    try {
      result = await executeAutoRun(principal, sessionId, txResult.txResult, signal);
    } catch (error) {
      await sendInternalErrorMessage(principal.organizationId, txResult.channelThreadId, txResult.txResult.runBase.id, 'Failed to start run');
      throw error;
    }

    // If the streaming server returned an error response, send internal error message
    if (!result.success) {
      await sendInternalErrorMessage(principal.organizationId, txResult.channelThreadId, result.runId, 'Error response from AI Endpoint');
    }

    return result;
  }
}

/**
 * Creates an internal (error) outgoing channel message and queues it for delivery.
 */
async function sendInternalErrorMessage(
  organizationId: string,
  channelThreadId: string,
  runId: string,
  errorText: string,
) {
  try {
    await withOrg(organizationId, async (tx) => {
      await insertAndQueueOutgoingMessage(tx, {
        channelThreadId,
        text: errorText,
        runId,
        internal: true,
      });
    });
  } catch (e) {
    log.warn({ runId, err: e }, 'failed to send internal error message');
  }
}
