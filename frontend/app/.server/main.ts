import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { APIError } from "better-auth/api";

import { z, createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { db } from './db'
import { client, thread, activity, run, email, commentThreads, commentMessages, commentMessageEdits, commentMentions, versions } from './db/schema'
import { asc, eq, ne, desc, and, inArray, isNull } from 'drizzle-orm'
import { response_data, response_error, body } from '../lib/hono_utils'
import { config } from '../agentview.config'
import { isUUID } from '../lib/isUUID'
import { isAsyncIterable } from '../lib/utils'
import { auth } from './auth'
import { getRootUrl } from './getRootUrl'
import { createInvitation, cancelInvitation, getPendingInvitations, getValidInvitation } from './invitations'




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
  origin: getRootUrl(),
  credentials: true,
}))

/* --------- AUTH --------- */

app.on(["POST", "GET"], "/api/auth/*", (c) => {
	return auth.handler(c.req.raw);
});


/* --------- CLIENTS --------- */

const ClientSchema = z.object({
  id: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
})


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

const ActivitySchema = z.object({
  id: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
  content: z.any(),
  thread_id: z.string(),
  type: z.string(),
  role: z.string(),
  commentThread: z.any(),
})

const ActivityCreateSchema = z.object({
  input: ActivitySchema.pick({
    type: true,
    role: true,
    content: true,
  })
})

const ThreadSchema = z.object({
  id: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
  metadata: z.any(),
  client_id: z.string(),
  type: z.string(),
  activities: z.array(ActivitySchema),
  state: z.string()
})

const ThreadCreateSchema = ThreadSchema.pick({
  client_id: true,
  type: true,
  metadata: true,
})

async function fetchThreadWithLastRun(thread_id: string) {
  const threadRow = await db.query.thread.findFirst({
    where: eq(thread.id, thread_id),
    with: {
      client: {
        with: {
          simulatedBy: true
        }
      },
      activities: {
        with: {
          run: true,
          commentThread: {
            with: {
              commentMessages: {
                orderBy: (commentMessages, { asc }) => [asc(commentMessages.createdAt)]
              }
            }
          }
          // commentThread: {
          //   with: {
          //     commentMessages: {
          //       with: {
          //         mentions: true,
          //       }
          //     }
          //   }
          // }
        },
        orderBy: (activity, { asc }) => [asc(activity.created_at)]
      },
      runs: {
        orderBy: (run, { desc }) => [desc(run.created_at)],
        limit: 1
      },
    }
  });

  const lastRun = threadRow?.runs[0]
  const lastRunState = lastRun?.state
  const threadState = (lastRunState === undefined || lastRunState === 'completed') ? 'idle' : lastRunState

  if (!threadRow) {
    return undefined
  }

  return {
    ...threadRow,
    activities: threadRow.activities.filter((a) => a.run_id === lastRun?.id || a.run?.state === 'completed'),
    runs: undefined,
    lastRun,
    state: threadState
  }
}


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

  return c.json(await fetchThreadWithLastRun(newThread.id), 201);
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

  const threadRow = await fetchThreadWithLastRun(thread_id);

  if (!threadRow) {
    return c.json({ message: "Thread not found" }, 404);
  }

  return c.json(threadRow, 200);
})


/* --------- ACTIVITIES --------- */


// Activities POST
const activitiesPOSTRoute = createRoute({
  method: 'post',
  path: '/api/threads/{thread_id}/activities',
  request: {
    params: z.object({
      thread_id: z.string(),
    }),
    body: body(ActivityCreateSchema)
  },
  responses: {
    201: response_data(ThreadSchema),
    400: response_error(),
    404: response_error()
  },
})

