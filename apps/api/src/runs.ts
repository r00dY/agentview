import { eq, and, desc, not, inArray } from 'drizzle-orm';
import { runs, sessionItems, webhookJobs } from './schemas/schema';
import type { Transaction } from './types';
import type { Environment, Run, RunCreate, RunUpdate, Session } from 'agentview/apiTypes';
import type { BaseAgentConfig, BaseRunConfig } from 'agentview/configTypes';
import { requireRunConfig, findItemConfig, findChannelConfig, requireAgentConfig } from 'agentview/configUtils';
import { AgentViewError } from 'agentview/AgentViewError';
import { parseMetadata } from './parseMetadata';
import { resolveAgentRef } from './agentRefs';
import { getLastRun } from 'agentview/sessionUtils';
import { fetchSession } from './sessions';
import { getConfigFromEnvironment } from './environments';

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
  environment: Environment,
  body: RunUpdate
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

  const isFinished = status === 'completed' || status === 'failed' || status === 'cancelled';
  const finishedAt = run.finishedAt ?? (isFinished ? new Date().toISOString() : null);

  let expiresAt: string | null = null;
  if (!isFinished) {
    if (!idleTimeout) { // if not finished, then idleTimeout must be set
      throw new AgentViewError("idleTimeout must be set when run is not finished.", 422);
    }
    expiresAt = new Date(Date.now() + idleTimeout).toISOString();
  }


  // if (!idleTimeout)
  // console.assert(!isFinished && idleTimeout !== undefined, "idleTimeout must be set when run is not finished");

  // const expiresAt = isFinished ? null : new Date(Date.now() + idleTimeout).toISOString();

  if (parsedItems.length > 0) {
    await tx.insert(sessionItems).values(
      parsedItems.map(item => ({
        organizationId: run.organizationId,
        sessionId: run.sessionId,
        content: item,
        runId: run.id,
        type: 'step' as const,
      }))
    );
  }

  await tx.update(runs).set({
    status,
    metadata,
    failReason,
    finishedAt,
    expiresAt,
    updatedAt: new Date().toISOString(),
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

  return (await getRun(tx, runId))!;
}

/**
 * Core run-creation logic shared between the POST /runs handler and internal callers (e.g. channel-messages worker).
 * Validates items, resolves versions, inserts run + session items.
 */
export async function createRun(
  tx: Transaction,
  organizationId: string,
  environment: Environment,
  body: RunCreate
): Promise<typeof runs.$inferSelect> {
  const session = await fetchSession(tx, body.sessionId);
  if (!session) {
    throw new AgentViewError("Session not found.", 404);
  }

  const lastRun = getLastRun(session);
  const config = getConfigFromEnvironment(environment);
  const manual = body.manual ?? false;

  const channelConfig = findChannelConfig(config, session.channel);
  const agentConfig = config.agents?.find(a => a.name === channelConfig?.agent);

  /** Only one in_progress run is allowed per session **/
  if (lastRun?.status === 'in_progress') {
    throw new AgentViewError(`Can't create a run because session has already a run in progress.`, 422);
  }

  // if (session.channel.type !== 'api' && manual) {
  //   throw new AgentViewError("For non-api channels manual mode is not supported.", 422);
  // }

  // // // Normalize: body.input (channel path) vs body.items (API path)
  // // const inputItems = body.input ?? (body.items ? [body.items[0]] : []);
  // // const nonInputItems = body.input ? [] : (body.items ? body.items.slice(1) : []);

  // // if (inputItems.length === 0) {
  // //   throw new AgentViewError("New run must have at least 1 input item.", 422);
  // // }

  /** Auto-fetch validation **/
  if (!manual) {
    if (session.channel.type !== 'api' && body.items) {
      throw new AgentViewError("Items cannot be set for non-api channels.", 422);
    }

    if (session.channel.type === 'api' && body.items && body.items.length !== 1) {
      throw new AgentViewError("Run must have exactly 1 item (input).", 422);
    }

    if (body.status && body.status !== 'in_progress') {
      throw new AgentViewError("The status must be 'in_progress' (or omitted).", 422);
    }
    if (body.state !== undefined) {
      throw new AgentViewError("State cannot be set on creation.", 422);
    }
    if (body.failReason !== undefined && body.failReason !== null) {
      throw new AgentViewError("failReason cannot be set on creation.", 422);
    }
    if (body.version !== undefined) {
      throw new AgentViewError("Version cannot be set on creation (the agent endpoint provides it).", 422);
    }
  }
  else {
    if (session.channel.type !== 'api') {
      throw new AgentViewError("For non-api channels manual mode is not supported.", 422);
    }
  }

  let parsedInputItems: any[] = [];
  let parsedNonInputItems: any[] = [];
  let status: string;
  let failReason: any | null = null;
  let expiresAt: string | null = null;
  let finishedAt: string | null = null;
  let metadata: Record<string, any> | undefined = undefined;
  let versionId: string | null = null;
  let runConfig: BaseRunConfig | undefined;

  // for non-api channels, we assume input is OK and we use simplified procedure. Agent is not required, as we should save items even if agent is not assigned.
  if (session.channel.type !== 'api') {
    status = 'in_progress';
    expiresAt = new Date(Date.now() + DEFAULT_IDLE_TIME).toISOString();
  }
  else {
    // channel config && agent config required at this point
    if (!channelConfig) {
      throw new AgentViewError(`Channel config not found for ${JSON.stringify(session.channel)}.`, 404);
    }
    if (!agentConfig) {
      throw new AgentViewError("Agent not found in environment config.", 404);
    }

    if (manual) {
      if (!body.version) {
        throw new AgentViewError("In manual mode, version is required.", 422);
      }

      const resolved = await resolveAgentRef(tx, {
        versionString: body.version!,
        agent: agentConfig.name,
        format: agentConfig.protocol === 'ai-sdk' ? 'ai-sdk' : 'default',
        isProduction: environment.user === null,
        isDev: environment.user !== null,
        lastRunVersion: lastRun?.agentRef?.version ?? null,
        organizationId,
        sessionId: session.id,
        existingSessionVersions: (session.agentRefs as string[]) ?? [],
      });
      versionId = resolved.agentRefId;
    }

    const inputItems = body.items![0];
    const nonInputItems = body.items!.slice(1);

    runConfig = requireRunConfig(agentConfig, inputItems);
    parsedInputItems = [runConfig.input.schema.parse(inputItems)];

    /** Validate rest items **/
    parsedNonInputItems = validateItems(runConfig, [parsedInputItems], nonInputItems);

    /** Metadata **/
    metadata = parseMetadata(runConfig.metadata, runConfig.allowUnknownMetadata ?? true, body.metadata ?? {}, {});

    /** Status, finished at, failReason **/
    status = body.status ?? 'in_progress';
    failReason = body.failReason ?? null;

    if (failReason && status !== 'failed') {
      throw new AgentViewError("failReason can only be set when status is 'failed'.", 422);
    }

    const isFinished = status === 'completed' || status === 'cancelled' || status === 'failed';
    const idleTimeout = runConfig.idleTimeout ?? DEFAULT_IDLE_TIME;
    finishedAt = isFinished ? new Date().toISOString() : null;
    expiresAt = isFinished ? null : new Date(Date.now() + idleTimeout).toISOString();
  }

  // Create run and items
  const [insertedRun] = await tx.insert(runs).values({
    organizationId,
    sessionId: session.id,
    status,
    failReason,
    expiresAt,
    finishedAt,
    agentRefId: versionId,
    metadata,
    fetchStatus: manual ? null : 'pending',
    environmentId: manual ? null : environment.id,
  }).returning();

  // Insert input items with type: 'input'
  if (parsedInputItems.length > 0) {
    await tx.insert(sessionItems).values(
      parsedInputItems.map(item => ({
        organizationId,
        sessionId: session.id,
        content: item,
        runId: insertedRun.id,
        type: 'input' as const,
      }))
    );
  }

  // Insert non-input items with type: 'step'
  if (parsedNonInputItems.length > 0) {
    await tx.insert(sessionItems).values(
      parsedNonInputItems.map(item => ({
        organizationId,
        sessionId: session.id,
        content: item,
        runId: insertedRun.id,
        type: 'step' as const,
      }))
    );
  }

  // insert state item
  if (body.state !== undefined) {
    await tx.insert(sessionItems).values({
      organizationId,
      sessionId: session.id,
      content: body.state,
      runId: insertedRun.id,
      isState: true,
    });
  }

  // Mark output items if run is completed at creation
  if (status === 'completed' && runConfig) {
    await markOutputItems(tx, insertedRun.id, 1, runConfig);
  }

  // Queue webhook job on first run (for summary generation and/or webhook delivery)
  const isFirstRun = lastRun === undefined;
  if (isFirstRun) {
    if (config.webhookUrl) { // enqueue job if 
      await tx.insert(webhookJobs).values({
        organizationId,
        eventType: 'session.on_first_run_created',
        payload: { session_id: body.sessionId },
        sessionId: body.sessionId,
        status: 'pending',
        nextAttemptAt: new Date().toISOString(),
        environmentId: environment.id,
      });
    }

    if (!config.__internal?.disableSummaries) {
      await tx.insert(webhookJobs).values({
        organizationId,
        eventType: 'session.generate_summary',
        payload: { session_id: body.sessionId },
        sessionId: body.sessionId,
        status: 'pending',
        nextAttemptAt: new Date().toISOString(),
        environmentId: environment.id,
      });
    }
  }

  return insertedRun;
}
