import { ServerResponse } from 'node:http';
import { serve } from '@hono/node-server';
import type { Context } from 'hono';

import { APIError as BetterAuthAPIError } from "better-auth/api";
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import type { StatusCode } from 'hono/utils/http-status';

import { swaggerUI } from '@hono/swagger-ui';
import { createRoute, OpenAPIHono, z, type RouteHandler } from '@hono/zod-openapi';
import { log, runWithContext } from './logger';
import { AgentViewError } from 'agentview/AgentViewError';
import {
  CommentMessageCreateSchema,
  CommentMessageSchema,
  EnvironmentBaseSchema,
  EnvironmentCreateSchema,
  EnvironmentSchema,
  InputTargetSchema,
  ManualRunCreateSchema,
  ManualRunUpdateSchema,
  RunCreateSchema,
  ScoreCreateSchema,
  ScoreSchema,
  SessionCreateSchema,
  SessionSchema,
  SessionsGetQueryParamsSchema,
  SessionsPaginatedResponseSchema,
  SessionUpdateSchema,
  StandardRunCreateSchema,
  StandardRunSchema,
  StandardSessionCreateSchema,
  StandardSessionSchema,
  UserCreateSchema,
  UserSchema,
  type Session,
  type StandardSession
} from 'agentview/apiTypes';
import { BaseConfigSchema, BaseRunSchemaToZod } from 'agentview/baseConfigTypes';
import { getChannelAgent, requireAgentConfig, requireChannelConfig, requireItemConfig, requireRunConfig, requireScoreConfig } from 'agentview/baseConfigUtils';
import { getLastRun } from 'agentview/sessionUtils';
import { and, countDistinct, DrizzleQueryError, eq, inArray, isNull, or, sql, type InferSelectModel } from 'drizzle-orm';
import packageJson from '../package.json';
import Redis from 'ioredis';
import { createAISDKStreamConsumer, type AISDKResponseMeta, type AISDKStreamConsumer } from './adapters/ai-sdk-stream';
import { REDIS_URL } from './redis';
import { auth } from './auth';
import { authn, authnAllowAnon, authnAllowPublic, authorize, requireMemberPrincipal, type Principal, type ServicePrincipal } from './authMiddleware';
import { db__dangerous } from './db';
import { requireConfig, requireEnvironment } from './environments';
import { equalJSON } from './equalJSON';
import { getAllowedOrigin } from './getAllowedOrigin';
import { body, response_data, response_error, response_no_content } from './hono_utils';
import { isInboxItemUnread } from './inboxItems';
import { initDb } from './initDb';
import { requireValidInvitation } from './invitations';
import { requireUUID } from './isUUID';
import { applyRunPatch, createAutoRun2, createManualRun, DEFAULT_IDLE_TIME, fastApplyRunPatch, getRunInput, getRunInputContent, isRunFinished, requireRunBase, RunTerminationError, sendRunTerminationSignal, terminateRun } from './runs';
import { createRunStreamConsumer } from './runStream';
import { organizations, users } from './schemas/auth-schema';
import { commentMessages, endUsers, environments, inboxItems, runs, scores, sessions } from './schemas/schema';
import { activateSession, createSession, getSessionListFilter, getSessions, updateSession } from './sessions';
import { createUser, requireUser, updateUser } from './users';
import { withOrg, withTenant } from './withOrg';

import { resolveTarget, resolveTargetWithObjects, targetFilter } from './target';

import { createComment, deleteComment, requireCommentMessage, requireCommentOwnership, updateComment } from './comments';
import { requireSession, requireSessionBase } from './sessions';

import { printELU } from './performance';
import { standardToDefaultSession } from './standardToDefaultSession';

// printELU('http');

await initDb();

export const app = new OpenAPIHono({
  // custom error handler for zod validation errors
  defaultHook: (result, c) => {
    if (!result.success) {
      log.warn({ issues: result.error.issues }, 'validation error');
      return c.json({
        message: 'Validation error',
        issues: result.error.issues
      }, 422)
    }
  }
})

/** --------- ERROR HANDLING --------- */

app.onError((error, c) => {
  if (error instanceof AgentViewError) {
    const payload = { message: error.message, ...(error.details ?? {}) }
    log.info({ errorType: 'AgentViewError', statusCode: error.statusCode }, error.message);
    return c.json(payload, error.statusCode as any);
  }
  else if (error instanceof BetterAuthAPIError) {
    log.error({ errorType: 'BetterAuthAPIError', statusCode: error.statusCode }, error.message);
    return c.json(error.body, error.statusCode as any); // "as any" because error.statusCode is "number" and hono expects some numeric literal union
  }
  else if (error instanceof DrizzleQueryError) {
    log.error({ errorType: 'DrizzleQueryError', err: error }, 'DB error');
    return c.json({ ...error, message: "DB error" }, 400);
  }
  else if (error instanceof Error) {
    log.error({ errorType: 'Error', err: error }, error.message);
    return c.json({ message: error.message }, 400);
  }
  else {
    log.error({ errorType: 'UnexpectedError', err: error }, 'Unexpected error');
    return c.json({ message: "Unexpected error" }, 400);
  }
});

/** --------- CORS --------- */

app.use('*', cors({
  // origin: [getStudioURL()],
  origin: (_, c) => {
    return getAllowedOrigin(c.req.raw.headers);
  },
  credentials: true,
}))

/** --------- REQUEST LOGGING --------- */

let reqCounter = 0;
app.use('*', async (c, next) => {
  const requestId = "r" + (++reqCounter).toString(10);
  const start = Date.now();

  return runWithContext({ requestId }, async () => {
    await next();
    const duration = Date.now() - start;
    log.info({ method: c.req.method, path: c.req.path, status: c.res.status, duration }, 'request completed');
  });
});

/* --------- AUTH --------- */

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});


// DATA HELPERS


/* --------- END USERS --------- */

const usersPOSTRoute = createRoute({
  method: 'post',
  path: '/api/users',
  summary: 'Create a user',
  tags: ['Users'],
  request: {
    body: body(UserCreateSchema)
  },
  responses: {
    201: response_data(UserSchema)
  },
})



app.openapi(usersPOSTRoute, async (c) => {
  const principal = await authnAllowAnon(c.req.raw.headers)
  const body = await c.req.valid('json')

  return withTenant(principal, async (tx) => {
    const newUser = await createUser(tx, body);
    return c.json(newUser, 201);
  })
})


const userMeRoute = createRoute({
  method: 'get',
  path: '/api/users/me',
  summary: 'Retrieve the current user',
  tags: ['Users'],
  responses: {
    200: response_data(UserSchema),
    404: response_error()
  },
})

