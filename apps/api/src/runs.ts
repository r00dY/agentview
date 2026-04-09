import { AgentViewError } from 'agentview/AgentViewError';
import type { Environment, ManualRunCreate, ManualRunUpdate } from 'agentview/apiTypes';
import type { BaseAgentConfig, BaseRunConfig } from 'agentview/baseConfigTypes';
import { findItemConfig, requireAgentConfig, requireChannelConfig, requireRunConfig, serializeRunConfig } from 'agentview/baseConfigUtils';
import { getLastRun } from 'agentview/sessionUtils';
import { and, eq, inArray, isNull, not, or } from 'drizzle-orm';
import { log } from './logger';
import { getAdapter } from './adapters/adapters';
import { resolveAgentRef } from './agentRefs';
import { authorize, type Principal } from './authMiddleware';
import { getConfigFromEnvironment, requireEnvironment } from './environments';
import { requireUUID } from './isUUID';
import { parseMetadata } from './parseMetadata';
import { publishEvent } from './redisPubSub';
import { publishRunStreamEvent } from './runStream';
import { agentRefs, channelMessages, runs, sessionItems, sessions, webhookJobs } from './schemas/schema';
import { activateSession, fetchSessionBase, requireSession, requireSessionBase } from './sessions';
import type { Transaction } from './types';
import { withTenant, type OrgTransaction, type TenantTransaction } from './withOrg';
import { standardToDefaultSession } from './standardToDefaultSession';

export const DEFAULT_IDLE_TIME = 1000 * 60; // 60 seconds


export function isRunFinished(run: { status: string }) {
  return run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed' || run.status === 'discarded';
}

/**
 * Returns the input content for a run's session items.
 * Uses the `type` field if any item has one, otherwise falls back to positional (first item).
 */
export function getRunInputContent(sessionItems: { content: any; type?: string | null }[]) {
  const inputItem = sessionItems.find(si => si.type === 'input') ?? sessionItems[0];
  return inputItem?.content;
}

/**
 * Validates non-input items. All items are validated against step schemas and output schema.
 * Items are always inserted as type: 'step' at this stage. Output marking happens later on completion.
 */
export function validateItems(runConfig: BaseRunConfig, previousRunItems: any[], items: any[]) {
  const validateSteps = runConfig.validateSteps ?? false;

  const parsedItems: any[] = [];

  for (const item of items) {
    // Try to match against any schema (step or output)
    const stepConfig = findItemConfig(runConfig, [...previousRunItems, ...parsedItems], item, [], "step");
    const outputConfig = findItemConfig(runConfig, [...previousRunItems, ...parsedItems], item, [], "output");

    if (stepConfig) {
      parsedItems.push(stepConfig.content);
    }
    else if (outputConfig) {
      parsedItems.push(outputConfig.content);
    }
    else if (!validateSteps) {
      parsedItems.push(item);
    }
    else {
      throw new AgentViewError("Couldn't find a matching item schema.", 422, { item });
    }
  }

  return parsedItems;
}

async function handleChannelReply(
  tx: Transaction,
  runId: string,
  sessionId: string,
  organizationId: string,
  channelReply?: { text: string },
) {
  const sessionRow = await tx.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    columns: { channelThreadId: true },
  });

  if (!sessionRow) {
    throw new Error("Unexpected error. Session doesn't exist when handling channel reply.");
  }

  if (sessionRow.channelThreadId) {
    if (!channelReply) {
      throw new AgentViewError("No channel reply for a session that has a channel thread.", 400);
    }

    await tx.insert(channelMessages).values({
      organizationId,
      channelThreadId: sessionRow.channelThreadId,
      direction: 'outgoing',
      status: 'pending',
      date: new Date().toISOString(),
      text: channelReply.text,
      runId,
    });
  }
  // else if (!sessionRow.channelThreadId && channelReply) {
  //   throw new AgentViewError("You can't set channel reply for a session that doesn't have a channel thread.", 400);
  // }
  // else if (sessionRow.channelThreadId && !channelReply) {
  //   throw new AgentViewError("No channel reply for a session that has a channel thread.", 400);
  // }
  // else if (!sessionRow.channelThreadId && !channelReply) {
  //   // no-op
  // }
}


/**
 * Marks the last N non-input, non-state items as 'output' on run completion.
 * Validates each item against the output schema before marking.
 */
