import { db__dangerous } from './db';
import { withOrg } from './withOrg';
import { runs, webhookJobs, environments, sessionItems, channelMessages, channels, sessions, endUsers } from './schemas/schema';
import { eq, and, lt, or, isNull, desc } from 'drizzle-orm';
import { getEnvironment, type Env } from './environments';
import { initDb } from './initDb';
import { generateSessionSummary } from './summaries';
import { fetchSession } from './sessions';
import { callAgentAPI, AgentAPIError } from './agentApi';
import { callAgentAPIAISDK } from './ai-sdk/agentApi';
import { BaseConfigSchemaToZod } from 'agentview/configUtils';
import { applyRunPatch } from './applyRunPatch';
import { resolveVersion } from './versions';
import type { RunBody } from 'agentview/apiTypes';
import { processGmailWatchRenewals } from './gmail/index';
import { findUser } from './users';
import { randomBytes } from 'crypto';

await initDb();

/**
 * Worker processes run without user context and need to access data across all organizations.
 *
 * Pattern:
 * - Initial queries to find work (expired runs, pending jobs) use db__dangerous for cross-org scans
 * - Once a specific record is found, use withOrg(record.organizationId) for all subsequent operations
 *   to enforce RLS as defense-in-depth
 */

async function processExpiredRuns() {
  try {
    const now = new Date().toISOString();

    // Find all runs that are in_progress and have expired
    const expiredRuns = await db__dangerous
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.status, 'in_progress'),
          lt(runs.expiresAt, now)
        )
      );

    if (expiredRuns.length === 0) {
      return;
    }

    // Update each expired run (using withOrg for RLS enforcement)
    for (const run of expiredRuns) {
      await withOrg(run.organizationId, async (tx) => {
        await tx
          .update(runs)
          .set({
            expiresAt: null,
            finishedAt: now,
            status: 'failed',
            failReason: { message: 'Timeout' },
            fetchStatus: null,
          })
          .where(eq(runs.id, run.id));
      });
    }

    if (expiredRuns.length > 0) {
      console.log(`Processed ${expiredRuns.length} expired run(s)`);
    }

  } catch (error) {
    console.error('Error processing expired runs:', error);
  }
}

// Webhook job retry delays: 5s, 30s, 2min
const RETRY_DELAYS = [5_000, 30_000, 120_000];

async function processWebhookJobs() {
  try {
    const now = new Date().toISOString();

    // Find jobs ready to be processed (cross-org scan needs db__dangerous)
    const jobs = await db__dangerous
      .select()
      .from(webhookJobs)
      .where(
        and(
          eq(webhookJobs.status, 'pending'),
          or(isNull(webhookJobs.nextAttemptAt), lt(webhookJobs.nextAttemptAt, now))
        )
      )
      .limit(10);

    for (const job of jobs) {
      const environment = await withOrg(job.organizationId, async (tx) => {
        return tx.query.environments.findFirst({
          where: eq(environments.id, job.environmentId),
        });
      });

      if (!environment) {
        console.error(`Environment ${job.environmentId} not found`);
        continue;
      }

      const config = environment.config as any;
      const webhookUrl = config?.webhookUrl;

      await processWebhookJob(job, config, webhookUrl);
    }
  } catch (error) {
    console.error('Error in webhook job processor:', error);
  }
}

