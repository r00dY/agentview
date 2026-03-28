import { eq, and, desc, not, inArray, asc, sql } from 'drizzle-orm';
import { runs, sessionItems, sessions, webhookJobs, channelMessages, agentRefs } from './schemas/schema';
import type { Transaction } from './types';
import type { Environment, ManualRunCreate, ManualRunUpdate, Run } from 'agentview/apiTypes';
import type { BaseAgentConfig, BaseRunConfig } from 'agentview/baseConfigTypes';
import { requireRunConfig, findItemConfig, findChannelConfig, requireAgentConfig, getChannelAgent, requireChannelConfig } from 'agentview/baseConfigUtils';
import { AgentViewError, type AgentViewRunTerminationBody } from 'agentview/AgentViewError';
import { parseMetadata } from './parseMetadata';
import { resolveAgentRef } from './agentRefs';
import { getLastRun } from 'agentview/sessionUtils';
import { fetchSession, fetchSessionBase } from './sessions';
import { getConfigFromEnvironment } from './environments';
import { publishRunStreamEvent } from './runStream';
import { withOrg, type OrgTransaction } from './withOrg';
import { getAdapter } from './adapters/adapters';

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

export async function handleChannelReply(
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
    throw new AgentViewError("Unexpected error", 500);
  }

  if (sessionRow.channelThreadId && channelReply) {
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
  else if (!sessionRow.channelThreadId && channelReply) {
    throw new AgentViewError("You can't set channel reply for a session that doesn't have a channel thread.", 400);
  }
  else if (sessionRow.channelThreadId && !channelReply) {
    throw new AgentViewError("No channel reply for a session that has a channel thread.", 400);
  }
  else if (!sessionRow.channelThreadId && !channelReply) {
    // no-op
  }
}


/**
 * Marks the last N non-input, non-state items as 'output' on run completion.
 * Validates each item against the output schema before marking.
 */
