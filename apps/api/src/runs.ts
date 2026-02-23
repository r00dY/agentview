import { eq } from 'drizzle-orm';
import { runs, sessionItems } from './schemas/schema';
import type { Transaction } from './types';
import type { Run, RunUpdate, Session } from 'agentview/apiTypes';
import type { BaseAgentConfig, BaseRunConfig } from 'agentview/configTypes';
import { requireRunConfig, findItemConfig } from 'agentview/configUtils';
import { AgentViewError } from 'agentview/AgentViewError';
import { parseMetadata } from './parseMetadata';
import { resolveVersion } from './versions';
import { getLastRun } from 'agentview/sessionUtils';

export const DEFAULT_IDLE_TIME = 1000 * 60; // 60 seconds

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
  agentConfig: BaseAgentConfig,
  body: RunUpdate
) {

  const run = await getRun(tx, runId);
  if (!run) {
    throw new AgentViewError("Run not found.", 404);
  }

  /** Find matching run config **/
  const inputItem = run.sessionItems[0].content;
  const runConfig = requireRunConfig(agentConfig, inputItem);

  /** Validate items */
  const items = body.items ?? [];

  if (items.length > 0 && run.status !== 'in_progress') {
    throw new AgentViewError("Cannot add items to a finished run.", 422);
  }

  const parsedItems = validateNonInputItems(runConfig, run.sessionItems.map(si => si.content), items, body.status ?? 'in_progress');

  /** State */
  if (body.state !== undefined && run.status !== 'in_progress') {
    throw new AgentViewError("Cannot set state to a finished run.", 422);
  }

  /** Metadata **/
  const metadata = parseMetadata(runConfig.metadata, runConfig.allowUnknownMetadata ?? true, body.metadata ?? {}, run.metadata ?? {});

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

  const idleTimeout = runConfig.idleTimeout ?? DEFAULT_IDLE_TIME;
  const expiresAt = isFinished ? null : new Date(Date.now() + idleTimeout).toISOString();

  if (parsedItems.length > 0) {
    await tx.insert(sessionItems).values(
      parsedItems.map(item => ({
        organizationId: run.organizationId,
        sessionId: run.sessionId,
        content: item,
        runId: run.id
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
  params: {
    organizationId: string;
    session: Session;
    agentConfig: BaseAgentConfig;
    items: any[];
    version?: string;
    metadata?: Record<string, any>;
    status?: 'in_progress' | 'completed' | 'cancelled' | 'failed';
    state?: any;
    failReason?: any;
    isDevEnv: boolean; // for version only
  }
): Promise<typeof runs.$inferSelect> {
  const { organizationId, session, agentConfig, items, isDevEnv } = params;
  const isAutoFetch = !!agentConfig.url;
  const lastRun = getLastRun(session);

  /** Only one in_progress run is allowed per session **/
  if (lastRun?.status === 'in_progress') {
    throw new AgentViewError(`Can't create a run because session has already a run in progress.`, 422);
  }

  /** Auto-fetch validation **/
  if (isAutoFetch) {
    if (items.length !== 1) {
      throw new AgentViewError("When agent has a url, run must have exactly 1 item (input).", 422);
    }
    if (params.status && params.status !== 'in_progress') {
      throw new AgentViewError("When agent has a url, status must be 'in_progress' (or omitted).", 422);
    }
    if (params.state !== undefined) {
      throw new AgentViewError("When agent has a url, state cannot be set on creation.", 422);
    }
    if (params.failReason !== undefined && params.failReason !== null) {
      throw new AgentViewError("When agent has a url, failReason cannot be set on creation.", 422);
    }
    if (params.version !== undefined) {
      throw new AgentViewError("When agent has a url, version cannot be set on creation (the agent endpoint provides it).", 422);
    }
  }

  if (!isAutoFetch && !params.version) {
    throw new AgentViewError("Version is required.", 422);
  }

  let versionId: string | null = null;

  if (!isAutoFetch) {
    const resolved = await resolveVersion(tx, {
      versionString: params.version!,
      isProduction: !isDevEnv,
      isDev: isDevEnv,
      lastRunVersion: lastRun?.version ?? null,
      organizationId,
      sessionId: session.id,
      existingSessionVersions: (session.versions as string[]) ?? [],
    });
    versionId = resolved.versionId;
  }

  /** Validate input item **/
  if (items.length === 0) {
    throw new AgentViewError("New run must have at least 1 item, input.", 422);
  }
  const [inputItem, ...nonInputItems] = items;

  const runConfig = requireRunConfig(agentConfig, inputItem);
  const parsedInput = [runConfig.input.schema.parse(inputItem)];

  /** Validate rest items **/
  const parsedNonInputItems = validateNonInputItems(runConfig, [parsedInput], nonInputItems, params.status ?? 'in_progress');
  const parsedItems = [...parsedInput, ...parsedNonInputItems];

  /** Metadata **/
  const metadata = parseMetadata(runConfig.metadata, runConfig.allowUnknownMetadata ?? true, params.metadata ?? {}, {});

  /** Status, finished at, failReason **/
  const status = params.status ?? 'in_progress';
  const failReason = params.failReason ?? null;

  if (failReason && status !== 'failed') {
    throw new AgentViewError("failReason can only be set when status is 'failed'.", 422);
  }

  const isFinished = status === 'completed' || status === 'cancelled' || status === 'failed';
  const finishedAt = isFinished ? new Date().toISOString() : null;
  const idleTimeout = runConfig.idleTimeout ?? DEFAULT_IDLE_TIME;
  const expiresAt = isFinished ? null : new Date(Date.now() + idleTimeout).toISOString();

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
    fetchStatus: isAutoFetch ? 'pending' : null,
  }).returning();

  await tx.insert(sessionItems).values(
    parsedItems.map(item => ({
      organizationId,
      sessionId: session.id,
      content: item,
      runId: insertedRun.id,
    }))
  );

  // insert state item
  if (params.state !== undefined) {
    await tx.insert(sessionItems).values({
      organizationId,
      sessionId: session.id,
      content: params.state,
      runId: insertedRun.id,
      isState: true,
    });
  }

  return insertedRun;
}
