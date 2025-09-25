import 'dotenv/config'
import { serve } from '@hono/node-server'
import { HTTPException } from 'hono/http-exception'

import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { APIError as BetterAuthAPIError } from "better-auth/api";

import { z, createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { db } from './db'
import { clients, sessions, sessionItems, runs, emails, commentMessages, commentMessageEdits, commentMentions, versions, scores, configs, events, inboxItems } from './schemas/schema'
import { eq, desc, and, inArray, ne, gt, isNull, isNotNull, or, gte, sql, countDistinct, DrizzleQueryError } from 'drizzle-orm'
import { response_data, response_error, body } from './hono_utils'
import { isUUID } from './isUUID'
import { extractMentions } from './utils'
import { auth } from './auth'
import { createInvitation, cancelInvitation, getPendingInvitations, getValidInvitation } from './invitations'
import { fetchSession } from './sessions'
import { callAgentAPI, AgentAPIError } from './agentApi'
import { getStudioURL } from './getStudioURL'

// shared imports
import { getAllSessionItems, getLastRun } from './shared/sessionUtils'
import { ClientSchema, SessionSchema, SessionCreateSchema, SessionItemCreateSchema, RunSchema, SessionItemSchema, type User, type Session, type SessionItem, ConfigSchema, ConfigCreateSchema, InboxItemSchema, ClientCreateSchema, MemberSchema, MemberUpdateSchema, type InboxItem, allowedSessionLists, InvitationSchema, InvitationCreateSchema } from './shared/apiTypes'
import { getConfig } from './getConfig'
import type { BaseConfig, BaseAgentConfig } from './shared/configTypes'
import { users } from './schemas/auth-schema'
import { getUsersCount } from './users'
import { updateInboxes } from './updateInboxes'
import { isInboxItemUnread } from './inboxItems'
import packageJson from '../package.json'


export const app = new OpenAPIHono({
  // custom error handler for zod validation errors
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

app.onError((error, c) => {
  console.error(error)
  if (error instanceof BetterAuthAPIError) {
    return c.json(error.body, error.statusCode as any); // "as any" because error.statusCode is "number" and hono expects some numeric literal union 
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

async function requireAuthSession(headers: Headers, options?: { admin?: boolean }) {
  const userSession = await auth.api.getSession({ headers })
  if (!userSession) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  if (options?.admin && userSession.user.role !== "admin") {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return userSession
}

async function requireConfig() {
  const config = await getConfig()
  if (!config) {
    throw new HTTPException(404, { message: "Config not found" });
  }
  return config
}

function requireAgentConfig(config: BaseConfig, name: string) {
  const agentConfig = config.agents?.find((agent) => agent.name === name)
  if (!agentConfig) {
    throw new HTTPException(404, { message: `Agent '${name}' not found in schema.` });
  }
  return agentConfig
}

function requireItemConfig(agentConfig: ReturnType<typeof requireAgentConfig>, type: string, role?: string | null) {
  const itemConfig = agentConfig.items?.find((item) => item.type === type && (!item.role || item.role === role))
  const itemTypeCuteName = `${type}' / '${role}`

  if (!itemConfig) {
    throw new HTTPException(400, { message: `Item '${itemTypeCuteName}' not found in configuration for agent '${agentConfig.name}'` });
  }

  return itemConfig
}

async function requireSession(sessionId: string) {
  const session = await fetchSession(sessionId)
  if (!session) {
    throw new HTTPException(404, { message: "Session not found" });
  }
  return session
}

async function requireSessionItem(session: Session, itemId: string) {
  const item = getAllSessionItems(session).find((a) => a.id === itemId)
  if (!item) {
    throw new HTTPException(404, { message: "Session item not found" });
  }
  return item
}

async function requireClient(clientId: string) {
  if (!isUUID(clientId)) {
    throw new HTTPException(400, { message: `Invalid client id: ${clientId}` });
  }

  const clientRow = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
  });

  if (!clientRow) {
    throw new HTTPException(404, { message: "Client not found" });
  }
  return clientRow
}

async function requireCommentMessageFromUser(item: SessionItem, commentId: string, user: User) {
  const comment = item.commentMessages?.find((m) => m.id === commentId && m.deletedAt === null)
  if (!comment) {
    throw new HTTPException(404, { message: "Comment not found" });
  }

  if (comment.userId !== user.id) {
    throw new HTTPException(401, { message: "You can only edit your own comments." });
  }

  return comment
}


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
  const session = await requireAuthSession(c.req.raw.headers)

  const [newClient] = await db.insert(clients).values({
    simulatedBy: session.user.id,
    isShared: body.isShared,
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

  const clientRow = await db.query.clients.findFirst({
    where: eq(clients.id, id),
  });

  if (!clientRow) {
    return c.json({ message: "Client not found" }, 404);
  }

  return c.json(clientRow, 200);
})


const apiClientsPUTRoute = createRoute({
  method: 'put',
  path: '/api/clients/{clientId}',
  request: {
    body: body(ClientCreateSchema)
  },
  responses: {
    200: response_data(ClientSchema)
  },
})

app.openapi(apiClientsPUTRoute, async (c) => {
  const body = await c.req.json()
  const { clientId } = c.req.param()

  const session = await requireAuthSession(c.req.raw.headers)
  const clientRow = await requireClient(clientId)

  if (clientRow.simulatedBy !== session.user.id) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const [updatedClient] = await db.update(clients).set(body).where(eq(clients.id, clientId)).returning();

  return c.json(updatedClient, 200);
})


/* --------- LISTS --------- */

// const LISTS : Record<string, { filter: any }>= {
//   real: {
//     filter: () => isNull(clients.simulatedBy)
//   },
//   simulated_private: {
//     filter: (user: User) => and(eq(clients.simulatedBy, user.id), eq(clients.isShared, false))
//   },
//   simulated_shared: {
//     filter: () => and(isNotNull(clients.simulatedBy), eq(clients.isShared, true))
//   }
// }

// const listsGETRoute = createRoute({
//   method: 'get',
//   path: '/api/lists',
//   responses: {
//     200: response_data(z.array(SessionListSchema)),
//   },
// })

// app.openapi(listsGETRoute, async (c) => {
//   const session = await requireAuthSession(c.req.raw.headers)
//   const config = await requireConfig()

//   const lists : SessionList[] = []

//   // For each session type in the schema
//   for (const agentConfig of config.sessions) {
//     // For each list type (real, simulated_private, simulated_shared)
//     for (const [listName, list] of Object.entries(LISTS)) {
//       const result = await db
//         .select({
//           unreadSessions: countDistinct(inboxItems.sessionId),
//         })
//         .from(inboxItems)
//         .leftJoin(sessions, eq(inboxItems.sessionId, sessions.id))
//         .leftJoin(clients, eq(sessions.clientId, clients.id))
//         .where(
//           and(
//             eq(inboxItems.userId, session.user.id), 
//             sql`${inboxItems.lastNotifiableEventId} > COALESCE(${inboxItems.lastReadEventId}, 0)`, 
//             list.filter(session.user),
//             eq(sessions.type, agentConfig.type)
//           )
//         )

//       lists.push({
//         name: listName,
//         agent: agentConfig.type,
//         unseenCount: result[0].unreadSessions ?? 0,
//         hasMentions: false,
//       })
//     }
//   }

//   return c.json(lists, 200);
// })



/* --------- SESSIONS --------- */

// const LISTS : Record<string, { filter: any }>= {
//   real: {
//     filter: () => isNull(clients.simulatedBy)
//   },
//   simulated_private: {
//     filter: (user: User) => and(eq(clients.simulatedBy, user.id), eq(clients.isShared, false))
//   },
//   simulated_shared: {
//     filter: () => and(isNotNull(clients.simulatedBy), eq(clients.isShared, true))
//   }
// }

function getSessionListFilter(args: { agent: string, list: string, user?: User }) {
  const { agent, list, user } = args;

  const filters : any[] = [
    eq(sessions.agent, agent)
  ]

  if (list === "real") {
    filters.push(isNull(clients.simulatedBy));
  }
  else if (list === "simulated_shared") {
    filters.push(and(isNotNull(clients.simulatedBy), eq(clients.isShared, true)));
  }
  else if (list === "simulated_private") {
    if (!user) {
      throw new Error("User not given for simulated_private list")
    }
    filters.push(and(eq(clients.simulatedBy, user.id), eq(clients.isShared, false)));
  }

  return and(...filters);
}


const sessionsGETRoute = createRoute({
  method: 'get',
  path: '/api/sessions',
  request: {
    query: z.object({
      agent: z.string(),
      list: z.enum(allowedSessionLists)
    }),
  },
  responses: {
    200: response_data(z.array(SessionSchema)),
    401: response_error(),
  },
})

app.openapi(sessionsGETRoute, async (c) => {
  const authSession = await requireAuthSession(c.req.raw.headers)

  const { agent, list } = c.req.query();

  const result = await db
    .select({
      id: sessions.id,
      agent: sessions.agent,
      client: {
        id: clients.id,
        simulatedBy: clients.simulatedBy,
        isShared: clients.isShared,
      }
    })
    .from(sessions)
    .leftJoin(clients, eq(sessions.clientId, clients.id))
    .where(getSessionListFilter({ agent, list, user: authSession.user }));

  const sessionIds = result.map((row) => row.id);

  const sessionRows = await db.query.sessions.findMany({
    where: and(inArray(sessions.id, sessionIds), eq(sessions.agent, agent)),
    with: {
      client: true,
      inboxItems: {
        where: eq(inboxItems.userId, authSession.user.id),
      },
    },
    orderBy: (session, { desc }: any) => [desc(session.updatedAt)],
  })

  const sessionRowsFilteredWithInboxItems = sessionRows.map((session) => {
    const sessionInboxItem = session.inboxItems.find((inboxItem) => inboxItem.sessionItemId === null);
    const itemInboxItems = session.inboxItems.filter((inboxItem) => inboxItem.sessionItemId !== null);

    function getUnseenEvents(inboxItem: InboxItem | null | undefined) {
      if (isInboxItemUnread(inboxItem)) {
        return inboxItem?.render?.events ?? [];
      }
      return [];
    }

    const unseenEvents: { session: any[], items: { [key: string]: any[] } } = {
      session: getUnseenEvents(sessionInboxItem),
      items: {}
    }

    itemInboxItems.forEach((inboxItem) => {
      unseenEvents.items[inboxItem.sessionItemId!] = getUnseenEvents(inboxItem);
    });

    return {
      ...session,
      unseenEvents
    }
  })

  return c.json(sessionRowsFilteredWithInboxItems, 200);
})

const sessionsGETStatsRoute = createRoute({
  method: 'get',
  path: '/api/sessions/stats',
  request: {
    query: z.object({
      agent: z.string(),
      list: z.enum(allowedSessionLists)
    }),
  },
  responses: {
    200: response_data(z.object({ unseenCount: z.number(), hasMentions: z.boolean() })),
  },
})

app.openapi(sessionsGETStatsRoute, async (c) => {
  const { user } = await requireAuthSession(c.req.raw.headers)
  const { agent, list } = c.req.query();

  const result = await db
    .select({
      unreadSessions: countDistinct(inboxItems.sessionId),
    })
    .from(inboxItems)
    .leftJoin(sessions, eq(inboxItems.sessionId, sessions.id))
    .leftJoin(clients, eq(sessions.clientId, clients.id))
    .where(
      and(
        eq(inboxItems.userId, user.id), 
        sql`${inboxItems.lastNotifiableEventId} > COALESCE(${inboxItems.lastReadEventId}, 0)`, 
        getSessionListFilter({ agent, list, user })
      )
    )

  return c.json({
    unseenCount: result[0].unreadSessions ?? 0,
    hasMentions: false,
  }, 200);
})

const sessionsPOSTRoute = createRoute({
  method: 'post',
  path: '/api/sessions',
  request: {
    body: body(SessionCreateSchema)
  },
  responses: {
    201: response_data(SessionSchema),
    400: response_error()
  },
})

app.openapi(sessionsPOSTRoute, async (c) => {
  const body = await c.req.json()

  const config = await requireConfig()
  const client = await requireClient(body.clientId)
  const agentConfig = await requireAgentConfig(config, body.agent)
  const authSession = await requireAuthSession(c.req.raw.headers)

  // Validate metadata against the schema
  try {
    agentConfig.metadata?.parse(body.metadata);
  } catch (error: any) {
    return c.json({ message: error.message }, 400);
  }

  const newSession = await db.transaction(async (tx) => {
    const [newSessionRow] = await tx.insert(sessions).values(body).returning();

    // add event
    const [event] = await tx.insert(events).values({
      type: 'session_created',
      authorId: authSession.user.id,
      payload: {
        session_id: newSessionRow.id,
      }
    }).returning();

    const newSession = await fetchSession(newSessionRow.id, tx);
    if (!newSession) {
      throw new Error("[Internal Error] Session not found");
    }

    await updateInboxes(tx, event, newSession, null);

    return newSession;
  });

  return c.json(newSession, 201);
})

const sessionGETRoute = createRoute({
  method: 'get',
  path: '/api/sessions/{sessionId}',
  request: {
    params: z.object({
      sessionId: z.string(),
    }),
  },
  responses: {
    200: response_data(SessionSchema),
    404: response_error()
  },
})



app.openapi(sessionGETRoute, async (c) => {
  const { sessionId } = c.req.param()

  const session = await fetchSession(sessionId);

  if (!session) {
    return c.json({ message: "Session not found" }, 404);
  }

  return c.json(session, 200);
})


const sessionSeenRoute = createRoute({
  method: 'post',
  path: '/api/sessions/{sessionId}/seen',
  request: {
    params: z.object({
      sessionId: z.string(),
    }),
  },
  responses: {
    200: response_data(z.object({})),
    400: response_error(),
    401: response_error(),
    404: response_error(),
  },
})

app.openapi(sessionSeenRoute, async (c) => {
  const { sessionId } = c.req.param()

  const authSession = await requireAuthSession(c.req.raw.headers);

  await db.update(inboxItems).set({
    lastReadEventId: sql`${inboxItems.lastNotifiableEventId}`,
    updatedAt: new Date(),
  }).where(and(
    eq(inboxItems.userId, authSession.user.id),
    eq(inboxItems.sessionId, sessionId),
    isNull(inboxItems.sessionItemId),
  ))

  return c.json({}, 200);
})


/* --------- RUNS --------- */


// Create run
const runsPOSTRoute = createRoute({
  method: 'post',
  path: '/api/sessions/{sessionId}/runs',
  request: {
    params: z.object({
      sessionId: z.string(),
    }),
    body: body(z.object({
      input: SessionItemCreateSchema
    }))
  },
  responses: {
    201: response_data(RunSchema), // todo: this sucks I guess
    400: response_error(),
    404: response_error()
  },
})

app.openapi(runsPOSTRoute, async (c) => {
  const { sessionId } = c.req.param()
  const { input: { type, role, content } } = await c.req.json()

  const session = await requireSession(sessionId)
  const config = await requireConfig()
  const agentConfig = requireAgentConfig(config, session.agent)
  const itemConfig = requireItemConfig(agentConfig, type, role)

  // Validate content against the schema
  try {
    itemConfig.content.parse(content);
  } catch (error: any) {
    return c.json({ message: `Invalid content: ${error.message}` }, 400);
  }

  const lastRun = getLastRun(session)

  if (lastRun?.state === 'in_progress') {
    return c.json({ message: `Cannot add user item when session is in 'in_progress' state.` }, 400);
  }

  // Create user item and run
  const userItem = await db.transaction(async (tx) => {

    const [newRun] = await tx.insert(runs).values({
      sessionId: sessionId,
      state: 'in_progress',
    }).returning();

    const [userItem] = await tx.insert(sessionItems).values({
      sessionId: sessionId,
      type,
      role,
      content,
      runId: newRun.id,
    }).returning();

    return userItem;
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
      session: {
        id: session.id,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        metadata: session.metadata,
        clientId: session.clientId,
        agent: session.agent,
        items: [...getAllSessionItems(session), userItem]
      }
    }

    async function isStillRunning() {
      const currentRun = await db.query.runs.findFirst({ where: eq(runs.id, userItem.runId) });
      if (currentRun && currentRun.state === 'in_progress') {
        return true
      }
      return false
    }

    try {
      // Try streaming first, fallback to non-streaming
      const runOutput = callAgentAPI(input, agentConfig.url)
      
      let versionId: string | null = null;

      let hadManifest = false

      for await (const event of runOutput) {
        if (!(await isStillRunning())) {
          return
        }

        if (!hadManifest && event.name !== 'response_data' && event.name !== 'manifest') {
          throw new AgentAPIError({
            message: "No 'manifest' was sent by the agent."
          });
        }

        if (event.name === 'response_data') {
          await db.update(runs)
            .set({ responseData: event.data })
            .where(eq(runs.id, userItem.runId));
          continue;
        }
        else if (event.name === 'manifest') {
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
          if (userItem.runId) {
            await db.update(runs)
              .set({ versionId })
              .where(eq(runs.id, userItem.runId));
          }

          hadManifest = true;
          continue; // Skip this item as it's not an item
        }
        else if (event.name === 'item') {

          const parsedItem = z.object({
            type: z.string(),
            role: z.string().optional(),
            content: z.any(),
          }).safeParse(event.data)

          if (!parsedItem.success) {
            throw new AgentAPIError({
              message: "Invalid item",
              details: event.data
            });
          }

          await db.insert(sessionItems).values({
            sessionId: sessionId,
            type: parsedItem.data.type,
            role: parsedItem.data.role,
            content: parsedItem.data.content,
            runId: userItem.runId,
          })
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

      await db.update(runs)
        .set({
          state: 'completed',
          finishedAt: new Date(),
        })
        .where(eq(runs.id, userItem.runId));
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
        console.error(error)
        failReason = {
          message: "AgentView internal error, please report to the team"
        }
      }

      await db.update(runs)
        .set({
          state: 'failed',
          finishedAt: new Date(),
          failReason
        })
        .where(eq(runs.id, userItem.runId));
    }

  })();

  const newSession = await fetchSession(sessionId);
  const newRun = getLastRun(newSession!);

  return c.json(newRun, 201);
})


// Cancel Run Endpoint
const runCancelRoute = createRoute({
  method: 'post',
  path: '/api/sessions/{sessionId}/cancel_run',
  request: {
    params: z.object({
      sessionId: z.string(),
    }),
  },
  responses: {
    200: response_data(z.object({})),
    400: response_error(),
    404: response_error(),
  },
});

app.openapi(runCancelRoute, async (c) => {
  const { sessionId } = c.req.param();

  const session = await requireSession(sessionId);
  const lastRun = getLastRun(session)

  if (lastRun?.state !== 'in_progress') {
    return c.json({ message: 'Run is not in progress' }, 400);
  }
  // Set the run as failed
  await db.update(runs)
    .set({
      state: 'failed',
      finishedAt: new Date(),
      failReason: { message: 'Run was cancelled by user' }
    })
    .where(eq(runs.id, lastRun.id));

  return c.json(await fetchSession(sessionId), 200);
});

const runWatchRoute = createRoute({
  method: 'get',
  path: '/api/sessions/{sessionId}/watch_run',
  request: {
    params: z.object({
      sessionId: z.string()
    })
  },
  responses: {
    // 201: response_data(z.array(SessionItemSchema)),
    400: response_error(),
    404: response_error()
  },
})



// @ts-ignore don't know how to fix this with hono yet
app.openapi(runWatchRoute, async (c) => {
  const { sessionId } = c.req.param()

  const session = await requireSession(sessionId)
  const lastRun = getLastRun(session)

  return streamSSE(c, async (stream) => {
    let running = true;
    stream.onAbort(() => {
      running = false;
    });

    // Always start with session.state in_progress
    await stream.writeSSE({
      data: JSON.stringify({ state: lastRun?.state }),
      event: 'state',
    });

    let sentItemIds: string[] = [];

    /**
     * 
     * POLLING HERE
     * 
     * Soon we'll need to create a proper messaging, when some LLM API will be streaming characters then even NOTIFY/LISTEN won't make it performance-wise.
     * 
     */
    while (running) {
      const session = await requireSession(sessionId)
      const lastRun = getLastRun(session)

      if (!lastRun) {
        throw new Error('unreachable');
      }

      const items = getAllSessionItems(session)

      for (const item of items) {
        if (sentItemIds.includes(item.id)) {
          continue;
        }
        sentItemIds.push(item.id)
        await stream.writeSSE({
          data: JSON.stringify(item),
          event: 'item',
        });
      }

      // End if run is no longer in_progress
      if (lastRun?.state !== 'in_progress') {
        const data: { state: string, failReason?: any } = { state: lastRun?.state }

        if (lastRun?.state === 'failed') {
          data.failReason = lastRun.failReason
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

/* --------- ITEMS --------- */


const itemSeenRoute = createRoute({
  method: 'post',
  path: '/api/sessions/{sessionId}/items/{itemId}/seen',
  request: {
    params: z.object({
      sessionId: z.string(),
      itemId: z.string(),
    }),
  },
  responses: {
    200: response_data(z.object({})),
    400: response_error(),
    401: response_error(),
    404: response_error(),
  },
})

app.openapi(itemSeenRoute, async (c) => {
  const { sessionId, itemId } = c.req.param()
  const authSession = await requireAuthSession(c.req.raw.headers);

  await db.update(inboxItems).set({
    lastReadEventId: sql`${inboxItems.lastNotifiableEventId}`,
    updatedAt: new Date(),
  }).where(and(
    eq(inboxItems.userId, authSession.user.id),
    eq(inboxItems.sessionId, sessionId),
    eq(inboxItems.sessionItemId, itemId),
  ))

  return c.json({}, 200);
})



/* --------- FEED --------- */


function validateScore(config: BaseConfig, session: Session, item: SessionItem, user: User, scoreName: string, scoreValue: any, options?: { mustNotExist?: boolean }) {
  const agentConfig = requireAgentConfig(config, session.agent);
  const itemConfig = requireItemConfig(agentConfig, item.type, item.role ?? undefined)
  const itemTypeCuteName = `${item.type}' / '${item.role}`

  // Find the score config for this item
  const scoreConfig = itemConfig.scores?.find((scoreConfig) => scoreConfig.name === scoreName);
  if (!scoreConfig) {
    throw new HTTPException(400, { message: `Score name '${scoreName}' not found in configuration for item  '${itemTypeCuteName}' in agent '${session.agent}'` });
  }

  // Check if there is already a score with the same name in any commentMessage's scores
  if (item.commentMessages && options?.mustNotExist === true) {
    for (const message of item.commentMessages) {
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
  path: '/api/sessions/{sessionId}/items/{itemId}/comments',
  request: {
    params: z.object({
      sessionId: z.string(),
      itemId: z.string(),
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
  const { sessionId, itemId } = c.req.param()

  const authSession = await requireAuthSession(c.req.raw.headers);
  const session = await requireSession(sessionId)
  const item = await requireSessionItem(session, itemId);
  const config = await requireConfig()

  const inputScores = body.scores ?? {}

  for (const [scoreName, scoreValue] of Object.entries(inputScores)) {
    validateScore(config, session, item, authSession.user, scoreName, scoreValue, { mustNotExist: true })
  }

  await db.transaction(async (tx) => {

    // Add comment
    const [newMessage] = await tx.insert(commentMessages).values({
      sessionItemId: itemId,
      userId: authSession.user.id,
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
        sessionItemId: itemId,
        name: scoreName,
        value: scoreValue,
        commentId: newMessage.id,
        createdBy: authSession.user.id,
      })
    }

    // add event
    const [event] = await tx.insert(events).values({
      type: 'comment_created',
      authorId: authSession.user.id,
      payload: {
        comment_id: newMessage.id, // never gets deleted
        has_comment: body.comment ? true : false,
        user_mentions: userMentions,
        scores: inputScores,
      }
    }).returning();

    await updateInboxes(tx, event, session, item);
  })

  return c.json({}, 201);
})


// Comments DELETE (delete comment)
const commentsDELETERoute = createRoute({
  method: 'delete',
  path: '/api/sessions/{sessionId}/items/{itemId}/comments/{commentId}',
  request: {
    params: z.object({
      sessionId: z.string(),
      itemId: z.string(),
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
  const { commentId, sessionId, itemId } = c.req.param()

  const authSession = await requireAuthSession(c.req.raw.headers);
  const session = await requireSession(sessionId)
  const item = await requireSessionItem(session, itemId);
  const commentMessage = await requireCommentMessageFromUser(item, commentId, authSession.user);

  await db.transaction(async (tx) => {
    await tx.delete(commentMentions).where(eq(commentMentions.commentMessageId, commentMessage.id));
    await tx.delete(scores).where(eq(scores.commentId, commentMessage.id));
    await tx.update(commentMessages).set({
      deletedAt: new Date(),
      deletedBy: authSession.user.id
    }).where(eq(commentMessages.id, commentMessage.id));

    // add event
    const [event] = await tx.insert(events).values({
      type: 'comment_deleted',
      authorId: authSession.user.id,
      payload: {
        comment_id: commentId
      }
    }).returning();

    await updateInboxes(tx, event, session, item);
  });
  return c.json({}, 200);
})


// Comments PUT (edit comment)
const commentsPUTRoute = createRoute({
  method: 'put',
  path: '/api/sessions/{sessionId}/items/{itemId}/comments/{commentId}',
  request: {
    params: z.object({
      sessionId: z.string(),
      itemId: z.string(),
      commentId: z.string(),
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
  const { sessionId, itemId, commentId } = c.req.param()
  const body = await c.req.json()

  const config = await requireConfig()
  const authSession = await requireAuthSession(c.req.raw.headers);
  const session = await requireSession(sessionId)
  const item = await requireSessionItem(session, itemId)
  const commentMessage = await requireCommentMessageFromUser(item, commentId, authSession.user);

  const inputScores = body.scores ?? {}

  for (const [scoreName, scoreValue] of Object.entries(inputScores)) {
    validateScore(config, session, item, authSession.user, scoreName, scoreValue, { mustNotExist: false })
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
          sessionItemId: itemId,
          name: scoreName,
          value: scoreValue,
          commentId: commentMessage.id,
          createdBy: authSession.user.id,
        });
      }
    }

    /** ADD EVENT **/
    const [event] = await tx.insert(events).values({
      type: 'comment_edited',
      authorId: authSession.user.id,
      payload: {
        comment_id: commentId, // never gets deleted
        has_comment: body.comment ? true : false,
        user_mentions: newUserMentions,
        scores: inputScores,
      }
    }).returning();

    await updateInboxes(tx, event, session, item);
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
  await requireAuthSession(c.req.raw.headers);

  const userRows = await db.select({
    id: users.id,
    email: users.email,
    name: users.name,
    role: users.role,
    createdAt: users.createdAt
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

  await requireAuthSession(c.req.raw.headers, { admin: true });

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

  await requireAuthSession(c.req.raw.headers, { admin: true });

  await auth.api.removeUser({
    headers: c.req.raw.headers,
    body: { userId: memberId },
  });

  return c.json({}, 200);
})

/* --------- INVITATIONS --------- */

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

  const session = await requireAuthSession(c.req.raw.headers, { admin: true });

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
  await requireAuthSession(c.req.raw.headers, { admin: true });

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

  await requireAuthSession(c.req.raw.headers, { admin: true });
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
  const emailRows = await db
    .select({
      id: emails.id,
      to: emails.to,
      subject: emails.subject,
      from: emails.from,
      createdAt: emails.createdAt,
    })
    .from(emails)
    .orderBy(desc(emails.createdAt))
    .limit(100);

  return c.json(emailRows, 200);
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
  const emailRow = await db.query.emails.findFirst({ where: eq(emails.id, id) })
  return c.json(emailRow, 200)
})

/* --------- SCHEMAS ---------   */

const configsGETRoute = createRoute({
  method: 'get',
  path: '/api/dev/configs/current',
  responses: {
    200: response_data(ConfigSchema.nullable()),
  },
})

app.openapi(configsGETRoute, async (c) => {
  await requireAuthSession(c.req.raw.headers)

  const configRows = await db.select().from(configs).orderBy(desc(configs.createdAt)).limit(1)
  if (configRows.length === 0) {
    return c.json(null, 200)
  }
  return c.json(configRows[0], 200)
})

const configsPOSTRoute = createRoute({
  method: 'post',
  path: '/api/dev/configs',
  request: {
    body: body(ConfigCreateSchema)
  },
  responses: {
    200: response_data(ConfigSchema),
  },
})

app.openapi(configsPOSTRoute, async (c) => {
  const session = await requireAuthSession(c.req.raw.headers, { admin: true })
  const body = await c.req.json()

  const [newSchema] = await db.insert(configs).values({
    config: body.config,
    createdBy: session.user.id,
  }).returning()

  return c.json(newSchema, 200)
})


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
    version: packageJson.version,
    title: "agentview API",
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