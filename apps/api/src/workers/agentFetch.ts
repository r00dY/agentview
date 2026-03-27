import { db__dangerous } from '../db';
import { withOrg } from '../withOrg';
import { runs, sessions, channelMessages, environments, sessionItems, channels } from '../schemas/schema';
import { eq, and, inArray, sql, not, isNull } from 'drizzle-orm';
import { getConfigFromEnvironment, getEnvironment } from '../environments';
import { fetchSession, fetchSessionBase } from '../sessions';
import { getAdapter } from '../adapters/adapters';
import { findChannelConfig, getChannelAgent } from 'agentview/baseConfigUtils';
import { applyRunPatch, terminateRun } from '../runs';
import { resolveAgentRef } from '../agentRefs';
import type { AgentRef, RunBody } from 'agentview/apiTypes';
import { onRunTerminated } from '../runStream';
import { createWorker } from './utils';
import { RunTerminationError } from '../types';
import { getLastRun } from 'agentview/sessionUtils';

type Run = typeof runs.$inferSelect;

export const agentFetchWorker = createWorker<Run>({
  name: 'agent-fetch',
  pollIntervalMs: 100,
  maxConcurrency: 1000, // those are high priority events, so maxConcurrency is high
  async claim(limit) {
    // Atomic claim: FOR UPDATE SKIP LOCKED prevents concurrent workers from double-claiming
    return db__dangerous
      .update(runs)
      .set({ status: 'init', updatedAt: new Date().toISOString() })
      .where(
        inArray(
          runs.id,
          sql`(SELECT ${runs.id} FROM ${runs} WHERE ${runs.status} = 'pending' LIMIT ${sql.raw(String(limit))} FOR UPDATE SKIP LOCKED)`
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
  let terminationAbortController: AbortController | undefined;

  try {

    /**
     * PREPARATION ('init' phase)
     */



    // await withOrg(run.organizationId, async (tx) => {

    //   let sessionBase = await fetchSessionBase(tx, run.sessionId);
    //   if (!sessionBase) {
    //     throw new Error(`Session ${run.sessionId} not found`);
    //   }

    //   if (!run.environmentId) {
    //     throw new Error('Environment ID is required for auto-fetch');
    //   }

    //   const environment = await getEnvironment(tx, run.environmentId);
    //   if (!environment) {
    //     throw new Error(`Environment ${run.environmentId} not found`);
    //   }

    //   const config = getConfigFromEnvironment(environment);

    //   const channelConfig = findChannelConfig(config, sessionBase.channel);
    //   if (!channelConfig) {
    //     throw new Error(`Channel config not found for ${JSON.stringify(sessionBase.channel)}.`);
    //   }

    //   const channelAgent = getChannelAgent(channelConfig);
    //   const agentName = channelAgent?.name;
    //   const agentConfig = config.agents?.find((a) => a.name === agentName);

    //   if (!agentConfig) {
    //     throw new Error(`Agent '${agentName}' not found in config`);
    //   }

    //   const agentUrl = agentConfig.url;
    //   if (!agentUrl) {
    //     throw new Error(`Agent '${agentName}' has no url`);
    //   }

    //   /**
    //    * For non-existing session.agentRef & run.agentRef we must resolve them (mostly for channels)
    //    */
    //   if (sessionBase.channel.type === 'api') {
    //     if (!sessionBase.agentRef) {
    //       throw new Error('Session agent ref is required for API runs');
    //     }
    //     if (!run.agentRefId) {
    //       throw new Error('Run agent ref is required for API runs');
    //     }
    //   }
    //   else {




    //     let sessionAgentRef = sessionBase.agentRef;
    //     if (!sessionAgentRef) {
    //       sessionAgentRef = await resolveAgentRef(tx, {
    //         agentRef: { version: agentConfig.version, agent: agentConfig.name, adapter: agentConfig.adapter },
    //       });
    //     }

    //     if (run.agentRefId) {
    //       throw new Error("Run agent ref should be empty for channel runs before agent fetch");
    //     }
    //   }





    //   // Resolve agent ref for session & run
    //   if (sessionBase.channel.type !== 'api') {
    //     let sessionAgentRef: AgentRef;

    //     // First set session ref if necessary (new sessions from channel don't have agentRef assigned yet)
    //     if (!sessionBase.agentRef) {
    //       const result = await upsertAgentRef(tx, {
    //         agentRef: { version: agentConfig.version, agent: agentConfig.name, adapter: agentConfig.adapter },
    //       });

    //       sessionAgentRef = {
    //         agent: result.agent,
    //         version: result.version,
    //         adapter: result.adapter
    //       };

    //       await tx.update(sessions).set({
    //         agentRefId: result.agentRefId,
    //       }).where(eq(sessions.id, run.sessionId));
    //     }
    //     else {
    //       sessionAgentRef = sessionBase.agentRef;
    //     }

    //     // Assign agentRef to a run
    //     const lastRunAgentRef = sessionBase.agentRefs[sessionBase.agentRefs.length - 1];
    //     const previousAgentRef = lastRunAgentRef ?? sessionAgentRef;

    //     const { agentRefId } = await resolveAgentRef(tx, {
    //       agentRef: { version: agentConfig.version, agent: agentConfig.name, adapter: agentConfig.adapter },
    //       previousAgentRef,
    //       sessionId: run.sessionId,
    //     });

    //     await tx.update(runs).set({
    //       agentRefId,
    //       updatedAt: new Date().toISOString(),
    //     }).where(eq(runs.id, run.id));
    //   }

    // });


    // let session = await withOrg(run.organizationId, async (tx) => {
    //   return fetchSession(tx, run.sessionId);
    // });

    // if (!session) {
    //   throw new Error(`Session ${run.sessionId} not found`);
    // }

    // // Get config from environment
    // const environmentId = run.environmentId;
    // if (!environmentId) {
    //   throw new Error('Environment ID is required for auto-fetch');
    // }


    // const environment = await withOrg(run.organizationId, async (tx) => {
    //   return tx.query.environments.findFirst({
    //     where: eq(environments.id, environmentId),
    //     with: {
    //       user: true,
    //     },
    //   });
    // });

    // if (!environment) {
    //   throw new Error('Environment not found');
    // }

    // const config = getConfigFromEnvironment(environment);

    // const channelConfig = findChannelConfig(config, session.channel);
    // if (!channelConfig) {
    //   throw new Error(`Channel config not found for ${JSON.stringify(session.channel)}.`);
    // }

    // const channelAgent = getChannelAgent(channelConfig);
    // const agentName = channelAgent?.name;
    // const agentConfig = config.agents?.find((a) => a.name === agentName);

    // if (!agentConfig) {
    //   throw new Error(`Agent '${agentName}' not found in config`);
    // }

    // const agentUrl = agentConfig.url;
    // if (!agentUrl) {
    //   throw new Error(`Agent '${agentName}' has no url`);
    // }

    // Resolve agent ref for session & run
    // if (session.channel.type !== 'api') {

    //   await withOrg(run.organizationId, async (tx) => {
    //     if (!session) {
    //       throw new Error(`Session ${run.sessionId} not found`);
    //     }

    //     let sessionAgentRef: AgentRef;

    //     // First set session ref if necessary (new sessions from channel don't have agentRef assigned yet)
    //     if (!session.agentRef) {
    //       const result = await upsertAgentRef(tx, {
    //         agentRef: { version: agentConfig.version, agent: agentConfig.name, adapter: agentConfig.adapter },
    //       });

    //       sessionAgentRef = {
    //         agent: result.agent,
    //         version: result.version,
    //         adapter: result.adapter
    //       };

    //       await tx.update(sessions).set({
    //         agentRefId: result.agentRefId,
    //       }).where(eq(sessions.id, run.sessionId));
    //     }
    //     else {
    //       sessionAgentRef = session.agentRef;
    //     }

    //     // Assign agentRef to a run
    //     const lastCompletedRunAgentRef = session.runs.reverse().find(r => r.status === 'completed')?.agentRef;
    //     const previousAgentRef = lastCompletedRunAgentRef ?? sessionAgentRef;

    //     const { agentRefId } = await resolveAgentRef(tx, {
    //       agentRef: { version: agentConfig.version, agent: agentConfig.name, adapter: agentConfig.adapter },
    //       previousAgentRef,
    //       sessionId: run.sessionId,
    //     });

    //     await tx.update(runs).set({
    //       agentRefId,
    //       updatedAt: new Date().toISOString(),
    //     }).where(eq(runs.id, run.id));
    //   });

    // }

    // // Refetch session after agentRef assignment
    // session = await withOrg(run.organizationId, async (tx) => {
    //   return fetchSession(tx, run.sessionId);
    // });

    // if (!session) {
    //   throw new Error(`Session ${run.sessionId} not found`);
    // }

    // /**
    //  * Pre-call validation for channel-based runs
    //  */
    // if (session.channel.type !== 'api') {
    //   const fullRun = session.runs.find(r => r.id === run.id);
    //   if (!fullRun) {
    //     throw new Error(`Run ${run.id} not found`);
    //   }

    //   const hasInput = fullRun.sessionItems.some(si => si.type === 'input');
    //   const hasIncomingMessages = fullRun.channelMessages.some(cm => cm.direction === 'incoming');

    //   if (!hasInput && !hasIncomingMessages) {
    //     throw new Error(`Run ${run.id} has no input and no incoming channel messages`);
    //   }
    // }


    /**
     * CALLING AGENT ENDPOINT
     * 
     * The algorithm here is pretty simple:
     * - we call adapter.callAgent which is async generator
     * - we're in the 'fetching' state until it returns
     * - it can, during processing, send patches to the run
     * - TERMINATION:
     *    - it gets signal to abort. We listen for abortion thanks to 'onRunTerminated' (which sets [TERMINATED] event on the 'agentview' native stream).
     *    - there are 2 sources of termination: timeouts and user cancellation. First results in "failed", second in "cancelled" states.
     * - ALL THE RESPONSIBILITY FOR CLEANUP IS ON THE ADAPTER SIDE. It means that if adapter ends while the run is in_progress, it won't finish. It will just timeout.
     */

    const { agentUrl, session, environment } = await withOrg(run.organizationId, async (tx) => {

      // TEMPORARY -> SET AS IN_PROGRESS JUST FOR TEMPORARY TESTING
      // LATER WE'LL SET IT AFTER THE REQUEST IS DONE.
      await tx.update(runs).set({ status: 'in_progress' }).where(eq(runs.id, run.id));



      const session = await fetchSession(tx, run.sessionId, { allowInitRun: true });

      if (!session) {
        throw new Error(`Session ${run.sessionId} not found`);
      }

      if (!run.environmentId) {
        throw new Error('Environment ID is required for auto-fetch');
      }

      const environment = await tx.query.environments.findFirst({
        where: eq(environments.id, run.environmentId),
        with: {
          user: true,
        },
      });
      
      if (!environment) {
        throw new Error(`Environment ${run.environmentId} not found`);
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

      return { agentUrl, agentConfig, session, environment };
    });

    const fullRun = session.runs.find(r => r.id === run.id);
    if (!fullRun) {
      throw new Error(`Run ${run.id} not found`);
    }

    if (!fullRun.agentRef) {
      throw new Error(`Run ${run.id} has no agent ref`);
    }


    // const adapter = getLastRun(session)!.adapter;

    // const agentConfig = getAgentConfig(session.channel.type);

    const body: RunBody = { session };
    const adapter = getAdapter(fullRun.agentRef.adapter);

    // Abort fetch immediately when run is terminated (e.g. external cancellation).
    terminationAbortController = onRunTerminated(run.id, (body) => {
      console.log(`[agentFetch][${run.id}] terminated, aborting (${body.status})`);
      abortController.abort(new RunTerminationError('Run terminated', body));
    });

    // event handlers

    const send = async (event: { name: string, data: any }) => {
      if (event.name === 'run.set_input') {
        console.log(`[agentFetch][${run.id}] run.set_unput`);

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
        console.log(`[agentFetch][${run.id}] run.response_data`);

        await withOrg(run.organizationId, async (tx) => {
          await tx.update(runs).set({
            responseData: event.data,
            updatedAt: new Date().toISOString(),
          }).where(eq(runs.id, run.id));
        });
      }
      else if (event.name === 'run.patch') {
        console.log(`[agentFetch][${run.id}] run.patch`, event.data);

        await withOrg(run.organizationId, async (tx) => {
          await applyRunPatch(
            tx,
            run.id,
            environment,
            event.data
          );
        })
      }
      else if (event.name === 'run.terminate') { // safe indempotent termination for cleanup
        console.log(`[agentFetch][${run.id}] run.terminate`);

        await withOrg(run.organizationId, async (tx) => {
          await terminateRun(tx, run.id, {
            status: 'failed',
            failReason: event.data,
          });
        });
      }

    }

    console.log(`[agentFetch][${run.id}] calling agent API`);

    await adapter.callAgent(body, agentUrl, send, abortController.signal);

    console.log(`[agentFetch][${run.id}] agent API call finished`);

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') { // This is OK since abort is only than on the condition of the run being *not* in progress
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    console.log(`[agentFetch][${run.id}] unexpected internal error: "${errorMessage}". This error happened because there's unhandled error in the adaptar.callAgent function. This should never happen.`);

    await withOrg(run.organizationId, async (tx) => {
      await terminateRun(tx, run.id, {
        status: 'failed',
        failReason: { message: errorMessage },
      });
    });

  } finally {
    terminationAbortController?.abort();
    console.log(`[agentFetch][${run.id}] finished`);

    await withOrg(run.organizationId, async (tx) => {
      await terminateRun(tx, run.id, {
        status: 'failed',
        failReason: { message: "The job ended with unfinished work. This should never happen." },
      });
    });

    // // Always clear fetchStatus when done (if not already cleared)
    // try {
    //   await db__dangerous
    //     .update(runs)
    //     .set({ fetchStatus: null, updatedAt: new Date().toISOString() })
    //     .where(and(eq(runs.id, run.id), eq(runs.fetchStatus, 'fetching')))
    // } catch {
    //   // Best-effort cleanup
    // }
  }
}
