import { db__dangerous } from '../db';
import { withOrg } from '../withOrg';
import { runs, sessions, channelMessages } from '../schemas/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { getEnvironment, type Env } from '../environments';
import { fetchSession } from '../sessions';
import { callAgentAPI, AgentAPIError } from '../agentApi';
import { callAgentAPIAISDK } from '../ai-sdk/agentApi';
import { BaseConfigSchemaToZod, findChannelConfig } from 'agentview/configUtils';
import { applyRunPatch, getRun } from '../runs';
import { resolveVersion } from '../versions';
import type { RunBody } from 'agentview/apiTypes';
import { createWorker } from './utils';

type Run = typeof runs.$inferSelect;

export const agentFetchWorker = createWorker<Run>({
  name: 'agent-fetch',
  pollIntervalMs: 1000,
  maxConcurrency: 1000, // those are high priority events, so maxConcurrency is high
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
  console.log(`[agentFetch][${run.id}] start`);

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

    const ch = findChannelConfig(config, session.channel);
    if (!ch) {
      throw new Error(`Channel config not found for ${JSON.stringify(session.channel)}.`);
    }
    const agentName = ch.agent;

    const agentConfig = config.agents?.find((a) => a.name === agentName);

    if (!agentConfig) {
      throw new Error(`Agent '${agentName}' not found in config`);
    }

    const agentUrl = agentConfig.url;
    if (!agentUrl) {
      throw new Error(`Agent '${agentName}' has no url`);
    }

    // Call the agent endpoint
    const body: RunBody = { session };

    const callFn = agentConfig.protocol === 'ai-sdk' ? callAgentAPIAISDK : callAgentAPI;

    let versionReceived = false;

    const getCurrentRunStatus = async () => {
      return await withOrg(run.organizationId, async (tx) => {
        const [currentRun] = await tx
          .select({ status: runs.status })
          .from(runs)
          .where(eq(runs.id, run.id))
          .limit(1);
        return currentRun.status;
      });
    }

    console.log(`[agentFetch][${run.id}] calling agent API`);
    for await (const event of callFn(body, agentUrl, abortController.signal)) {
      console.log(`[agentFetch][${run.id}] event: ${event.name}`);
      // Check for cancellation after each new event received. We immediately abort the stream if the run is not in progress.
      const runStatus = await getCurrentRunStatus();
      if (runStatus !== 'in_progress') {
        console.log(`[agentFetch][${run.id}] aborting!!!`);
        abortController.abort();
        break;
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
            agent: agentConfig.name,
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

        await withOrg(run.organizationId, async (tx) => {
          await applyRunPatch(
            tx,
            run.id,
            environment,
            event.data
          );
        });
      }
    }



    // Automatically fail the run if it is not in progress after stream is finished
    const finalRunStatus = await getCurrentRunStatus();
    if (finalRunStatus === 'in_progress') {
      throw new Error('Agent stream ended without completing');
    }

    console.log(`[agentFetch][${run.id}] success`);

    // Create outgoing channel message if session has a channel thread
    if (finalRunStatus === 'completed') {
      try {
        await withOrg(run.organizationId, async (tx) => {
          // Check if session is connected to a channel thread
          const sessionRow = await tx.query.sessions.findFirst({
            where: eq(sessions.id, run.sessionId),
            columns: { channelThreadId: true },
          });
          if (!sessionRow?.channelThreadId) return;

          console.log(`[agentFetch][${run.id}] creating outgoing channel message`);

          // Get the completed run with its items
          const completedRun = (await getRun(tx, run.id))!;

          // Take the last session item as the output (assumes { type: 'text', text: string })
          const lastItem = completedRun.sessionItems[completedRun.sessionItems.length - 1];
          const content = lastItem?.content as any;
          const outputText = content?.text ?? "";

          // Insert outgoing channel message
          await tx.insert(channelMessages).values({
            organizationId: run.organizationId,
            channelThreadId: sessionRow.channelThreadId,
            direction: 'outgoing',
            status: 'pending',
            date: new Date().toISOString(),
            text: outputText,
            runId: run.id,
          });

          console.log(`[agentFetch][${run.id}] created outgoing channel message`);
        });
      } catch (e) {
        // Don't let outgoing message creation failure affect run completion
        console.error(`[agentFetch][${run.id}] failed to create outgoing channel message:`, e);
      }
    }

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // This is OK since abort is only than on the condition of the run being *not* in progress
      return;
    }

    const errorMessage = error instanceof AgentAPIError
      ? error.message
      : (error instanceof Error ? error.message : String(error));

    console.log(`[agentFetch][${run.id}] error: ${errorMessage}`);

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
    console.log(`[agentFetch][${run.id}] finished`);

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