async function processWebhookJob(job: typeof webhookJobs.$inferSelect, config: any, webhookUrl: string | undefined) {
  const now = new Date();

  // Mark as processing (using withOrg for RLS enforcement)
  await withOrg(job.organizationId, async (tx) => {
    await tx.update(webhookJobs)
      .set({ status: 'processing', updatedAt: now.toISOString() })
      .where(eq(webhookJobs.id, job.id));
  });

  try {
    // summary generation
    if (job.eventType === 'session.generate_summary') {
      const payload = job.payload as { session_id: string };
      const disableSummaries = config?.__internal?.disableSummaries;

      if (disableSummaries) {
        throw new Error(`Summary generation is disabled`);
      }

      await generateSessionSummary(payload.session_id, job.organizationId);
    }
    // webhook
    else {
      if (!webhookUrl) {
        throw new Error(`Webhook URL is not configured`); // if webhook url disappeared while job is pending -> fail the job.
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: job.eventType,
          payload: job.payload,
          job_id: job.id,
        }),
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}: ${await response.text()}`);
      }

      console.log(`Webhook job ${job.id} completed successfully`);
    }

    // Success - mark as completed
    await withOrg(job.organizationId, async (tx) => {
      await tx.update(webhookJobs)
        .set({ status: 'completed', updatedAt: new Date().toISOString() })
        .where(eq(webhookJobs.id, job.id));
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const newAttempts = job.attempts + 1;

    if (newAttempts >= job.maxAttempts) {
      // Failed permanently
      await withOrg(job.organizationId, async (tx) => {
        await tx.update(webhookJobs)
          .set({
            status: 'failed',
            attempts: newAttempts,
            lastError: errorMessage,
            updatedAt: new Date().toISOString()
          })
          .where(eq(webhookJobs.id, job.id));
      });

      console.error(`Webhook job ${job.id} failed permanently after ${newAttempts} attempts: ${errorMessage}`);
    } else {
      // Schedule retry with backoff
      const delay = RETRY_DELAYS[Math.min(newAttempts - 1, RETRY_DELAYS.length - 1)];
      const nextAttemptAt = new Date(now.getTime() + delay).toISOString();

      await withOrg(job.organizationId, async (tx) => {
        await tx.update(webhookJobs)
          .set({
            status: 'pending',
            attempts: newAttempts,
            nextAttemptAt,
            lastError: errorMessage,
            updatedAt: now.toISOString()
          })
          .where(eq(webhookJobs.id, job.id));
      });

      console.log(`Webhook job ${job.id} failed, scheduling retry ${newAttempts}/${job.maxAttempts} at ${nextAttemptAt}`);
    }
  }
}

async function processAgentFetches() {
  try {
    // Find runs with fetchStatus = 'pending'
    const pendingRuns = await db__dangerous
      .select()
      .from(runs)
      .where(eq(runs.fetchStatus, 'pending'))
      .limit(5);

    for (const run of pendingRuns) {
      // CAS: set fetchStatus to 'fetching' only if still 'pending'
      const [updated] = await db__dangerous
        .update(runs)
        .set({ fetchStatus: 'fetching', updatedAt: new Date().toISOString() })
        .where(and(eq(runs.id, run.id), eq(runs.fetchStatus, 'pending')))
        .returning({ id: runs.id });

      if (updated) {
        // Fire and forget - don't await
        processAgentFetch(run).catch((error) => {
          console.error(`Unhandled error in processAgentFetch for run ${run.id}:`, error);
        });
      }
    }
  } catch (error) {
    console.error('Error in agent fetch processor:', error);
  }
}

async function processAgentFetch(run: typeof runs.$inferSelect) {
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

async function processChannelMessages() {
  try {
    const received = await db__dangerous
      .select()
      .from(channelMessages)
      .where(eq(channelMessages.status, 'received'))
      .limit(20);

    for (const message of received) {
      try {
        // Set status → processing
        await withOrg(message.organizationId, async (tx) => {
          await tx.update(channelMessages).set({
            status: 'processing',
            updatedAt: new Date().toISOString(),
          }).where(eq(channelMessages.id, message.id));
        });

        // Look up the channel
        const channel = await db__dangerous.query.channels.findFirst({
          where: eq(channels.id, message.channelId),
        });

        if (!channel || channel.status !== 'active') {
          console.warn(`[channel-message] Skipping message ${message.id}: channel inactive or not found`);
          await withOrg(message.organizationId, async (tx) => {
            await tx.update(channelMessages).set({
              status: 'failed',
              updatedAt: new Date().toISOString(),
            }).where(eq(channelMessages.id, message.id));
          });
          continue;
        }

        if (!channel.environmentId || !channel.agent) {
          console.warn(`[channel-message] Skipping message ${message.id}: channel has no routing configured`);
          await withOrg(message.organizationId, async (tx) => {
            await tx.update(channelMessages).set({
              status: 'failed',
              updatedAt: new Date().toISOString(),
            }).where(eq(channelMessages.id, message.id));
          });
          continue;
        }

        // Look up environment and validate agent
        const environment = await withOrg(message.organizationId, async (tx) => {
          return tx.query.environments.findFirst({
            where: eq(environments.id, channel.environmentId!),
          });
        });

        if (!environment) {
          console.warn(`[channel-message] Skipping message ${message.id}: environment ${channel.environmentId} not found`);
          await withOrg(message.organizationId, async (tx) => {
            await tx.update(channelMessages).set({
              status: 'failed',
              updatedAt: new Date().toISOString(),
            }).where(eq(channelMessages.id, message.id));
          });
          continue;
        }

        const config = BaseConfigSchemaToZod.parse(environment.config);
        const agentConfig = config.agents?.find((a) => a.name === channel.agent);

        if (!agentConfig) {
          console.warn(`[channel-message] Skipping message ${message.id}: agent '${channel.agent}' not found in config`);
          await withOrg(message.organizationId, async (tx) => {
            await tx.update(channelMessages).set({
              status: 'failed',
              updatedAt: new Date().toISOString(),
            }).where(eq(channelMessages.id, message.id));
          });
          continue;
        }

        // Find or create end user
        await withOrg(message.organizationId, async (tx) => {
          let user: typeof endUsers.$inferSelect | undefined;

          if (message.contactKind === 'email') {
            user = await findUser(tx, { email: message.contact, organizationId: message.organizationId });
          }

          if (!user) {
            const [newUser] = await tx.insert(endUsers).values({
              organizationId: message.organizationId,
              email: message.contactKind === 'email' ? message.contact : null,
              createdBy: null,
              space: 'production',
              token: randomBytes(32).toString('hex'),
            }).returning();
            user = newUser;
          }

          // Find existing session by channelId + channelThreadId + agent
          let session = await tx.query.sessions.findFirst({
            where: and(
              eq(sessions.channelId, message.channelId),
              eq(sessions.agent, channel.agent!),
              eq(sessions.userId, user.id),
              message.threadId
                ? eq(sessions.channelThreadId, message.threadId)
                : isNull(sessions.channelThreadId),
            ),
          });

          if (!session) {
            // Generate handle number — production users have empty suffix
            const handleSuffix = '';
            const sessionWithHighestHandle = await tx.query.sessions.findFirst({
              orderBy: (sessions, { desc }) => [desc(sessions.handleNumber)],
              where: eq(sessions.handleSuffix, handleSuffix),
            });
            const newHandleNumber = sessionWithHighestHandle ? sessionWithHighestHandle.handleNumber + 1 : 1;

            const [newSession] = await tx.insert(sessions).values({
              organizationId: message.organizationId,
              handleNumber: newHandleNumber,
              handleSuffix,
              agent: channel.agent!,
              userId: user.id,
              channelId: message.channelId,
              channelThreadId: message.threadId ?? null,
            }).returning();
            session = newSession;
          }

          const providerData = message.providerData as any;
          const handle = session.handleNumber.toString() + (session.handleSuffix ?? '');
          console.log(`[channel-message] Processed → session #${handle} | user: ${user.email ?? user.id} | subject: ${providerData?.subject ?? '-'}`);

          // Set status → processed
          await tx.update(channelMessages).set({
            status: 'processed',
            updatedAt: new Date().toISOString(),
          }).where(eq(channelMessages.id, message.id));
        });
      } catch (msgError) {
        console.error(`[channel-message] Error processing message ${message.id}:`, msgError);
        try {
          await withOrg(message.organizationId, async (tx) => {
            await tx.update(channelMessages).set({
              status: 'failed',
              updatedAt: new Date().toISOString(),
            }).where(eq(channelMessages.id, message.id));
          });
        } catch { /* best-effort */ }
      }
    }
  } catch (error) {
    console.error('Error in channel message processor:', error);
  }
}

// Run expired runs processor every second
setInterval(() => {
  processExpiredRuns();
}, 1000);

// Run webhook job processor every 3 seconds
setInterval(() => {
  processWebhookJobs();
}, 3000);

// Run agent fetch processor every 2 seconds
setInterval(() => {
  processAgentFetches();
}, 1000);

// Run channel message processor every 2 seconds
setInterval(() => {
  processChannelMessages();
}, 2000);

// Run Gmail watch renewal every hour
setInterval(() => {
  processGmailWatchRenewals();
}, 60 * 60 * 1000);

// Run immediately on startup
processExpiredRuns();
processWebhookJobs();
processAgentFetches();
processChannelMessages();
processGmailWatchRenewals();
