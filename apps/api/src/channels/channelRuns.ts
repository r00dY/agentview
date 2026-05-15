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
import { withOrg, withTenant } from '../withOrg';
import { OUTGOING_CHANNEL_MESSAGE_QUEUE } from '../workers/outgoingChannelMessages';

const PENDING_OUTGOING_POLL_INTERVAL = 1000;
const PENDING_OUTGOING_TIMEOUT = 30000;

/**
 * Wait until there are no pending/sending outgoing messages for the channel thread.
 * Polls outside of a transaction to avoid holding locks.
 */
async function waitForPendingOutgoing(
  organizationId: string,
  channelThreadId: string,
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < PENDING_OUTGOING_TIMEOUT) {
    const hasPending = await withOrg(organizationId, async (tx) => {
      const unresolved = await tx.query.channelMessages.findFirst({
        where: and(
          eq(channelMessages.channelThreadId, channelThreadId),
          eq(channelMessages.direction, 'outgoing'),
          inArray(channelMessages.status, ['pending', 'sending']),
        ),
      });
      return !!unresolved;
    });
    if (!hasPending) return;

    log.debug({ channelThreadId }, 'waiting for pending outgoing message...');
    await new Promise(r => setTimeout(r, PENDING_OUTGOING_POLL_INTERVAL));
  }

  throw new AgentViewError("Timed out waiting for pending outgoing message.", 408);
}

/**
 * Creates and executes a run for a channel session.
 *
 * 1. Waits for any pending outgoing messages to resolve
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
): Promise<{ runId: string; response: Response; success: boolean }> {
  log.debug(`[${sessionId}] [createRunForChannel] start`);

  // Get channelThreadId outside the main transaction
  const { channelThreadId, organizationId } = await withTenant(principal, async (tx) => {
    const session = await requireSessionBase(tx, sessionId);
    if (typeof session.channelThreadId !== 'string') {
      throw new AgentViewError("Session has no channel thread.", 422);
    }
    return { channelThreadId: session.channelThreadId, organizationId: tx.organizationId };
  });

  // Wait for any pending outgoing messages
  await waitForPendingOutgoing(organizationId, channelThreadId);

  // Main transaction: terminate active run, create new run
  const txResult = await withTenant(principal, async (tx) => {
    await tx.acquireLock({ type: "edit_session", sessionId });

    const session = await requireSessionBase(tx, sessionId);

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

    // Find the last successfully sent, non-internal outgoing message — this is the conversation boundary.
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

    return result;
  });

  // Execute the run (streaming connection)
  let result: { runId: string; response: Response; success: boolean };
  try {
    result = await executeAutoRun(principal, sessionId, txResult, signal);
  } catch (error) {
    // Connection failure — send internal error message
    await sendInternalErrorMessage(organizationId, channelThreadId, txResult.runBase.id, 'Failed to start run');
    throw error;
  }

  // If the streaming server returned an error response, send internal error message
  if (!result.success) {
    await sendInternalErrorMessage(organizationId, channelThreadId, result.runId, 'Error response from AI Endpoint');
  }

  return result;
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
      const [insertedMsg] = await tx.insert(channelMessages).values({
        organizationId,
        channelThreadId,
        direction: 'outgoing',
        status: 'pending',
        date: new Date().toISOString(),
        text: errorText,
        runId,
        internal: true,
      }).returning();

      await getBoss().send(
        OUTGOING_CHANNEL_MESSAGE_QUEUE,
        { messageId: insertedMsg.id, organizationId },
        { db: fromDrizzle(tx, sql) },
      );
    });
  } catch (e) {
    log.warn({ runId, err: e }, 'failed to send internal error message');
  }
}
