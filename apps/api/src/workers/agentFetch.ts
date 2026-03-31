import type { RunBody } from 'agentview/apiTypes';
import { findChannelConfig, getChannelAgent } from 'agentview/baseConfigUtils';
import { eq, inArray, sql } from 'drizzle-orm';
import { getAdapter } from '../adapters/adapters';
import { db__dangerous } from '../db';
import { getConfigFromEnvironment } from '../environments';
import { applyRunPatch, RunTerminationError, terminateRun, acceptRun } from '../runs';
import { createRunTerminationReceiver } from '../runStream';
import { environments, runs } from '../schemas/schema';
import { activateSession, fetchSession } from '../sessions';
import { withOrg, withTenant } from '../withOrg';
import { createWorker } from './utils';
import type { ServicePrincipal } from '../authMiddleware';

type Run = typeof runs.$inferSelect;

const runTerminationReceiver = await createRunTerminationReceiver(); // one Redis connection per worker process

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

  let clearTerminationListener: (() => void) | undefined;

  let finalError: string | undefined = undefined;

  try {
    const { agentUrl, session, environment } = await withOrg(run.organizationId, async (tx) => {

      const session = await fetchSession(tx, run.sessionId, { includeInitRun: true });

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


    /**
     * CALLING AGENT ENDPOINT
     * 
     * The algorithm here is pretty simple:
     * - the run start with 'init' state which means we don't know what was the HTTP response (status, headers)
     * - we await adapter.callAgent which is async function. Until it runs, we assume fetching is in progress.
     * - adapter.callAgent can send events
     * - when run is in 'init' state we first wait for response. It's acknowledged when "run.streaming_started" / "run.discarded" events are sent.
     * - when run.streaming_started -> run becomes in_progress
     * - later we expect run.yield events
     * 
     * - it first must send either "run.discard" or "run.streaming_started"
     * - it can, during processing, send patches to the run
     * - TERMINATION:
     *    - it gets signal to abort. We listen for abortion thanks to 'onRunTerminated' (which sets [TERMINATED] event on the 'agentview' native stream).
     *    - there are 2 sources of termination: timeouts and user cancellation. First results in "failed", second in "cancelled" states.
     * - ALL THE RESPONSIBILITY FOR CLEANUP IS ON THE ADAPTER SIDE. It means that if adapter ends while the run is in_progress, it won't finish. It will just timeout.
     */


    const body: RunBody = { session };
    const adapter = getAdapter(fullRun.agentRef.adapter);

    /**
     * STREAM TERMINATION (IMPORTANT)
     * 
     * - when we get info from Redis that run is terminated ([TERMINATED] event added to the stream), we must notify the adapter to abort.
     * - we send normal AgentViewError with code "run.finished". It's because it's consistent with our API.
     * - there's potential RACE CONDITION where adapter calls run.patch, the run is already cancelled, and onRunTerminated was not yet called.
     * - that's why our API (run.patch) must throw correct errors ("run.finished" error code) to handle this case correctly.
     * - thanks to this we know how to handle cancel vs. fail (different semantics)
     * - the error argument in onRunTerminated is the same type as our API error. It's AgentViewError with code "run.finished".
     * - thanks to this adapter sees the same error code (AgentViewError with code "run.finished"), if it comes from API call or from termination.
     */
    
    // Abort fetch immediately when run is terminated (e.g. external cancellation).

    clearTerminationListener = runTerminationReceiver.listen(run.id, (reason) => {
      console.log(`[agentFetch][${run.id}] run termination received`, reason);
      abortController.abort(new RunTerminationError(reason));
    });

    let isFirstEventSent = false;

    const principal : ServicePrincipal = {
      type: 'service',
      organizationId: run.organizationId,
      env: environment.handle,
    };
    
    // event handlers
    const send = async (event: { name: string, data: any }) => {

      if (event.name === 'run.patch') {
        console.log(`[agentFetch][${run.id}] run.patch`, event.data);

        if (!isFirstEventSent) {
          throw new Error(`[agentFetch][${run.id}] "run.patch" called before "run.discard" or "run.accept".`);
        }

        await withTenant(principal, async (tx) => {
          await applyRunPatch(
            tx,
            run.id,
            event.data
          );
        })

        console.log(`[agentFetch][${run.id}] run.patch successful`);
      }
      /**
       * Discard and streaming started are only FIRST THINGS that should happen before streaming starts. Either run is discarded or streaming started, which means it becomes in_progress.
       * This is *INTERNAL* api, not public (like run.patch)
       */
      else if (event.name === 'run.discard') { // safe indempotent termination for cleanup
        console.log(`[agentFetch][${run.id}] run discarded`);

        if (isFirstEventSent) {
          throw new Error(`[agentFetch][${run.id}] "run.discard" can be only called as a first event.`);
        }
        isFirstEventSent = true;

        await withOrg(run.organizationId, async (tx) => {
          await terminateRun(tx, session.id, run.id, {
            status: 'discarded',
            failReason: event.data,
          });
        });
      }
      else if (event.name === 'run.accept') { // set run as in progress!
        console.log(`[agentFetch][${run.id}] run accepted`);

        if (isFirstEventSent) {
          throw new Error(`[agentFetch][${run.id}] "run.accept" can be only called as a first event.`);
        }
        isFirstEventSent = true;

        await withTenant(principal, async (tx) => {
          await tx.acquireLock({ type: "edit_session", sessionId: session.id });
          
          await acceptRun(tx, session.id, run.id);
          await activateSession(tx, session.id);
        });
      }
    }

    console.log(`[agentFetch][${run.id}] calling agent API`);

    await adapter.callAgent(body, agentUrl, send, abortController.signal);

    console.log(`[agentFetch][${run.id}] agent API call finished`);

  } catch (error) {
    /**
     * This is severe error and always should be investigated. An unhandled error propagated from adapter here. The cleanup should be always graceful, so this is severe.
     */
    finalError = error instanceof Error ? error.message : String(error);
    console.log(`[agentFetch][${run.id}] SEVERE, please investigate. Error: "${finalError}"`);

  } finally {

    // best effort cleanup
    try {
      console.log(`[agentFetch][${run.id}] cleaning up`);

      await withOrg(run.organizationId, async (tx) => {
        await terminateRun(tx, run.sessionId, run.id, {
          status: 'failed',
          failReason: { message: finalError ?? "The job ended with unfinished work. This should never happen." },
        });
      });

      clearTerminationListener?.();

    } catch {}
  }
}
