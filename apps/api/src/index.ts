import 'dotenv/config'
import { serve } from '@hono/node-server'
import { HTTPException } from 'hono/http-exception'

import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { APIError } from "better-auth/api";

import { z, createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { db } from './db'
import { client, thread, activity, run, email, commentMessages, commentMessageEdits, commentMentions, versions, scores } from './db/schema'
import { eq, desc, and, inArray} from 'drizzle-orm'
import { response_data, response_error, body } from './hono_utils'
import { isUUID } from './isUUID'
import { isAsyncIterable, extractMentions } from './utils'
import { auth } from './auth'
import { createInvitation, cancelInvitation, getPendingInvitations, getValidInvitation } from './invitations'
import { fetchThread } from './threads'
import { callAgentAPI } from './agentApi'
import { getStudioURL } from './getStudioURL'

// shared imports
import { getAllActivities, getLastRun } from './shared/threadUtils'
import { ClientSchema, ThreadSchema, ThreadCreateSchema, ActivityCreateSchema, RunSchema, type User, type Thread, type Activity } from './shared/apiTypes'
import { config } from './shared/agentview.config'


export const app = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {

      return c.json({
        message: 'Validation error',
        issues: result.error.issues
      }, 422) 

    }
  }
})

app.use('*', cors({
  origin: [getStudioURL()],
  credentials: true,
}))

/* --------- AUTH --------- */

app.on(["POST", "GET"], "/api/auth/*", (c) => {
	return auth.handler(c.req.raw);
});


/* --------- CLIENTS --------- */

// API Clients POST
const apiClientsPOSTRoute = createRoute({
  method: 'post',
  path: '/api/clients',
  request: {
    body: body(z.object({}))
  },
  responses: {
    201: response_data(ClientSchema)
  },
})

app.openapi(apiClientsPOSTRoute, async (c) => {
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) {
      return c.json({ message: "Authentication required" }, 401);
    }

    const [newClient] = await db.insert(client).values({
      simulated_by: session.user.id,
    }).returning();
    
    return c.json(newClient, 201);
  } catch (error: any) {
    return errorToResponse(c, error);
  }
})


// Client GET
const clientGETRoute = createRoute({
  method: 'get',
  path: '/api/clients/{id}',
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: response_data(ClientSchema),
    404: response_error()
  },
})

app.openapi(clientGETRoute, async (c) => {
  const { id } = c.req.param()

  const clientRow = await db.query.client.findFirst({
    where: eq(client.id, id),
  });

  if (!clientRow) {
    return c.json({ message: "Client not found" }, 404);
  }

  return c.json(clientRow, 200);
})



/* --------- THREADS --------- */



// Threads GET (list all threads with filtering)
const threadsGETRoute = createRoute({
  method: 'get',
  path: '/api/threads',
  request: {
    query: z.object({
      list: z.enum(['real', 'simulated_private', 'simulated_shared']).optional(),
    }),
  },
  responses: {
    200: response_data(z.array(ThreadSchema)),
    401: response_error(),
  },
})

app.openapi(threadsGETRoute, async (c) => {
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) {
      return c.json({ message: "Authentication required" }, 401);
    }

    const list = c.req.query().list || 'real';
    const userId = session.user.id;

    const threadRows = await db.query.thread.findMany({
      with: {
        activities: {
          orderBy: (activity: any, { desc }: any) => [desc(activity.created_at)],
        },
        client: {
          with: {
            simulatedBy: true
          }
        }
      },
      orderBy: (thread: any, { desc }: any) => [desc(thread.updated_at)]
    })

    const threadRowsFiltered = threadRows.filter((thread: any) => {
      if (list === "real") {
        return thread.client.simulatedBy === null;
      } else if (list === "simulated_private") {
        return thread.client.simulatedBy !== null && thread.client.simulatedBy.id === userId;
      } else if (list === "simulated_shared") {
        return thread.client.simulatedBy !== null && thread.client.is_shared;
      }
    })

    return c.json(threadRowsFiltered, 200);
  } catch (error: any) {
    return errorToResponse(c, error);
  }
})

// Threads POST
const threadsPOSTRoute = createRoute({
  method: 'post',
  path: '/api/threads',
  request: {
    body: body(ThreadCreateSchema)
  },
  responses: {
    201: response_data(ThreadSchema),
    400: response_error()
  },
})

app.openapi(threadsPOSTRoute, async (c) => {
  const body = await c.req.json()

  // Find thread configuration by type
  const threadConfig = config.threads.find((t: any) => t.type === body.type);
  if (!threadConfig) {
    return c.json({ message: `Thread type '${body.type}' not found in configuration` }, 400);
  }

  // Validate metadata against the schema
  try {
    threadConfig.metadata.parse(body.metadata);
  } catch (error: any) {
    return c.json({ message: error.message }, 400);
  }


  // Validate whether client exists in db
  if (!isUUID(body.client_id)) {
    return c.json({ message: `Invalid client id: ${body.client_id}` }, 400);
  }

  const clientExists = await db.query.client.findFirst({
    where: eq(client.id, body.client_id)
  });
  if (!clientExists) {
    return c.json({ message: `Client with id '${body.client_id}' does not exist` }, 400);
  }

  const [newThread] = await db.insert(thread).values(body).returning();

  return c.json(await fetchThread(newThread.id), 201);
})

// Thread GET
const threadGETRoute = createRoute({
  method: 'get',
  path: '/api/threads/{thread_id}',
  request: {
    params: z.object({
      thread_id: z.string(),
    }),
  },
  responses: {
    200: response_data(ThreadSchema),
    404: response_error()
  },
})



