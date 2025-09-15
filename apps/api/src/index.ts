import 'dotenv/config'
import { serve } from '@hono/node-server'
import { HTTPException } from 'hono/http-exception'

import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { APIError as BetterAuthAPIError } from "better-auth/api";

import { z, createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { db } from './db'
import { client, thread, activity, run, email, commentMessages, commentMessageEdits, commentMentions, versions, scores, schemas, events, inboxItems } from './schemas/schema'
import { eq, desc, and, inArray, ne, gt, isNull, isNotNull, or, gte, sql, countDistinct, DrizzleQueryError } from 'drizzle-orm'
import { response_data, response_error, body } from './hono_utils'
import { isUUID } from './isUUID'
import { extractMentions } from './utils'
import { auth } from './auth'
import { createInvitation, cancelInvitation, getPendingInvitations, getValidInvitation } from './invitations'
import { fetchThread } from './threads'
import { callAgentAPI, AgentAPIError } from './agentApi'
import { getStudioURL } from './getStudioURL'

// shared imports
import { getAllActivities, getLastRun } from './shared/threadUtils'
import { ClientSchema, ThreadSchema, ThreadCreateSchema, ActivityCreateSchema, RunSchema, ActivitySchema, type User, type Thread, type Activity, SchemaSchema, SchemaCreateSchema, InboxItemSchema, ClientCreateSchema, MemberSchema, MemberUpdateSchema, type InboxItem, SessionListSchema, type SessionList } from './shared/apiTypes'
import { getSchema } from './getSchema'
import type { BaseConfig } from './shared/configTypes'
import { users } from './schemas/auth-schema'
import { getUsersCount } from './users'
import { updateInboxes } from './updateInboxes'
import { isInboxItemUnread } from './inboxItems'



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

/** --------- ERROR HANDLING --------- */

function handleError(c: any, error: any) {
  console.error(error);
  if (error instanceof BetterAuthAPIError) {
    return c.json(error.body, error.statusCode);
  }
  else if (error instanceof DrizzleQueryError) {
    return c.json({ ...error, message: "DB error. Is db running?" }, 400);
  }
  else if (error instanceof HTTPException) {
    return c.json(error, 500);
  }
  else if (error instanceof Error) {
    return c.json({ message: error.message }, 400);
  }
  else {
    return c.json({ message: "Unexpected error" }, 400);
  }
}


app.onError((err, c) => {
  return handleError(c, err);
});

/** --------- CORS --------- */

app.use('*', cors({
  origin: [getStudioURL()],
  credentials: true,
}))

/* --------- AUTH --------- */

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

/** --------- UTILS --------- */


async function requireSession(headers: Headers) {
  const session = await auth.api.getSession({ headers })
  if (!session) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return session
}

async function requireAdminSession(headers: Headers) {
  const session = await requireSession(headers)

  if (session.user.role !== "admin") {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  return session;
}

async function requireSchema() {
  const schema = await getSchema()
  if (!schema) {
    throw new HTTPException(404, { message: "Schema not found" });
  }
  return schema
}

async function requireThreadConfig(schema: BaseConfig, threadType: string) {
  const threadConfig = schema.threads.find((threadConfig) => threadConfig.type === threadType);
  if (!threadConfig) {
    throw new HTTPException(404, { message: `Thread type '${threadType}' not found in schema.` });
  }
  return threadConfig
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

async function requireClient(client_id: string) {
  if (!isUUID(client_id)) {
    throw new HTTPException(400, { message: `Invalid client id: ${client_id}` });
  }

  const clientRow = await db.query.client.findFirst({
    where: eq(client.id, client_id),
  });

  if (!clientRow) {
    throw new HTTPException(404, { message: "Client not found" });
  }
  return clientRow
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

/* --------- LISTS --------- */

const LISTS : Record<string, { filter: any }>= {
  real: {
    filter: () => isNull(client.simulated_by)
  },
  simulated_private: {
    filter: (user: User) => and(eq(client.simulated_by, user.id), eq(client.is_shared, false))
  },
  simulated_shared: {
    filter: () => and(isNotNull(client.simulated_by), eq(client.is_shared, true))
  }
}

// async function getInboxItemOrCreateEmpty(user: User, thread_id: string, activity_id?: string) {
//   const [inboxItem] = await db.insert(inboxItems).values({
//     userId: user.id,
//     threadId: thread_id,
//     activityId: activity_id ?? null,
//     lastNotifiableEventId: null,
//     lastReadEventId: null,
//     render: { events: [] },
//   })
//   .onConflictDoNothing({
//     target: [inboxItems.userId, inboxItems.activityId, inboxItems.threadId],
//   }).returning();

//   return inboxItem;
// }


/* --------- CLIENTS --------- */

// API Clients POST
const apiClientsPOSTRoute = createRoute({
  method: 'post',
  path: '/api/clients',
  request: {
    body: body(ClientCreateSchema)
  },
  responses: {
    201: response_data(ClientSchema)
  },
})

app.openapi(apiClientsPOSTRoute, async (c) => {
  const body = await c.req.json()
  const session = await requireSession(c.req.raw.headers)

  const [newClient] = await db.insert(client).values({
    simulated_by: session.user.id,
    is_shared: body.is_shared,
  }).returning();

  return c.json(newClient, 201);
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


const apiClientsPUTRoute = createRoute({
  method: 'put',
  path: '/api/clients/{client_id}',
  request: {
    body: body(ClientCreateSchema)
  },
  responses: {
    200: response_data(ClientSchema)
  },
})

app.openapi(apiClientsPUTRoute, async (c) => {
  const body = await c.req.json()
  const { client_id } = c.req.param()

  const session = await requireSession(c.req.raw.headers)
  const clientRow = await requireClient(client_id)

  if (clientRow.simulated_by !== session.user.id) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const [updatedClient] = await db.update(client).set(body).where(eq(client.id, client_id)).returning();

  return c.json(updatedClient, 200);
})

// const LISTS : any[] = [
//   {
//     name: 'real',
//     title: 'Real',
//     filter: () => isNull(client.simulated_by)
//   },
//   {
//     name: 'simulated_private',
//     title: 'Simulated Private',
//     filter: (user: User) => and(eq(client.simulated_by, user.id), eq(client.is_shared, false))
//   },
//   {
//     name: 'simulated_shared',
//     title: 'Simulated Shared',
//     filter: () => and(
//         isNotNull(client.simulated_by),
//         eq(client.is_shared, true),
//       )
//   },
// ]


const listsGETRoute = createRoute({
  method: 'get',
  path: '/api/lists',
  responses: {
    200: response_data(z.array(SessionListSchema)),
  },
})

app.openapi(listsGETRoute, async (c) => {
  const session =await requireSession(c.req.raw.headers)

  const lists : SessionList[] = []

  for (const [name, list] of Object.entries(LISTS)) {
    const result = await db
      .select({
        unreadThreads: countDistinct(inboxItems.threadId),
      })
      .from(inboxItems)
      .leftJoin(thread, eq(inboxItems.threadId, thread.id))
      .leftJoin(client, eq(thread.client_id, client.id))
      .where(
        and(eq(inboxItems.userId, session.user.id), sql`${inboxItems.lastNotifiableEventId} > COALESCE(${inboxItems.lastReadEventId}, 0)`, list.filter(session.user))
      )

    lists.push({
      name: name,
      unseenCount: result[0].unreadThreads ?? 0,
      hasMentions: false,
    })
  }

  return c.json(lists, 200);
})

/* --------- THREADS --------- */


// Threads GET (list all threads with filtering)
const threadsGETRoute = createRoute({
  method: 'get',
  path: '/api/threads',
  request: {
    query: z.object({
      list: z.enum(Object.keys(LISTS)).optional(),
      type: z.string(),
    }),
  },
  responses: {
    200: response_data(z.array(ThreadSchema)),
    401: response_error(),
  },
})

app.openapi(threadsGETRoute, async (c) => {
  const session = await requireSession(c.req.raw.headers)

  const listName = c.req.query().list ?? "real";
  const type = c.req.query().type;

  const listFilter = LISTS[listName].filter(session.user);

  const result = await db.select().from(thread).leftJoin(client, eq(thread.client_id, client.id)).where(listFilter);

  const threadIds = result.map((row) => row.thread.id);

  const threadRows = await db.query.thread.findMany({
    where: and(inArray(thread.id, threadIds), eq(thread.type, type)),
    with: {
      client: true,
      inboxItems: {
        where: eq(inboxItems.userId, session.user.id),
      },
    },
    orderBy: (thread: any, { desc }: any) => [desc(thread.updated_at)],
  })

  const threadRowsFilteredWithInboxItems = threadRows.map((thread) => {
    const threadInboxItem = thread.inboxItems.find((inboxItem) => inboxItem.activityId === null);
    const activityInboxItems = thread.inboxItems.filter((inboxItem) => inboxItem.activityId !== null);

    function getUnseenEvents(inboxItem: InboxItem | null | undefined) {
      if (isInboxItemUnread(inboxItem)) {
        return inboxItem?.render?.events ?? [];
      }
      return [];
    }

    const unseenEvents: { thread: any[], activities: { [key: string]: any[] } } = {
      thread: getUnseenEvents(threadInboxItem),
      activities: {}
    }

    activityInboxItems.forEach((inboxItem) => {
      unseenEvents.activities[inboxItem.activityId!] = getUnseenEvents(inboxItem);
    });

    return {
      ...thread,
      unseenEvents
    }
  })

  return c.json(threadRowsFilteredWithInboxItems, 200);
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

  const schema = await requireSchema()
  const client = await requireClient(body.client_id)
  const threadConfig = await requireThreadConfig(schema, body.type)
  const session = await requireSession(c.req.raw.headers)

  // Validate metadata against the schema
  try {
    threadConfig.metadata?.parse(body.metadata);
  } catch (error: any) {
    return c.json({ message: error.message }, 400);
  }


  const newThread = await db.transaction(async (tx) => {
    const [newThreadRow] = await tx.insert(thread).values(body).returning();

    // add event
    const [event] = await tx.insert(events).values({
      type: 'thread_created',
      authorId: session.user.id,
      payload: {
        thread_id: newThreadRow.id,
      }
    }).returning();

    const newThread = await fetchThread(newThreadRow.id, tx);
    if (!newThread) {
      throw new Error("[Internal Error] Thread not found");
    }

    await updateInboxes(tx, event, newThread, null);

    return newThread;
  });

  return c.json(newThread, 201);
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


const threadSeenRoute = createRoute({
  method: 'post',
  path: '/api/threads/{thread_id}/seen',
  request: {
    params: z.object({
      thread_id: z.string(),
    }),
  },
  responses: {
    200: response_data(z.object({})),
    400: response_error(),
    401: response_error(),
    404: response_error(),
  },
})

app.openapi(threadSeenRoute, async (c) => {
  const { thread_id } = c.req.param()

  const session = await requireSession(c.req.raw.headers);

  await db.update(inboxItems).set({
    lastReadEventId: sql`${inboxItems.lastNotifiableEventId}`,
    updatedAt: new Date(),
  }).where(and(
    eq(inboxItems.userId, session.user.id),
    eq(inboxItems.threadId, thread_id),
    isNull(inboxItems.activityId),
  ))

  return c.json({}, 200);
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

  const threadRow = await requireThread(thread_id)
  const schema = await requireSchema()

  // Find thread configuration by type
  const threadConfig = schema.threads.find((threadConfig) => threadConfig.type === threadRow.type);
  if (!threadConfig) {
    return c.json({ message: `Thread type '${threadRow.type}' not found in configuration` }, 400);
  }

  if (role !== "user") {
    return c.json({ message: "Only activities with role 'user' are allowed" }, 400);
  }

  // Find activity configuration by type and role
  const activityConfig = threadConfig.activities.find((activityConfig) => activityConfig.type === type && activityConfig.role === role);
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
      const activitySchemas = threadConfig!.activities
        .filter((activityConfig) => activityConfig.role !== 'user') // Exclude user activities from output validation
        .map((activityConfig) =>
          z.object({
            type: z.literal(activityConfig.type),
            role: z.literal(activityConfig.role),
            content: activityConfig.content
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
      const runOutput = callAgentAPI(input, threadConfig.url)
      let versionId: string | null = null;

      let firstItem = true;
      for await (const event of runOutput) {

        // The first yield MUST be a manifest
        if (firstItem && event.name !== 'manifest') {
          throw new AgentAPIError({
            message: "No 'manifest' was sent by the agent."
          });
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
    catch (error: unknown) {
      if (!(await isStillRunning())) {
        return
      }

      let failReason: { message: string, [key: string]: any }

      if (error instanceof AgentAPIError) {
        failReason = error.object
      }
      else {
        failReason = {
          message: "AgentView internal error, please report to the team"
        }
      }

      await db.update(run)
        .set({
          state: 'failed',
          finished_at: new Date(),
          fail_reason: failReason
        })
        .where(eq(run.id, userActivity.run_id));
    }

  })();

  const thread = await fetchThread(thread_id);
  const newRun = getLastRun(thread!);

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

// @ts-ignore don't know how to fix this with hono yet
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
      if (!threadRow) {
        throw new Error('Thread not found');
      }
      const lastRun = getLastRun(threadRow)

      if (!lastRun) {
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

/* --------- ACTIVITIES --------- */


const activitySeenRoute = createRoute({
  method: 'post',
  path: '/api/threads/{thread_id}/activities/{activity_id}/seen',
  request: {
    params: z.object({
      thread_id: z.string(),
      activity_id: z.string(),
    }),
  },
  responses: {
    200: response_data(z.object({})),
    400: response_error(),
    401: response_error(),
    404: response_error(),
  },
})

app.openapi(activitySeenRoute, async (c) => {
  const { thread_id, activity_id } = c.req.param()

  const session = await requireSession(c.req.raw.headers);

  await db.update(inboxItems).set({
    lastReadEventId: sql`${inboxItems.lastNotifiableEventId}`,
    updatedAt: new Date(),
  }).where(and(
    eq(inboxItems.userId, session.user.id),
    eq(inboxItems.threadId, thread_id),
    eq(inboxItems.activityId, activity_id),
  ))

  return c.json({}, 200);
})



/* --------- FEED --------- */


function validateScore(schema: BaseConfig, thread: Thread, activity: Activity, user: User, scoreName: string, scoreValue: any, options?: { mustNotExist?: boolean }) {
  // Find the thread config
  const threadConfig = schema.threads.find((threadConfig) => threadConfig.type === thread.type);
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
          if (score.name === scoreName && !score.deletedAt && score.createdBy === user.id) {
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

  const session = await requireSession(c.req.raw.headers);
  const thread = await requireThread(thread_id)
  const activity = await requireActivity(thread, activity_id);
  const schema = await requireSchema()

  const inputScores = body.scores ?? {}

  for (const [scoreName, scoreValue] of Object.entries(inputScores)) {
    validateScore(schema, thread, activity, session.user, scoreName, scoreValue, { mustNotExist: true })
  }

  await db.transaction(async (tx) => {

    // Add comment
    const [newMessage] = await tx.insert(commentMessages).values({
      activityId: activity_id,
      userId: session.user.id,
      content: body.comment ?? null,
    }).returning();

    let userMentions: string[] = [];

    // Add comment mentions
    if (body.comment) {
      let mentions;

      try {
        mentions = extractMentions(body.comment);
        userMentions = mentions.user_id || [];
      } catch (error) {
        return c.json({ message: `Invalid mention format: ${(error as Error).message}` }, 400)
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

    // add scores
    for (const [scoreName, scoreValue] of Object.entries(inputScores)) {
      await tx.insert(scores).values({
        activityId: activity_id,
        name: scoreName,
        value: scoreValue,
        commentId: newMessage.id,
        createdBy: session.user.id,
      })
    }

    // add event
    const [event] = await tx.insert(events).values({
      type: 'comment_created',
      authorId: session.user.id,
      payload: {
        comment_id: newMessage.id, // never gets deleted
        has_comment: body.comment ? true : false,
        user_mentions: userMentions,
        scores: inputScores,
      }
    }).returning();

    await updateInboxes(tx, event, thread, activity);

  })

  return c.json({}, 201);
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

    // add event
    const [event] = await tx.insert(events).values({
      type: 'comment_deleted',
      authorId: session.user.id,
      payload: {
        comment_id
      }
    }).returning();

    await updateInboxes(tx, event, thread, activity);

  });
  return c.json({}, 200);

})


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

  const schema = await requireSchema()
  const session = await requireSession(c.req.raw.headers);
  const thread = await requireThread(thread_id)
  const activity = await requireActivity(thread, activity_id);
  const commentMessage = await requireCommentMessageFromUser(thread, activity, comment_id, session.user);

  const inputScores = body.scores ?? {}

  for (const [scoreName, scoreValue] of Object.entries(inputScores)) {
    validateScore(schema, thread, activity, session.user, scoreName, scoreValue, { mustNotExist: false })
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

    /** ADD EVENT **/
    const [event] = await tx.insert(events).values({
      type: 'comment_edited',
      authorId: session.user.id,
      payload: {
        comment_id, // never gets deleted
        has_comment: body.comment ? true : false,
        user_mentions: newUserMentions,
        scores: inputScores,
      }
    }).returning();

    await updateInboxes(tx, event, thread, activity);


  });

  return c.json({}, 200);
})


/* --------- MEMBERS --------- */


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
  await requireSession(c.req.raw.headers);

  const userRows = await db.select({
    id: users.id,
    email: users.email,
    name: users.name,
    role: users.role,
    created_at: users.createdAt
  }).from(users);

  return c.json(userRows, 200);

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

  await requireAdminSession(c.req.raw.headers);

  await auth.api.setRole({
    headers: c.req.raw.headers,
    body: { userId: memberId, role: body.role },
  });

  return c.json({}, 200);
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

  await requireAdminSession(c.req.raw.headers);

  await auth.api.removeUser({
    headers: c.req.raw.headers,
    body: { userId: memberId },
  });

  return c.json({}, 200);
})

/* --------- INVITATIONS --------- */

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

  const session = await requireAdminSession(c.req.raw.headers);

  await createInvitation(body.email, body.role, session.user.id);

  // Get the created invitation to return it
  const pendingInvitations = await getPendingInvitations();
  const createdInvitation = pendingInvitations.find(inv => inv.email === body.email);

  if (!createdInvitation) {
    return c.json({ message: "Failed to create invitation" }, 400);
  }

  return c.json(createdInvitation, 201);
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
  await requireAdminSession(c.req.raw.headers);

  const pendingInvitations = await getPendingInvitations();
  return c.json(pendingInvitations, 200);
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

  await requireAdminSession(c.req.raw.headers);
  await cancelInvitation(id);
  return c.json({}, 200);
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

  const invitation = await getValidInvitation(invitationId);
  return c.json(invitation, 200);
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

/* --------- SCHEMAS ---------   */

const schemasGETRoute = createRoute({
  method: 'get',
  path: '/api/dev/schemas/current',
  responses: {
    200: response_data(z.array(SchemaSchema).nullable()),
  },
})

app.openapi(schemasGETRoute, async (c) => {
  await requireSession(c.req.raw.headers)

  const schemaRows = await db.select().from(schemas).orderBy(desc(schemas.createdAt)).limit(1)
  if (schemaRows.length === 0) {
    return c.json(null, 200)
  }
  return c.json(schemaRows[0], 200)
})

const schemasPOSTRoute = createRoute({
  method: 'post',
  path: '/api/dev/schemas',
  request: {
    body: body(SchemaCreateSchema)
  },
  responses: {
    200: response_data(z.array(SchemaSchema).nullable()),
  },
})

app.openapi(schemasPOSTRoute, async (c) => {
  await requireAdminSession(c.req.raw.headers)

  const session = await requireSession(c.req.raw.headers)
  const body = await c.req.json()

  const [newSchema] = await db.insert(schemas).values({
    schema: body.schema,
    createdBy: session.user.id,
  }).returning()

  return c.json(newSchema, 200)
})


/* --------- INBOX --------- */



// Inbox GET (get all inbox items for the user)
const inboxGETRoute = createRoute({
  method: 'get',
  path: '/api/inbox',
  responses: {
    200: response_data(z.array(InboxItemSchema)),
    401: response_error(),
  },
})

app.openapi(inboxGETRoute, async (c) => {
  const session = await requireSession(c.req.raw.headers);

  const inboxItemRows = await db.query.inboxItems.findMany({
    where: eq(inboxItems.userId, session.user.id),
    with: {
      thread: true,
      activity: true,
      lastNotifiableEvent: true,
    }
  })

  inboxItemRows.sort((a, b) => {
    const aDate = a.lastNotifiableEvent?.createdAt ? new Date(a.lastNotifiableEvent.createdAt).getTime() : 0;
    const bDate = b.lastNotifiableEvent?.createdAt ? new Date(b.lastNotifiableEvent.createdAt).getTime() : 0;
    return bDate - aDate;
  });

  return c.json(inboxItemRows, 200);
});



// Mark inbox item as read
// const inboxMarkAsReadRoute = createRoute({
//   method: 'post',
//   path: '/api/inbox/{id}/mark_as_read',
//   request: {
//     params: z.object({
//       id: z.string(),
//     }),
//   },
//   responses: {
//     200: response_data(z.object({})),
//     400: response_error(),
//     401: response_error(),
//     404: response_error(),
//   },
// })

// app.openapi(inboxMarkAsReadRoute, async (c) => {
//   const { id } = c.req.param()

//   try {
//     const session = await requireSession(c.req.raw.headers);
//     const inboxItem = await requireInboxItem(session.user, id)

//     await db.update(inboxItems)
//       .set({
//         lastReadEventId: sql`${inboxItem.lastNotifiableEventId}`, // should be set to last notiffiable event id, because IT IS WHAT USER SAW. If we set it to last event id (from the system) we lose option to renotify user about consecutive events that he should be notified about.
//       })
//       .where(eq(inboxItems.id, inboxItem.id));

//     return c.json({}, 200);
//   } catch (error: any) {
//     return errorToResponse(c, error);
//   }
// })

/* --------- IS ACTIVE --------- */

const statusRoute = createRoute({
  method: 'get',
  path: '/api/status',
  responses: {
    200: response_data(z.object({
      is_active: z.boolean(),
    })),
  },
})

app.openapi(statusRoute, async (c) => {
  const hasUsers = await getUsersCount() > 0;
  return c.json({ is_active: hasUsers }, 200);
})

/* --------- EMAILS --------- */

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
  const apiPort = process.env.AGENTVIEW_API_PORT ?? "80";
  // if (!apiPort) throw new Error('API_PORT is not set');

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