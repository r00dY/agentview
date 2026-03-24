import { db__dangerous } from '../db';
import { withOrg } from '../withOrg';
import { runs, sessions, channelMessages, environments, sessionItems } from '../schemas/schema';
import { eq, and, inArray, sql, not, isNull } from 'drizzle-orm';
import { getConfigFromEnvironment } from '../environments';
import { fetchSession } from '../sessions';
import { AgentAPIError } from '../agentApi';
import { getAdapter } from '../adapters/adapters';
import { findChannelConfig, getChannelAgent } from 'agentview/baseConfigUtils';
import { applyRunPatch, terminateRun } from '../runs';
import { resolveAgentRef, upsertAgentRef } from '../agentRefs';
import type { AgentRef, RunBody } from 'agentview/apiTypes';
import { onRunTerminated } from '../runStream';
import { createWorker } from './utils';

type Run = typeof runs.$inferSelect;

export const agentFetchWorker = createWorker<Run>({
  name: 'agent-fetch',
  pollIntervalMs: 100,
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

  const fetchAbortController = new AbortController();
  let terminationAbortController: AbortController | undefined;

  try {
    // Fetch session within org context
    let session = await withOrg(run.organizationId, async (tx) => {
      return fetchSession(tx, run.sessionId);
    });

    if (!session) {
      throw new Error(`Session ${run.sessionId} not found`);
    }

    // Get config from environment
    const environmentId = run.environmentId;
    if (!environmentId) {
      throw new Error('Environment ID is required for auto-fetch');
    }

    const environment = await withOrg(run.organizationId, async (tx) => {
      return tx.query.environments.findFirst({
        where: eq(environments.id, environmentId),
        with: {
          user: true,
        },
      });
    });

    if (!environment) {
      throw new Error('Environment not found');
    }

    const config = getConfigFromEnvironment(environment);

    const channelConfig = findChannelConfig(config, session.channel);
    if (!channelConfig) {
      throw new Error(`Channel config not found for ${JSON.stringify(session.channel)}.`);
    }

    const channelAgent = getChannelAgent(channelConfig);
    const agentName = channelAgent?.name;
    const agentConfig = config.agents?.find((a) => a.name === agentName);

    if (!agentConfig) {
      throw new Error(`Agent '${agentName}' not found in config`);
    }

    const agentUrl = agentConfig.url;
    if (!agentUrl) {
      throw new Error(`Agent '${agentName}' has no url`);
    }

    // Resolve agent ref for session & run
    if (session.channel.type !== 'api') {

      await withOrg(run.organizationId, async (tx) => {
        if (!session) {
          throw new Error(`Session ${run.sessionId} not found`);
        }
        
        let sessionAgentRef: AgentRef;
  
        // First set session ref if necessary (new sessions from channel don't have agentRef assigned yet)
        if (!session.agentRef) {
          const result = await upsertAgentRef(tx, {
            agentRef: { version: agentConfig.version, agent: agentConfig.name, adapter: agentConfig.adapter },
            organizationId: run.organizationId,
          });
  
          sessionAgentRef = {
            agent: result.agent,
            version: result.version,
            adapter: result.adapter
          };
  
          await tx.update(sessions).set({
            agentRefId: result.agentRefId,
          }).where(eq(sessions.id, run.sessionId));
        }
        else {
          sessionAgentRef = session.agentRef;
        }
  
        // Assign agentRef to a run
        const lastCompletedRunAgentRef = session.runs.reverse().find(r => r.status === 'completed')?.agentRef;
        const previousAgentRef = lastCompletedRunAgentRef ?? sessionAgentRef;
  
        const { agentRefId } = await resolveAgentRef(tx, {
          agentRef: { version: agentConfig.version, agent: agentConfig.name, adapter: agentConfig.adapter },
          previousAgentRef,
          organizationId: run.organizationId,
          sessionId: run.sessionId,
        });
  
        await tx.update(runs).set({
          agentRefId,
          updatedAt: new Date().toISOString(),
        }).where(eq(runs.id, run.id));
      });

    }

    

    // Refetch session after agentRef assignment
    session = await withOrg(run.organizationId, async (tx) => {
      return fetchSession(tx, run.sessionId);
    });

    if (!session) {
      throw new Error(`Session ${run.sessionId} not found`);
    }

    /**
     * Pre-call validation for channel-based runs
     */
    if (session.channel.type !== 'api') {
      const fullRun = session.runs.find(r => r.id === run.id);
      if (!fullRun) {
        throw new Error(`Run ${run.id} not found`);
      }

      const hasInput = fullRun.sessionItems.some(si => si.type === 'input');
      const hasIncomingMessages = fullRun.channelMessages.some(cm => cm.direction === 'incoming');

      if (!hasInput && !hasIncomingMessages) {
        throw new Error(`Run ${run.id} has no input and no incoming channel messages`);
      }
    }

    // Call the agent endpoint
    const body: RunBody = { session };

    const adapter = getAdapter(agentConfig.adapter);

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

    // Abort fetch immediately when run is terminated (e.g. external cancellation).
    terminationAbortController = onRunTerminated(run.id, () => {
      console.log(`[agentFetch][${run.id}] terminated, aborting`);
      fetchAbortController.abort()
    });

    console.log(`[agentFetch][${run.id}] calling agent API`);

    for await (const event of adapter.callAgent(body, agentUrl, fetchAbortController.signal)) {
      console.log(`[agentFetch][${run.id}] event: ${event.name}`);

      // Check for external cancellation after each event received.
      // this is sanity check, listetning to [DONE] above is faster and should be enough
      const runStatus = await getCurrentRunStatus();
      if (runStatus === 'cancelled') {
        console.log(`[agentFetch][${run.id}] cancelled, aborting [not in progress]`);
        fetchAbortController.abort();
        break;
      }

      if (event.name === 'run.set_input') {
        await withOrg(run.organizationId, async (tx) => {
          // Validate: run must have no items or only input items
          const existing = await tx
            .select({ type: sessionItems.type })
            .from(sessionItems)
            .where(and(
              eq(sessionItems.runId, run.id),
              eq(sessionItems.isState, false),
            ));

          if (existing.some(item => item.type !== 'input')) {
            throw new Error('Cannot set input: run already has non-input items');
          }

          await tx.insert(sessionItems).values({
            organizationId: run.organizationId,
            sessionId: run.sessionId,
            runId: run.id,
            type: 'input',
            content: event.data,
          });
        });
      }
      else if (event.name === 'response_data') {
        // Store response data
        await withOrg(run.organizationId, async (tx) => {
          await tx.update(runs).set({
            responseData: event.data,
            updatedAt: new Date().toISOString(),
          }).where(eq(runs.id, run.id));
        });
      }
      else if (event.name === 'run.patch') {
        await applyRunPatch(
          run.id,
          run.organizationId,
          environment,
          event.data
        );
      }
    }

    // Automatically fail the run if it is not in progress after stream is finished
    const finalRunStatus = await getCurrentRunStatus();
    if (finalRunStatus === 'in_progress') {
      throw new Error('Agent stream ended without completing');
    }

    console.log(`[agentFetch][${run.id}] success`);

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // This is OK since abort is only than on the condition of the run being *not* in progress
      return;
    }

    const errorMessage = error instanceof AgentAPIError
      ? error.message
      : (error instanceof Error ? error.message : String(error));

    console.log(`[agentFetch][${run.id}] error: ${errorMessage}`);

    await terminateRun(run.id, run.organizationId, {
      status: 'failed',
      failReason: { message: errorMessage },
    });

  } finally {
    terminationAbortController?.abort();
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