app.openapi(userMeRoute, async (c) => {
  const principal = await authnAllowPublic(c.req.raw.headers)

  if (principal.type !== 'user') {
    throw new AgentViewError("This endpoint is only available for user-scoped tokens.", 401);
  }

  const user = principal.user;

  if (!user) {
    throw new AgentViewError("You must provide an end user token to access this endpoint.", 422);
  }

  await authorize(principal, { action: "end-user:read", user })
  return c.json(user, 200);
})

const userGETRoute = createRoute({
  method: 'get',
  path: '/api/users/{id}',
  summary: 'Retrieve a user',
  tags: ['Users'],
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: response_data(UserSchema),
    404: response_error()
  },
})

app.openapi(userGETRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)

  const { id } = c.req.param()

  return withOrg(principal.organizationId, async (tx) => {
    const user = await requireUser(tx, { id })
    await authorize(principal, { action: "end-user:read", user })
    return c.json(user, 200);
  })
})

const userByExternalIdGETRoute = createRoute({
  method: 'get',
  path: '/api/users/by-external-id/{external_id}',
  summary: 'Retrieve a user by external id',
  tags: ['Users'],
  request: {
    params: z.object({
      external_id: z.string(),
    }),
  },
  responses: {
    200: response_data(UserSchema),
    404: response_error()
  },
})

app.openapi(userByExternalIdGETRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)

  const { external_id } = c.req.param()

  return withTenant(principal, async (tx) => {
    const user = await requireUser(tx, { externalId: external_id })
    await authorize(principal, { action: "end-user:read", user })
    return c.json(user, 200);
  })
})

const apiUsersPATCHRoute = createRoute({
  method: 'patch',
  path: '/api/users/{id}',
  summary: 'Update a user',
  tags: ['Users'],
  request: {
    body: body(UserCreateSchema)
  },
  responses: {
    200: response_data(UserSchema)
  },
})


app.openapi(apiUsersPATCHRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)

  const { id } = c.req.param()
  const body = await c.req.valid('json')

  return withTenant(principal, async (tx) => {
    const updatedUser = await updateUser(tx, id, body);
    return c.json(updatedUser, 200);
  })
})



// internal
const sessionsGETRoute = createRoute({
  method: 'get',
  path: '/api/sessions',
  summary: 'List sessions',
  tags: ['Sessions and Runs'],
  request: {
    query: SessionsGetQueryParamsSchema,
  },
  responses: {
    200: response_data(SessionsPaginatedResponseSchema),
    401: response_error(),
  },
})

app.openapi(sessionsGETRoute, async (c) => {
  const principal = await authnAllowPublic(c.req.raw.headers)
  const params = c.req.valid("query");

  return withTenant(principal, async (tx) => {
    const sessions = await getSessions(tx, params)
    return c.json(sessions, 200);
  })
})

type InboxItemStatsResponse = {
  sessionId: string,
  runId: string | null,
  sessionItemId: string | null,
  channelMessageId: string | null,
  unseenEvents: any[],
}

type StatsResponse = {
  unseenCount: number,
  sessions?: {
    [sessionId: string]: {
      inboxItems: InboxItemStatsResponse[]
    }
  }
}

const sessionsGETStatsRoute = createRoute({
  method: 'get',
  path: '/api/sessions/stats',
  summary: 'Get stats',
  tags: ['Inbox'],
  request: {
    query: SessionsGetQueryParamsSchema.extend({
      granular: z.stringbool().optional()
    }),
  },
  responses: {
    200: response_data(z.object({ unseenCount: z.number() })),
  },
})

app.openapi(sessionsGETStatsRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const memberPrincipal = requireMemberPrincipal(principal);

  const { granular = false, ...params } = c.req.valid("query");

  return withTenant(principal, async (tx) => {
    const result = await tx
      .select({
        unreadSessions: countDistinct(inboxItems.sessionId),
      })
      .from(inboxItems)
      .leftJoin(sessions, eq(inboxItems.sessionId, sessions.id))
      .leftJoin(endUsers, eq(sessions.userId, endUsers.id))
      .where(
        and(
          eq(inboxItems.userId, memberPrincipal.session.user.id),
          sql`${inboxItems.lastNotifiableEventId} > COALESCE(${inboxItems.lastReadEventId}, 0)`,
          getSessionListFilter(tx, params)
        )
      )

    const response: StatsResponse = {
      unseenCount: result[0].unreadSessions ?? 0,
    }

    if (granular) {
      const sessionsResult = await getSessions(tx, params);
      const sessionIds = sessionsResult.sessions.map((row) => row.id);

      response.sessions = {}

      const sessionRows = await tx.query.sessions.findMany({
        where: inArray(sessions.id, sessionIds),
        with: {
          user: true,
          inboxItems: {
            where: eq(inboxItems.userId, memberPrincipal.session.user.id),
          },
        },
        orderBy: (session, { desc }: any) => [desc(session.updatedAt)],
      })

      function getUnseenEvents(inboxItem: InferSelectModel<typeof inboxItems>): any[] {
        if (isInboxItemUnread(inboxItem)) {
          const render: any = inboxItem.render;
          return render?.events ?? [];
        }
        return [];
      }

      sessionRows.map((session) => {
        const items: InboxItemStatsResponse[] = [];

        for (const inboxItem of session.inboxItems) {
          const unseenEvents = getUnseenEvents(inboxItem);
          if (unseenEvents.length === 0) continue;

          items.push({
            sessionId: session.id,
            runId: inboxItem.runId,
            sessionItemId: inboxItem.sessionItemId,
            channelMessageId: inboxItem.channelMessageId,
            unseenEvents,
          });
        }

        response.sessions![session.id] = { inboxItems: items };
      })
    }

    return c.json(response, 200);
  })
})

/**
 * SESSION GET BY ID
 */

const sessionGETRoute = createRoute({
  method: 'get',
  path: '/api/sessions/{session_id}/standard',
  summary: 'Retrieve a session',
  tags: ['Standard'],
  request: {
    params: z.object({
      session_id: z.string(),
    }),
  },
  responses: {
    200: response_data(StandardSessionSchema),
    404: response_error()
  },
})

async function sessionGETHandler(c: Parameters<RouteHandler<typeof sessionGETRoute>>[0]) {
  const principal = await authnAllowPublic(c.req.raw.headers)
  const { session_id } = c.req.param()

  return withOrg(principal.organizationId, async (tx) => {
    const session = await requireSession(tx, session_id);
    await authorize(principal, { action: "end-user:read", user: session.user });
    return session;
  })
}

