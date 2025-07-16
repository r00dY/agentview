import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'

import { z, createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { db } from './lib/db.server'
import { client, thread, activity, run } from './db/schema'
import { asc, eq, ne } from 'drizzle-orm'
import { response_data, response_error, body } from './lib/hono_utils'
import { config } from './agentview.config'


const app = new OpenAPIHono()


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
  return c.json({ data: newClient }, 201);
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
    return c.json({ error: "Client not found" }, 404);
  }

  return c.json({ data: clientRow }, 200);
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
})

const ActivityCreateSchema = ActivitySchema.pick({
  type: true,
  role: true,
  content: true,
})


const ThreadSchema = z.object({
  id: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
  metadata: z.any(),
  client_id: z.string(),
  type: z.string(),
  activities: z.array(ActivitySchema)
})

const ThreadCreateSchema = ThreadSchema.pick({
  client_id: true,
  type: true,
  metadata: true,
})

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
    return c.json({ error: `Thread type '${body.type}' not found in configuration` }, 400);
  }

  // Validate metadata against the schema
  try {
    threadConfig.metadata.parse(body.metadata);
  } catch (error: any) {
    return c.json({ error: `Invalid metadata: ${error.message}` }, 400);
  }

  const [newThread] = await db.insert(thread).values(body).returning();
  
  return c.json({ data: {
    ...newThread,
    activities: []
  } }, 201);
})

// Thread GET
const threadGETRoute = createRoute({
  method: 'get',
  path: '/threads/{id}',
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: response_data(ThreadSchema),
    404: response_error()
  },
})

app.openapi(threadGETRoute, async (c) => {
  const { id } = c.req.param()

  const threadRow = await db.query.thread.findFirst({
    where: eq(thread.id, id),
    with: {
      activities: true
    }
  });

  if (!threadRow) {
    return c.json({ error: "Thread not found" }, 404);
  }

  return c.json({ data: threadRow }, 200);
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
    201: response_data(ActivitySchema),
    400: response_error(),
    404: response_error()
  },
})

app.openapi(activitiesPOSTRoute, async (c) => {
  const { thread_id } = c.req.param()
  const { type, role, content } = await c.req.json()
  
  // Find the thread to get its type
  const threadRow = await db.query.thread.findFirst({
    where: eq(thread.id, thread_id),
    with: {
      runs: {
        where: ne(run.state, 'completed')
      },
    }
  });

  if (!threadRow) {
    return c.json({ error: "Thread not found" }, 404);
  }

  if (threadRow.runs.length >= 2) {
    return c.json({ error: "SYSTEM ERROR: Thread has multiple non-completed runs" }, 400);
  }

  // Find thread configuration by type
  const threadConfig = config.threads.find((t: any) => t.type === threadRow.type);
  if (!threadConfig) {
    return c.json({ error: `Thread type '${threadRow.type}' not found in configuration` }, 400);
  }

  if (role !== "user") {
    return c.json({ error: "Only activities with role 'user' are allowed" }, 400);
  }

  // Find activity configuration by type and role
  const activityConfig = threadConfig.activities.find((a: any) => a.type === type && a.role === role);
  if (!activityConfig) {
    return c.json({ error: `Activity type '${type}' with role '${role}' not found in configuration` }, 400);
  }

  // Validate content against the schema
  try {
    activityConfig.content.parse(content);
  } catch (error: any) {
    return c.json({ error: `Invalid content: ${error.message}` }, 400);
  }

  const activeRun = threadRow.runs.length > 0 ? threadRow.runs[0] : null;

  // Check thread status conditions
  if (activeRun) {
    return c.json({ error: `Cannot add user activity while thread has an non-completed run. Run state: ${activeRun.state}` }, 400);
  }

  const finalActivity = await db.transaction(async (tx) => {
    // Thread status is 'idle', so we can proceed
    // First create the activity
    const [newActivity] = await tx.insert(activity).values({
      thread_id,
      type,
      role,
      content,
    }).returning();

    // Create a new run with status 'in_progress' and set trigger_activity_id
    const [newRun] = await tx.insert(run).values({
      thread_id,
      trigger_activity_id: newActivity.id,
      state: 'in_progress',
    }).returning();

    // Return the activity with the run_id
    return {
      ...newActivity,
      run_id: newRun.id
    };
  })
  
  return c.json({ data: finalActivity }, 201);
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
    port: 2138
})

console.log("Agent View API running...")