async function markOutputItems(
  tx: Transaction,
  runId: string,
  outputItemCount: number,
  runConfig: BaseRunConfig,
) {
  if (outputItemCount === 0) return;

  // Get all non-input, non-state items for this run, ordered by sortOrder DESC
  const outputItems = await tx.query.sessionItems.findMany({
    where: and(
      eq(sessionItems.runId, runId),
      eq(sessionItems.isState, false),
      not(eq(sessionItems.type, 'input')),
    ),
    orderBy: (si, { desc }) => [desc(si.sortOrder)],
    limit: outputItemCount,
  });

  if (outputItems.length === 0) {
    throw new AgentViewError("Run set as 'completed' must have at least one output item, but no non-input items found.", 422);
  }

  for (const outputItem of outputItems) {
    const outputConfig = findItemConfig(runConfig, [], outputItem.content as Record<string, any>, [], "output");
    if (!outputConfig) {
      throw new AgentViewError("Item does not match output schema.", 422, { item: outputItem.content });
    }
  }

  // Update their type to 'output'
  const itemIds = outputItems.map(i => i.id);
  await tx.update(sessionItems).set({
    type: 'output',
    updatedAt: new Date().toISOString(),
  }).where(inArray(sessionItems.id, itemIds));
}


export async function getRunBase(tx: Transaction, runId: string) {
  requireUUID(runId);

  const runRows = await tx
    .select()
    .from(runs)
    .leftJoin(agentRefs, eq(runs.agentRefId, agentRefs.id))
    .where(eq(runs.id, runId))
    .limit(1);

  const row = runRows[0];
  if (!row) return undefined;

  return {
    ...row.runs,
    agentRef: row.agent_refs,
  };
}

export async function requireRunBase(tx: Transaction, runId: string) {
  const run = await getRunBase(tx, runId);
  if (!run) {
    throw new AgentViewError("Run not found", 404);
  }
  return run
}

export async function getRunInput(tx: Transaction, runId: string) {
  return await tx.query.sessionItems.findFirst({
    where: and(eq(sessionItems.runId, runId), eq(sessionItems.isState, false)),
    orderBy: (sessionItem, { asc }) => [asc(sessionItem.sortOrder)],
  });
}

export async function getRunSessionItems(tx: Transaction, runId: string) {
  return await tx.query.sessionItems.findMany({
    where: eq(sessionItems.runId, runId),
    orderBy: (sessionItem, { asc }) => [asc(sessionItem.sortOrder)],
  });
}





/**
 * Shared run-creation core. Receives pre-validated params, inserts run + items, queues webhooks.
 */
async function createRunCore(
  tx: OrgTransaction,
  environment: Environment,
  sessionId: string,
  params: {
    id?: string | undefined;
    parsedInput: any
    parsedNonInputItems: any[];
    status: string;
    failReason: any | null;
    expiresAt: string | null;
    finishedAt: string | null;
    metadata: Record<string, any> | undefined;
    agentRefId: string;
    manual: boolean;
    state: any | undefined;
    runConfig: BaseRunConfig;
    lastRun: ReturnType<typeof getLastRun>;
  }
): Promise<typeof runs.$inferSelect> {
  const { parsedInput, parsedNonInputItems, status, failReason, expiresAt, finishedAt, metadata, agentRefId, manual, state, runConfig, lastRun, id } = params;

  const [insertedRun] = await tx.insert(runs).values({
    id,
    organizationId: tx.organizationId,
    sessionId,
    status,
    failReason,
    manual,
    expiresAt,
    finishedAt,
    agentRefId,
    metadata,
    environmentId: environment.id,
  }).returning();

  await tx.insert(sessionItems).values(
    {
      organizationId: tx.organizationId,
      sessionId,
      content: parsedInput,
      runId: insertedRun.id,
      type: 'input' as const,
    }
  );

  if (parsedNonInputItems.length > 0) {
    await tx.insert(sessionItems).values(
      parsedNonInputItems.map(item => ({
        organizationId: tx.organizationId,
        sessionId,
        content: item,
        runId: insertedRun.id,
        type: 'step' as const,
      }))
    );
  }

  if (state !== undefined) {
    await tx.insert(sessionItems).values({
      organizationId: tx.organizationId,
      sessionId,
      content: state,
      runId: insertedRun.id,
      isState: true,
    });
  }

  if (status === 'completed') {
    await markOutputItems(tx, insertedRun.id, 1, runConfig);
  }

  // Queue webhook job on first run
  const config = getConfigFromEnvironment(environment);
  const isFirstRun = lastRun === undefined;
  if (isFirstRun) {
    if (config.webhookUrl) {
      await tx.insert(webhookJobs).values({
        organizationId: tx.organizationId,
        eventType: 'session.on_first_run_created',
        payload: { session_id: sessionId },
        sessionId,
        status: 'pending',
        nextAttemptAt: new Date().toISOString(),
        environmentId: environment.id,
      });
    }

    if (!config.__internal?.disableSummaries) {
      await tx.insert(webhookJobs).values({
        organizationId: tx.organizationId,
        eventType: 'session.generate_summary',
        payload: { session_id: sessionId },
        sessionId,
        status: 'pending',
        nextAttemptAt: new Date().toISOString(),
        environmentId: environment.id,
      });
    }
  }

  // Notify event-driven workers immediately after commit for auto-fetch runs
  tx.afterCommit(async () => {
    await publishEvent({ type: 'run.created', runId: insertedRun.id });
  });

  return insertedRun;
}