app.openapi(sessionGETRoute, async (c) => {
  return c.json(await sessionGETHandler(c), 200);
})

const sessionAISDKGETRoute = createRoute({
  method: 'get',
  path: '/api/sessions/{session_id}',
  summary: 'Retrieve a session',
  tags: ['Sessions and Runs'],
  request: {
    params: z.object({
      session_id: z.string(),
    }),
  },
  responses: {
    200: response_data(SessionSchema),
    404: response_error()
  },
})

app.openapi(sessionAISDKGETRoute, async (c) => {
  const session = await sessionGETHandler(c);
  return c.json(standardToDefaultSession(session), 200);
})



const sessionPATCHRoute = createRoute({
  method: 'patch',
  path: '/api/sessions/{session_id}',
  summary: 'Update a session',
  tags: ['Sessions and Runs'],
  request: {
    params: z.object({
      session_id: z.string(),
    }),
    body: body(SessionUpdateSchema),
  },
  responses: {
    200: response_data(StandardSessionSchema),
    401: response_error(),
    404: response_error(),
    422: response_error(),
  },
})

app.openapi(sessionPATCHRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const { session_id } = c.req.param()
  const body = await c.req.valid('json')

  return withTenant(principal, async (tx) => {
    await updateSession(tx, session_id, body);

    // we return full session
    const updatedSession = await requireSession(tx, session_id);
    return c.json(updatedSession, 200);
  })
})


const sessionCommentsGETRoute = createRoute({
  method: 'get',
  path: '/api/sessions/{session_id}/comments',
  summary: 'List comments',
  tags: ['Comments'],
  request: {
    params: z.object({
      session_id: z.string(),
    }),
  },
  responses: {
    200: response_data(z.array(CommentMessageSchema)),
    404: response_error()
  },
})

app.openapi(sessionCommentsGETRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const { session_id } = c.req.param()

  return withOrg(principal.organizationId, async (tx) => {
    const session = await requireSession(tx, session_id);
    await authorize(principal, { action: "end-user:read", user: session.user });

    const comments = await tx.query.commentMessages.findMany({
      where: and(
        isNull(commentMessages.deletedAt),
        eq(commentMessages.sessionId, session.id)
      ),
      orderBy: (comment, { asc }) => [asc(comment.createdAt)],
      with: {
        score: true
      }
    });

    return c.json(comments, 200);
  })
})

const sessionScoresGETRoute = createRoute({
  method: 'get',
  path: '/api/sessions/{session_id}/scores',
  summary: 'List scores',
  tags: ['Scores'],
  request: {
    params: z.object({
      session_id: z.string(),
    }),
  },
  responses: {
    200: response_data(z.array(ScoreSchema)),
    404: response_error()
  },
})

app.openapi(sessionScoresGETRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const { session_id } = c.req.param()

  return withOrg(principal.organizationId, async (tx) => {
    const session = await requireSession(tx, session_id);
    await authorize(principal, { action: "end-user:read", user: session.user });

    const sessionScores = await tx.query.scores.findMany({
      where: or(
        eq(scores.sessionItemId, sql`ANY(SELECT id FROM session_items WHERE session_id = ${session.id})`),
        eq(scores.runId, sql`ANY(SELECT id FROM runs WHERE session_id = ${session.id})`),
      ),
      orderBy: (score, { asc }) => [asc(score.createdAt)],
    });

    return c.json(sessionScores, 200);
  })
})



/**
 * Session Create
 */


const sessionsPOSTRoute = createRoute({
  method: 'post',
  path: '/api/sessions/standard',
  summary: 'Create a session',
  tags: ['Standard'],
  request: {
    body: body(StandardSessionCreateSchema)
  },
  responses: {
    201: response_data(StandardSessionSchema),
    422: response_error()
  },
})

app.openapi(sessionsPOSTRoute, async (c) => {
  const principal = await authnAllowPublic(c.req.raw.headers)
  const body = await c.req.valid('json')

  if (body.input) {
    throw new AgentViewError('Input is not supported for standard session creation.', 422);
  }

  return withTenant(principal, async (tx) => {
    const newSession = await createSession(tx, body, { active: true });
    const fullSession = await requireSession(tx, newSession.id);
    return c.json(fullSession, 201);
  })
})

const sessionsAISDKPOSTRoute = createRoute({
  method: 'post',
  path: '/api/sessions',
  summary: 'Create a session',
  tags: ['Sessions and Runs'],
  request: {
    body: body(SessionCreateSchema)
  },
  responses: {
    201: {
      content: {
        'text/event-stream': {
          schema: z.string(),
        },
        'application/json': {
          schema: SessionSchema,
        },
      },
      description: 'Creates a session, optionally streaming the first run',
    },
    422: response_error()
  },
})

app.openapi(sessionsAISDKPOSTRoute, async (c) => {
  const principal = await authnAllowPublic(c.req.raw.headers)
  const body = await c.req.valid('json')

  // session without run - just create active session and return it
  if (!body.input) {
    return await withTenant(principal, async (tx) => {
      const newSession = await createSession(tx, body, { active: true });
      const fullSession = await requireSession(tx, newSession.id);
      return c.json(standardToDefaultSession(fullSession), 201);
    })
  }
  // inactive session -> create run -> activate if successful
  else {
    const newSession = await withTenant(principal, async (tx) => {
      return await createSession(tx, body, { active: false });
    })

    const { response, success } = await createAutoRun2(principal, newSession.id, body.input, c.req.raw.signal);

    // on success -> just return new session
    if (success) {
      return await withTenant(principal, async (tx) => {
        await activateSession(tx, newSession.id);
        const fullSession = await requireSession(tx, newSession.id);
        return c.json(standardToDefaultSession(fullSession), 201);
      })
    }
    else {
      return response;
    }
  }
})


// watches session and its last run changes
function getSessionStreamResponse(c: any, session: StandardSession) {
  const lastRun = getLastRun(session);

  if (!lastRun || isRunFinished(lastRun)) {
    return c.body(null, 204); // 204 when no stream in our internal protocol
  }

  return streamSSE(c, async (stream) => {
    let streamConsumer: ReturnType<typeof createRunStreamConsumer> | undefined = undefined;

    try {
      streamConsumer = createRunStreamConsumer(lastRun.id, c.req.raw.signal);

      // session snapshot first
      await stream.writeSSE({
        event: 'session.snapshot',
        data: JSON.stringify(session),
      });

      // stream run events from last updatedAt
      for await (const data of streamConsumer.entries()) {
        await stream.writeSSE({
          event: 'run.patch',
          data
        });
      }
    } finally {
      streamConsumer?.close();
    }

  });
}