app.openapi(threadGETRoute, async (c) => {
  const { thread_id } = c.req.param()

  const threadRow = await fetchThread(thread_id);

  if (!threadRow) {
    return c.json({ message: "Thread not found" }, 404);
  }

  return c.json(threadRow, 200);
})


/* --------- RUNS --------- */


// Create run
const runsPOSTRoute = createRoute({
  method: 'post',
  path: '/api/threads/{thread_id}/runs',
  request: {
    params: z.object({
      thread_id: z.string(),
    }),
    body: body(z.object({
      input: ActivityCreateSchema
    }))
  },
  responses: {
    201: response_data(RunSchema), // todo: this sucks I guess
    400: response_error(),
    404: response_error()
  },
})

app.openapi(runsPOSTRoute, async (c) => {
  const { thread_id } = c.req.param()
  const { input: { type, role, content } } = await c.req.json()

  const threadRow = await fetchThread(thread_id);

  if (!threadRow) {
    return c.json({ message: "Thread not found" }, 404);
  }

  // Find thread configuration by type
  const threadConfig = config.threads.find((t: any) => t.type === threadRow.type);
  if (!threadConfig) {
    return c.json({ message: `Thread type '${threadRow.type}' not found in configuration` }, 400);
  }

  if (role !== "user") {
    return c.json({ message: "Only activities with role 'user' are allowed" }, 400);
  }

  // Find activity configuration by type and role
  const activityConfig = threadConfig.activities.find((a: any) => a.type === type && a.role === role);
  if (!activityConfig) {
    return c.json({ message: `Activity type '${type}' with role '${role}' not found in configuration` }, 400);
  }

  // Validate content against the schema
  try {
    activityConfig.content.parse(content);
  } catch (error: any) {
    return c.json({ message: `Invalid content: ${error.message}` }, 400);
  }

  const lastRun = getLastRun(threadRow)

  // Check thread status conditions
  if (lastRun?.state === 'in_progress') {
    return c.json({ message: `Cannot add user activity when thread is in 'in_progress' state.` }, 400);
  }

  // Create user activity and run
  const userActivity = await db.transaction(async (tx) => {

    // Create a new run with status 'in_progress' and set trigger_activity_id
    const [newRun] = await tx.insert(run).values({
      thread_id,
      state: 'in_progress',
    }).returning();

    // Thread status is 'idle', so we can proceed
    // First create the activity
    const [userActivity] = await tx.insert(activity).values({
      thread_id,
      type,
      role,
      content,
      run_id: newRun.id,
    }).returning();

    // Return the activity with the run_id
    return userActivity;
  });

  /*** 
   * 
   * SIMULATION OF THE BACKGROUND JOB RUNNING
   * 
   * This should go to the queue but for now is scheduled in HTTP Server process
   * 
   * Caveats:
   * - when server goes down then state is not recovered (dangling `in_progress` run)
   * 
   ***/

  (async () => {

    const input = {
      thread: {
        id: threadRow.id,
        created_at: threadRow.created_at,
        updated_at: threadRow.updated_at,
        metadata: threadRow.metadata,
        client_id: threadRow.client_id,
        type: threadRow.type,
        activities: [...getAllActivities(threadRow), userActivity]
      }
    }

    function validateActivity(activity: any) {
      const activitySchemas = threadConfig.activities
        .filter((a: any) => a.role !== 'user') // Exclude user activities from output validation
        .map((a: any) =>
          z.object({
            type: z.literal(a.type),
            role: z.literal(a.role),
            content: a.content
          })
        );

      const schema = z.union(activitySchemas);
      schema.parse(activity);
    }

    async function isStillRunning() {
      const currentRun = await db.query.run.findFirst({ where: eq(run.id, userActivity.run_id) });
      if (currentRun && currentRun.state === 'in_progress') {
        return true
      }
      return false
    }

    async function validateAndInsertActivity(activityData: any) {
      try {
        validateActivity(activityData);
      }
      catch (error: any) {
        throw {
          error: error.message,
        }
      }

      if (!(await isStillRunning())) {
        throw new Error('Run is not in progress')
      }

      const [newActivity] = await db.insert(activity).values({
        thread_id,
        type: activityData.type,
        role: activityData.role,
        content: activityData.content,
        run_id: userActivity.run_id,
      }).returning();

      return newActivity;
    }

    try {
      // Try streaming first, fallback to non-streaming
      const runOutput = callAgentAPI(input)
      let versionId: string | null = null;

      let firstItem = true;
      for await (const event of runOutput) {

        // The first yield MUST be a manifest
        if (firstItem && event.name !== 'manifest') {
          throw { 
            message: "No 'manifest' was sent by the agent." 
          };
        }

        if (event.name === 'manifest') {
          // Create or find existing version
          const [version] = await db.insert(versions).values({
            version: event.data.version,
            env: event.data.env || 'dev',
            metadata: event.data.metadata || null,
          }).onConflictDoUpdate({
            target: [versions.version, versions.env],
            set: {
              metadata: event.data.metadata || null,
            }
          }).returning();
          
          versionId = version.id;
          
          // Update the run with version_id
          if (userActivity.run_id) {
            await db.update(run)
              .set({ version_id: versionId })
              .where(eq(run.id, userActivity.run_id));
          }
          
          firstItem = false;
          continue; // Skip this item as it's not an activity
        }
        else if (event.name === 'activity') {
          // This is a regular activity
          await validateAndInsertActivity(event.data)
        }
        else {
          throw {
            message: `Unknown event type: ${event.name}`
          }
        }
      }

        if (!(await isStillRunning())) {
          return
        }

        await db.update(run)
          .set({
            state: 'completed',
            finished_at: new Date(),
          })
          .where(eq(run.id, userActivity.run_id));
    }
    catch (error: any) {
      if (!(await isStillRunning())) {
        return
      }

      // Handle transport errors (connection dropped, etc.)
      const failReason = typeof error?.message === 'string' 
        ? error
        : { message: "[internal error]", details: error }
      
      await db.update(run)
        .set({
          state: 'failed',
          finished_at: new Date(),
          fail_reason: failReason
          })
          .where(eq(run.id, userActivity.run_id));
    }




    // try {
    //   // Try streaming first, fallback to non-streaming
    //   try {
    //     console.log('trying streaming agent API')
    //     const runOutput = callAgentApiStream(input)
    //     let versionId: string | null = null;

    //     let firstItem = true;
    //     for await (const item of runOutput) {
    //       // The first yield MUST be a manifest
    //       if (firstItem) {
    //         if (!item || typeof item !== 'object' || !('type' in item) || item.type !== 'manifest') {
    //           throw { 
    //             message: "No 'manifest' was sent by the agent." 
    //           };
    //         }
            
    //         const versionManifest = item as { type: string; version: string; env?: string; metadata?: any };
    //         console.log('Version manifest received:', versionManifest);
            
    //         // Create or find existing version
    //         const [version] = await db.insert(versions).values({
    //           version: versionManifest.version,
    //           env: versionManifest.env || 'dev',
    //           metadata: versionManifest.metadata || null,
    //         }).onConflictDoUpdate({
    //           target: [versions.version, versions.env],
    //           set: {
    //             metadata: versionManifest.metadata || null,
    //           }
    //         }).returning();
            
    //         versionId = version.id;
            
    //         // Update the run with version_id
    //         if (userActivity.run_id) {
    //           await db.update(run)
    //             .set({ version_id: versionId })
    //             .where(eq(run.id, userActivity.run_id));
    //         }
            
    //         firstItem = false;
    //         continue; // Skip this item as it's not an activity
    //       }
          
    //       // This is a regular activity
    //       await validateAndInsertActivity(item)
    //     }
    //   } catch (streamError: any) {
    //     console.log('streaming failed, trying non-streaming:', streamError.message)
        
    //     // Fallback to non-streaming API
    //     const result = await callAgentApi(input);

    //     if (!result || typeof result !== 'object' || !('manifest' in result) || !('activities' in result)) {
    //       throw { 
    //         message: "Agent API must return { manifest, activities }" 
    //       };
    //     }

    //     const { manifest, activities } = result;

    //     // Handle manifest
    //     if (manifest && typeof manifest === 'object' && 'version' in manifest) {
    //       const versionManifest = manifest as { version: string; env?: string; metadata?: any };
    //       console.log('Version manifest received:', versionManifest);
          
    //       // Create or find existing version
    //       const [version] = await db.insert(versions).values({
    //         version: versionManifest.version,
    //         env: versionManifest.env || 'dev',
    //         metadata: versionManifest.metadata || null,
    //       }).onConflictDoUpdate({
    //         target: [versions.version, versions.env],
    //         set: {
    //           metadata: versionManifest.metadata || null,
    //         }
    //       }).returning();
          
    //       const versionId = version.id;
          
    //       // Update the run with version_id
    //       if (userActivity.run_id) {
    //         await db.update(run)
    //           .set({ version_id: versionId })
    //           .where(eq(run.id, userActivity.run_id));
    //       }
    //     }

    //     // Handle activities
    //     if (!Array.isArray(activities)) {
    //       throw { 
    //         message: "Activities must be an array" 
    //       };
    //     }

    //     for (const activityData of activities) {
    //       await validateAndInsertActivity(activityData)
    //     }
    //   }

    //   console.log('updating run as completed')

    //   if (!(await isStillRunning())) {
    //     return
    //   }

    //   await db.update(run)
    //     .set({
    //       state: 'completed',
    //       finished_at: new Date(),
    //     })
    //     .where(eq(run.id, userActivity.run_id));
    // }
    // catch (error: any) {
    //   console.log('Catch!', error)

    //   if (!(await isStillRunning())) {
    //     return
    //   }
      
    //   // Handle transport errors (connection dropped, etc.)
    //   const failReason = error.message 
    //     ? { message: error.message, details: error }
    //     : { message: "Error in agent API call", details: error }
      
    //   await db.update(run)
    //     .set({
    //       state: 'failed',
    //       finished_at: new Date(),
    //       fail_reason: failReason
    //       })
    //       .where(eq(run.id, userActivity.run_id));
    //   }

  })();

  const thread = await fetchThread(thread_id);
  const newRun = getLastRun(thread);

  return c.json(newRun, 201);
})