/**
 * Prepares a session for run creation: fetches session, checks no in-progress run, finds config.
 */
async function prepareRunCreation(tx: OrgTransaction, environment: Environment, sessionId: string) {
  const session = await requireSession(tx, sessionId, { includePendingRun: true, includeInitRun: true }); // todo: optimize

  const lastRun = getLastRun(session);
  if (lastRun && !isRunFinished(lastRun)) {
    throw new AgentViewError(`Can't create a run because session has already a run in progress.`, 422);
  }

  const config = getConfigFromEnvironment(environment);
  const channelConfig = requireChannelConfig(config, session.channel);
  const agentConfig = requireAgentConfig(config, typeof channelConfig.agent === 'string' ? channelConfig.agent : channelConfig.agent?.name);

  const agentRefWithId = await resolveAgentRef(tx, {
    agentRef: { version: agentConfig.version, agent: agentConfig.name, adapter: agentConfig.adapter },
    previousAgentRef: lastRun?.agentRef ?? session.agentRef,
  });

  return { session, lastRun, config, agentConfig, channelConfig, agentRefId: agentRefWithId.id };
}

async function processInput(agentConfig: BaseAgentConfig, input: any) {
  const runConfig = requireRunConfig(agentConfig, input);
  const parsedInput = runConfig.input.schema.parse(input);
  const idleTimeout = runConfig.idleTimeout ?? DEFAULT_IDLE_TIME;

  return { runConfig, parsedInput, idleTimeout };
}



export type RunTerminationReason = { status: 'cancelled' } | { status: 'failed', failReason: any } | { status: 'discarded', failReason: any };

export function terminationReasonText(body: RunTerminationReason) {
  switch (body.status) {
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return `failed${body.failReason ? ` (${body.failReason.message})` : ''}`;
    case 'discarded':
      return `discarded${body.failReason ? ` (${body.failReason.message})` : ''}`;
  }
}

export class RunTerminationError extends Error {
  constructor(public reason: RunTerminationReason) {
    super(terminationReasonText(reason));
    this.name = 'RunTerminationError';
  }
}



/**
 * Mutations. Locks required.
 */


/**
 * Fast operations for agent-fetch
 */

// export async function upsertItem(
//   tx: TenantTransaction,
//   options: {
//     runId: string,
//     sessionId: string,
//     runConfig: BaseRunConfig,
//     id: string,
//     content: any
//   }
// ) {
//   await tx.acquireLock({ type: "edit_session", sessionId: options.sessionId });

//   const { runId, sessionId, runConfig, id, content } = options;

//   const run = await requireRunBase(tx, runId);

//   if (run.status === 'discarded') { // important for auto-fetch. When resource is discarded all "patch" operations should trigger this error to handle race conditions gracefully.
//     throw new RunTerminationError({ status: run.status, failReason: run.failReason });
//   }

//   if (run.status !== 'in_progress') {
//     throw new AgentViewError("Can't add item to run that is not in 'in_progress' status. Status: " + run.status, 422);
//   }

//   const idleTimeout = runConfig.idleTimeout ?? DEFAULT_IDLE_TIME;
//   const now = Date.now();
//   const nowIso = new Date(now).toISOString();

//   // Run both operations in parallel for speed.
//   await Promise.all([
//     tx.insert(sessionItems).values({
//       id,
//       sessionId,
//       content,
//       runId,
//       organizationId: run.organizationId
//     }).onConflictDoUpdate({
//       target: [sessionItems.id],
//       set: {
//         content,
//         updatedAt: nowIso,
//       },
//     }),
//     tx.update(runs).set({
//       expiresAt: new Date(now + idleTimeout).toISOString(),
//       updatedAt: nowIso,
//     }).where(eq(runs.id, run.id)),
//   ]);
// }

// export const ManualRunUpdateSchema = z.object({
//   items: z.array(z.record(z.string(), z.any())).optional(),
//   metadata: z.record(z.string(), z.any()).optional(),
//   status: z.enum(['in_progress', 'completed', 'cancelled', 'failed']).optional(),
//   state: z.any().optional(),
//   failReason: z.any().nullable().optional(),
//   outputItemCount: z.number().int().min(0).optional(),
//   channelReply: z.object({ text: z.string() }).optional(),
// });

export type FastPatchItemOp = {
  type: "item",
  id?: string,
  content: any
}

export type FastPatchStateOp = {
  type: "state",
  content: any
}

export type FastPatchMetadataOp = {
  type: "metadata",
  metadata: Record<string, any>
}

export type FastPatchCancelOp = {
  type: "cancel",
}

export type FastPatchFailOp = {
  type: "fail",
  failReason: { message: string, [key: string]: any }
}

export type FastPatchCompleteOp = {
  type: "complete",
  outputItemCount: number,
  channelReply?: { text: string }
}

export type FastPatchOp = FastPatchItemOp | FastPatchStateOp | FastPatchMetadataOp | FastPatchCancelOp | FastPatchFailOp | FastPatchCompleteOp;


