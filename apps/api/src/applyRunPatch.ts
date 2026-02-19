import { eq } from 'drizzle-orm';
import { runs, sessionItems } from './schemas/schema';
import type { Transaction } from './types';
import type { RunUpdate } from 'agentview/apiTypes';
import type { BaseAgentConfig, BaseRunConfig } from 'agentview/configTypes';
import { requireRunConfig, findItemConfig } from 'agentview/configUtils';
import { AgentViewError } from 'agentview/AgentViewError';
import { parseMetadata } from './parseMetadata';

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




/**
 * Core run-update logic shared between the PATCH handler and the worker.
 * Validates items, metadata, status transitions, inserts items, and updates the run.
 */
export async function applyRunPatch(
  tx: Transaction,
  organizationId: string,
  runId: string,
  run: {
    id: string;
    status: string;
    metadata: any;
    finishedAt: string | null;
    sessionId: string;
    sessionItems: { content: any }[];
  },
  sessionId: string,
  agentConfig: BaseAgentConfig,
  body: RunUpdate
): Promise<void> {
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
        organizationId,
        sessionId,
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
      organizationId,
      sessionId,
      content: body.state,
      runId: run.id,
      isState: true,
    });
  }
}
