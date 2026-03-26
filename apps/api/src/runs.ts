import { eq, and, desc, not, inArray, asc, sql } from 'drizzle-orm';
import { runs, sessionItems, sessions, webhookJobs, channelMessages, agentRefs } from './schemas/schema';
import type { RunTerminationBody, Transaction } from './types';
import type { Environment, ManualRunCreate, ManualRunUpdate, Run } from 'agentview/apiTypes';
import type { BaseRunConfig } from 'agentview/baseConfigTypes';
import { requireRunConfig, findItemConfig, findChannelConfig, requireAgentConfig, getChannelAgent } from 'agentview/baseConfigUtils';
import { AgentViewError } from 'agentview/AgentViewError';
import { parseMetadata } from './parseMetadata';
import { resolveAgentRef } from './agentRefs';
import { getLastRun } from 'agentview/sessionUtils';
import { fetchSession } from './sessions';
import { getConfigFromEnvironment } from './environments';
import { publishRunStreamEvent } from './runStream';
import { withOrg, type OrgTransaction } from './withOrg';

export const DEFAULT_IDLE_TIME = 1000 * 5;//60; // 60 seconds

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

      if (items.length > 0 && run.status !== 'in_progress') {
        throw new AgentViewError("Cannot add items to a finished run.", 422);
      }

      const sessionItems = await getRunSessionItems(tx, runId);

      parsedItems = validateItems(runConfig, sessionItems.map(si => si.content), items);

      /** State */
      if (body.state !== undefined && run.status !== 'in_progress') {
        throw new AgentViewError("Cannot set state to a finished run.", 422);
      }

      /** Metadata **/
      metadata = parseMetadata(runConfig.metadata, runConfig.allowUnknownMetadata ?? true, body.metadata ?? {}, run.metadata ?? {});

      idleTimeout = runConfig.idleTimeout ?? DEFAULT_IDLE_TIME;
    }

    /** Status, finished at, failReason */
    if (run.status !== 'in_progress' && body.status && body.status !== run.status) {
      throw new AgentViewError("Cannot change the status of a finished run.", 422);
    }

    const status = body.status ?? 'in_progress';
    const failReason = body.failReason ?? null;

    if (failReason) {
      if (run.status !== 'in_progress') {
        throw new AgentViewError("failReason cannot be set for a finished run.", 422);
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
export async function terminateRun(tx: OrgTransaction, runId: string, body: RunTerminationBody) {
  console.log(`[terminateRun][${runId}] trying to terminate run (${body.status}${body.status === 'failed' ? ` -> ${body.failReason.message ?? "No fail reason"}` : ''})`);
  const runBase = await getRunBaseWithLock(tx, runId); // we must start with a lock for safety of concurrent writes!
  
  if (!runBase) {
    throw new AgentViewError("Can't find run to terminate.", 404);
  }
  if (runBase.status !== 'in_progress') {
    console.log(`[terminateRun][${runId}] already finished`);
    return; // indempotency
    // throw new AgentViewError("Cannot terminate a run that is not in progress.", 422);
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
  tx: Transaction,
  organizationId: string,
  environment: Environment,
  sessionId: string,
  params: {
    parsedInputItems: any[];
    parsedNonInputItems: any[];
    status: string;
    failReason: any | null;
    expiresAt: string | null;
    finishedAt: string | null;
    metadata: Record<string, any> | undefined;
    agentRefId: string | null;
    fetchStatus: 'pending' | null;
    state: any | undefined;
    runConfig: BaseRunConfig | undefined;
    lastRun: ReturnType<typeof getLastRun>;
  }
): Promise<typeof runs.$inferSelect> {
  const { parsedInputItems, parsedNonInputItems, status, failReason, expiresAt, finishedAt, metadata, agentRefId, fetchStatus, state, runConfig, lastRun } = params;

  const [insertedRun] = await tx.insert(runs).values({
    organizationId,
    sessionId,
    status,
    failReason,
    expiresAt,
    finishedAt,
    agentRefId,
    metadata,
    fetchStatus,
    environmentId: fetchStatus === 'pending' ? environment.id : null,
  }).returning();

  if (parsedInputItems.length > 0) {
    await tx.insert(sessionItems).values(
      parsedInputItems.map(item => ({
        organizationId,
        sessionId,
        content: item,
        runId: insertedRun.id,
        type: 'input' as const,
      }))
    );
  }

  if (parsedNonInputItems.length > 0) {
    await tx.insert(sessionItems).values(
      parsedNonInputItems.map(item => ({
        organizationId,
        sessionId,
        content: item,
        runId: insertedRun.id,
        type: 'step' as const,
      }))
    );
  }

  if (state !== undefined) {
    await tx.insert(sessionItems).values({
      organizationId,
      sessionId,
      content: state,
      runId: insertedRun.id,
      isState: true,
    });
  }

  if (status === 'completed' && runConfig) {
    await markOutputItems(tx, insertedRun.id, 1, runConfig);
  }

  // Queue webhook job on first run
  const config = getConfigFromEnvironment(environment);
  const isFirstRun = lastRun === undefined;
  if (isFirstRun) {
    if (config.webhookUrl) {
      await tx.insert(webhookJobs).values({
        organizationId,
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
        organizationId,
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
async function prepareRunCreation(tx: Transaction, organizationId: string, environment: Environment, sessionId: string) {
  const session = await fetchSession(tx, sessionId);
  if (!session) {
    throw new AgentViewError("Session not found.", 404);
  }

  const lastRun = getLastRun(session);
  if (lastRun?.status === 'in_progress') {
    throw new AgentViewError(`Can't create a run because session has already a run in progress.`, 422);
  }

  const config = getConfigFromEnvironment(environment);
  const channelConfig = findChannelConfig(config, session.channel);
  const channelAgent = channelConfig ? getChannelAgent(channelConfig) : undefined;
  const agentConfig = config.agents?.find(a => a.name === channelAgent?.name);

  return { session, lastRun, config, channelConfig, channelAgent, agentConfig };
}

/**
 * Auto-fetch run creation. Used by POST /api/sessions/{id}/runs and channel message workers.
 * For API channels: validates a single input item, sets fetchStatus='pending'.
 * For non-API channels: no input needed (channel messages serve as input).
 */
export async function createAutoRun(
  tx: Transaction,
  organizationId: string,
  environment: Environment,
  sessionId: string,
  body: { input?: Record<string, any> }
): Promise<typeof runs.$inferSelect> {
  const { session, lastRun, channelConfig, agentConfig } = await prepareRunCreation(tx, organizationId, environment, sessionId);

  let parsedInputItems: any[] = [];
  let runConfig: BaseRunConfig | undefined;
  let agentRefId: string | null = null;

  if (session.channel.type !== 'api') {
    // Non-API channels: simplified procedure, no input validation
  }
  else {
    if (!channelConfig) {
      throw new AgentViewError(`Channel config not found for ${JSON.stringify(session.channel)}.`, 404);
    }
    if (!agentConfig) {
      throw new AgentViewError("Agent not found in environment config.", 404);
    }

    if (!body.input) {
      throw new AgentViewError("Input is required for API channel runs.", 422);
    }

    const result = await resolveAgentRef(tx, {
      agentRef: { version: agentConfig.version, agent: agentConfig.name, adapter: agentConfig.adapter },
      previousAgentRef: lastRun?.agentRef ?? session.agentRef,
      organizationId,
      sessionId: session.id,
    });

    agentRefId = result.agentRefId;
    runConfig = requireRunConfig(agentConfig, body.input);
    parsedInputItems = [runConfig.input.schema.parse(body.input)];
  }

  const idleTimeout = runConfig?.idleTimeout ?? DEFAULT_IDLE_TIME;

  return createRunCore(tx, organizationId, environment, sessionId, {
    parsedInputItems,
    parsedNonInputItems: [],
    status: 'in_progress',
    failReason: null,
    expiresAt: new Date(Date.now() + idleTimeout).toISOString(),
    finishedAt: null,
    metadata: undefined,
    agentRefId,
    fetchStatus: 'pending',
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
  tx: Transaction,
  organizationId: string,
  environment: Environment,
  sessionId: string,
  body: ManualRunCreate
): Promise<typeof runs.$inferSelect> {
  const { session, lastRun, channelConfig, agentConfig } = await prepareRunCreation(tx, organizationId, environment, sessionId);

  if (session.channel.type !== 'api') {
    throw new AgentViewError("For non-api channels manual mode is not supported.", 422);
  }
  if (!channelConfig) {
    throw new AgentViewError(`Channel config not found for ${JSON.stringify(session.channel)}.`, 404);
  }
  if (!agentConfig) {
    throw new AgentViewError("Agent not found in environment config.", 404);
  }
  if (!body.items || body.items.length === 0) {
    throw new AgentViewError("Items are required for manual runs.", 422);
  }

  const resolved = await resolveAgentRef(tx, {
    agentRef: { version: agentConfig.version, agent: agentConfig.name, adapter: agentConfig.adapter },
    previousAgentRef: lastRun?.agentRef ?? session.agentRef,
    organizationId,
    sessionId: session.id,
  });

  const inputItem = body.items[0];
  const nonInputItems = body.items.slice(1);

  const runConfig = requireRunConfig(agentConfig, inputItem);
  const parsedInputItems = [runConfig.input.schema.parse(inputItem)];
  const parsedNonInputItems = validateItems(runConfig, [parsedInputItems], nonInputItems);

  const metadata = parseMetadata(runConfig.metadata, runConfig.allowUnknownMetadata ?? true, body.metadata ?? {}, {});

  const status = body.status ?? 'in_progress';
  const failReason = body.failReason ?? null;

  if (failReason && status !== 'failed') {
    throw new AgentViewError("failReason can only be set when status is 'failed'.", 422);
  }

  const isFinished = status === 'completed' || status === 'cancelled' || status === 'failed';
  const idleTimeout = runConfig.idleTimeout ?? DEFAULT_IDLE_TIME;
  const finishedAt = isFinished ? new Date().toISOString() : null;
  const expiresAt = isFinished ? null : new Date(Date.now() + idleTimeout).toISOString();

  return createRunCore(tx, organizationId, environment, sessionId, {
    parsedInputItems,
    parsedNonInputItems,
    status,
    failReason,
    expiresAt,
    finishedAt,
    metadata,
    agentRefId: resolved.agentRefId,
    fetchStatus: null,
    state: body.state,
    runConfig,
    lastRun,
  });
}
