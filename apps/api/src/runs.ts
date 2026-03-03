import { eq } from 'drizzle-orm';
import { runs, sessionItems, webhookJobs } from './schemas/schema';
import type { Transaction } from './types';
import type { Environment, Run, RunCreate, RunUpdate, Session } from 'agentview/apiTypes';
import type { BaseAgentConfig, BaseRunConfig } from 'agentview/configTypes';
import { requireRunConfig, findItemConfig, findChannelConfig, requireAgentConfig } from 'agentview/configUtils';
import { AgentViewError } from 'agentview/AgentViewError';
import { parseMetadata } from './parseMetadata';
import { resolveVersion } from './versions';
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

export function validateNonInputItems(runConfig: BaseRunConfig, previousRunItems: any[], items: any[], status: 'in_progress' | 'completed' | 'cancelled' | 'failed') {
  const validateSteps = runConfig.validateSteps ?? false;

  const parsedItems: any[] = [];

  const validateStepItems = (stepItems: any[]) => {
    for (const stepItem of stepItems) {
      const stepItemConfig = findItemConfig(runConfig, [...previousRunItems, ...parsedItems], stepItem, [], "step");
      if (stepItemConfig) {
        parsedItems.push(stepItemConfig.content);
      }
      else if (!validateSteps) {
        parsedItems.push(stepItem);
      }
      else {
        throw new AgentViewError("Couldn't find a matching step item.", 422, { item: stepItem });
      }
    }
  }

  if (status === "completed") { // last item must exist and must be output
    if (items.length === 0) {
      if (previousRunItems.length <= 1) {
        throw new AgentViewError("Run set as 'completed' must have at least 2 items, input and output.", 422);
      }

      // when completing run without items, we only validate the last item against output schema
      const lastItemOutputConfig = findItemConfig(runConfig, previousRunItems.slice(0, -1), previousRunItems[previousRunItems.length - 1], [], "output");

      if (!lastItemOutputConfig) {
        throw new AgentViewError("Last item must be an output.", 422, { item: previousRunItems[previousRunItems.length - 1] });
      }
    }
    else {

      const outputItem = items[items.length - 1];

      validateStepItems(items.slice(0, -1));

      const outputItemConfig = findItemConfig(runConfig, [...previousRunItems, ...parsedItems], outputItem, [], "output");
      if (!outputItemConfig) {
        throw new AgentViewError("Couldn't find a matching output item.", 422, { item: outputItem });
      }
      else {
        parsedItems.push(outputItemConfig.content);
      }
    }

  }
  else if (status === "failed" || status === "cancelled") { // last item, if exists, should be either step or output
    if (items.length === 0) {
      validateStepItems(items);
    }
    else {
      const lastItem = items[items.length - 1];
      validateStepItems(items.slice(0, -1));

      // last item must be either step or output. We first try to match step, if not successful then output
      const lastItemStepConfig = findItemConfig(runConfig, [...previousRunItems, ...parsedItems], lastItem, [], "step");
      const lastItemOutputConfig = findItemConfig(runConfig, [...previousRunItems, ...parsedItems], lastItem, [], "output");

      if (lastItemStepConfig) {
        parsedItems.push(lastItemStepConfig.content);
      }
      else if (lastItemOutputConfig) {
        parsedItems.push(lastItemOutputConfig.content);
      }
      else if (!validateSteps) {
        // we don't validate steps, so if no match, then we assume it's unknown step
        parsedItems.push(lastItem);
      }
      else {
        throw new AgentViewError("Last item must be either step or output.", 422, { item: lastItem });
      }
    }
  }
  else if (status === "in_progress") {
    validateStepItems(items);
  }

  return parsedItems;
}

export async function getRun(tx: Transaction, runId: string) {
  const run = await tx.query.runs.findFirst({
    where: eq(runs.id, runId),
    with: {
      sessionItems: {
        orderBy: (sessionItem, { asc }) => [asc(sessionItem.sortOrder)],
        where: (sessionItem, { eq }) => eq(sessionItem.isState, false),
      },
      version: true,
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

  if (body.items || body.metadata || body.state) { // operations requireing run config
    const config = getConfigFromEnvironment(environment);

    const agentName = run.version?.agent;
    if (!agentName) {
      throw new AgentViewError("You're trying to update run items, metadata or state, but the run doesn't have an agent assigned yet.", 422);
    }

    const agentConfig = requireAgentConfig(config, agentName);
    const runConfig = requireRunConfig(agentConfig, inputItem);

    /** Validate items */
    const items = body.items ?? [];

    if (items.length > 0 && run.status !== 'in_progress') {
      throw new AgentViewError("Cannot add items to a finished run.", 422);
    }

    parsedItems = validateNonInputItems(runConfig, run.sessionItems.map(si => si.content), items, body.status ?? 'in_progress');

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
        type: 'output' as const,
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

  if (session.channel.type !== 'api' && manual) {
    throw new AgentViewError("For non-api channels manual mode is not supported.", 422);
  }

  // Normalize: body.input (channel path) vs body.items (API path)
  const inputItems = body.input ?? (body.items ? [body.items[0]] : []);
  const nonInputItems = body.input ? [] : (body.items ? body.items.slice(1) : []);

  if (inputItems.length === 0) {
    throw new AgentViewError("New run must have at least 1 input item.", 422);
  }

  /** Only one in_progress run is allowed per session **/
  if (lastRun?.status === 'in_progress') {
    throw new AgentViewError(`Can't create a run because session has already a run in progress.`, 422);
  }

  /** Auto-fetch validation **/
  if (!manual) {
    if (body.items && body.items.length !== 1) {
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

  let parsedInputItems: any[] = [];
  let parsedNonInputItems: any[] = [];
  let status: string;
  let failReason: any | null = null;
  let expiresAt: string | null = null;
  let finishedAt: string | null = null;
  let metadata: Record<string, any> | undefined = undefined;
  let versionId: string | null = null;

  // for non-api channels, we assume input is OK and we use simplified procedure. Agent is not required, as we should save items even if agent is not assigned.
  if (session.channel.type !== 'api') {
    parsedInputItems = inputItems;
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

      const resolved = await resolveVersion(tx, {
        versionString: body.version!,
        agent: agentConfig.name,
        isProduction: environment.user === null,
        isDev: environment.user !== null,
        lastRunVersion: lastRun?.version ?? null,
        organizationId,
        sessionId: session.id,
        existingSessionVersions: (session.versions as string[]) ?? [],
      });
      versionId = resolved.versionId;
    }

    const firstInputItem = inputItems[0];
    const runConfig = requireRunConfig(agentConfig, firstInputItem);
    parsedInputItems = [runConfig.input.schema.parse(firstInputItem)];

    /** Validate rest items **/
    parsedNonInputItems = validateNonInputItems(runConfig, [parsedInputItems], nonInputItems, body.status ?? 'in_progress');

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
    versionId,
    metadata,
    fetchStatus: manual ? null : 'pending',
    environmentId: manual ? null : environment.id,
  }).returning();

  // Insert input items with type: 'input'
  await tx.insert(sessionItems).values(
    parsedInputItems.map(item => ({
      organizationId,
      sessionId: session.id,
      content: item,
      runId: insertedRun.id,
      type: 'input' as const,
    }))
  );

  // Insert non-input items with type: 'output'
  if (parsedNonInputItems.length > 0) {
    await tx.insert(sessionItems).values(
      parsedNonInputItems.map(item => ({
        organizationId,
        sessionId: session.id,
        content: item,
        runId: insertedRun.id,
        type: 'output' as const,
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