export async function fastApplyRunPatch(
  tx: TenantTransaction,
  runId: string,
  sessionId: string,
  runConfig: BaseRunConfig,
  op: FastPatchOp
) {
  await tx.acquireLock({ type: "edit_session", sessionId });

  const run = await requireRunBase(tx, runId);

  if (run.manual) {
    throw new AgentViewError("This endpoint is allowed only for auto-fetch runs.", 422);
  }

  if (run.status !== 'in_progress') { // important for auto-fetch. When resource is discarded all "patch" operations should trigger this error to handle race conditions gracefully.
    throw new RunTerminationError({ status: run.status as 'cancelled' | 'failed' | 'discarded', failReason: run.failReason });
  }

  // if (run.status !== 'in_progress') {
  //   throw new AgentViewError("Can't add item to run that is not in 'in_progress' status. Status: " + run.status, 422);
  // }

  const idleTimeout = runConfig.idleTimeout ?? DEFAULT_IDLE_TIME;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const updatedRun: { updatedAt: string, expiresAt: string, metadata?: Record<string, any>, status?: string, finishedAt?: string, failReason?: any } = {
    updatedAt: nowIso,
    expiresAt: new Date(now + idleTimeout).toISOString(),
  };

  let updatedItem: typeof sessionItems.$inferInsert | undefined = undefined;

  const dbOps: Promise<any>[] = [];

  if (op.type === 'item') {
    updatedItem = {
      id: op.id,
      content: op.content,
      runId,
      sessionId,
      organizationId: run.organizationId,
      type: 'step' as const,
    };
  } else if (op.type === 'state') {
    updatedItem = {
      content: op.content,
      isState: true,
      runId,
      sessionId,
      organizationId: run.organizationId,
    };
  } else if (op.type === 'metadata') {
    const metadata = parseMetadata(runConfig.metadata, runConfig.allowUnknownMetadata ?? true, op.metadata ?? {}, run.metadata ?? {});
    updatedRun.metadata = metadata;

  } else if (op.type === 'cancel') {
    updatedRun.status = 'cancelled';
    updatedRun.finishedAt = nowIso;

  } else if (op.type === 'fail') {
    updatedRun.status = 'failed';
    updatedRun.failReason = op.failReason;
    updatedRun.finishedAt = nowIso;

  } else if (op.type === 'complete') {
    updatedRun.status = 'completed';
    updatedRun.finishedAt = nowIso;

    dbOps.push(
      markOutputItems(tx, run.id, op.outputItemCount ?? 1, runConfig), // validation inside
      handleChannelReply(tx, run.id, run.sessionId, tx.organizationId, op.channelReply),
    );
  }

  dbOps.push(tx.update(runs).set(updatedRun).where(eq(runs.id, run.id)));

  if (updatedItem) {
    dbOps.push(tx.insert(sessionItems).values(updatedItem).onConflictDoUpdate({
      target: [sessionItems.id],
      set: {
        content: updatedItem.content,
        updatedAt: nowIso
      },
    }));
  }

  await Promise.all(dbOps);

  // TEMPORARY ONLY FOR BACKWARD COMPAT
  const streamEvent: any = {
    ...updatedRun
  }
  if (op.type === 'item') {
    streamEvent.items = [op.content];
  } else if (op.type === 'state') {
    streamEvent.state = op.content;
  }

  tx.afterCommit(async () => {
    await publishRunStreamEvent(runId, nowIso, JSON.stringify(streamEvent));

    if (op.type === 'complete' || op.type === 'cancel' || op.type === 'fail') {
      await publishRunStreamEvent(runId, null, '[DONE]');
    }
  });
}




/**
 * Core run-update logic shared between the PATCH handler and the worker.
 * Validates items, metadata, status transitions, inserts items, and updates the run.
 */