/**
 * Raw SSE streaming: Redis XREAD → outgoing.write(). No WebStreams, no helpers.
 * Returns a sentinel Response with x-hono-already-sent so Hono skips writing.
 */
function streamAISDKEvents(c: any, consumer: AISDKStreamConsumer) {
  return streamSSE(c, async (stream) => {
    try {
      for await (const data of consumer.stream()) {
        await stream.writeSSE({ data });
      }
    } finally {
      consumer.close();
    }
  });
}

const sessionStreamRoute = createRoute({
  method: 'get',
  path: '/api/sessions/{session_id}/stream/standard',
  summary: 'Stream updates',
  tags: ['Standard'],
  request: {
    params: z.object({
      session_id: z.string(),
    })
  },
  responses: {
    200: {
      content: {
        'text/event-stream': {
          schema: z.string(),
        },
      },
      description: "Streams items from the run",
    },
    204: response_no_content(),
    400: response_error(),
    404: response_error()
  },
});

const sessionStreamHandler = async (c: Parameters<RouteHandler<typeof sessionStreamRoute>>[0]) => {
  const principal = await authnAllowPublic(c.req.raw.headers);

  const { session_id } = c.req.param()

  const session = await withOrg(principal.organizationId, async (tx) => requireSession(tx, session_id))

  authorize(principal, { action: "end-user:read", user: session.user });

  return session;
}

app.openapi(sessionStreamRoute, async (c) => {
  const session = await sessionStreamHandler(c);
  return getSessionStreamResponse(c, session);
});

const sessionAISDKStreamRoute = createRoute({
  method: 'get',
  path: '/api/sessions/{session_id}/stream',
  summary: 'Stream updates',
  tags: ['Sessions and Runs'],
  request: {
    params: z.object({
      session_id: z.string(),
    })
  },
  responses: {
    200: {
      content: {
        'text/event-stream': {
          schema: z.string(),
        },
      },
      description: "Streams items from the run",
    },
    204: response_no_content(),
    400: response_error(),
    404: response_error()
  },
});

app.openapi(sessionAISDKStreamRoute, async (c) => {
  const session = await sessionStreamHandler(c);
  const lastRun = getLastRun(session);

  if (!lastRun || isRunFinished(lastRun)) {
    return c.body(null, 204);
  }

  return createStreamResponse(c, lastRun.id);

  // const consumer = createAISDKStreamConsumer(lastRun.id, c.req.raw.signal);
  // return streamAISDKEvents(c, consumer);
});




const seenRoute = createRoute({
  method: 'post',
  path: '/api/seen',
  summary: 'Mark inbox item as seen',
  tags: ['Inbox'],
  request: {
    body: body(InputTargetSchema)
  },
  responses: {
    200: response_data(z.object({})),
    400: response_error(),
    401: response_error(),
    404: response_error(),
  },
})

app.openapi(seenRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const userPrincipal = requireMemberPrincipal(principal);

  const body = await c.req.valid('json');

  return withOrg(principal.organizationId, async tx => {
    const target = await resolveTarget(tx, body);

    await tx.update(inboxItems).set({
      lastReadEventId: sql`${inboxItems.lastNotifiableEventId}`,
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(inboxItems.userId, userPrincipal.session.user.id),
      targetFilter(inboxItems, target),
    ));

    return c.json({}, 200);
  })
})


/* --------- RUNS --------- */


const runsPOSTRoute = createRoute({
  method: 'post',
  path: '/api/sessions/{session_id}/runs/standard',
  summary: 'Create a run (auto-fetch)',
  tags: ['Standard'],
  request: {
    params: z.object({
      session_id: z.string(),
    }),
    body: body(StandardRunCreateSchema.extend({
      stream: z.boolean().optional(),
    }))
  },
  responses: {
    201: {
      content: {
        'text/event-stream': {
          schema: z.string(),
        },
        'application/json': {
          schema: StandardRunSchema,
        },
      },
      description: "Streams native AI SDK events",
    },
    400: response_error(),
    404: response_error()
  },
})


app.openapi(runsPOSTRoute, async (_c) => {
  throw new AgentViewError('Temporarily disabled.', 400);
  // const { run, session, stream } = await createRunHandler(c);

  // if (stream) {
  //   c.status(201);
  //   return getSessionStreamResponse(c, session);
  // }

  // return c.json(run, 201);
})

const runsAISDKPOSTRoute = createRoute({
  method: 'post',
  path: '/api/sessions/{session_id}/runs',
  summary: 'Create a run (auto-fetch)',
  tags: ['Sessions and Runs'],
  request: {
    params: z.object({
      session_id: z.string(),
    }),
    body: body(RunCreateSchema.extend({
      stream: z.boolean().optional(),
    }))
  },
  responses: {
    201: {
      content: {
        'text/event-stream': {
          schema: z.string(),
        },
        'application/json': {
          schema: SessionSchema,
        },
      },
      description: "Streams native AI SDK events",
    },
    400: response_error(),
    404: response_error()
  },
})

/**
 * OLD HANDLER
 */

async function createRunAISDKHandlerOLD(c: Context, run: { id: string, sessionId: string }, stream: boolean, principal: Principal) {
  const consumer = createAISDKStreamConsumer(run.id, c.req.raw.signal);

  // Wait for agent response. If anything throws or we don't need to stream,
  // close the consumer here. The streaming path transfers ownership to
  // streamAISDKEvents which handles close() in its own finally.
  let response: AISDKResponseMeta;
  try {
    response = await consumer.waitForResponse();
  } catch (e) {
    consumer.close();
    throw e;
  }

  if (response.error !== undefined) {
    consumer.close();

    c.status(response.status as StatusCode);
    for (const [key, value] of Object.entries(response.headers)) {
      c.header(key, value);
    }

    return c.body(response.error);
  }

  if (!stream) {
    consumer.close();
    return withOrg(principal.organizationId, async (tx) => {
      const session = await requireSession(tx, run.sessionId);
      return c.json(standardToDefaultSession(session), 201);
    });
  }

  // Ownership of consumer transfers to streamAISDKEvents (closes in its finally)
  return streamAISDKEvents(c, consumer);
}

/* --------- Redis Stream Connection Pool --------- */

const MAX_STREAMS_PER_CONN = 200;
const POOL_BLOCK_MS = 1000;

/** Callback receives each stream entry's data. Return false to unsubscribe. */
type StreamDataCallback = (data: string) => boolean;

interface StreamSub {
  streamKey: string;
  lastId: string;
  callback: StreamDataCallback;
  onError: () => void;
}