// Cancel Run Endpoint
const runCancelRoute = createRoute({
  method: 'post',
  path: '/api/threads/{thread_id}/cancel_run',
  request: {
    params: z.object({
      thread_id: z.string(), 
    }),
  },
  responses: {
    200: response_data(z.object({})),
    400: response_error(),
    404: response_error(),
  },
});

app.openapi(runCancelRoute, async (c) => {
  const { thread_id } = c.req.param();

  const threadRow = await fetchThread(thread_id);
  if (!threadRow) {
    return c.json({ message: 'Thread not found' }, 404);
  }

  const lastRun = getLastRun(threadRow)

  if (lastRun?.state !== 'in_progress') {
    return c.json({ message: 'Run is not in progress' }, 400);
  }
  // Set the run as failed
  await db.update(run)
    .set({
      state: 'failed',
      finished_at: new Date(),
      fail_reason: { message: 'Run was cancelled by user' }
    })
    .where(eq(run.id, lastRun.id));

  return c.json(await fetchThread(thread_id), 200);
});

const runWatchRoute = createRoute({
  method: 'get',
  path: '/api/threads/{thread_id}/watch_run',
  request: {
    params: z.object({
      thread_id: z.string()
    }),
    // query: z.object({
    //   last_activity_id: z.string().optional(),
    // })
  },
  responses: {
    // 201: response_data(z.array(ActivitySchema)),
    400: response_error(),
    404: response_error()
  },
})



