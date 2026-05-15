import { AgentViewError } from 'agentview/AgentViewError';
import { requireAgentConfigBySession } from 'agentview/baseConfigUtils';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import { sql } from 'drizzle-orm';
import type { ServicePrincipal } from 'src/authMiddleware';
import { getAdapter } from '../adapters/adapters';
import { db__dangerous } from '../db';
import { getConfigFromEnvironment, requireEnvironment } from '../environments';
import { log } from '../logger';
import { getBoss } from '../pgboss';
import { createAutoRunInTx, executeAutoRun, terminateRun } from '../runs';
import { channelMessages, channelThreads, runs, sessions } from '../schemas/schema';
import { requireSessionBase } from '../sessions';
import { withOrg, withTenant, type OrgTransaction } from '../withOrg';
import { OUTGOING_CHANNEL_MESSAGE_QUEUE } from '../workers/outgoingChannelMessages';

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
 * Idempotent — tries to create and execute a run based on the current channel thread state.
 * Never throws. Safe to call multiple times; skips silently when there is no work to do.
 *
 * Triggered from two places:
 * - New incoming channel message ingested (from ingestMessage in defineChannel)
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
  try {
    // Resolve session + channel environment to construct a principal
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

    const envHandle = thread?.channel?.environment?.handle;
    if (!envHandle) return;

    const organizationId = session.organizationId;
    const sessionId = session.id;

    const principal = {
      type: 'service' as const,
      organizationId,
      env: envHandle,
    } as ServicePrincipal;

    log.debug(`[${sessionId}] [createRunForChannelThread] start`);

    // result == undefined -> ignore
    const result = await withTenant(principal, async (tx) => {
      await tx.acquireLock({ type: "edit_session", sessionId });

      const session = await requireSessionBase(tx, sessionId);

      // ── Gate 1: bail if outgoing message is in-flight ──
      // We can't create a new run while side effects are uncertain.
      // The outgoing message worker will re-trigger this function once resolved.
      const unresolvedOutgoing = await tx.query.channelMessages.findFirst({
        where: and(
          eq(channelMessages.channelThreadId, channelThreadId),
          eq(channelMessages.direction, 'outgoing'),
          inArray(channelMessages.status, ['pending', 'sending']),
        ),
      });
      if (unresolvedOutgoing) {
        log.debug(`[${sessionId}] skipping: outgoing message still pending/sending`);
        return;
      }

      // ── Gate 2: bail if no unprocessed incoming messages ──
      // An incoming message without a runId means it hasn't been consumed by any run yet.
      const unprocessedIncoming = await tx.query.channelMessages.findFirst({
        where: and(
          eq(channelMessages.channelThreadId, channelThreadId),
          eq(channelMessages.direction, 'incoming'),
          isNull(channelMessages.runId),
        ),
      });
      if (!unprocessedIncoming) {
        log.debug(`[${sessionId}] skipping: no unprocessed incoming messages`);
        return;
      }


      // ── Terminate active run ──
      // New unprocessed messages exist, so any in-progress run is stale.
      // terminateRun → onRunFinished → channelOnRunFinishHandler clears runId
      // on the terminated run's messages (within this same transaction).
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

      // ── Build input from conversation boundary ──
      // Use the last successful (sent, non-internal) outgoing message as boundary.
      // All incoming messages after that point become the new run's input.
      // This is independent of runId — works correctly even when terminated run's
      // messages have just had their runId cleared in this same transaction.
      const allMessages = await tx.query.channelMessages.findMany({
        where: eq(channelMessages.channelThreadId, channelThreadId),
        orderBy: (cm, { asc }) => [asc(cm.date)],
      });

      const lastSuccessful = [...allMessages].reverse().find(m =>
        m.direction === 'outgoing' && m.status === 'sent' && !m.internal && m.runId
      );

      let previousRunId: string | null = null; // null means from ROOT
      let incomingMessages: typeof allMessages;

      if (lastSuccessful) {
        previousRunId = lastSuccessful.runId;
        incomingMessages = allMessages.filter(m =>
          m.direction === 'incoming' && m.createdAt > lastSuccessful.createdAt
        );
      } else {
        // No successful outgoing yet — first run, consume all incoming messages
        incomingMessages = allMessages.filter(m => m.direction === 'incoming');
      }

      if (incomingMessages.length === 0) {
        // Shouldn't happen (gate 2 passed), but guard anyway
        log.debug(`[${sessionId}] skipping: no incoming messages after conversation boundary`);
        return null;
      }

      log.info({ sessionId, count: incomingMessages.length }, 'incoming messages found');

      const newRunId = crypto.randomUUID();
      const environment = await requireEnvironment(tx);
      const config = getConfigFromEnvironment(environment);
      const agentConfig = requireAgentConfigBySession(config, session);
      const adapter = getAdapter(agentConfig.adapter);
      const input = adapter.createDefaultInputForChannelMessages(incomingMessages, newRunId);

      const result = await createAutoRunInTx(tx, sessionId, input, {
        id: newRunId,
        previousRunId,
      });

      // Mark consumed incoming messages with the new runId
      const incomingIds = incomingMessages.map(m => m.id);
      if (incomingIds.length > 0) {
        await tx.update(channelMessages)
          .set({ runId: newRunId })
          .where(inArray(channelMessages.id, incomingIds));
      }

      return result;
    });

    if (!result) return;

    // Execute the run (streaming connection) — outside the transaction
    let result: { runId: string; response: Response; success: boolean };
    try {
      result = await executeAutoRun(principal, sessionId, txResult.txResult);
    } catch (error) {
      await sendInternalErrorMessage(organizationId, channelThreadId, txResult.txResult.runBase.id, 'Failed to start run');
      throw error;
    }

    if (!result.success) {
      await sendInternalErrorMessage(organizationId, channelThreadId, result.runId, 'Error response from AI Endpoint');
    }
  } catch (error) {
    log.error({ err: error, channelThreadId }, 'createRunForChannelThreadIfNecessary failed');
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
