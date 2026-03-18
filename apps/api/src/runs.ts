import { eq, and, desc, not, inArray } from 'drizzle-orm';
import { runs, sessionItems, webhookJobs } from './schemas/schema';
import type { Transaction } from './types';
import type { Environment, Run, RunCreate, ManualRunCreate, ManualRunUpdate, Session } from 'agentview/apiTypes';
import type { BaseAgentConfig, BaseRunConfig } from 'agentview/configTypes';
import { requireRunConfig, findItemConfig, findChannelConfig, requireAgentConfig, getChannelAgent } from 'agentview/configUtils';
import { AgentViewError } from 'agentview/AgentViewError';
import { parseMetadata } from './parseMetadata';
import { resolveAgentRef } from './agentRefs';
import { getLastRun } from 'agentview/sessionUtils';
import { fetchSession } from './sessions';
import { getConfigFromEnvironment } from './environments';
import { publishRunStreamEvent } from './runStream';

export const DEFAULT_IDLE_TIME = 1000 * 60; // 60 seconds

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

  // // Get the full run items for validation context
  // const runItems = await tx.query.sessionItems.findMany({
  //   where: and(
  //     eq(sessionItems.runId, runId),
  //     eq(sessionItems.isState, false),
  //   ),
  //   orderBy: (si, { asc }) => [asc(si.sortOrder)],
  // });

  // const allContents = runItems.map(i => i.content);

  for (const outputItem of outputItems) {
    const outputConfig = findItemConfig(runConfig, [], outputItem.content as Record<string, any>, [], "output");
    if (!outputConfig) {
      throw new AgentViewError("Item does not match output schema.", 422, { item: outputItem.content });
    }
  }

  // // Validate each candidate output item against the output schema
  // for (const item of allItems) {
  //   const itemIndex = runItems.findIndex(i => i.id === item.id);
  //   const itemsBefore = allContents.slice(0, itemIndex);
  //   const itemsAfter = allContents.slice(itemIndex + 1);

  //   const outputConfig = findItemConfig(runConfig, itemsBefore, item.content as Record<string, any>, itemsAfter, "output");
  //   if (!outputConfig) {
  //     throw new AgentViewError("Item does not match output schema.", 422, { item: item.content });
  //   }
  // }

  // Update their type to 'output'
  const itemIds = outputItems.map(i => i.id);
  await tx.update(sessionItems).set({
    type: 'output',
    updatedAt: new Date().toISOString(),
  }).where(inArray(sessionItems.id, itemIds));
}

export async function getRun(tx: Transaction, runId: string) {
  const run = await tx.query.runs.findFirst({
    where: eq(runs.id, runId),
    with: {
      sessionItems: {
        orderBy: (sessionItem, { asc }) => [asc(sessionItem.sortOrder)],
        where: (sessionItem, { eq }) => eq(sessionItem.isState, false),
      },
      agentRef: true,
    },
  });

  return run;
}


/**
 * Core run-update logic shared between the PATCH handler and the worker.
 * Validates items, metadata, status transitions, inserts items, and updates the run.
 */
export async function applyRunPatch(
  tx: Transaction,
  runId: string,
  environment: Environment | null,
  body: ManualRunUpdate
) {
  const run = await getRun(tx, runId);
  if (!run) {
    throw new AgentViewError("Run not found.", 404);
  }

  /** Find matching run config **/
  const inputItem = getRunInputContent(run.sessionItems);

  let parsedItems: any[] = [];
  let metadata: Record<string, any> | undefined = undefined;
  let idleTimeout: number | undefined;

  /** Reject outputItemCount if status is not being set to 'completed' */
  if (body.outputItemCount !== undefined && body.status !== 'completed') {
    throw new AgentViewError("outputItemCount can only be set when status is 'completed'.", 422);
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

    parsedItems = validateItems(runConfig, run.sessionItems.map(si => si.content), items);

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
  }

  // Publish to Redis stream
  const dataToStream = JSON.stringify({
    ...body,
    items: insertedItems,
    updatedAt: nowIso
  });

  await publishRunStreamEvent(runId, 'agentview', nowIso, dataToStream);
  if (isFinished) {
    await publishRunStreamEvent(runId, 'agentview', nowIso, '[DONE]');
  }

  return (await getRun(tx, runId))!;
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
