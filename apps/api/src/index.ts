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
  RunUpdateSchema,
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
  TokenSchema,
  TokenWithSecretSchema,
  UserCreateSchema,
  UserSchema,
  UserUpdateSchema,
  UserWithTokenSchema,
  type StandardSession
} from 'agentview/apiTypes';
import { BaseConfigSchema, BaseRunSchemaToZod } from 'agentview/baseConfigTypes';
import { requireAgentConfigBySession, requireItemConfig, requireRunConfig, requireScoreConfig } from 'agentview/baseConfigUtils';
import { getLastRun } from 'agentview/sessionUtils';
import { and, countDistinct, DrizzleQueryError, eq, inArray, isNull, or, sql, type InferSelectModel } from 'drizzle-orm';
import packageJson from '../package.json';
import { auth } from './auth';
import { authn, authnAllowAnon, authnAllowUser, authorize, requireMemberPrincipal, type Principal, type ServicePrincipal } from './authMiddleware';
import { db__dangerous } from './db';
import { requireConfig, requireEnvironment } from './environments';
import { equalJSON } from './equalJSON';
import { getAllowedOrigin } from './getAllowedOrigin';
import { body, response_data, response_error, response_no_content } from './hono_utils';
import { isInboxItemUnread } from './inboxItems';
import { initDb } from './initDb';
import { startBoss } from './queues/pgboss';
import { requireValidInvitation } from './invitations';
import { requireUUID } from './isUUID';
import { applyRunPatch, createAutoRun2, createManualRun, DEFAULT_IDLE_TIME, fastApplyRunPatch, getRunInput, getRunInputContent, isRunFinished, requireRunBase, sendRunTerminationSignal, terminateRun, updateRun } from './runs';
import { RunTerminationError, type RunTerminationReason, terminationReasonText } from './runsTermination';

import { organizations, users } from './schemas/auth-schema';
import { commentMessages, endUsers, environments, inboxItems, runs, scores, sessions } from './schemas/schema';
import { activateSession, createSession, getCurrentlyStreamingOrConnectingRun, getSessionListFilter, getSessions, setAgentForSession, updateSession } from './sessions';
import { createUser, issueToken, listTokens, requireTokenOwner, requireUser, revokeToken, updateUser } from './users';
import { withOrg, withTenant } from './withOrg';

import { resolveTarget, resolveTargetWithObjects, targetFilter } from './target';

import { createComment, deleteComment, requireCommentMessage, requireCommentOwnership, updateComment } from './comments';
import { requireSession, requireSessionBase } from './sessions';

import { standardToDefaultSession } from './standardToDefaultSession';
import { HEARTBEAT_STALE_MS } from './workerHeartbeat';


await initDb();
await startBoss();

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