export async function applyRunPatch(
  tx: TenantTransaction,
  runId: string,
  body: ManualRunUpdate,
  mustBeManual?: boolean
) {
  const runPreLock = await requireRunBase(tx, runId);

  await tx.acquireLock({ type: "edit_session", sessionId: runPreLock.sessionId });

  const run = await requireRunBase(tx, runId);
  const session = await requireSessionBase(tx, run.sessionId);

  authorize(tx.principal, { action: "end-user:update", user: session.user });

  if (run.status === 'discarded') { // important for auto-fetch. When resource is discarded all "patch" operations should trigger this error to handle race conditions gracefully.
    throw new RunTerminationError({ status: run.status, failReason: run.failReason });
  }

  // Guard: API can only cancel auto-fetch runs which are being auto-fetched
  if (mustBeManual && !run.manual) {
    throw new AgentViewError("This endpoint is allowed only for manual runs.", 422);
  }

  if (run.status === 'pending' || run.status === 'init') {
    throw new AgentViewError("You can't run apply patch on run in 'init' or 'pending' status.", 422);
  }

  const environment = await requireEnvironment(tx);

  /** Find matching run config **/
  const inputItem = (await getRunInput(tx, runId))?.content;

  let parsedItems: any[] = [];
  let metadata: Record<string, any> | undefined = undefined;
  let idleTimeout: number | undefined;

  /** Reject outputItemCount if status is not being set to 'completed' */
  if (body.outputItemCount !== undefined && body.status !== 'completed') {
    throw new AgentViewError("outputItemCount can only be set when status is 'completed'.", 422);
  }
  if (body.channelReply !== undefined && body.status !== 'completed') {
    throw new AgentViewError("channelReply can only be set when status is 'completed'.", 422);
  }

  let runConfig: BaseRunConfig | undefined;

  if (body.items || body.metadata || body.state || body.status === 'completed') { // operations requiring run config
    const config = getConfigFromEnvironment(environment);

    const agentName = run.agentRef?.agent;
    if (!agentName) {
      throw new AgentViewError("You're trying to update run items, metadata or state, but the run doesn't have an agent assigned yet.", 422);
    }

    const agentConfig = requireAgentConfig(config, agentName);
    runConfig = requireRunConfig(agentConfig, inputItem);

    /** Validate items */
    const items = body.items ?? [];

    if (isRunFinished(run) && items.length > 0) {
      // it's important to throw error with proper code. It allows other systems to handle cancels and fails differently!
      throw new AgentViewError("Run already finished. Cannot add items.", 422);
    }

    const sessionItems = await getRunSessionItems(tx, runId);

    parsedItems = validateItems(runConfig, sessionItems.map(si => si.content), items);

    /** State */
    if (isRunFinished(run) && body.state !== undefined) {
      throw new AgentViewError("Run already finished. Cannot set state.", 422);
    }

    /** Metadata **/
    metadata = parseMetadata(runConfig.metadata, runConfig.allowUnknownMetadata ?? true, body.metadata ?? {}, run.metadata ?? {});

    idleTimeout = runConfig.idleTimeout ?? DEFAULT_IDLE_TIME;
  }

  /** Status, finished at, failReason */
  if (isRunFinished(run) && body.status && body.status !== run.status) {
    throw new AgentViewError("Run already finished (status: " + run.status + "). Cannot change status.", 422);
  }

  const status = body.status ?? 'in_progress';
  const failReason = body.failReason ?? null;

  if (failReason) {
    if (isRunFinished(run)) {
      throw new AgentViewError("Run already finished. failReason cannot be set.", 422);
    }
    else if (status !== 'failed') {
      throw new AgentViewError("failReason can only be set when changing status to 'failed'.", 422);
    }
  }

  const now = new Date();
  const nowIso = now.toISOString();

  const isFinished = status === 'completed' || status === 'failed' || status === 'cancelled';
  const finishedAt = run.finishedAt ?? (isFinished ? nowIso : null);

  let expiresAt: string | null = null;
  if (!isFinished) {
    if (!idleTimeout) { // if not finished, then idleTimeout must be set
      throw new AgentViewError("idleTimeout must be set when run is not finished.", 422);
    }
    expiresAt = new Date(now.getTime() + idleTimeout).toISOString();
  }

  let insertedItems: any[] = [];

  // await withOrg(organizationId, async (tx) => {
  if (parsedItems.length > 0) {
    insertedItems = await tx.insert(sessionItems).values(
      parsedItems.map(item => ({
        organizationId: run.organizationId,
        sessionId: run.sessionId,
        content: item,
        runId: run.id,
        type: 'step' as const,
      }))
    ).returning();
  }

  const [updatedRun] = await tx.update(runs).set({
    status,
    metadata,
    failReason,
    finishedAt,
    expiresAt,
    updatedAt: nowIso,
  }).where(eq(runs.id, run.id)).returning();

  if (body.state !== undefined) {
    await tx.insert(sessionItems).values({
      organizationId: run.organizationId,
      sessionId: run.sessionId,
      content: body.state,
      runId: run.id,
      isState: true,
    });
  }

  /** Mark output items on completion */
  if (status === 'completed' && runConfig) {
    const outputItemCount = body.outputItemCount ?? 1;
    await markOutputItems(tx, run.id, outputItemCount, runConfig);
    await handleChannelReply(tx, run.id, run.sessionId, tx.organizationId, body.channelReply);
  }

  // Publish to Redis stream only after transaction finished successfully in DB
  const dataToStream = JSON.stringify({
    ...body,
    items: insertedItems,
    updatedAt: nowIso
  });

  tx.afterCommit(async () => {
    await publishRunStreamEvent(runId, nowIso, dataToStream);

    if (isFinished) {
      await publishRunStreamEvent(runId, null, '[DONE]');
    }
  });

  return updatedRun;
}

export async function sendRunTerminationSignal(runId: string, reason: RunTerminationReason, options: { graceful: boolean }) {
  try {
    await fetch('http://localhost:1999/terminate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        runId,
        reason,
        graceful: options.graceful,
      }),
    }); 
  } catch (error) {
    log.error({ runId, error }, 'Failed to send run termination signal');
    return false;
  }
}

