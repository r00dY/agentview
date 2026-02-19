import { db__dangerous } from '../db';
import { withOrg } from '../withOrg';
import { runs, environments } from '../schemas/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { getEnvironment, type Env } from '../environments';
import { fetchSession } from '../sessions';
import { callAgentAPI, AgentAPIError } from '../agentApi';
import { callAgentAPIAISDK } from '../ai-sdk/agentApi';
import { BaseConfigSchemaToZod } from 'agentview/configUtils';
import { applyRunPatch } from '../applyRunPatch';
import { resolveVersion } from '../versions';
import type { RunBody } from 'agentview/apiTypes';
import { createWorker } from './createWorker';

type Run = typeof runs.$inferSelect;

export const agentFetchWorker = createWorker<Run>({
  name: 'agent-fetch',
  pollIntervalMs: 1000,
  maxConcurrency: 5,
  async claim(limit) {
    // Atomic claim: FOR UPDATE SKIP LOCKED prevents concurrent workers from double-claiming
    return db__dangerous
      .update(runs)
      .set({ fetchStatus: 'fetching', updatedAt: new Date().toISOString() })
      .where(
        inArray(
          runs.id,
          sql`(SELECT ${runs.id} FROM ${runs} WHERE ${runs.fetchStatus} = 'pending' LIMIT ${sql.raw(String(limit))} FOR UPDATE SKIP LOCKED)`
        )
      )
      .returning();
  },
  async process(run) {
    await processAgentFetch(run);
  },
});