export async function markOutputItems(
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

/**
 * IMPORTANT:
 * 
 * Most modifications of a run, especially run patch or terminate can be concurrent. Apply patch logic takes non-obvious amount of time to complete, so we must start with a lock for safety of concurrent writes.
 * That's why we use SELECT FOR UPDATE here on row and this function should be always called with a lock.
 */
export async function getRunBaseWithLock(tx: Transaction, runId: string) {
  // Build the run query — use select() API so we can append FOR UPDATE.

  const runRows = await tx
    .select()
    .from(runs)
    .leftJoin(agentRefs, eq(runs.agentRefId, agentRefs.id))
    .where(eq(runs.id, runId))
    .limit(1)
    .for('update', { of: runs });

  const row = runRows[0];
  if (!row) return undefined;

  return {
    ...row.runs,
    agentRef: row.agent_refs,
  };
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
 * Core run-update logic shared between the PATCH handler and the worker.
 * Validates items, metadata, status transitions, inserts items, and updates the run.
 */
export async function applyRunPatch(
  tx: OrgTransaction,
  runId: string,
  environment: Environment | null,
  body: ManualRunUpdate
) {
    const run = await getRunBaseWithLock(tx, runId); // we must start with a lock for safety of concurrent writes!

    if (!run) {
      throw new AgentViewError("Run not found.", 404);
    }

    if (run.status === 'pending' || run.status === 'init') {
      throw new AgentViewError("You can't run apply patch on run in 'init' or 'pending' status.", 422);
    }

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
      if (!environment) {
        throw new AgentViewError("Environment is required for this operation.", 422);
      }
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
        throw new AgentViewError("Cannot add items to a finished run.", 422, {
          code: "run.finished",
          status: run.status as "cancelled" | "failed" | "discarded",
          failReason: run.failReason
        });
      }

      const sessionItems = await getRunSessionItems(tx, runId);

      parsedItems = validateItems(runConfig, sessionItems.map(si => si.content), items);

      /** State */
      if (isRunFinished(run) && body.state !== undefined) {
        throw new AgentViewError("Cannot set state to a finished run.", 422, {
          code: "run.finished",
          status: run.status as "cancelled" | "failed" | "discarded",
          failReason: run.failReason
        });
      }

      /** Metadata **/
      metadata = parseMetadata(runConfig.metadata, runConfig.allowUnknownMetadata ?? true, body.metadata ?? {}, run.metadata ?? {});

      idleTimeout = runConfig.idleTimeout ?? DEFAULT_IDLE_TIME;
    }

    /** Status, finished at, failReason */
    if (isRunFinished(run) && body.status && body.status !== run.status) {
      throw new AgentViewError("Cannot change the status of a finished run.", 422, {
        code: "run.finished",
        status: run.status as "cancelled" | "failed" | "discarded",
        failReason: run.failReason
      });
    }

    const status = body.status ?? 'in_progress';
    const failReason = body.failReason ?? null;

    if (failReason) {
      if (isRunFinished(run)) {
        throw new AgentViewError("failReason cannot be set for a finished run.", 422, {
          code: "run.finished",
          status: run.status as "cancelled" | "failed" | "discarded",
          failReason: run.failReason
        });
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

    await tx.update(runs).set({
      status,
      metadata,
      failReason,
      finishedAt,
      expiresAt,
      updatedAt: nowIso,
    }).where(eq(runs.id, run.id));

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

  //   return { insertedItems, nowIso, isFinished, run };
  // });

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
}

/**
 * Simplified run termination that doesn't reply on applyRunPatch logic.
 * apply patch logic is that it comes from "external source", like agent call or manual run patch.
 * when run is finished with apply patch it's essentially "correct" system state that doesn't need anything extra.
 * however, sometimes we need to terminate run where:
 * - it must be 100% certain that run is terminated, must be simplified
 * - it should be able to notify agent API call to abort.
 * 
 * If termination was done by apply patch:
 * - there's risk we introduce a bug which incorrectly terminates run.
 * - when we listened to [done] event on redis streams in agent API call, even if integration called apply patch with "complete" / "failed" correctly. In that case we should not abort agent API call. That's why termination is different "path" in our system.
 */
export async function terminateRun(tx: OrgTransaction, runId: string, body: AgentViewRunTerminationBody) {
  const runBase = await getRunBaseWithLock(tx, runId); // we must start with a lock for safety of concurrent writes!
  
  if (!runBase) {
    throw new AgentViewError("Can't find run to terminate.", 404);
  }
  if (runBase.status === 'failed' || runBase.status === 'cancelled' || runBase.status === 'completed' || runBase.status === 'discarded') {
    console.log(`[terminateRun][${runId}] attempted, not needed`);
    return; // indempotency
  }

  // logs
  if (body.status === 'discarded') {
    console.log(`[terminateRun][${runId}] discarded -> ${body.failReason.message ?? "no reason"}`);
  }
  else if (body.status === 'failed') {
    console.log(`[terminateRun][${runId}] failed -> ${body.failReason.message ?? "no reason"}`);
  }
  else if (body.status === 'cancelled') {
    console.log(`[terminateRun][${runId}] cancelled`);
  }

  const nowIso = new Date().toISOString();

  await tx.update(runs).set({
    ...body,
    finishedAt: nowIso,
    updatedAt: nowIso,
    expiresAt: null,
  }).where(eq(runs.id, runId));

  tx.afterCommit(async () => {
    await publishRunStreamEvent(runId, nowIso, JSON.stringify({ // this is important, we must send the last run patch event to the stream
      ...body,
      updatedAt: nowIso,
    }));
    await publishRunStreamEvent(runId, null, '[TERMINATED]' + JSON.stringify(body));
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

  return insertedRun;
}




/**
 * Prepares a session for run creation: fetches session, checks no in-progress run, finds config.
 */
async function prepareRunCreation(tx: OrgTransaction, environment: Environment, sessionId: string) {
  const session = await fetchSession(tx, sessionId); // todo: optimize
  if (!session) {
    throw new AgentViewError("Session not found.", 404);
  }

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


export async function createAutoRunFromChannelMessages(
  tx: OrgTransaction,
  environment: Environment,
  sessionId: string,
  incomingMessages: any[],
) {
  if (incomingMessages.length === 0) {
    throw new AgentViewError("No incoming messages to create a run from.", 422);
  }

  const { lastRun, agentConfig, agentRefId, session } = await prepareRunCreation(tx, environment, sessionId);
  const adapter = getAdapter(agentConfig.adapter);

  const newRunId = crypto.randomUUID();
  const input = adapter.createDefaultInputForChannelMessages(incomingMessages, newRunId);
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



export async function createAutoRun(
  tx: OrgTransaction,
  environment: Environment,
  sessionId: string,
  body: { input: Record<string, any> }
): Promise<typeof runs.$inferSelect> {
  const { lastRun, agentConfig, agentRefId } = await prepareRunCreation(tx, environment, sessionId);
  const { runConfig, parsedInput, idleTimeout } = await processInput(agentConfig, body.input);

  return await createRunCore(tx, environment, sessionId, {
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
}

/**
 * Manual run creation. Used by POST /api/sessions/{id}/runs/manual.
 * Full control: items, status, state, failReason, metadata.
 * API channels only.
 */
export async function createManualRun(
  tx: OrgTransaction,
  environment: Environment,
  sessionId: string,
  body: ManualRunCreate
): Promise<typeof runs.$inferSelect> {
  const sessionBase = await fetchSessionBase(tx, sessionId); // todo: optimize
  if (!sessionBase) {
    throw new AgentViewError("Session not found.", 404);
  }

  if (sessionBase.channel.type !== 'api') {
    throw new AgentViewError("For non-api channels manual mode is not supported.", 422);
  }

  if (!body.items || body.items.length === 0) {
    throw new AgentViewError("Items are required for manual runs.", 422);
  }

  const inputItem = body.items[0];
  const nonInputItems = body.items.slice(1);

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