// Activities Watch (SSE)
app.openapi(runWatchRoute, async (c) => {
  const { thread_id } = c.req.param()

  const threadRow = await requireThread(thread_id)

  const lastRun = getLastRun(threadRow)
  // const activities = getAllActivities(threadRow)


  // if (lastRun?.state !== 'in_progress') {
  //   return c.json({ message: "Thread active run must be in 'in_progress' state to watch" }, 400);
  // }


  // 4. Start SSE stream
  return streamSSE(c, async (stream) => {
    let running = true;
    stream.onAbort(() => {
      running = false;
    });

    // Always start with thread.state in_progress
    await stream.writeSSE({
      data: JSON.stringify({ state: lastRun?.state }),
      event: 'state',
    });

    let sentActivityIds: string[] = [];

    /**
     * 
     * POLLING HERE
     * 
     * Soon we'll need to create a proper messaging, when some LLM API will be streaming characters then even NOTIFY/LISTEN won't make it performance-wise.
     * 
     */
    while (running) {
      const threadRow = await fetchThread(thread_id);
      const lastRun = getLastRun(threadRow)

      if (!threadRow || !lastRun) {
        throw new Error('unreachable');
      }

      const activities = getAllActivities(threadRow)

      for (const activity of activities) {
        if (sentActivityIds.includes(activity.id)) {
          continue;
        }
        sentActivityIds.push(activity.id)
        await stream.writeSSE({
          data: JSON.stringify(activity),
          event: 'activity',
        });
      }

      // End if run is no longer in_progress
      if (lastRun?.state !== 'in_progress') {

        const data: { state: string, fail_reason?: any } = { state: lastRun?.state }

        if (lastRun?.state === 'failed') {
          data.fail_reason = lastRun.fail_reason
        }

        await stream.writeSSE({
          data: JSON.stringify(data),
          event: 'state',
        });
        break;
      }

      // Wait 1s before next poll
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });
});



/* --------- FEED --------- */


function validateScore(thread: Thread, activity: Activity, scoreName: string, scoreValue: any, options?: { mustNotExist?: boolean }) {
  // Find the thread config
  const threadConfig = config.threads.find((t) => t.type === thread.type);
  if (!threadConfig) {
    throw new HTTPException(400, { message: `Thread type '${thread.type}' not found in configuration` });
  }

  // Find the activity config for this thread/activity
  const activityConfig = threadConfig.activities.find(
    (activityConfig) => activityConfig.type === activity.type && activityConfig.role === activity.role
  );

  const activityTypeCuteName = `${activity.type}' / '${activity.role}`

  if (!activityConfig) {
    throw new HTTPException(400, { message: `Activity '${activityTypeCuteName}' not found in configuration for thread type '${thread.type}'` });
  }

  // Find the score config for this activity
  const scoreConfig = activityConfig.scores?.find((scoreConfig) => scoreConfig.name === scoreName);
  if (!scoreConfig) {
    throw new HTTPException(400, { message: `Score name '${scoreName}' not found in configuration for activity  '${activityTypeCuteName}' in thread type '${thread.type}'` });
  }

  // Check if there is already a score with the same name in any commentMessage's scores
  if (activity.commentMessages && options?.mustNotExist === true) {
    for (const message of activity.commentMessages) {
      if (message.scores) {
        for (const score of message.scores) {
          if (score.name === scoreName && !score.deletedAt) {
            throw new HTTPException(400, { message: `A score with name '${scoreName}' already exists.` });
          }
        }
      }
    }
  }

  // Validate value against the schema
  try {
    scoreConfig.schema.parse(scoreValue);
  } catch (error: any) {
    throw new Error(`Invalid score value: ${error.message}`);
  }
}


async function requireSession(headers: Headers) {
  const session = await auth.api.getSession({ headers })
  if (!session) {
    throw new HTTPException(401, { message: "Authentication required" });
  }
  return session
}

async function requireThread(thread_id: string) {
  const thread = await fetchThread(thread_id)
  if (!thread) {
    throw new HTTPException(404, { message: "Thread not found" });
  }
  return thread
}

async function requireActivity(thread: Thread, activity_id: string) {
  const activity = getAllActivities(thread).find((a) => a.id === activity_id)
  if (!activity) {
    throw new HTTPException(404, { message: "Activity not found" });
  }
  return activity
}

async function requireCommentMessageFromUser(thread: Thread, activity: Activity, comment_id: string, user: User) {
  const comment = activity.commentMessages?.find((m) => m.id === comment_id && m.deletedAt === null)
  if (!comment) {
    throw new HTTPException(404, { message: "Comment not found" });
  }

  if (comment.userId !== user.id) {
    throw new HTTPException(401, { message: "You can only edit your own comments." });
  }

  return comment
}


const commentsPOSTRoute = createRoute({
  method: 'post',
  path: '/api/threads/{thread_id}/activities/{activity_id}/comments',
  request: {
    params: z.object({
      thread_id: z.string(),
      activity_id: z.string(),
    }),
    body: body(z.object({
      comment: z.string().optional(),
      scores: z.record(z.string(), z.any()).optional()
    }))
  },
  responses: {
    201: response_data(z.object({})),
    400: response_error(),
    401: response_error(),
    404: response_error(),
  },
})


app.openapi(commentsPOSTRoute, async (c) => {
  const body = await c.req.json()
  const { thread_id, activity_id } = c.req.param()
  
  try {
    const session = await requireSession(c.req.raw.headers);
    const thread = await requireThread(thread_id)
    const activity = await requireActivity(thread, activity_id);

    const inputScores = body.scores ?? {}

    for (const [scoreName, scoreValue] of Object.entries(inputScores)) {
      validateScore(thread, activity, scoreName, scoreValue, { mustNotExist: true })
    }

    await db.transaction(async (tx) => {

      // Add comment
      const [newMessage] = await tx.insert(commentMessages).values({
        activityId: activity_id,
        userId: session.user.id,
        content: body.comment ?? null,
      }).returning();

      // Add comment mentions
      if (body.comment) {
        let mentions;
        let userMentions: string[] = [];

        try {
          mentions = extractMentions(body.comment);
          userMentions = mentions.user_id || [];
        } catch (error) {
          return c.json({ message: `Invalid mention format: ${(error as Error).message}`}, 400)
        }

        if (userMentions.length > 0) {
          await tx.insert(commentMentions).values(
            userMentions.map((mentionedUserId: string) => ({
              commentMessageId: newMessage.id,
              mentionedUserId,
            }))
          );
        }
      }

      for (const [scoreName, scoreValue] of Object.entries(inputScores)) {
        await tx.insert(scores).values({
          activityId: activity_id,
          name: scoreName,
          value: scoreValue,
          commentId: newMessage.id,
          createdBy: session.user.id,
        })
      }
     
      // return newMessage;
    })

    return c.json({}, 201);

  } catch (error: any) {
    console.error('Error creating comment:', error);
    return c.json({ message: "Failed to create comment: " + error.message }, 400);
  }
})


// Comments DELETE (delete comment)
const commentsDELETERoute = createRoute({
  method: 'delete',
  path: '/api/threads/{thread_id}/activities/{activity_id}/comments/{comment_id}',
  request: {
    params: z.object({
      thread_id: z.string(),
      activity_id: z.string(),
      comment_id: z.string(),
    }),
  },
  responses: {
    200: response_data(z.object({})),
    400: response_error(),
    401: response_error(),
    404: response_error(),
  },
})

app.openapi(commentsDELETERoute, async (c) => {
  const { comment_id, thread_id, activity_id } = c.req.param()
  
  try {
    const session = await requireSession(c.req.raw.headers);
    const thread = await requireThread(thread_id)
    const activity = await requireActivity(thread, activity_id);
    const commentMessage = await requireCommentMessageFromUser(thread, activity, comment_id, session.user);

    await db.transaction(async (tx) => {
      await tx.delete(commentMentions).where(eq(commentMentions.commentMessageId, commentMessage.id));
      await tx.delete(scores).where(eq(scores.commentId, commentMessage.id));
      await tx.update(commentMessages).set({
        deletedAt: new Date(),
        deletedBy: session.user.id
      }).where(eq(commentMessages.id, commentMessage.id));

    });
    return c.json({}, 200);

  } catch (error: any) {
    return c.json({ message: "Failed to delete comment: " + error.message }, 400);
  }
})


/* --------- COMMENTS --------- */

// Comments POST (create new comment)
// const commentsPOSTRoute = createRoute({
//   method: 'post',
//   path: '/api/comments',
//   request: {
//     body: body(z.object({
//       content: z.string(),
//       activityId: z.string(),
//     }))
//   },
//   responses: {
//     201: response_data(CommentMessageSchema),
//     400: response_error(),
//     401: response_error(),
//   },
// })

// app.openapi(commentsPOSTRoute, async (c) => {
//   const body = await c.req.json()
  
//   try {
//     const session = await auth.api.getSession({ headers: c.req.raw.headers })
//     if (!session) {
//       return c.json({ message: "Authentication required" }, 401);
//     }


//     const newMessage = await db.transaction(async (tx) => {

//       // Create the comment message
//       const [newMessage] = await tx.insert(commentMessages).values({
//         activityId: body.activityId,
//         userId: session.user.id,
//         content: body.content,
//       }).returning();

//       // Handle mentions for new comments
//       let mentions;
//       let userMentions: string[] = [];

//       try {
//         mentions = extractMentions(body.content);
//         userMentions = mentions.user_id || [];
//       } catch (error) {
//         throw new Error(`Invalid mention format: ${(error as Error).message}`);
//       }

//       if (userMentions.length > 0) {
//         await tx.insert(commentMentions).values(
//           userMentions.map((mentionedUserId: string) => ({
//             commentMessageId: newMessage.id,
//             mentionedUserId,
//           }))
//         );
//       }

//       return newMessage;
//     })

//     return c.json(newMessage, 201);

//   } catch (error: any) {
//     console.error('Error creating comment:', error);
//     return c.json({ message: "Failed to create comment: " + error.message }, 400);
//   }
// })




// Comments PUT (edit comment)
const commentsPUTRoute = createRoute({
  method: 'put',
  path: '/api/threads/{thread_id}/activities/{activity_id}/comments/{comment_id}',
  request: {
    params: z.object({
      thread_id: z.string(),
      activity_id: z.string(),
      comment_id: z.string(),
    }),
    body: body(z.object({
      comment: z.string().optional(),
      scores: z.record(z.string(), z.any()).optional()
    }))
  },
  responses: {
    200: response_data(z.object({})),
    400: response_error(),
    401: response_error(),
    404: response_error(),
  },
})

app.openapi(commentsPUTRoute, async (c) => {
  const { thread_id, activity_id, comment_id } = c.req.param()
  const body = await c.req.json()
  
  try {
    const session = await requireSession(c.req.raw.headers);
    const thread = await requireThread(thread_id)
    const activity = await requireActivity(thread, activity_id);
    const commentMessage = await requireCommentMessageFromUser(thread, activity, comment_id, session.user);

    const inputScores = body.scores ?? {}

    for (const [scoreName, scoreValue] of Object.entries(inputScores)) {
      validateScore(thread, activity, scoreName, scoreValue, { mustNotExist: false })
    }

    await db.transaction(async (tx) => {

      /** EDIT COMMENT **/

      // Extract mentions from new content
      let newMentions, previousMentions;
      let newUserMentions: string[] = [], previousUserMentions: string[] = [];

      try {
        newMentions = extractMentions(body.comment ?? "");
        previousMentions = extractMentions(commentMessage.content ?? "");
        newUserMentions = newMentions.user_id || [];
        previousUserMentions = previousMentions.user_id || [];
      } catch (error) {
        return c.json({ message: `Invalid mention format: ${(error as Error).message}` }, 400);
      }

      // Store previous content in edit history
      await tx.insert(commentMessageEdits).values({
        commentMessageId: commentMessage.id,
        previousContent: commentMessage.content,
      });

      // Update the comment message
      await tx.update(commentMessages)
        .set({ content: body.comment ?? null, updatedAt: new Date() })
        .where(eq(commentMessages.id, commentMessage.id));

      // Handle mentions for edits
      if (newUserMentions.length > 0 || previousUserMentions.length > 0) {
        // Get existing mentions for this message
        const existingMentions = await db
          .select()
          .from(commentMentions)
          .where(eq(commentMentions.commentMessageId, commentMessage.id));

        const existingMentionedUserIds = existingMentions.map((m: any) => m.mentionedUserId);

        // // Find mentions to keep (existed before and still exist)
        // const mentionsToKeep = newUserMentions.filter((mention: string) =>
        //   previousUserMentions.includes(mention) && existingMentionedUserIds.includes(mention)
        // );

        // Find new mentions to add
        const newMentionsToAdd = newUserMentions.filter((mention: string) =>
          !existingMentionedUserIds.includes(mention)
        );
            
        // Find mentions to remove (existed before but not in new content)
        const mentionsToRemove = existingMentionedUserIds.filter((mention: string) =>
          !newUserMentions.includes(mention)
        );

        // Remove mentions that are no longer present
        if (mentionsToRemove.length > 0) {
          await tx.delete(commentMentions)
            .where(and(
              eq(commentMentions.commentMessageId, commentMessage.id),
              inArray(commentMentions.mentionedUserId, mentionsToRemove)
            ));
        }

        // Add new mentions
        if (newMentionsToAdd.length > 0) {
          await tx.insert(commentMentions).values(
            newMentionsToAdd.map((mentionedUserId: string) => ({
              commentMessageId: commentMessage.id,
              mentionedUserId,
            }))
          );
        }
      }

      /** EDIT SCORES **/
      
      // Get existing scores for this comment
      const existingScores = commentMessage.scores ?? [];

      // Find scores to delete (exist in database but not in inputScores)
      const scoresToDelete = existingScores.filter(score => 
        !Object.keys(inputScores).includes(score.name)
      );

      // Delete scores that are no longer present
      if (scoresToDelete.length > 0) {
        await tx.delete(scores)
          .where(inArray(scores.id, scoresToDelete.map(s => s.id)));
      }

      // Update or insert scores from inputScores
      for (const [scoreName, scoreValue] of Object.entries(inputScores)) {
        const existingScore = existingScores.find(s => s.name === scoreName);
        
        if (existingScore) {
          // Update existing score
          await tx.update(scores)
            .set({ 
              value: scoreValue,
              updatedAt: new Date()
            })
            .where(eq(scores.id, existingScore.id));
        } else {
          // Insert new score
          await tx.insert(scores).values({
            activityId: activity_id,
            name: scoreName,
            value: scoreValue,
            commentId: commentMessage.id,
            createdBy: session.user.id,
          });
        }
      }
    }); 

    return c.json({}, 200);

  } catch (error: any) {
    console.error('Error editing comment:', error);
    return c.json({ message: "Failed to edit comment: " + error.message }, 400);
  }
})

// // Comments DELETE (delete comment)
// const commentsDELETERoute = createRoute({
//   method: 'delete',
//   path: '/api/comments/{commentId}',
//   request: {
//     params: z.object({
//       commentId: z.string(),
//     }),
//   },
//   responses: {
//     200: response_data(z.object({})),
//     400: response_error(),
//     401: response_error(),
//     404: response_error(),
//   },
// })

// app.openapi(commentsDELETERoute, async (c) => {
//   const { commentId } = c.req.param()
  
//   try {
//     const session = await auth.api.getSession({ headers: c.req.raw.headers })
//     if (!session) {
//       return c.json({ message: "Authentication required" }, 401);
//     }

//     // Find the comment message
//     const [message] = await db
//       .select()
//       .from(commentMessages)
//       .where(eq(commentMessages.id, commentId));

//     if (!message) {
//       return c.json({ message: "Comment message not found" }, 404);
//     }

//     // Check if user can delete this comment (own comment or admin)
//     if (message.userId !== session.user.id) {
//       return c.json({ message: "You can only delete your own comments." }, 401);
//     }

//     // Soft delete the comment
//     await db.update(commentMessages)
//       .set({ 
//         deletedAt: new Date(),
//         deletedBy: session.user.id
//       })
//       .where(eq(commentMessages.id, commentId));

//     return c.json({}, 200);

//   } catch (error: any) {
//     console.error('Error deleting comment:', error);
//     return c.json({ message: "Failed to delete comment: " + error.message }, 400);
//   }
// })


/* --------- SCORES --------- */

// // Scores POST (create new score)
// const scoresPOSTRoute = createRoute({
//   method: 'post',
//   path: '/api/scores',
//   request: {
//     body: body(ScoreCreateSchema)
//   },
//   responses: {
//     201: response_data(ScoreSchema),
//     400: response_error(),
//     401: response_error(),
//     404: response_error(),
//   },
// })

// app.openapi(scoresPOSTRoute, async (c) => {
//   const body = await c.req.json()
  
//   try {
//     const session = await auth.api.getSession({ headers: c.req.raw.headers })
//     if (!session) {
//       return c.json({ message: "Authentication required" }, 401);
//     }

//     // Validate that the activity exists
//     const activityExists = await db.query.activity.findFirst({
//       where: eq(activity.id, body.activityId)
//     });
    
//     if (!activityExists) {
//       return c.json({ message: "Activity not found" }, 404);
//     }

//     // Validate that the comment exists if commentId is provided
//     if (body.commentId) {
//       const commentExists = await db.query.commentMessages.findFirst({
//         where: eq(commentMessages.id, body.commentId)
//       });
      
//       if (!commentExists) {
//         return c.json({ message: "Comment not found" }, 404);
//       }
//     }
    
//     // Validate score name and value against config
//     // First, find the activity that this score belongs to
//     const activityRecord = await db.query.activity.findFirst({
//       where: eq(activity.id, body.activityId),
//       with: {
//         thread: true
//       }
//     });
    
//     if (!activityRecord) {
//       return c.json({ message: "Activity not found" }, 404);
//     }

//     // Find the thread configuration
//     const threadConfig = config.threads.find((t) => t.type === activityRecord.thread.type);
//     if (!threadConfig) {
//       return c.json({ message: `Thread type not found in configuration` }, 400);
//     }

//     // Find the activity configuration
//     const activityConfig = threadConfig.activities.find((a) => 
//       a.type === activityRecord.type && a.role === activityRecord.role
//     );

//     if (!activityConfig) {
//       return c.json({ message: `Activity type '${activityRecord.type}' with role '${activityRecord.role}' not found in configuration` }, 400);
//     }

//     // Find the score configuration for this activity
//     const scoreConfig = activityConfig.scores?.find((score: any) => score.name === body.name);
//     if (!scoreConfig) {
//       return c.json({ message: `Score name '${body.name}' not found in configuration for activity type '${activityRecord.type}' with role '${activityRecord.role}'` }, 400);
//     }

//     // Validate value against the schema
//     try {
//       scoreConfig.schema.parse(body.value);
//     } catch (error: any) {
//       return c.json({ message: `Invalid score value: ${error.message}` }, 400);
//     }

//     // Create the score
//     const [newScore] = await db.insert(scores).values({
//       activityId: body.activityId,
//       name: body.name,
//       value: body.value,
//       commentId: body.commentId,
//       createdBy: session.user.id,
//     }).returning();

//     return c.json(newScore, 201);

//   } catch (error: any) {
//     console.error('Error creating score:', error);
//     return c.json({ message: "Failed to create score: " + error.message }, 400);
//   }
// })


/* --------- MEMBERS --------- */

async function getSessionAndValidateAdmin(c: any) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })

  if (!session) {
    throw new APIError(401, { message: "Unauthorized" });
  }

  if (session.user.role !== "admin") {
    throw new APIError(401, { message: "Unauthorized" });
  }

  return session;
}

const MemberSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  role: z.string(),
  created_at: z.date(),
})

const MemberUpdateSchema = z.object({
  role: z.enum(['admin', 'user']),
})

// Members GET (list all users)
const membersGETRoute = createRoute({
  method: 'get',
  path: '/api/members',
  responses: {
    200: response_data(z.array(MemberSchema)),
    401: response_error(),
  },
})

app.openapi(membersGETRoute, async (c) => {
  try {
    await getSessionAndValidateAdmin(c);
    
    const response = await auth.api.listUsers({
      headers: c.req.raw.headers,
      query: {
        limit: 100,
      },
    });

    const users: User[] = response.users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }));

    return c.json(users, 200);
  } catch (error: any) {
    return errorToResponse(c, error);
  }
})

// Member POST (update role)
const memberPOSTRoute = createRoute({
  method: 'post',
  path: '/api/members/{memberId}',
  request: {
    params: z.object({
      memberId: z.string(),
    }),
    body: body(MemberUpdateSchema)
  },
  responses: {
    200: response_data(z.object({})),
    400: response_error(),
    401: response_error(),
    404: response_error(),
  },
})

app.openapi(memberPOSTRoute, async (c) => {
  const { memberId } = c.req.param()
  const body = await c.req.json()
  
  try {
    await getSessionAndValidateAdmin(c);

    await auth.api.setRole({
      headers: c.req.raw.headers,
      body: { userId: memberId, role: body.role },
    });

    return c.json({}, 200);
  } catch (error: any) {
    return errorToResponse(c, error);
  }
})