async function processAgentFetch(run: Run) {
  const abortController = new AbortController();

  try {
    // Fetch session within org context
    const session = await withOrg(run.organizationId, async (tx) => {
      return fetchSession(tx, run.sessionId);
    });

    if (!session) {
      throw new Error(`Session ${run.sessionId} not found`);
    }

    // Derive environment from session's space
    const env: Env = session.user.space === 'production'
      ? { type: 'prod' }
      : { type: 'dev', memberId: session.user.createdBy! };

    // Get config from environment
    const environment = await withOrg(run.organizationId, async (tx) => {
      return getEnvironment(tx, env);
    });

    if (!environment) {
      throw new Error('Environment not found');
    }

    const config = BaseConfigSchemaToZod.parse(environment.config);
    const agentConfig = config.agents?.find((a) => a.name === session.agent);

    if (!agentConfig) {
      throw new Error(`Agent '${session.agent}' not found in config`);
    }

    const agentUrl = agentConfig.url;
    if (!agentUrl) {
      throw new Error(`Agent '${session.agent}' has no url`);
    }

    // Call the agent endpoint
    const body: RunBody = { session };

    const callFn = agentConfig.protocol === 'ai-sdk' ? callAgentAPIAISDK : callAgentAPI;

    let streamCompleted = false;
    let versionReceived = false;

    for await (const event of callFn(body, agentUrl, abortController.signal)) {

      console.log('----');
      console.log('event', event);
      // Check for cancellation on each event
      const runStatus = await withOrg(run.organizationId, async (tx) => {

        const [currentRun] = await tx
          .select({ status: runs.status })
          .from(runs)
          .where(eq(runs.id, run.id))
          .limit(1);

        return currentRun.status;
      });
      console.log('run status', runStatus);

      if (runStatus !== 'in_progress') {
        console.log('aborting');
        abortController.abort();
        return;
      }

      if (event.name === 'response_data') {
        // Store response data
        await withOrg(run.organizationId, async (tx) => {
          await tx.update(runs).set({
            responseData: event.data,
            updatedAt: new Date().toISOString(),
          }).where(eq(runs.id, run.id));
        });
      }
      else if (event.name === 'version') {
        versionReceived = true;

        const previousRuns = session.runs.filter(r => r.id !== run.id);
        const lastPreviousRun = previousRuns[previousRuns.length - 1];

        await withOrg(run.organizationId, async (tx) => {
          const { versionId } = await resolveVersion(tx, {
            versionString: event.data,
            isProduction: session.user.space === 'production',
            isDev: session.user.space !== 'production',
            lastRunVersion: lastPreviousRun?.version ?? null,
            organizationId: run.organizationId,
            sessionId: run.sessionId,
          });

          await tx.update(runs).set({
            versionId,
            updatedAt: new Date().toISOString(),
          }).where(eq(runs.id, run.id));
        });
      }
      else if (event.name === 'run.patch') {
        if (!versionReceived) {
          throw new Error('Agent must provide X-AgentView-Version response header');
        }

        try {
          await withOrg(run.organizationId, async (tx) => {
            // Re-fetch run to get current state (items may have been added)
            const currentRunData = await tx.query.runs.findFirst({
              where: eq(runs.id, run.id),
              with: {
                sessionItems: {
                  orderBy: (si, { asc }) => [asc(si.sortOrder)],
                  where: (si, { eq }) => eq(si.isState, false),
                },
              },
            });

            if (!currentRunData) {
              throw new Error('Run not found');
            }

            await applyRunPatch(
              tx,
              run.organizationId,
              run.id,
              currentRunData,
              run.sessionId,
              agentConfig,
              event.data
            );
          });

          // Check if the patch completed the run
          const [afterPatch] = await db__dangerous
            .select({ status: runs.status })
            .from(runs)
            .where(eq(runs.id, run.id))
            .limit(1);

          if (afterPatch && (afterPatch.status === 'completed' || afterPatch.status === 'failed' || afterPatch.status === 'cancelled')) {
            streamCompleted = true;
            abortController.abort();
            break;
          }
        } catch (error) {
          // Patch validation failed - mark run as failed
          const errorMessage = error instanceof Error ? error.message : String(error);
          await withOrg(run.organizationId, async (tx) => {
            await tx.update(runs).set({
              status: 'failed',
              failReason: {
                message: `Agent stream event failed validation: ${errorMessage}`,
                event: event.data,
              },
              finishedAt: new Date().toISOString(),
              fetchStatus: null,
              expiresAt: null,
              updatedAt: new Date().toISOString(),
            }).where(eq(runs.id, run.id));
          });
          abortController.abort();
          return;
        }
      }
    }

    // Stream ended - check if run was completed
    if (!streamCompleted) {
      // Check current status
      const [finalRun] = await db__dangerous
        .select({ status: runs.status, fetchStatus: runs.fetchStatus })
        .from(runs)
        .where(eq(runs.id, run.id))
        .limit(1);

      if (finalRun && finalRun.fetchStatus !== null && finalRun.status === 'in_progress') {
        // Stream ended without completing the run
        await withOrg(run.organizationId, async (tx) => {
          await tx.update(runs).set({
            status: 'failed',
            failReason: { message: 'Agent stream ended without completing' },
            finishedAt: new Date().toISOString(),
            fetchStatus: null,
            expiresAt: null,
            updatedAt: new Date().toISOString(),
          }).where(eq(runs.id, run.id));
        });
      }
    }

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return; // Expected when we abort
    }

    const errorMessage = error instanceof AgentAPIError
      ? error.message
      : (error instanceof Error ? error.message : String(error));

    await withOrg(run.organizationId, async (tx) => {
      await tx.update(runs).set({
        status: 'failed',
        failReason: { message: errorMessage },
        finishedAt: new Date().toISOString(),
        fetchStatus: null,
        expiresAt: null,
        updatedAt: new Date().toISOString(),
      }).where(eq(runs.id, run.id));
    });
  } finally {
    // Always clear fetchStatus when done (if not already cleared)
    try {
      await db__dangerous
        .update(runs)
        .set({ fetchStatus: null, updatedAt: new Date().toISOString() })
        .where(and(eq(runs.id, run.id), eq(runs.fetchStatus, 'fetching')))
    } catch {
      // Best-effort cleanup
    }
  }
}