class PooledRedisConnection {
  private conn: Redis;
  private subs = new Map<string, StreamSub>();
  private polling = false;
  private closed = false;

  constructor() {
    this.conn = new Redis(REDIS_URL);
  }

  get size() { return this.subs.size; }
  get isClosed() { return this.closed; }

  add(sub: StreamSub) {
    this.subs.set(sub.streamKey, sub);
    if (!this.polling) this.poll();
  }

  remove(streamKey: string) {
    this.subs.delete(streamKey);
  }

  private poll() {
    if (this.closed || this.subs.size === 0) {
      this.polling = false;
      if (this.subs.size === 0) this.destroy();
      return;
    }
    this.polling = true;

    const keys: string[] = [];
    const ids: string[] = [];
    for (const sub of this.subs.values()) {
      keys.push(sub.streamKey);
      ids.push(sub.lastId);
    }

    this.conn.xread('BLOCK', POOL_BLOCK_MS, 'STREAMS', ...keys, ...ids)
      .then((results) => {
        if (this.closed) return;
        if (results) {
          for (const [streamKey, entries] of results) {
            const sub = this.subs.get(streamKey);
            if (!sub) continue;
            for (const [id, fields] of entries) {
              sub.lastId = id;
              const data = fields[1];
              if (!sub.callback(data)) {
                this.subs.delete(streamKey);
                break;
              }
            }
          }
        }
        this.poll();
      })
      .catch(() => {
        for (const sub of this.subs.values()) sub.onError();
        this.destroy();
      });
  }

  private destroy() {
    if (this.closed) return;
    this.closed = true;
    this.subs.clear();
    this.conn.disconnect();
    const idx = streamPool.indexOf(this);
    if (idx !== -1) streamPool.splice(idx, 1);
  }
}

const streamPool: PooledRedisConnection[] = [];

function subscribeToStream(
  streamKey: string,
  callback: StreamDataCallback,
  onError: () => void,
): () => void {
  let poolConn = streamPool.find(c => c.size < MAX_STREAMS_PER_CONN);
  if (!poolConn) {
    poolConn = new PooledRedisConnection();
    streamPool.push(poolConn);
  }

  poolConn.add({ streamKey, lastId: '0-0', callback, onError });

  const conn = poolConn;
  return () => {
    conn.remove(streamKey);
    if (conn.size === 0 && !conn.isClosed) {
      // destroy is handled by the next poll() cycle seeing 0 subs
    }
  };
}

/* --------- AI SDK Handler --------- */

/**
 * Raw implementation: pooled Redis XREAD → outgoing.write(). No WebStreams, no consumer helpers.
 * The [RESPONSE] meta-event determines whether we stream SSE or return an error body.
 */
function createStreamResponse(c: Context, runId: string, _options?: { headers?: Headers, status?: number }) {
  const outgoing = (c.env as any).outgoing as ServerResponse;
  const signal: AbortSignal = c.req.raw.signal;
  const streamKey = `run-stream:ai-sdk:${runId}`;

  let unsubscribe: (() => void) | null = null;
  let closed = false;

  function cleanup() {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', cleanup);
    unsubscribe?.();
  }

  signal.addEventListener('abort', cleanup, { once: true });

  // IMPORTANT TODO: translate headers from Response!!!
  outgoing.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  unsubscribe = subscribeToStream(
    streamKey,
    (data) => {
      if (closed) return false;

      // if (data.startsWith('[RESPONSE]')) {
      //   const meta = JSON.parse(data.slice('[RESPONSE]'.length)) as AISDKResponseMeta;

      //   if (meta.error !== undefined) {
      //     outgoing.writeHead(meta.status, meta.headers);
      //     outgoing.end(meta.error);
      //     cleanup();
      //     return false;
      //   }

      //   if (!stream) {
      //     cleanup();
      //     withOrg(principal.organizationId, (tx) => requireSession(tx, run.sessionId)).then((session) => {
      //       outgoing.writeHead(201, { 'Content-Type': 'application/json' });
      //       outgoing.end(JSON.stringify(standardToDefaultSession(session)));
      //     }).catch(() => {
      //       if (!outgoing.headersSent) outgoing.writeHead(500);
      //       outgoing.end();
      //     });
      //     return false;
      //   }

      //   outgoing.writeHead(200, {
      //     ...meta.headers,
      //     'Content-Type': 'text/event-stream',
      //     'Cache-Control': 'no-cache',
      //     'Connection': 'keep-alive',
      //   });
      //   return true;
      // }

      if (data === '[DONE]') {
        outgoing.end();
        cleanup();
        return false;
      }

      outgoing.write(`data: ${data}\n\n`);
      return true;
    },
    () => {
      if (!closed) {
        outgoing.end();
        cleanup();
      }
    },
  );

  return new Response(null, { headers: { 'x-hono-already-sent': '1' } });
}

// app.openapi(runsAISDKPOSTRoute, async (c) => {
//   const principal = await authnAllowPublic(c.req.raw.headers)
//   const body = await c.req.valid('json')
//   const params = await c.req.param();

//   const run = await withTenant(principal, async (tx) => {
//     return await createAutoRun(tx, params.session_id, body);
//   })

//   return createRunAISDKHandler(c, run, body.stream ?? false, principal);
// })

app.post('/internal/fast-patch', async (c) => {
  const body = await c.req.json()

  const servicePrincipal: ServicePrincipal = {
    type: 'service',
    organizationId: body.organizationId
  };

  try {
    await withTenant(servicePrincipal, async (tx) => {
      await fastApplyRunPatch(
        tx,
        body.runId,
        body.sessionId,
        BaseRunSchemaToZod.parse(body.runConfig),
        body.op
      );
    })
  } catch (error) {
    if (error instanceof RunTerminationError) {
      return c.json({ reason: error.reason }, 409); // if run terminated -> just return 409
    }
    throw error;
  }

  return c.json({}, 201)
})