// here we send "source" for every error, becasue sometimes, when ai-sdk machinery gets error they tend to do new Error(body), and it's good to be able to distinguish agentview from upstream errors easily.
app.onError((error, c) => {
  if (error instanceof AgentViewError) {
    const payload = { source: 'agentview', message: error.message, ...(error.details ?? {}) }
    log.info({ errorType: 'AgentViewError', statusCode: error.statusCode }, error.message);
    return c.json(payload, error.statusCode as any);
  }
  else if (error instanceof BetterAuthAPIError) {
    log.error({ errorType: 'BetterAuthAPIError', statusCode: error.statusCode }, error.message);
    return c.json({ source: 'agentview', ...error.body }, error.statusCode as any); // "as any" because error.statusCode is "number" and hono expects some numeric literal union
  }
  else if (error instanceof DrizzleQueryError) {
    log.error({ errorType: 'DrizzleQueryError', err: error }, 'DB error');
    return c.json({ source: 'agentview', ...error, message: error.message ?? 'DB error' }, 500);
  }
  else if (error instanceof Error) {
    log.error({ errorType: 'Error', err: error }, error.message);
    return c.json({ source: 'agentview', message: error.message }, 400);
  }
  else {
    log.error({ errorType: 'UnexpectedError', err: error }, 'Unexpected error');
    return c.json({ source: 'agentview', message: "Unexpected error" }, 400);
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
const MAX_ERROR_BODY_LOG = 2000;
app.use('*', async (c, next) => {
  const requestId = "r" + (++reqCounter).toString(10);
  const start = Date.now();

  return runWithContext({ requestId }, async () => {
    await next();
    const duration = Date.now() - start;
    const status = c.res.status;
    const level = status >= 500 ? 'error' : 'info';

    let errorBody: string | undefined;
    if (status >= 500) {
      try {
        const contentType = c.res.headers.get('content-type') ?? '';
        if (contentType.includes('json') || contentType.startsWith('text/')) {
          const text = await c.res.clone().text();
          errorBody = text.length > MAX_ERROR_BODY_LOG
            ? `${text.slice(0, MAX_ERROR_BODY_LOG)}…[truncated, ${text.length} bytes total]`
            : text;
        }
      } catch {
        // ignore body read errors (e.g. streaming responses)
      }
    }

    log[level]({ method: c.req.method, path: c.req.path, status, duration, ...(errorBody !== undefined && { errorBody }) }, 'request completed');
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
    201: response_data(UserWithTokenSchema)
  },
})

app.openapi(usersPOSTRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const body = await c.req.valid('json')

  return withTenant(principal, async (tx) => {
    const newUserWithToken = await createUser(tx, body);
    return c.json(newUserWithToken, 201);
  })
})

const usersAnonPOSTRoute = createRoute({
  method: 'post',
  path: '/api/users/anonymous',
  summary: 'Create anon user',
  tags: ['Users'],
  request: {
    body: body(z.object({}).optional())
  },
  responses: {
    201: response_data(UserWithTokenSchema)
  },
})

app.openapi(usersAnonPOSTRoute, async (c) => {
  const principal = await authnAllowAnon(c.req.raw.headers)
  const body = await c.req.valid('json')

  return withTenant(principal, async (tx) => {
    const newUserWithToken = await createUser(tx, body ?? {});
    return c.json(newUserWithToken, 201);
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
  const principal = await authnAllowUser(c.req.raw.headers)

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

const userByEmailGETRoute = createRoute({
  method: 'get',
  path: '/api/users/by-email/{email}',
  summary: 'Retrieve a user by email',
  tags: ['Users'],
  request: {
    params: z.object({
      email: z.string(),
    }),
  },
  responses: {
    200: response_data(UserSchema),
    404: response_error()
  },
})

app.openapi(userByEmailGETRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)

  const { email } = c.req.param()

  return withTenant(principal, async (tx) => {
    const user = await requireUser(tx, { email })
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
    body: body(UserUpdateSchema)
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

/* --------- USER TOKENS --------- */

const userTokensPOSTRoute = createRoute({
  method: 'post',
  path: '/api/users/{id}/tokens',
  summary: 'Issue a user token',
  tags: ['Users'],
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    201: response_data(TokenWithSecretSchema),
    404: response_error(),
  },
})

app.openapi(userTokensPOSTRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const { id } = c.req.param()

  return withTenant(principal, async (tx) => {
    const user = await requireUser(tx, { id })
    await authorize(principal, { action: "end-user:update", user })
    const row = await issueToken(tx, user.id)
    return c.json(row, 201)
  })
})

const userTokensGETRoute = createRoute({
  method: 'get',
  path: '/api/users/{id}/tokens',
  summary: 'List user tokens',
  tags: ['Users'],
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: response_data(z.array(TokenSchema)),
    404: response_error(),
  },
})

app.openapi(userTokensGETRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const { id } = c.req.param()

  return withTenant(principal, async (tx) => {
    const user = await requireUser(tx, { id })
    await authorize(principal, { action: "end-user:update", user })
    const tokens = await listTokens(tx, user.id)
    return c.json(tokens, 200)
  })
})

const userTokenDELETERoute = createRoute({
  method: 'delete',
  path: '/api/tokens/{token_id}',
  summary: 'Revoke a user token',
  tags: ['Users'],
  request: {
    params: z.object({
      token_id: z.string(),
    }),
  },
  responses: {
    200: response_data(TokenSchema),
    404: response_error(),
  },
})

app.openapi(userTokenDELETERoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const { token_id } = c.req.param()

  return withTenant(principal, async (tx) => {
    const { user } = await requireTokenOwner(tx, token_id)
    await authorize(principal, { action: "end-user:update", user })
    const revoked = await revokeToken(tx, token_id)
    return c.json(revoked, 200)
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
  const principal = await authnAllowUser(c.req.raw.headers)
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
  sessionItemIndex: number | null,
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
      .leftJoin(runs, eq(inboxItems.runId, runs.id))
      .where(
        and(
          eq(inboxItems.userId, memberPrincipal.session.user.id),
          sql`${inboxItems.lastNotifiableEventId} > COALESCE(${inboxItems.lastReadEventId}, 0)`,
          eq(inboxItems.hasImportant, true),
          // If inbox item has a runId, only count it if the run is active
          or(isNull(inboxItems.runId), eq(runs.active, true)),
          getSessionListFilter(tx, params) // it's just filter, no pagination -> so all sessions are counted
        )
      )

    const response: StatsResponse = {
      unseenCount: result[0].unreadSessions ?? 0,
    }

    if (granular) {
      const sessionsResult = await getSessions(tx, params); // only sessions from current list (takes pagination into account)
      const sessionIds = sessionsResult.sessions.map((row) => row.id);

      response.sessions = {}

      // Probably too heavy but fuck it for now
      const sessionRows = await tx.query.sessions.findMany({
        where: inArray(sessions.id, sessionIds),
        with: {
          user: true,
          inboxItems: {
            where: eq(inboxItems.userId, memberPrincipal.session.user.id),
            with: {
              run: true,
            },
          },
          runs: {
            with: {
              sessionItems: {
                orderBy: (sessionItem, { asc }) => [asc(sessionItem.sortOrder)],
                where: (sessionItem, { eq }) => eq(sessionItem.isState, false),
              },
            },
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

        // Build sessionItemId -> index map from runs data
        const indexMap = new Map<string, number>();
        for (const run of session.runs) {
          for (let i = 0; i < run.sessionItems.length; i++) {
            indexMap.set(run.sessionItems[i].id, i);
          }
        }

        for (const inboxItem of session.inboxItems) {
          // Skip inbox items tied to inactive runs
          if (inboxItem.runId && !inboxItem.run?.active) continue;

          const unseenEvents = getUnseenEvents(inboxItem);
          if (unseenEvents.length === 0) continue;

          items.push({
            sessionId: session.id,
            runId: inboxItem.runId,
            sessionItemId: inboxItem.sessionItemId,
            sessionItemIndex: inboxItem.sessionItemId ? indexMap.get(inboxItem.sessionItemId) ?? null : null,
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
  const principal = await authnAllowUser(c.req.raw.headers)
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


function buildSessionItemIndexMap(session: StandardSession): Map<string, number> {
  const map = new Map<string, number>();
  for (const run of session.runs) {
    for (let i = 0; i < run.sessionItems.length; i++) {
      map.set(run.sessionItems[i].id, i);
    }
  }
  return map;
}

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

    const indexMap = buildSessionItemIndexMap(session);

    return c.json(comments.map(c => ({
      ...c,
      sessionItemIndex: c.sessionItemId ? indexMap.get(c.sessionItemId) ?? null : null,
      score: c.score ? { ...c.score, sessionItemIndex: c.score.sessionItemId ? indexMap.get(c.score.sessionItemId) ?? null : null } : null,
    })), 200);
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

    const indexMap = buildSessionItemIndexMap(session);

    return c.json(sessionScores.map(s => ({
      ...s,
      sessionItemIndex: s.sessionItemId ? indexMap.get(s.sessionItemId) ?? null : null,
    })), 200);
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
  const principal = await authnAllowUser(c.req.raw.headers)
  const body = await c.req.valid('json')

  if (body.input) {
    throw new AgentViewError('Input is not supported for standard session creation.', 422);
  }

  return withTenant(principal, async (tx) => {
    const newSession = await createSession(tx, {
      userId: body.userId,
      title: body.title,
    });
    await setAgentForSession(tx, newSession.id, { agent: body.agent, metadata: body.metadata, initialState: body.initialState });
    await activateSession(tx, newSession.id, principal.type === 'member' ? principal.session.user.id : undefined);

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
  const principal = await authnAllowUser(c.req.raw.headers)
  const body = await c.req.valid('json')
  const active = body.active ?? true; // default active: true

  // session without run - just create active session and return it
  if (!body.input) {
    return await withTenant(principal, async (tx) => {

      const newSession = await createSession(tx, {
        id: body.id,
        userId: body.userId,
        title: body.title,
      });
      await setAgentForSession(tx, newSession.id, { agent: body.agent, metadata: body.metadata, initialState: body.initialState });

      if (active) {
        await activateSession(tx, newSession.id, principal.type === 'member' ? principal.session.user.id : undefined);
      }

      const fullSession = await requireSession(tx, newSession.id);
      return c.json(standardToDefaultSession(fullSession), 201);
    })
  }
  // inactive session -> create run -> activate if successful
  else {
    const newSession = await withTenant(principal, async (tx) => {
      const newSession = await createSession(tx, {
        id: body.id,
        userId: body.userId,
        title: body.title,
      });

      return await setAgentForSession(tx, newSession.id, { agent: body.agent, metadata: body.metadata, initialState: body.initialState });
    })

    const { response, success } = await createAutoRun2(principal, newSession.id, body.input, undefined, c.req.raw.signal);

    // on success -> just return new session
    if (success) {
      return await withTenant(principal, async (tx) => {
        // await activateSession(tx, newSession.id);
        const fullSession = await requireSession(tx, newSession.id);
        return c.json(standardToDefaultSession(fullSession), 201);
      })
    }
    else {
      return response;
    }
  }
})


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
  const principal = await authnAllowUser(c.req.raw.headers);

  const { session_id } = c.req.param()

  const session = await withOrg(principal.organizationId, async (tx) => requireSession(tx, session_id))

  authorize(principal, { action: "end-user:read", user: session.user });

  return session;
}

app.openapi(sessionStreamRoute, async (c) => {
  throw new AgentViewError('Temporarily disabled.', 400);
  // const session = await sessionStreamHandler(c);

  // return getSessionStreamResponse(c, session);
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
      hasImportant: false,
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

app.openapi(runsAISDKPOSTRoute, async (c) => {
  const principal = await authnAllowUser(c.req.raw.headers)
  const body = await c.req.valid('json')
  const params = await c.req.param();

  const sessionBase = await withTenant(principal, async (tx) => {
    return await requireSessionBase(tx, params.session_id);
  })

  if (sessionBase.channelThreadId) {
    throw new AgentViewError("This endpoint is not allowed for sessions created from non-api channels (like email, etc.)", 400);
  }

  const { response, runId, success } = await createAutoRun2(principal, params.session_id, body.input, body.previousRunId, c.req.raw.signal);

  if (!success) {
    return response as any; // as any because we have no idea what the response is
  }

  // no stream -> just return session
  if (!body.stream) {
    return await withTenant(principal, async (tx) => {
      const standardSession = await requireSession(tx, params.session_id);
      return c.json(standardToDefaultSession(standardSession), 201);
    })
  }

  return createStreamResponse(c, runId, response)
})


app.post('/internal/fast-patch', async (c) => {
  const body = await c.req.json()

  const metadata = JSON.parse(body.metadata);
  const sessionId = metadata.sessionId;
  const organizationId = metadata.organizationId;
  const runConfig = BaseRunSchemaToZod.parse(metadata.runConfig)

  const servicePrincipal: ServicePrincipal = {
    type: 'service',
    organizationId
  };

  try {
    await withTenant(servicePrincipal, async (tx) => {
      await fastApplyRunPatch(
        tx,
        body.runId,
        sessionId,
        runConfig,
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

/**
 * For metadata purpose only
 */
const runsAISDKPatchRoute = createRoute({
  method: 'patch',
  path: '/api/sessions/{session_id}/runs/{run_id}',
  summary: 'Update a run',
  tags: ['Sessions and Runs'],
  request: {
    params: z.object({
      session_id: z.string(),
      run_id: z.string(),
    }),
    body: body(RunUpdateSchema)
  },
  responses: {
    200: response_data(SessionSchema),
    400: response_error(),
    404: response_error()
  },
})

app.openapi(runsAISDKPatchRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const body = await c.req.valid('json')
  const params = await c.req.param();

  return await withTenant(principal, async (tx) => {
    await updateRun(tx, params.session_id, params.run_id, body);
    const standardSession = await requireSession(tx, params.session_id);
    return c.json(standardToDefaultSession(standardSession), 200);
  })
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
  const principal = await authnAllowUser(c.req.raw.headers)

  const { session_id } = c.req.param()

  // Phase 1. Throw error if run is not in progress
  const { currentlyStreamingOrConnectingRun } = await withOrg(principal.organizationId, async (tx) => {
    const session = await requireSessionBase(tx, session_id);

    authorize(principal, { action: "end-user:update", user: session.user });

    const currentlyStreamingOrConnectingRun = await getCurrentlyStreamingOrConnectingRun(tx, session_id);
    if (!currentlyStreamingOrConnectingRun) {
      throw new AgentViewError("The session has no run.", 422);
    }

    if (currentlyStreamingOrConnectingRun.manual) {
      throw new AgentViewError("This endpoint is allowed only for auto-fetch runs.", 422);
    }

    return { currentlyStreamingOrConnectingRun }
  });

  // this function contract is that it takes max 5s to complete, should return almost immediately after proper cleanup and termination
  await sendRunTerminationSignal(currentlyStreamingOrConnectingRun.id, { status: 'cancelled' }, { graceful: true });

  return await withOrg(principal.organizationId, async (tx) => {
    await terminateRun(tx, session_id, currentlyStreamingOrConnectingRun.id, { status: 'cancelled' }); // idempotent cleanup (if above didn't work)

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
    const agentConfig = requireAgentConfigBySession(config, session);

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

    await updateComment(tx, commentMessage, body.content);

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
    const agentConfig = requireAgentConfigBySession(config, session);
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

app.get('/api/organization', async (c) => {
  const principal = await authnAllowAnon(c.req.raw.headers)

  // Auth tables don't have RLS - safe to query directly
  const organization = await db__dangerous.query.organizations.findFirst({
    where: eq(organizations.id, principal.organizationId),
    columns: { id: true, name: true, slug: true, logo: true }
  });

  if (!organization) {
    throw new AgentViewError("Organization not found", 404);
  }

  return c.json(organization, 200);
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

  const updates: { config?: any; tunnelUrl?: string | null } = {};

  // validate & parse body.config (only if provided)
  if (body.config !== undefined) {

    const { data, success, error } = BaseConfigSchema.safeParse(body.config)
    console.log('success', success, 'error', error)
    if (!success) {
      log.error({ issues: error.issues }, 'invalid config')
      return c.json({ message: "Invalid config", code: 'parse.schema', details: error.issues }, 422);
    }
    updates.config = data;
  }

  if (body.tunnelUrl !== undefined) {
    updates.tunnelUrl = body.tunnelUrl;
  }

  return withTenant(principal, async (tx) => {
    const environment = await requireEnvironment(tx);

    // Guard: tunnelUrl can only be set on dev (user-scoped) environments
    if (updates.tunnelUrl !== undefined && updates.tunnelUrl !== null && !environment.userId) {
      throw new AgentViewError("Cannot set tunnel URL on production environment.", 400);
    }

    const configUnchanged =
      updates.config === undefined ||
      // @ts-ignore
      equalJSON(environment.config, updates.config);
    const tunnelUnchanged =
      updates.tunnelUrl === undefined ||
      environment.tunnelUrl === updates.tunnelUrl;

    if (configUnchanged && tunnelUnchanged) {
      return c.json(environment, 200)
    }

    const setPayload: Record<string, any> = {};
    if (updates.config !== undefined) setPayload.config = updates.config;
    if (updates.tunnelUrl !== undefined) setPayload.tunnelUrl = updates.tunnelUrl;

    await tx.update(environments)
      .set(setPayload)
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

const CheckSchema = z.object({
  ok: z.boolean(),
  durationMs: z.number(),
  error: z.string().optional(),
  details: z.record(z.string(), z.any()).optional(),
})

const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    postgres: CheckSchema,
    streamingServer: CheckSchema,
    workers: CheckSchema,
  }),
})

const healthRoute = createRoute({
  method: 'get',
  path: '/api/health',
  summary: 'Health check',
  tags: ['System'],
  responses: {
    200: response_data(HealthResponseSchema),
    503: response_data(HealthResponseSchema),
  },
})

async function timed<T extends Record<string, any>>(fn: () => Promise<T>): Promise<{ ok: boolean; durationMs: number; error?: string; details?: Record<string, any> }> {
  const start = Date.now();
  try {
    const details = await fn();
    return { ok: true, durationMs: Date.now() - start, details };
  } catch (err) {
    return { ok: false, durationMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

app.openapi(healthRoute, async (c) => {
  const [postgres, streamingServer, workers] = await Promise.all([
    timed(async () => {
      await db__dangerous.execute(sql`select 1`);
      return {};
    }),
    timed(async () => {
      const url = process.env.STREAMING_SERVER_URL;
      if (!url) throw new Error('STREAMING_SERVER_URL is not set');
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2_000) });
      if (!res.ok) throw new Error(`streaming server returned ${res.status}`);
      const body = await res.json().catch(() => ({}));
      return { upstream: body };
    }),
    timed(async () => {
      const rows = await db__dangerous.execute(
        sql`select count(*)::int as live from worker_heartbeats where last_beat_at > now() - interval '${sql.raw(String(HEARTBEAT_STALE_MS))} milliseconds'`
      );
      const live = Number((rows as any).rows?.[0]?.live ?? (rows as any)[0]?.live ?? 0);
      if (live < 1) throw new Error('no live workers');
      return { live };
    }),
  ]);

  const allOk = postgres.ok && streamingServer.ok && workers.ok;
  const body = {
    status: allOk ? 'ok' as const : 'degraded' as const,
    checks: { postgres, streamingServer, workers },
  };

  return c.json(body, allOk ? 200 : 503);
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
import { createStreamResponse } from './createStreamResponse';

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
