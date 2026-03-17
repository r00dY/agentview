import { db__dangerous } from '../db';
import { withOrg } from '../withOrg';
import { runs, sessions, channelMessages, environments, sessionItems } from '../schemas/schema';
import { eq, and, inArray, sql, not, isNull } from 'drizzle-orm';
import { getConfigFromEnvironment } from '../environments';
import { fetchSession } from '../sessions';
import { callAgentAPI, AgentAPIError } from '../agentApi';
import { callAgentAPIAISDK } from '../ai-sdk/agentApi';
import { BaseConfigSchemaToZod, findChannelConfig, getChannelAgent } from 'agentview/configUtils';
import { applyRunPatch, getRun } from '../runs';
import { resolveAgentRef, upsertAgentRef } from '../agentRefs';
import type { AgentRef, RunBody } from 'agentview/apiTypes';
import { createWorker } from './utils';
import { getLastRun } from 'agentview/sessionUtils';

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
    await withOrg(run.organizationId, async (tx) => {
      if (!session) {
        throw new Error(`Session ${run.sessionId} not found`);
      }
      
      let sessionAgentRef: AgentRef;

      // First set session ref if necessary (new sessions from channel don't have agentRef assigned yet)
      if (!session.agentRef) {
        const result = await upsertAgentRef(tx, {
          agentRef: { version: agentConfig.version, agent: agentConfig.name, adapter: agentConfig.adapter === 'ai-sdk' ? 'ai-sdk' : 'agentview' },
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
        agentRef: { version: agentConfig.version, agent: agentConfig.name, adapter: agentConfig.adapter === 'ai-sdk' ? 'ai-sdk' : 'agentview' },
        previousAgentRef,
        organizationId: run.organizationId,
        sessionId: run.sessionId,
      });

      await tx.update(runs).set({
        agentRefId,
        updatedAt: new Date().toISOString(),
      }).where(eq(runs.id, run.id));
    });

    // Refetch session after agentRef assignment
    session = await withOrg(run.organizationId, async (tx) => {
      return fetchSession(tx, run.sessionId);
    });

    if (!session) {
      throw new Error(`Session ${run.sessionId} not found`);
    }

    /**
     * CHANNEL MESSAGES -> SESSION ITEM
     */


    if (session.channel.type !== 'api') {
      if (agentConfig.adapter !== 'ai-sdk') {
        throw new Error('Agent adapter must be ai-sdk to create session items from channel messages');
      }

      const fullRun = session.runs.find(r => r.id === run.id);
      if (!fullRun) {
        throw new Error(`Run ${run.id} not found`);
      }

      if (fullRun.sessionItems.length > 0) {
        throw new Error(`Run ${run.id} already has session items`);
      }

      const inputChannelMessages = fullRun.channelMessages.filter(cm => cm.direction === 'incoming');

      if (inputChannelMessages.length === 0) {
        throw new Error('No input channel messages found');
      }

      const inputSessionItemContent = {
        role: 'user',
        parts: inputChannelMessages.map(cm => ({ type: 'text', text: cm.text ?? "" })),
      }

      await withOrg(run.organizationId, async (tx) => {
        await tx.insert(sessionItems).values({
          organizationId: run.organizationId,
          sessionId: run.sessionId,
          runId: run.id,
          type: 'input',
          content: inputSessionItemContent,
        });
      });

      // Refetch session
      session = await withOrg(run.organizationId, async (tx) => {
        return fetchSession(tx, run.sessionId);
      });

      if (!session) {
        throw new Error(`Session ${run.sessionId} not found`);
      }
    }

    // Call the agent endpoint
    const body: RunBody = { session };

    const callFn = agentConfig.adapter === 'ai-sdk' ? callAgentAPIAISDK : callAgentAPI;

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
      else if (event.name === 'run.patch') {
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
    if (finalRunStatus === 'completed' && session.channel.type !== 'api') {
      try {
        await withOrg(run.organizationId, async (tx) => {
          // Check if session is connected to a channel thread
          const sessionRow = await tx.query.sessions.findFirst({
            where: eq(sessions.id, run.sessionId),
            columns: { channelThreadId: true },
          });
          if (!sessionRow?.channelThreadId) return;

          if (agentConfig.adapter !== 'ai-sdk') {
            throw new Error('Agent adapter must be ai-sdk to create outgoing channel message');
          }

          console.log(`[agentFetch][${run.id}] creating outgoing channel message`);

          // Get the completed run with its items
          const completedRun = (await getRun(tx, run.id))!;

          // Filter for output items and use the last one for channel message
          const outputItems = completedRun.sessionItems.filter(si => si.type === 'output');

          const outputText = outputItems.map(si => (si.content as any)?.text).filter(Boolean).join('\n\n');

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