app.openapi(runsAISDKPOSTRoute, async (c) => {
  const principal = await authnAllowPublic(c.req.raw.headers)
  const body = await c.req.valid('json')
  const params = await c.req.param();

  const { response, runId, success } = await createAutoRun2(principal, params.session_id, body.input, c.req.raw.signal);

  if (!success) {
    return response;
  }

  // no stream -> just return session
  if (!body.stream) {
    return await withTenant(principal, async (tx) => {
      const standardSession = await requireSession(tx, params.session_id);
      return standardToDefaultSession(standardSession)
    })
  }

  return createStreamResponse(c, runId, response)

  // // 1. Create pending run, prepare session 
  // const { run, standardSession } = await withTenant(principal, async (tx) => {
  //   const run = await createAutoRun(tx, params.session_id, body);
  //   const standardSession = await requireSession(tx, params.session_id);
  //   return { run, standardSession };
  // })

  // const session = standardToDefaultSession(standardSession);
  // const messages = session.messages;

  // // 2. Make live connection to the streaming server, wait for response to know if we should discard or accept the run.
  // let errorMessage: string | null = null;

  // try {
  //   const response = await fetch('http://localhost:1999/connect', {
  //     method: 'POST',
  //     headers: {
  //       'Content-Type': 'application/json',
  //     },
  //     body: JSON.stringify({ messages, session }),
  //     signal: c.req.raw.signal,
  //   });

  //   if (!response.ok) {
  //     errorMessage = "Error response from AI Endpoint";
  //     return response;
  //   }

  //   await withTenant(principal, async (tx) => {
  //     await tx.acquireLock({ type: "create_resource" }); // handles!
  //     await tx.acquireLock({ type: "edit_session", sessionId: session.id });

  //     await acceptRun(tx, session.id, run.id);
  //     await activateSession(tx, session.id);
  //   });

  // } catch (err) {
  //   errorMessage = 'Failed to establish connection to the streaming server'
  //   throw new AgentViewError(errorMessage, 500);
  // } finally {
  //   // best effort termination
  //   await withTenant(principal, async (tx) => {
  //     await terminateRun(tx, session.id, run.id, {
  //       status: 'discarded',
  //       failReason: {
  //         message: errorMessage
  //       },
  //     });
  //   });
  // }

  // // For channel-based runs: we'll create run from incoming channel messages
  // const incomingMessages = currentRun.channelMessages.filter(cm => cm.direction === 'incoming');
  // const isChannelRun = incomingMessages.length > 0;

  // /**
  //  * Fetch the agent API response
  //  */
  // let response: Response | undefined = undefined;

  // log.info('[ai-sdk] fetch');

  // let fetchError: string | undefined = undefined;

  // try {
  //     response = await fetch(url, {
  //         method: 'POST',
  //         headers: {
  //             'Content-Type': 'application/json',
  //         },
  //         body: JSON.stringify({ messages, session: body.session }),
  //         signal,
  //     });

  // return createRunAISDKHandler(c, run, body.stream ?? false, principal);
})


const sessionStandardCancelRoute = createRoute({
  method: 'post',
  path: '/api/sessions/{session_id}/cancel/standard',
  summary: 'Cancels a run',
  tags: ['Standard'],
  request: {
    params: z.object({
      session_id: z.string(),
    })
  },
  responses: {
    200: response_data(StandardSessionSchema),
    400: response_error(),
    404: response_error()
  },
})

async function sessionStandardCancelHandler(c: Parameters<RouteHandler<typeof sessionCancelRoute>>[0]) {
  const principal = await authnAllowPublic(c.req.raw.headers)

  const { session_id } = c.req.param()

  // Phase 1. Throw error if run is not in progress
  const { lastRun } = await withOrg(principal.organizationId, async (tx) => {
    const session = await requireSession(tx, session_id);

    authorize(principal, { action: "end-user:update", user: session.user });

    const lastRun = getLastRun(session);
    if (!lastRun) {
      throw new AgentViewError("The session has no run.", 422);
    }

    if (lastRun.manual) {
      throw new AgentViewError("This endpoint is allowed only for auto-fetch runs.", 422);
    }

    return { lastRun }
  });

  // Phase 2. 
  // - Signal cancellation and schedule hard termination after 5s
  // - the setTimeout must be non-blocking. We don't want to wait 5s as it might potentially end much faster than that, when [DONE] is sent sooner.
  // - this 5s is just a safety net. termineRun inside it should be no-op in all cases.

  await sendRunTerminationSignal(lastRun.id, { status: 'cancelled' }, { graceful: true }); // it's blocking, max 5s

  // safe termination in case sendRunTerminationSignal failed
  withOrg(principal.organizationId, async (tx) => {
    await terminateRun(tx, session_id, lastRun.id, { status: 'cancelled' });
  });


  // const forceTerminationPromise = new Promise((resolve) => {
  //   setTimeout(() => {
  //     withOrg(principal.organizationId, async (tx) => {
  //       await terminateRun(tx, session_id, lastRun.id, { status: 'cancelled' });
  //     });
  //     resolve(null);
  //   }, 5000);
  // });

  // await Promise.race([properTerminationPromise, forceTerminationPromise]);


  // await publishEvent({ type: 'run.terminated', runId: lastRun.id, reason: { status: 'cancelled' } });

  // setTimeout(() => {
  //   withOrg(principal.organizationId, async (tx) => {
  //     await terminateRun(tx, session_id, lastRun.id, { status: 'cancelled' });
  //   });
  // }, 5000);

  // // Phase 3. Wait for stream to end (this is expected behaviour).
  // let streamConsumer: ReturnType<typeof createRunStreamConsumer> | undefined = undefined;

  // try {
  //   streamConsumer = createRunStreamConsumer(lastRun.id, c.req.raw.signal);
  //   for await (const _ of streamConsumer!.entries()) { }
  // } finally {
  //   streamConsumer?.close();
  // }

  // Phase 4. Return session to the client (must be updated by now)
  return await withOrg(principal.organizationId, async (tx) => {
    return await requireSession(tx, session_id);
  });
};

app.openapi(sessionStandardCancelRoute, async (c) => {
  const session = await sessionStandardCancelHandler(c);
  return c.json(session, 200);
})

const sessionCancelRoute = createRoute({
  method: 'post',
  path: '/api/sessions/{session_id}/cancel',
  summary: 'Cancels a run',
  tags: ['Sessions and Runs'],
  request: {
    params: z.object({
      session_id: z.string(),
    })
  },
  responses: {
    200: response_data(SessionSchema),
    400: response_error(),
    404: response_error()
  },
})

app.openapi(sessionCancelRoute, async (c) => {
  const session = await sessionStandardCancelHandler(c);
  return c.json(standardToDefaultSession(session), 200);
})




const runKeepAliveRoute = createRoute({
  method: 'post',
  path: '/api/runs/{run_id}/keep-alive',
  summary: 'Keep alive',
  tags: ['Standard'],
  responses: {
    200: response_data(z.object({ expiresAt: z.string().nullable() })),
    400: response_error(),
    404: response_error()
  },
})