/**
 * Best-effort run clean-up (for finally {} blocks, timeouts, discards etc)
 * It unconditionally KILLS run. No grace period.
 */
export async function terminateRun(tx: OrgTransaction, sessionId: string, runId: string, reason: RunTerminationReason) {
  await tx.acquireLock({ type: "edit_session", sessionId });

  try {
    const runBase = await getRunBase(tx, runId); // we must start with a lock for safety of concurrent writes!

    if (!runBase) {
      log.warn({ runId }, 'terminateRun: run not found');
      return;
    }

    if (isRunFinished(runBase)) {
      return;
    }

    // logs
    const logText = terminationReasonText(reason);

    // When we get termination for pending/init run, we override to discard.
    if ((runBase.status === 'pending' || runBase.status === 'init') && reason.status !== 'discarded') {
      reason = { status: 'discarded', failReason: { message: `Overriden for pending/init from: ${logText}` } };
    }

    // await publishEvent({ type: 'run.terminated', runId, reason }); // important to signal termination to the workers (the signal might have been sent before for cancel / timeout, but it's for discards and general sanity)

    log.info({ runId, reason: logText }, 'terminating run');

    const nowIso = new Date().toISOString();

    await tx.update(runs).set({
      ...reason,
      finishedAt: nowIso,
      updatedAt: nowIso,
      expiresAt: null,
    }).where(eq(runs.id, runId));

    // Channel messages must be disconnected from the run.
    if (reason.status === "discarded") {
      await tx.update(channelMessages).set({
        runId: null
      }).where(eq(channelMessages.runId, runId));
    }

    // this is important, we must send the last run patch event to the stream
    tx.afterCommit(async () => {
      await sendRunTerminationSignal(runId, reason, { graceful: false }) // super important

      await publishRunStreamEvent(runId, nowIso, JSON.stringify({
        ...reason,
        updatedAt: nowIso,
      }));
      await publishRunStreamEvent(runId, null, '[DONE]');
    });

    log.info({ runId }, 'termination successful');

  } catch (e) {
    log.error({ runId, err: e }, `SEVERE: termination failed: ${e instanceof Error ? e.message : String(e)}`);
  }

}





export async function acceptRun(tx: TenantTransaction, sessionId: string, runId: string) {
  await tx.acquireLock({ type: "edit_session", sessionId });

  const run = await requireRunBase(tx, runId);

  if (run.status === 'discarded') { // important for auto-fetch. When resource is discarded all "patch" operations should trigger this error to handle race conditions gracefully.
    throw new RunTerminationError({ status: run.status, failReason: run.failReason });
  }

  if (run?.status !== 'init') {
    throw new AgentViewError("You can't accept run that is not in 'init' status. Status: " + run.status, 422);
  }

  await tx.update(runs).set({ status: 'in_progress' }).where(eq(runs.id, runId));
}


export async function createAutoRunFromChannelMessages(
  tx: OrgTransaction,
  environment: Environment,
  sessionId: string
) {
  await tx.acquireLock({ type: "edit_session", sessionId });

  log.info({ sessionId }, 'creating run from channel messages');

  /**
   * TODO: I'm not sure here... there might be no config in the environment. Then this function will be retried. So we probably must take this into account.
   */
  const { lastRun, agentConfig, agentRefId, session } = await prepareRunCreation(tx, environment, sessionId);
  const adapter = getAdapter(agentConfig.adapter);

  /**
   * Find channel thread id for the session
   */
  const channelThreadId = (await tx.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    columns: {
      channelThreadId: true,
    },
  }))?.channelThreadId;

  if (typeof channelThreadId !== 'string') {
    throw new AgentViewError("Session has no channel thread.", 422);
  }

  // we take either incoming messages without run_id or messages from the last run that was failed/cancelled/discarded (not completed)
  const incomingMessages = await tx.query.channelMessages.findMany({
    where: and(
      eq(channelMessages.channelThreadId, channelThreadId),
      or(
        isNull(channelMessages.runId),
        (lastRun && lastRun.status !== 'completed') ? eq(channelMessages.runId, lastRun.id) : undefined,
      )
    ),
    orderBy: (cm, { asc }) => [asc(cm.date)],
  });

  if (incomingMessages.length === 0) {
    throw new AgentViewError("No incoming messages to create a run from.", 422);
  }

  log.info({ sessionId, count: incomingMessages.length }, 'incoming messages found');


  /**
   * Let's create a new run
   */
  const newRunId = crypto.randomUUID();
  const input = adapter.createDefaultInputForChannelMessages(incomingMessages, newRunId);

  log.debug({ sessionId, input }, 'channel run input');

  const { runConfig, parsedInput, idleTimeout } = await processInput(agentConfig, input);

  // session version might be totally not set yet
  if (!session.agentRef) {
    await tx.update(sessions).set({
      agentRefId,
    }).where(eq(sessions.id, sessionId));
  }

  await createRunCore(tx, environment, sessionId, {
    id: newRunId,
    parsedInput,
    parsedNonInputItems: [],
    status: 'pending',
    failReason: null,
    expiresAt: new Date(Date.now() + idleTimeout).toISOString(),
    finishedAt: null,
    metadata: undefined,
    agentRefId,
    manual: false,
    state: undefined,
    runConfig,
    lastRun,
  });

  await tx.update(channelMessages).set({
    runId: newRunId,
    updatedAt: new Date().toISOString(),
  }).where(inArray(channelMessages.id, incomingMessages.map(m => m.id)));
}






