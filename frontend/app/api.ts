import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'

import { z, createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { db } from './lib/db.server'
import { client, thread, activity } from './db/schema'
import { asc, eq } from 'drizzle-orm'
import { response_data, response_error, body } from './lib/hono_utils'


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
    201: response_data(ThreadSchema)
  },
})

app.openapi(threadsPOSTRoute, async (c) => {
  const body = await c.req.json()
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
      activities: true,
      // activities: {
      //   orderBy: [asc(activity.created_at)],
      // }
    }
  });

  if (!threadRow) {
    return c.json({ error: "Thread not found" }, 404);
  }

  // // Get activities for this thread, sorted by created_at (oldest first)
  // const activities = await db.query.activity.findMany({
  //   where: eq(activity.thread_id, id),
  //   orderBy: [activity.created_at],
  // });

  // const threadWithActivities = {
  //   ...threadRow,
  //   activities,
  // };

  return c.json({ data: threadRow }, 200);
})



/* --------- ACTIVITIES --------- */

// Activities POST
const activitiesPOSTRoute = createRoute({
  method: 'post',
  path: '/activities',
  request: {
    body: body(z.object({
      thread_id: z.string(),
      type: z.string(),
      role: z.string(),
      content: z.any(),
    }))
  },
  responses: {
    201: response_data(ActivitySchema)
  },
})

app.openapi(activitiesPOSTRoute, async (c) => {
  const { thread_id, type, role, content } = await c.req.json()
  
  const [newActivity] = await db.insert(activity).values({
    thread_id,
    type,
    role,
    content,
  }).returning();
  
  return c.json({ data: newActivity }, 201);
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