app.openapi(runKeepAliveRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)

  const { run_id } = c.req.param()

  return withTenant(principal, async (tx) => {
    const run = await requireRunBase(tx, run_id);
    const session = await requireSessionBase(tx, run.sessionId);

    authorize(principal, { action: "end-user:update", user: session.user });

    const config = await requireConfig(tx);
    const channelConfig = requireChannelConfig(config, session.channel);
    const agentConfig = requireAgentConfig(config, getChannelAgent(channelConfig)?.name);

    const inputItem = (await getRunInput(tx, run_id))?.content;
    const runConfig = requireRunConfig(agentConfig, inputItem);

    const status = run.status;
    const isFinished = isRunFinished(run);
    const idleTimeout = runConfig.idleTimeout ?? DEFAULT_IDLE_TIME;
    const expiresAt = isFinished ? null : new Date(Date.now() + idleTimeout).toISOString();

    await tx.update(runs).set({
      status,
      expiresAt
    }).where(eq(runs.id, run.id));

    return c.json({
      expiresAt
    }, 200);
  })
})



const runsManualPOSTRoute = createRoute({
  method: 'post',
  path: '/api/sessions/{session_id}/runs/manual',
  summary: 'Create a manual run',
  tags: ['Standard'],
  request: {
    params: z.object({
      session_id: z.string(),
    }),
    body: body(ManualRunCreateSchema)
  },
  responses: {
    201: response_data(StandardRunSchema),
    400: response_error(),
    404: response_error()
  },
})

app.openapi(runsManualPOSTRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const body = await c.req.valid('json')
  const params = await c.req.param();

  return withTenant(principal, async (tx) => {
    await createManualRun(tx, params.session_id, body);

    // get full run (we could optimise this)
    const updatedSession = await requireSession(tx, params.session_id);
    const newRun = getLastRun(updatedSession)!;

    return c.json(newRun, 201);
  })
})


const runManualPATCHRoute = createRoute({
  method: 'patch',
  path: '/api/runs/{run_id}/manual',
  summary: 'Update a run',
  tags: ['Standard'],
  request: {
    params: z.object({
      run_id: z.string(),
    }),
    body: body(ManualRunUpdateSchema)
  },
  responses: {
    201: response_data(StandardRunSchema),
    400: response_error(),
    404: response_error()
  },
})

app.openapi(runManualPATCHRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)

  const { run_id } = c.req.param()
  requireUUID(run_id);

  const body = await c.req.valid('json')

  return await withTenant(principal, async (tx) => {
    const run = await applyRunPatch(tx, run_id, body, true);

    const updatedSession = await requireSession(tx, run.sessionId); // TODO: optimize
    const newRun = getLastRun(updatedSession)!;
    return c.json(newRun, 201);
  })
});

/* --------- FLAT COMMENTS API --------- */

function getMemberIdBasedOnPrincipal(principal: Principal) { // we use it only for comments, and mostly for testing for now
  if (principal.type === 'member') {
    return principal.session.user.id;
  }
  else if (principal.type === 'apiKey') {
    return principal.apiKey.userId;
  }
  else {
    throw new AgentViewError("Unauthorized", 401);
  }
}


const CommentCreateBodySchema = InputTargetSchema.extend({
  content: z.string(),
})

const commentsPOSTRoute = createRoute({
  method: 'post',
  path: '/api/comments',
  summary: 'Create a comment',
  tags: ['Comments'],
  request: {
    body: body(CommentCreateBodySchema)
  },
  responses: {
    201: response_data(z.object({})),
    400: response_error(),
    401: response_error(),
    404: response_error(),
  },
})


app.openapi(commentsPOSTRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const memberId = getMemberIdBasedOnPrincipal(principal);
  const body = await c.req.valid('json')

  return withOrg(principal.organizationId, async (tx) => {
    const target = await resolveTarget(tx, body);
    await createComment(tx, target, memberId, body.content ?? null);
    return c.json({}, 201);
  })
})


const commentsPUTRoute = createRoute({
  method: 'put',
  path: '/api/comments/{commentId}',
  summary: 'Update a comment',
  tags: ['Comments'],
  request: {
    params: z.object({
      commentId: z.string(),
    }),
    body: body(CommentMessageCreateSchema)
  },
  responses: {
    200: response_data(z.object({})),
    400: response_error(),
    401: response_error(),
    404: response_error(),
    422: response_error(),
  },
})

app.openapi(commentsPUTRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const memberId = getMemberIdBasedOnPrincipal(principal);

  const { commentId } = c.req.param()
  const body = await c.req.valid('json')

  return withOrg(principal.organizationId, async (tx) => {
    const commentMessage = await requireCommentMessage(tx, commentId);
    requireCommentOwnership(commentMessage, memberId);

    try {
      await updateComment(tx, commentMessage, body.content);
    } catch (error) {
      return c.json({ message: `Invalid mention format: ${(error as Error).message}` }, 422);
    }

    return c.json({}, 200);
  })
})


const commentsDELETERoute = createRoute({
  method: 'delete',
  path: '/api/comments/{commentId}',
  summary: 'Delete a comment',
  tags: ['Comments'],
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
  const principal = await authn(c.req.raw.headers)
  const memberId = getMemberIdBasedOnPrincipal(principal);

  const { commentId } = c.req.param()

  return withOrg(principal.organizationId, async (tx) => {
    const commentMessage = await requireCommentMessage(tx, commentId);
    requireCommentOwnership(commentMessage, memberId);

    await deleteComment(tx, commentMessage.id, memberId);
    return c.json({}, 200);
  })
})


/* --------- FLAT SCORES API --------- */

const ScoresPatchBodySchema = InputTargetSchema.extend({
  scores: z.array(ScoreCreateSchema),
})

const scoresPATCHRoute = createRoute({
  method: 'patch',
  path: '/api/scores',
  summary: 'Update scores',
  tags: ['Scores'],
  request: {
    body: body(ScoresPatchBodySchema)
  },
  responses: {
    200: response_data(z.object({})),
    400: response_error(),
    401: response_error(),
    404: response_error(),
  },
})

