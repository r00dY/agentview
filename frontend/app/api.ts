import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'

import { z, createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { db } from './lib/db.server'
import { client, thread, activity, run } from './db/schema'
import { asc, eq, ne } from 'drizzle-orm'
import { response_data, response_error, body } from './lib/hono_utils'
import { config } from './agentview.config'
import { isUUID } from './lib/isUUID'
import { isAsyncIterable } from './lib/utils'



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
app.use('*', cors())


/* --------- CLIENTS --------- */

const ClientSchema = z.object({
  id: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
})

// Clients POST
const clientsPOSTRoute = createRoute({
  method: 'post',
  path: '/clients',
  request: {
    body: body(z.object({}))
  },
  responses: {
    201: response_data(ClientSchema)
  },
})

app.openapi(clientsPOSTRoute, async (c) => {
  const [newClient] = await db.insert(client).values({}).returning();
  return c.json(newClient, 201);
})


// Client GET
const clientGETRoute = createRoute({
  method: 'get',
  path: '/clients/{id}',
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


// Threads POST
const threadsPOSTRoute = createRoute({
  method: 'post',
  path: '/threads',
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
  path: '/threads/{thread_id}',
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
  path: '/threads/{thread_id}/activities',
  request: {
    params: z.object({
      thread_id: z.string(),
    }),
    body: body(ActivityCreateSchema)
  },
  responses: {
    201: response_data(z.array(ActivitySchema)),
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

      if (isAsyncIterable(runOutput)) {
        console.log('is async iterable')

        for await (const activityData of runOutput) {
          await validateAndInsertActivity(activityData)
        }

      }
      else {
        console.log('not async iterable')

        const newActivities = await runOutput;

        if (!Array.isArray(newActivities)) {
          throw { error: "Invalid response from run function, it's not an array" }
        } else {
          for (const activityData of newActivities) {
            validateAndInsertActivity(activityData)
          }
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
          })
          .where(eq(run.id, userActivity.run_id));
      }

  })();

  return c.json(await fetchThreadWithLastRun(thread_id), 200);
})


// Cancel Run Endpoint
const threadCancelRoute = createRoute({
  method: 'post',
  path: '/threads/{thread_id}/cancel',
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
    })
    .where(eq(run.id, threadRow.lastRun.id));

  return c.json(await fetchThreadWithLastRun(thread_id), 200);
});

// Activities POST
const activityWatchRoute = createRoute({
  method: 'get',
  path: '/threads/{thread_id}/watch',
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
        await stream.writeSSE({
          data: JSON.stringify({ state: threadRow.state }),
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

// // Thread GET
// const threadGETCommentsRoute = createRoute({
//   method: 'get',
//   path: '/threads/{thread_id}/comments',
//   request: {
//     params: z.object({
//       thread_id: z.string(),
//     }),
//   },
//   responses: {
//     200: response_data(ThreadSchema),
//     404: response_error()
//   },
// })

// app.openapi(threadGETRoute, async (c) => {
//   const { thread_id } = c.req.param()

//   const threadRow = await fetchThreadWithLastRun(thread_id);

//   if (!threadRow) {
//     return c.json({ message: "Thread not found" }, 404);
//   }

//   return c.json(threadRow, 200);
// })









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
  port: 2138
})

console.log("Agent View API running...")