// Member DELETE (delete user)
const memberDELETERoute = createRoute({
  method: 'delete',
  path: '/api/members/{memberId}',
  request: {
    params: z.object({
      memberId: z.string(),
    }),
  },
  responses: {
    200: response_data(z.object({})),
    400: response_error(),
    401: response_error(),
    404: response_error(),
  },
})

app.openapi(memberDELETERoute, async (c) => {
  const { memberId } = c.req.param()
  
  try {
    await getSessionAndValidateAdmin(c);

    await auth.api.removeUser({
      headers: c.req.raw.headers,
      body: { userId: memberId },
    });

    return c.json({}, 200);
  } catch (error: any) {
    return errorToResponse(c, error);
  }
})

/* --------- INVITATIONS --------- */

function errorToResponse(c: any, error: any) {
  if (error instanceof APIError) {
    return c.json(error.body, error.statusCode);
  }
  else if (error instanceof Error) {
    return c.json({ message: error.message }, 400);
  }
  else {
    return c.json({ message: "Unexpected error" }, 400);
  }
}

const InvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  expires_at: z.date(),
  created_at: z.date(),
  status: z.string(),
  invited_by: z.string().nullable(),
})

const InvitationCreateSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'user']),
})

// Invitations POST (create invitation)
const invitationsPOSTRoute = createRoute({
  method: 'post',
  path: '/api/invitations',
  request: {
    body: body(InvitationCreateSchema)
  },
  responses: {
    201: response_data(InvitationSchema),
    400: response_error(),
  },
})


