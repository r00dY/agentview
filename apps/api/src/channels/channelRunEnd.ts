import { eq } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import { sql } from 'drizzle-orm';
import { log } from '../logger';
import { getBoss } from '../pgboss';
import { channelMessages, sessions } from '../schemas/schema';
import { OUTGOING_CHANNEL_MESSAGE_QUEUE } from '../workers/outgoingChannelMessages';
import type { OrgTransaction } from '../withOrg';

/**
 * Called when a run reaches a terminal state (completed or failed).
 * If the session is a channel session, creates an outgoing channel message.
 *
 * - Completed runs: normal outgoing message with the agent's reply text
 * - Failed runs: internal outgoing message with the error reason
 */
export async function onRunEnded(tx: OrgTransaction, params: {
  runId: string;
  sessionId: string;
  organizationId: string;
  status: 'completed' | 'failed';
  channelReply?: { text: string };
  failReason?: { message: string } | any;
}) {
  const sessionRow = await tx.query.sessions.findFirst({
    where: eq(sessions.id, params.sessionId),
    columns: { channelThreadId: true },
  });

  if (!sessionRow?.channelThreadId) {
    return; // not a channel session
  }

  const isError = params.status === 'failed';
  const text = isError
    ? (params.failReason?.message ?? 'Run failed')
    : (params.channelReply?.text ?? '');

  if (!text) {
    log.warn({ runId: params.runId }, 'onRunEnded: no text for outgoing message, skipping');
    return;
  }

  const [insertedMsg] = await tx.insert(channelMessages).values({
    organizationId: params.organizationId,
    channelThreadId: sessionRow.channelThreadId,
    direction: 'outgoing',
    status: 'pending',
    date: new Date().toISOString(),
    text,
    runId: params.runId,
    internal: isError,
  }).returning();

  await getBoss().send(
    OUTGOING_CHANNEL_MESSAGE_QUEUE,
    { messageId: insertedMsg.id, organizationId: params.organizationId },
    { db: fromDrizzle(tx, sql) },
  );
}