app.openapi(activitiesPOSTRoute, async (c) => {
  const { thread_id } = c.req.param()
  const { input: { type, role, content } } = await c.req.json()

  const threadRow = await fetchThreadWithLastRun(thread_id);

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

  // Check thread status conditions
  if (threadRow.state === 'in_progress') {
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
        activities: [...threadRow.activities, userActivity]
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
      const runOutput = config.run(input)
      let versionId: string | null = null;

      if (isAsyncIterable(runOutput)) {
        console.log('is async iterable')

        let firstItem = true;
        for await (const item of runOutput) {
          // The first yield MUST be a manifest
          if (firstItem) {
            if (!item || typeof item !== 'object' || !('type' in item) || item.type !== 'manifest') {
              throw { 
                message: "No 'manifest' was sent by the agent." 
              };
            }
            
            const versionManifest = item as { type: string; version: string; env?: string; metadata?: any };
            console.log('Version manifest received:', versionManifest);
            
            // Create or find existing version
            const [version] = await db.insert(versions).values({
              version: versionManifest.version,
              env: versionManifest.env || 'dev',
              metadata: versionManifest.metadata || null,
            }).onConflictDoUpdate({
              target: [versions.version, versions.env],
              set: {
                metadata: versionManifest.metadata || null,
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
          
          // This is a regular activity
          await validateAndInsertActivity(item)
        }

      }
      else {
        console.log('not async iterable')

        const result = await runOutput;

        if (!result || typeof result !== 'object' || !('manifest' in result) || !('activities' in result)) {
          throw { 
            message: "Non-async iterable run function must return { manifest, activities }" 
          };
        }

        const { manifest, activities } = result;

        // Handle manifest
        if (manifest && typeof manifest === 'object' && 'version' in manifest) {
          const versionManifest = manifest as { version: string; env?: string; metadata?: any };
          console.log('Version manifest received:', versionManifest);
          
          // Create or find existing version
          const [version] = await db.insert(versions).values({
            version: versionManifest.version,
            env: versionManifest.env || 'dev',
            metadata: versionManifest.metadata || null,
          }).onConflictDoUpdate({
            target: [versions.version, versions.env],
            set: {
              metadata: versionManifest.metadata || null,
            }
          }).returning();
          
          versionId = version.id;
          
          // Update the run with version_id
          if (userActivity.run_id) {
            await db.update(run)
              .set({ version_id: versionId })
              .where(eq(run.id, userActivity.run_id));
          }
        }

        // Handle activities
        if (!Array.isArray(activities)) {
          throw { 
            message: "Activities must be an array" 
          };
        }

        for (const activityData of activities) {
          await validateAndInsertActivity(activityData)
        }
      }

      console.log('updating run as completed')

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
      console.log('Catch!', error)

      if (!(await isStillRunning())) {
        return
      }
      
      await db.update(run)
        .set({
          state: 'failed',
          finished_at: new Date(),
          fail_reason: error.message ? { message: error.message } : null
          })
          .where(eq(run.id, userActivity.run_id));
      }

  })();

  return c.json(await fetchThreadWithLastRun(thread_id), 201);
})


// Cancel Run Endpoint
const threadCancelRoute = createRoute({
  method: 'post',
  path: '/api/threads/{thread_id}/cancel',
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

app.openapi(threadCancelRoute, async (c) => {
  const { thread_id } = c.req.param();
  const threadRow = await fetchThreadWithLastRun(thread_id);
  if (!threadRow) {
    return c.json({ message: 'Thread not found' }, 404);
  }
  if (threadRow.state !== 'in_progress' || !threadRow.lastRun) {
    return c.json({ message: 'Thread is not in progress' }, 400);
  }
  // Set the run as failed
  await db.update(run)
    .set({
      state: 'failed',
      finished_at: new Date(),
      fail_reason: { message: 'Run was cancelled by user' }
    })
    .where(eq(run.id, threadRow.lastRun.id));

  return c.json(await fetchThreadWithLastRun(thread_id), 200);
});

// Activities POST
const activityWatchRoute = createRoute({
  method: 'get',
  path: '/api/threads/{thread_id}/watch',
  request: {
    query: z.object({
      last_activity_id: z.string().optional(),
    })
  },
  responses: {
    // 201: response_data(z.array(ActivitySchema)),
    400: response_error(),
    404: response_error()
  },
})


// Activities Watch (SSE)
app.openapi(activityWatchRoute, async (c) => {
  const { thread_id } = c.req.param()

  const threadRow = await fetchThreadWithLastRun(thread_id);

  if (!threadRow) {
    return c.json({ message: "Thread not found" }, 404);
  }

  // if (state !== 'in_progress') {
  //   return c.json({ message: "Thread must be in 'in_progress' state to watch" }, 400);
  // }

  let lastActivityIndex: number;

  if (c.req.query().last_activity_id) {
    lastActivityIndex = threadRow.activities.findIndex((a) => a.id === c.req.query().last_activity_id)

    if (lastActivityIndex === -1) {
      return c.json({ message: "Last activity id not found" }, 400);
    }
  }
  else {
    lastActivityIndex = threadRow.activities.length - 1
  }

  // Only include activities before lastActivityId in ignoredActivityIds
  const ignoredActivityIds = threadRow.activities
    .slice(0, threadRow.activities.findIndex((a) => a.id === threadRow.activities[lastActivityIndex].id))
    .map((a) => a.id);

  // 4. Start SSE stream
  return streamSSE(c, async (stream) => {
    let running = true;
    stream.onAbort(() => {
      running = false;
    });

    // Always start with thread.state in_progress
    await stream.writeSSE({
      data: JSON.stringify({ state: threadRow.state }),
      event: 'thread.state',
    });

    /**
     * 
     * POLLING HERE
     * 
     * Soon we'll need to create a proper messaging, when some LLM API will be streaming characters then even NOTIFY/LISTEN won't make it performance-wise.
     * 
     */
    while (running) {
      const threadRow = await fetchThreadWithLastRun(thread_id);

      if (!threadRow || !threadRow.lastRun) {
        throw new Error('unreachable');
      }

      // Check for new activities by comparing count
      const activities = threadRow?.activities;

      for (const activity of activities) {
        if (ignoredActivityIds.includes(activity.id)) {
          continue;
        }
        ignoredActivityIds.push(activity.id)
        await stream.writeSSE({
          data: JSON.stringify(activity),
          event: 'activity',
        });
      }

      // End if run is no longer in_progress
      if (threadRow.state !== 'in_progress') {

        const data: any = { state: threadRow.state }

        if (threadRow.state === 'failed') {
          data.fail_reason = threadRow.lastRun.fail_reason
        }

        await stream.writeSSE({
          data: JSON.stringify(data),
          event: 'thread.state',
        });
        break;
      }

      // Wait 1s before next poll
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });
});





/* --------- COMMENTS --------- */

const CommentMessageSchema = z.object({
  id: z.string(),
  commentThreadId: z.string(),
  userId: z.string(),
  content: z.string(),
  createdAt: z.date(),
  updatedAt: z.date().nullable(),
  deletedAt: z.date().nullable(),
  deletedBy: z.string().nullable(),
})

const CommentThreadSchema = z.object({
  id: z.string(),
  activityId: z.string(),
  commentMessages: z.array(CommentMessageSchema),
})

// Comments POST (create new comment)
const commentsPOSTRoute = createRoute({
  method: 'post',
  path: '/api/comments',
  request: {
    body: body(z.object({
      content: z.string(),
      activityId: z.string(),
    }))
  },
  responses: {
    201: response_data(CommentMessageSchema),
    400: response_error(),
    401: response_error(),
  },
})

app.openapi(commentsPOSTRoute, async (c) => {
  const body = await c.req.json()
  
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) {
      return c.json({ message: "Authentication required" }, 401);
    }

    const { extractMentions } = await import('../lib/utils')

    // Check if comment thread exists for this activity
    let commentThread = await db.query.commentThreads.findFirst({
      where: eq(commentThreads.activityId, body.activityId),
      with: {
        commentMessages: {
          where: isNull(commentMessages.deletedAt), // Only include non-deleted comments
          orderBy: (commentMessages: any, { asc }: any) => [asc(commentMessages.createdAt)]
        }
      }
    });

    const newMessage = await db.transaction(async (tx: any) => {
      // If no comment thread exists, create one
      if (!commentThread) {
        const [newThread] = await tx.insert(commentThreads).values({
          activityId: body.activityId,
        }).returning();

        commentThread = {
          ...newThread,
          commentMessages: []
        };
      }

      // Create the comment message
      const [newMessage] = await tx.insert(commentMessages).values({
        commentThreadId: commentThread!.id,
        userId: session.user.id,
        content: body.content,
      }).returning();

      // Handle mentions for new comments
      let mentions;
      let userMentions: string[] = [];

      try {
        mentions = extractMentions(body.content);
        userMentions = mentions.user_id || [];
      } catch (error) {
        throw new Error(`Invalid mention format: ${(error as Error).message}`);
      }

      if (userMentions.length > 0) {
        await tx.insert(commentMentions).values(
          userMentions.map((mentionedUserId: string) => ({
            commentMessageId: newMessage.id,
            mentionedUserId,
          }))
        );
      }

      return newMessage;
    })

    return c.json(newMessage, 201);

  } catch (error: any) {
    console.error('Error creating comment:', error);
    return c.json({ message: "Failed to create comment: " + error.message }, 400);
  }
})

// Comments PUT (edit comment)
const commentsPUTRoute = createRoute({
  method: 'put',
  path: '/api/comments/{commentId}',
  request: {
    params: z.object({
      commentId: z.string(),
    }),
    body: body(z.object({
      content: z.string(),
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
  const { commentId } = c.req.param()
  const body = await c.req.json()
  
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) {
      return c.json({ message: "Authentication required" }, 401);
    }

    const { extractMentions } = await import('../lib/utils')

    // Find the comment message
    const [message] = await db
      .select()
      .from(commentMessages)
      .where(eq(commentMessages.id, commentId));
    
    if (!message) {
      return c.json({ message: "Comment message not found" }, 404);
    }
    
    if (message.userId !== session.user.id) {
      return c.json({ message: "You can only edit your own comments." }, 401);
    }

    // Extract mentions from new content
    let newMentions, previousMentions;
    let newUserMentions: string[] = [], previousUserMentions: string[] = [];

    try {
      newMentions = extractMentions(body.content);
      previousMentions = extractMentions(message.content);
      newUserMentions = newMentions.user_id || [];
      previousUserMentions = previousMentions.user_id || [];
    } catch (error) {
      return c.json({ message: `Invalid mention format: ${(error as Error).message}` }, 400);
    }

    // Store previous content in edit history
    await db.insert(commentMessageEdits).values({
      commentMessageId: commentId,
      previousContent: message.content,
    });

    // Update the comment message
    await db.update(commentMessages)
      .set({ content: body.content, updatedAt: new Date() })
      .where(eq(commentMessages.id, commentId));

    // Handle mentions for edits
    if (newUserMentions.length > 0 || previousUserMentions.length > 0) {
      // Get existing mentions for this message
      const existingMentions = await db
        .select()
        .from(commentMentions)
        .where(eq(commentMentions.commentMessageId, commentId));

      const existingMentionedUserIds = existingMentions.map((m: any) => m.mentionedUserId);

      // Find mentions to keep (existed before and still exist)
      const mentionsToKeep = newUserMentions.filter((mention: string) =>
        previousUserMentions.includes(mention) && existingMentionedUserIds.includes(mention)
      );

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
        await db.delete(commentMentions)
          .where(and(
            eq(commentMentions.commentMessageId, commentId),
            inArray(commentMentions.mentionedUserId, mentionsToRemove)
          ));
      }

      // Add new mentions
      if (newMentionsToAdd.length > 0) {
        await db.insert(commentMentions).values(
          newMentionsToAdd.map((mentionedUserId: string) => ({
            commentMessageId: commentId,
            mentionedUserId,
          }))
        );
      }
    }

    return c.json({}, 200);

  } catch (error: any) {
    console.error('Error editing comment:', error);
    return c.json({ message: "Failed to edit comment: " + error.message }, 400);
  }
})

// Comments DELETE (delete comment)
const commentsDELETERoute = createRoute({
  method: 'delete',
  path: '/api/comments/{commentId}',
  request: {
    params: z.object({
      commentId: z.string(),
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
  const { commentId } = c.req.param()
  
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) {
      return c.json({ message: "Authentication required" }, 401);
    }

    // Find the comment message
    const [message] = await db
      .select()
      .from(commentMessages)
      .where(eq(commentMessages.id, commentId));

    if (!message) {
      return c.json({ message: "Comment message not found" }, 404);
    }

    // Check if user can delete this comment (own comment or admin)
    if (message.userId !== session.user.id) {
      return c.json({ message: "You can only delete your own comments." }, 401);
    }

    // Soft delete the comment
    await db.update(commentMessages)
      .set({ 
        deletedAt: new Date(),
        deletedBy: session.user.id
      })
      .where(eq(commentMessages.id, commentId));

    return c.json({}, 200);

  } catch (error: any) {
    console.error('Error deleting comment:', error);
    return c.json({ message: "Failed to delete comment: " + error.message }, 400);
  }
})




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
    
    const users = await auth.api.listUsers({
      headers: c.req.raw.headers,
      query: {
        limit: 100,
      },
    });

    return c.json(users.users, 200);
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


serve({
  fetch: app.fetch,
  port: 2139
})

console.log("Agent View API running...")