app.openapi(invitationsPOSTRoute, async (c) => {
  const body = await c.req.json()
  
  try {
    const session = await getSessionAndValidateAdmin(c);

    await createInvitation(body.email, body.role, session.user.id);
    
    // Get the created invitation to return it
    const pendingInvitations = await getPendingInvitations();
    const createdInvitation = pendingInvitations.find(inv => inv.email === body.email);
    
    if (!createdInvitation) {
      return c.json({ message: "Failed to create invitation" }, 400);
    }

    return c.json(createdInvitation, 201);
  } catch (error) {
    return errorToResponse(c, error);
  }
})

// Invitations GET (get pending invitations)
const invitationsGETRoute = createRoute({
  method: 'get',
  path: '/api/invitations',
  responses: {
    200: response_data(z.array(InvitationSchema)),
    400: response_error(),
  },
})

app.openapi(invitationsGETRoute, async (c) => {
  try {
    await getSessionAndValidateAdmin(c);

    const pendingInvitations = await getPendingInvitations();
    return c.json(pendingInvitations, 200);

  } catch (error: any) {
    return errorToResponse(c, error);
  }
})

// Invitation DELETE (cancel invitation)
const invitationDELETERoute = createRoute({
  method: 'delete',
  path: '/api/invitations/{id}',
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: response_data(z.object({})),
    400: response_error(),
    404: response_error(),
  },
})