app.openapi(scoresPATCHRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const memberId = getMemberIdBasedOnPrincipal(principal);

  const body = await c.req.valid('json');
  // const target = parseScoreTarget(body);
  const inputScores = body.scores;

  return withTenant(principal, async (tx) => {
    const config = await requireConfig(tx)

    const target = await resolveTargetWithObjects(tx, body);
    if (target.type !== 'sessionItem' && target.type !== 'run') {
      throw new AgentViewError(`Invalid target: "${target.type}"`, 400);
    }

    const session = target.session;
    const run = target.run;

    // Resolve score configs based on target type
    const channelConfig = requireChannelConfig(config, session.channel);
    const agentConfig = requireAgentConfig(config, getChannelAgent(channelConfig)?.name);
    const runConfig = requireRunConfig(agentConfig, getRunInputContent(run.sessionItems));

    let scoreConfigs: { name: string; schema: any }[] | undefined;

    if (target.type === 'sessionItem') {
      const itemConfig = requireItemConfig(runConfig, run.sessionItems, target.sessionItem.id).itemConfig;
      scoreConfigs = itemConfig.scores;
    }
    else if (target.type === 'run') {
      scoreConfigs = runConfig.scores;
    }

    for (const score of inputScores) {
      const { name, value } = score;

      const scoreConfig = requireScoreConfig(scoreConfigs, name);

      // Check if score already exists for this user
      const existingScore = await tx.query.scores.findFirst({
        where: and(
          targetFilter(scores, target),
          eq(scores.name, name),
          eq(scores.createdBy, memberId),
          isNull(scores.deletedAt)
        )
      });

      // delete
      if (value === null || value === undefined) {
        if (existingScore) {
          await deleteComment(tx, existingScore.commentId, memberId);
          await tx.delete(scores)
            .where(eq(scores.id, existingScore.id));
        }
      }
      else if (value !== null) {
        const result = scoreConfig.schema.safeParse(value);
        if (!result.success) {
          return c.json({
            message: `Error parsing the score "${name}"`,
            code: 'parse.schema',
            details: result.error.issues
          }, 400);
        }

        // edit
        if (existingScore) {
          await tx.update(scores)
            .set({
              value: value,
              updatedAt: new Date().toISOString()
            })
            .where(eq(scores.id, existingScore.id));
        }
        // create
        else {
          const commentMessage = await createComment(tx, target, memberId, null);

          await tx.insert(scores).values({
            organizationId: principal.organizationId,
            ...target.ids,
            name,
            value,
            commentId: commentMessage.id,
            createdBy: memberId,
          });
        }
      }
    }

    return c.json({}, 200);
  })
})


/* --------- INVITATIONS --------- */

app.get('/api/invitations/:invitation_id', async (c) => {
  const { invitation_id } = c.req.param();
  const invitation = await requireValidInvitation(invitation_id);

  // db__dangerous is used because we're querying users which are not under RLS
  const user = await db__dangerous.query.users.findFirst({
    where: eq(users.email, invitation.email)
  })

  const organization = await db__dangerous.query.organizations.findFirst({
    where: eq(organizations.id, invitation.organizationId)
  })

  return c.json({ ...invitation, userExists: !!user, organization }, 200)
})

/* --------- ORGANIZATION PUBLIC INFO --------- */

app.get('/api/organization/public-info', async (c) => {
  const organizationId = c.req.header('x-organization-id');

  if (!organizationId) {
    return c.json({ name: null }, 200);
  }

  // Auth tables don't have RLS - safe to query directly
  const organization = await db__dangerous.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
    columns: { name: true }
  });

  if (!organization) {
    return c.json({ name: null }, 200);
  }

  return c.json({ name: organization.name }, 200);
})

/* --------- SCHEMAS ---------   */

const environmentsListRoute = createRoute({
  method: 'get',
  path: '/api/environments',
  summary: 'List all environments',
  tags: ['Environment'],
  responses: {
    200: response_data(z.array(EnvironmentBaseSchema)),
  },
})

app.openapi(environmentsListRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  authorize(principal, { action: "environment:read" });

  return withOrg(principal.organizationId, async (tx) => {
    const environments = await tx.query.environments.findMany({
      columns: {
        id: true,
        handle: true,
        createdAt: true,
      },
      with: {
        user: true,
      },
    });

    return c.json(environments, 200);

    // const rows = await tx
    //   .select({
    //     id: environments.id,
    //     userId: environments.userId,
    //     createdAt: environments.createdAt,
    //     email: users.email,
    //   })
    //   .from(environments)
    //   .leftJoin(users, eq(environments.userId, users.id))
    //   .orderBy(environments.createdAt);

    // return c.json(rows.map(row => ({
    //   id: row.id,
    //   userId: row.userId,
    //   name: row.email ? `dev:${row.email}` : "prod",
    //   createdAt: row.createdAt,
    // })), 200)
  })
})

const environmentGETRoute = createRoute({
  method: 'get',
  path: '/api/environment',
  summary: 'Retrieve the environment',
  tags: ['Environment'],
  responses: {
    200: response_data(EnvironmentSchema.nullable()),
  },
})

app.openapi(environmentGETRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  authorize(principal, { action: "environment:read" });

  return withTenant(principal, async (tx) => {
    const environment = await requireEnvironment(tx);
    return c.json(environment ?? null, 200)
  })
})

const environmentPATCHRoute = createRoute({
  method: 'patch',
  path: '/api/environment',
  summary: 'Update the environment',
  tags: ['Environment'],
  request: {
    body: body(EnvironmentCreateSchema)
  },
  responses: {
    200: response_data(EnvironmentCreateSchema),
    422: response_error(),
  },
})

app.openapi(environmentPATCHRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  authorize(principal, { action: "environment:write" });

  const body = await c.req.valid('json')

  // validate & parse body.config
  const { data, success, error } = BaseConfigSchema.safeParse(body.config)
  if (!success) {
    log.error({ issues: error.issues }, 'invalid config')
    return c.json({ message: "Invalid config", code: 'parse.schema', details: error.issues }, 422);
  }

  return withTenant(principal, async (tx) => {
    const environment = await requireEnvironment(tx);

    // @ts-ignore
    if (environment && equalJSON(environment.config, data)) {
      return c.json(environment, 200)
    }

    // Only update existing config for this user
    await tx.update(environments)
      .set({ config: data })
      .where(
        and(
          eq(environments.id, environment.id)
        )
      );

    const updatedEnvironment = await requireEnvironment(tx);

    return c.json(updatedEnvironment, 200)
  })
})


/* --------- IS ACTIVE --------- */

const healthRoute = createRoute({
  method: 'get',
  path: '/api/health',
  summary: 'Health check',
  tags: ['System'],
  responses: {
    200: response_data(z.object({
      status: z.literal("ok"),
      // is_active: z.boolean(),
    })),
  },
})

app.openapi(healthRoute, async (c) => {
  return c.json({ status: "ok" }, 200);
})


/* --------- CHANNELS --------- */

import { channelApps } from './channels/registry';
for (const channel of channelApps) {
  if (channel.routes) {
    app.route(`/api/channels/${channel.type}`, channel.routes);
  }
}

// Generic channel routes stay separate, mounted after channel-specific apps
import { channelsApp } from './channels/routes';

app.route('', channelsApp);



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
  const apiPort = process.env.HTTP_SERVER_PORT ?? "80";
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