export async function createAutoRun2(
  principal: Principal,
  sessionId: string,
  input_?: Record<string, any>,
  signal?: AbortSignal
): Promise<{ runId: string, response: Response, success: boolean }> {

  log.debug(`[${sessionId}] [createAutoRun2] start`);

  // 1. Prepare run creation (authorization, validation, etc)
  const { runId, standardSession, runConfig, agentUrl } = await withTenant(principal, async (tx) => {
    await tx.acquireLock({ type: "edit_session", sessionId });

    const session = await requireSessionBase(tx, sessionId);
    authorize(tx.principal, { action: "end-user:update", user: session.user });
  
    const environment = await requireEnvironment(tx);
  
    const { lastRun, agentConfig, agentRefId } = await prepareRunCreation(tx, environment, sessionId);
    
    const newRunId = crypto.randomUUID();

    /**
     * PROCESS INPUT
     * - differently for API and non-API channels
     */
    const { input, consumedChannelMessageIds } = await (async () => {
      // normal input from API
      if (input_ && session.channel.type === 'api') {
        return { input: input_, consumedChannelMessageIds: [] as string[] }
      }
      // input from non-api channel -> based on channel messags
      else if (!input_ && session.channel.type !== 'api') {

        const channelThreadId = (await tx.query.sessions.findFirst({
          where: eq(sessions.id, sessionId),
          columns: {
            channelThreadId: true,
          },
        }))?.channelThreadId;

        if (typeof channelThreadId !== 'string') {
          throw new AgentViewError("Session has no channel thread.", 422);
        }

        // we take either incoming messages without run_id or messages from the last run that was failed/cancelled/discarded (not completed)
        const incomingMessages = await tx.query.channelMessages.findMany({
          where: and(
            eq(channelMessages.channelThreadId, channelThreadId),
            or(
              isNull(channelMessages.runId),
              (lastRun && lastRun.status !== 'completed') ? eq(channelMessages.runId, lastRun.id) : undefined,
            )
          ),
          orderBy: (cm, { asc }) => [asc(cm.date)],
        });

        if (incomingMessages.length === 0) {
          throw new AgentViewError("No incoming messages to create a run from.", 422);
        }

        log.info({ sessionId, count: incomingMessages.length }, 'incoming messages found');

        /**
         * Let's create a new run
         */
        const adapter = getAdapter(agentConfig.adapter);
        return {
          input: adapter.createDefaultInputForChannelMessages(incomingMessages, newRunId),
          consumedChannelMessageIds: incomingMessages.map(m => m.id),
        }
      }
      else {
        throw new AgentViewError("createAutoRun can be called only with input for api channels, or without input for non-api channels.", 500);
      }
    })();


    const { runConfig, parsedInput, idleTimeout } = await processInput(agentConfig, input);
  
    const run = await createRunCore(tx, environment, sessionId, {
      id: newRunId,
      parsedInput,
      parsedNonInputItems: [],
      status: 'in_progress',
      failReason: null,
      expiresAt: new Date(Date.now() + idleTimeout).toISOString(),
      finishedAt: null,
      metadata: undefined,
      agentRefId,
      manual: false,
      state: undefined,
      runConfig,
      lastRun,
    });

    if (consumedChannelMessageIds.length > 0) {
      await tx.update(channelMessages).set({
        runId: newRunId,
        updatedAt: new Date().toISOString(),
      }).where(inArray(channelMessages.id, consumedChannelMessageIds));
    }

    const agentUrl = agentConfig.url;
    if (!agentUrl) {
      throw new AgentViewError("Agent URL not provided", 400);
    }

    const standardSession = await requireSession(tx, sessionId);
    return { runId: run.id, standardSession, runConfig, agentUrl }
  });

  const session = standardToDefaultSession(standardSession);
  const messages = session.messages;

  // 2. Make live connection to the streaming server, wait for response to know if we should discard or accept the run.
  log.debug(`[${sessionId}] [createAutoRun2] establishing live connection...`);

  try {
    const response = await fetch('http://localhost:1999/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: { messages, session },
        agentUrl,
        runConfig: serializeRunConfig(runConfig),
        runId,
        sessionId,
        organizationId: principal.organizationId,
      }),
      signal,
    });

    // fetch() responses have immutable headers; Hono needs mutable headers to finalize the response, so we create a copy.
    const responseCopy = new Response(response.body, {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
    });

    // Response came but it's error.
    if (!response.ok) {
      log.debug(`[${sessionId}] [createAutoRun2] error response from AI Endpoint`);

      // Discard run and return
      await withTenant(principal, async (tx) => {
        await terminateRun(tx, sessionId, runId, {
          status: 'discarded',
          failReason: {
            message: "Error response from AI Endpoint"
          },
        });
      });

      return { response: responseCopy, runId, success: false };
    }

    // Stream established.
    log.debug(`[${sessionId}] [createAutoRun2] stream established`);

    // await withTenant(principal, async (tx) => {
    //   await tx.acquireLock({ type: "create_resource" }); // handles!
    //   await tx.acquireLock({ type: "edit_session", sessionId: session.id });

    //   // await acceptRun(tx, sessionId, runId);
    //   await activateSession(tx, sessionId);
    // });

    // log.debug(`[${sessionId}] [createAutoRun2] run activated`);

    return { response: responseCopy, runId, success: true }

  } catch (err) {
    log.debug({ err }, `[${sessionId}] [createAutoRun2] error`);
    
    const message = 'Failed to establish connection to the streaming server'

    // best effort termination
    await withTenant(principal, async (tx) => {
      await terminateRun(tx, sessionId, runId, {
        status: 'discarded',
        failReason: {
          message
        },
      });
    });

    throw new AgentViewError(message, 500);
  }

}