app.openapi(invitationDELETERoute, async (c) => {
  const { id } = c.req.param()

  try {
    await getSessionAndValidateAdmin(c);
    await cancelInvitation(id);
    return c.json({}, 200);
  } catch (error: any) {
    return errorToResponse(c, error);
  }
})

// Invitation validation
const invitationValidateRoute = createRoute({
  method: 'get',
  path: '/api/invitations/{invitationId}',
  request: {
    params: z.object({
      invitationId: z.string(),
    }),
  },
  responses: {
    200: response_data(InvitationSchema),
    400: response_error(),
  },
})

app.openapi(invitationValidateRoute, async (c) => {
  const { invitationId } = c.req.param()

  try {
    const invitation = await getValidInvitation(invitationId);
    return c.json(invitation, 200);
  } catch (error: any) {
    return errorToResponse(c, error);
  }
})



/* --------- EMAILS --------- */

// Emails GET
const emailsGETRoute = createRoute({
  method: 'get',
  path: '/api/dev/emails',
  responses: {
    200: response_data(z.any()),
  },
})

app.openapi(emailsGETRoute, async (c) => {
  const emails = await db
    .select({
      id: email.id,
      to: email.to,
      subject: email.subject,
      from: email.from,
      created_at: email.created_at,
    })
    .from(email)
    .orderBy(desc(email.created_at))
    .limit(100);

  return c.json(emails, 200);
})

/* --------- EMAIL DETAIL --------- */

const emailDetailGETRoute = createRoute({
  method: 'get',
  path: '/api/dev/emails/{id}',
  responses: {
    200: response_data(z.any()),
  },
})

app.openapi(emailDetailGETRoute, async (c) => {
  const { id } = c.req.param()
  const emailRow = await db.query.email.findFirst({ where: eq(email.id, id) })
  return c.json(emailRow, 200)
})


// The OpenAPI documentation will be available at /doc
app.doc('/openapi', {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'My API',
  },
})

app.get('/docs', swaggerUI({ url: '/openapi' }))
app.get('/', (c) => c.text('Hello Agent View!'))

const port = (() => {
  // Get the port from API_PORT
  const apiPort = process.env.API_PORT;
  if (!apiPort) throw new Error('API_PORT is not set');

  try {
    return Number(apiPort);
  } catch (e) {
    throw new Error('Invalid API_PORT: ' + e);
  }
})()

serve({
  fetch: app.fetch,
  port
})

console.log("Agent View API running on port " + port)