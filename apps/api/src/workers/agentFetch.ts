import type { ManualRunUpdate, RunBody } from 'agentview/apiTypes';
import { findChannelConfig, getChannelAgent, requireRunConfig } from 'agentview/baseConfigUtils';
import { eq, inArray, sql } from 'drizzle-orm';
import { getAdapter } from '../adapters/adapters';
import { db__dangerous } from '../db';
import { getConfigFromEnvironment } from '../environments';
import { log, setContext } from '../logger';
import { applyRunPatch, RunTerminationError, terminateRun, acceptRun, fastApplyRunPatch, type FastPatchOp } from '../runs';
import { getEventReceiver } from '../redisPubSub';
import { environments, runs } from '../schemas/schema';
import { activateSession, requireSession } from '../sessions';
import { withOrg, withTenant } from '../withOrg';
import { createEventDrivenWorker } from './utils';
import type { ServicePrincipal } from '../authMiddleware';

type Run = typeof runs.$inferSelect;

const eventReceiver = await getEventReceiver(); // singleton — one Redis connection per worker process

export const agentFetchWorker = createEventDrivenWorker<Run>({
  name: 'agent-fetch',
  fallbackPollIntervalMs: 5000, // safety net — events drive the fast path
  maxConcurrency: 1000,
  subscribe(onEvent) {
    const unsubscribe = eventReceiver.on('run.created', () => onEvent());
    return { close: unsubscribe };
  },
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


let fetchCounter = 0;
async function processAgentFetch(run: Run) {
  const fetchId = `f${++fetchCounter}`

  setContext({ fetchId, runId: run.id, sessionId: run.sessionId, organizationId: run.organizationId });

  log.info(`FETCH run:${run.id} session:${run.sessionId}`);

  const abortController = new AbortController();

  let clearTerminationListener: (() => void) | undefined;

  let finalError: string | undefined = undefined;

  try {
    const { agentConfig, agentUrl, session, environment } = await withOrg(run.organizationId, async (tx) => {

      const session = await requireSession(tx, run.sessionId, { includeInitRun: true, includeDiscardedRun: true, includePendingRun: true });
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

    if (!session.agentRef) {
      throw new Error(`Session ${session.id} has no agent ref. It totally should have one at this point.`);
    }

    const lastRun = session.runs[session.runs.length - 1];

    if (lastRun.status === 'discarded') { // it's possible run is discarded between claim and session fetch
      log.info(`Last run is discarded. Returning.`);
      return;
    }
    else if (lastRun.status !== 'init') { // sanity check
      throw new Error(`Last run in impossible status: ${lastRun.status}`);
    }

    const runConfig = requireRunConfig(agentConfig, lastRun.sessionItems[0].content);



    // const fullRun = session.runs.find(r => r.id === run.id);
    // if (!fullRun) {
    //   throw new Error(`Run ${run.id} not found`);
    // }

    // if (!fullRun.agentRef) {
    //   throw new Error(`Run ${run.id} has no agent ref`);
    // }


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
    const adapter = getAdapter(session.agentRef.adapter);

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

    clearTerminationListener = eventReceiver.on('run.terminated', run.id, (event) => {
      const terminationError = new RunTerminationError(event.reason);
      log.debug('"run.terminated" signal received: ' + terminationError.toString());
      abortController.abort(terminationError);
    });

    let isFirstEventSent = false;

    const principal : ServicePrincipal = {
      type: 'service',
      organizationId: run.organizationId,
      env: environment.handle,
    };
    
    // event handlers
    type DiscardEvent = { name: 'run.discard', data: any };
    type PatchEvent = { name: 'run.patch', data: ManualRunUpdate };
    type FastPatchEvent = { name: 'fast.patch', data: FastPatchOp };
    type AcceptEvent = { name: 'run.accept', data: any };
    type SendEvent = DiscardEvent | PatchEvent | FastPatchEvent | AcceptEvent;

    const send = async (event: SendEvent) => {
      // log.debug('event received: ' + event.name);

      if (event.name === 'run.patch') {
        if (!isFirstEventSent) {
          throw new Error("run.patch called as a first event");
        }

        await withTenant(principal, async (tx) => {
          await applyRunPatch(
            tx,
            run.id,
            event.data
          );
        })
      }

      if (event.name === 'fast.patch') {
        if (!isFirstEventSent) {
          throw new Error("fast.patch called as a first event");
        }

        const start = Date.now();

        await withTenant(principal, async (tx) => {
          await fastApplyRunPatch(
            tx,
            run.id,
            session.id,
            runConfig,
            event.data
          );
        })

        const duration = Date.now() - start;
        log.debug({ "patchtime": duration });
      }


      /**
       * Discard and streaming started are only FIRST THINGS that should happen before streaming starts. Either run is discarded or streaming started, which means it becomes in_progress.
       * This is *INTERNAL* api, not public (like run.patch)
       */
      else if (event.name === 'run.discard') { // safe indempotent termination for cleanup
        if (isFirstEventSent) {
          throw new Error(`run.discard called not as a first event`);
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
        if (isFirstEventSent) {
          throw new Error(`run.discard called not as a first event`);
        }
        isFirstEventSent = true;

        await withTenant(principal, async (tx) => {
          await tx.acquireLock({ type: "create_resource" }); // handles!
          await tx.acquireLock({ type: "edit_session", sessionId: session.id });
          
          await acceptRun(tx, session.id, run.id);
          await activateSession(tx, session.id);
        });
      }
    }

    await adapter.callAgent(body, agentUrl, send, abortController.signal);

  } catch (error) {
    /**
     * This is severe error and always should be investigated. An unhandled error propagated from adapter here. The cleanup should be always graceful, so this is severe.
     */
    finalError = error instanceof Error ? error.message : String(error);
    log.error({ err: error }, 'Unhanled error: ' + finalError);

  } finally {

    // best effort cleanup
    try {
      await withOrg(run.organizationId, async (tx) => {
        await terminateRun(tx, run.sessionId, run.id, {
          status: 'failed',
          failReason: { message: finalError ?? "The job ended with unfinished work. This should never happen." },
        });
      });

      clearTerminationListener?.();

    } catch {}

    log.info('Finished');
  }
}