// export async function createAutoRun(
//   tx: TenantTransaction,
//   sessionId: string,
//   body: { input: Record<string, any> }
// ) {
//   await tx.acquireLock({ type: "edit_session", sessionId });

//   const session = await requireSessionBase(tx, sessionId);
//   authorize(tx.principal, { action: "end-user:update", user: session.user });

//   const environment = await requireEnvironment(tx);

//   const { lastRun, agentConfig, agentRefId } = await prepareRunCreation(tx, environment, sessionId);
//   const { runConfig, parsedInput, idleTimeout } = await processInput(agentConfig, body.input);

//   const run = await createRunCore(tx, environment, sessionId, {
//     parsedInput,
//     parsedNonInputItems: [],
//     // status: 'pending',
//     status: 'in_progress',
//     failReason: null,
//     expiresAt: new Date(Date.now() + idleTimeout).toISOString(),
//     finishedAt: null,
//     metadata: undefined,
//     agentRefId,
//     manual: false,
//     state: undefined,
//     runConfig,
//     lastRun,
//   });

//   return { run, runConfig, agentConfig }
// }



/**
 * Manual run creation. Used by POST /api/sessions/{id}/runs/manual.
 * Full control: items, status, state, failReason, metadata.
 * API channels only.
 */
export async function createManualRun(
  tx: TenantTransaction,
  sessionId: string,
  body: ManualRunCreate
): Promise<typeof runs.$inferSelect> {
  await tx.acquireLock({ type: "edit_session", sessionId });

  const sessionBase = await fetchSessionBase(tx, sessionId); // todo: optimize
  if (!sessionBase) {
    throw new AgentViewError("Session not found.", 404);
  }

  authorize(tx.principal, { action: "end-user:update", user: sessionBase.user });

  if (sessionBase.channel.type !== 'api') {
    throw new AgentViewError("For non-api channels manual mode is not supported.", 422);
  }

  if (!body.items || body.items.length === 0) {
    throw new AgentViewError("Items are required for manual runs.", 422);
  }

  const inputItem = body.items[0];
  const nonInputItems = body.items.slice(1);

  const environment = await requireEnvironment(tx);

  const { lastRun, agentConfig, agentRefId } = await prepareRunCreation(tx, environment, sessionId);
  const { runConfig, parsedInput, idleTimeout } = await processInput(agentConfig, inputItem);


  // Process non-input items, metadata etc
  const parsedNonInputItems = validateItems(runConfig, [parsedInput], nonInputItems);

  const metadata = parseMetadata(runConfig.metadata, runConfig.allowUnknownMetadata ?? true, body.metadata ?? {}, {});

  const status = body.status ?? 'in_progress';
  const failReason = body.failReason ?? null;

  if (failReason && status !== 'failed') {
    throw new AgentViewError("failReason can only be set when status is 'failed'.", 422);
  }

  const isFinished = status === 'completed' || status === 'cancelled' || status === 'failed';
  const finishedAt = isFinished ? new Date().toISOString() : null;
  const expiresAt = isFinished ? null : new Date(Date.now() + idleTimeout).toISOString();

  return await createRunCore(tx, environment, sessionId, {
    parsedInput,
    parsedNonInputItems,
    status,
    failReason,
    expiresAt,
    finishedAt,
    metadata,
    agentRefId,
    manual: true,
    state: body.state,
    runConfig,
    lastRun,
  });
}
