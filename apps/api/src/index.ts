import { serve } from '@hono/node-server';
import { HTTPException } from 'hono/http-exception';

import type { User as BetterAuthUser } from "better-auth";
import { APIError as BetterAuthAPIError } from "better-auth/api";
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';

import { swaggerUI } from '@hono/swagger-ui';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, countDistinct, desc, DrizzleQueryError, eq, inArray, isNull, sql, type InferSelectModel } from 'drizzle-orm';
import { auth } from './auth';
import { db__dangerous } from './db';
import { extractMentions } from './extractMentions';
import { body, response_data, response_error, response_no_content } from './hono_utils';
import { isUUID } from './isUUID';
import { commentMentions, commentMessageEdits, commentMessages, environments, endUsers, events, inboxItems, runs, scores, sessionItems, sessions, starredSessions, versions, webhookJobs } from './schemas/schema';
import { withOrg } from './withOrg';
import { AgentViewError } from 'agentview/AgentViewError';
import {
  EnvironmentBaseSchema,
  EnvironmentCreateSchema,
  EnvironmentSchema,
  SpaceSchema,
  PublicSessionsGetQueryParamsSchema,
  RunCreateSchema,
  RunSchema,
  RunUpdateSchema,
  SessionCreateSchema,
  SessionSchema,
  SessionsGetQueryParamsSchema,
  SessionsPaginatedResponseSchema,
  SessionUpdateSchema,
  CommentMessageSchema,
  ScoreSchema,
  UserCreateSchema,
  UserSchema,
  type Session, type SessionItem,
  type SessionsGetQueryParams,
  type User,
  type Space,
  CommentMessageCreateSchema,
  ScoreCreateSchema
} from 'agentview/apiTypes';
import { type BaseAgentViewConfig } from 'agentview/configTypes';
import { BaseConfigSchema, BaseConfigSchemaToZod, findItemConfigById, requireRunConfig } from 'agentview/configUtils';
import { getAllSessionItems, getLastRun } from 'agentview/sessionUtils';
import packageJson from '../package.json';
import { equalJSON } from './equalJSON';
import { getAllowedOrigin } from './getAllowedOrigin';
import { getEnvironment, requireEnvironment, type Env } from './environments';
import { isInboxItemUnread } from './inboxItems';
import { initDb } from './initDb';
import { requireValidInvitation } from './invitations';
import { members, organizations, users } from './schemas/auth-schema';
import { createSession, fetchLastRunStatus, fetchSession } from './sessions';
import type { Transaction } from './types';
import { updateInboxes } from './updateInboxes';
import { findUser } from './users';
import { randomBytes } from 'crypto';
import { applyRunPatch, getRun, createRun, DEFAULT_IDLE_TIME } from './runs';
import { parseMetadata } from './parseMetadata';
import { authn, authnUser, authorize, requireMemberPrincipal, getMemberId, requireMemberId, getEnv, type PrivatePrincipal, type Principal, type MemberPrincipal, type ApiKeyPrincipal, type UserPrincipal } from './authMiddleware';

export { authn, authorize, requireMemberPrincipal, requireMemberId } from './authMiddleware';


await initDb();

export const app = new OpenAPIHono({
  // custom error handler for zod validation errors
  defaultHook: (result, c) => {
    if (!result.success) {
      console.log('Validation Error', result.error.issues);
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
  if (error instanceof AgentViewError) {
    const payload = { message: error.message, ...(error.details ?? {}) }
    console.log('AgentViewError', error.statusCode, payload);
    return c.json(payload, error.statusCode as any);
  }
  else if (error instanceof BetterAuthAPIError) {
    return c.json(error.body, error.statusCode as any); // "as any" because error.statusCode is "number" and hono expects some numeric literal union 
  }
  else if (error instanceof DrizzleQueryError) {
    return c.json({ ...error, message: "DB error" }, 400);
  }
  else if (error instanceof HTTPException) {
    return c.json({
      message: error.message,
    }, error.status);
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
  // origin: [getStudioURL()],
  origin: (origin, c) => {
    return getAllowedOrigin(c.req.raw.headers);
  },
  credentials: true,
}))

/* --------- AUTH --------- */

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});


// CONFIG HELPERS


async function getEnvironmentByPrincipal(tx: Transaction, principal: PrivatePrincipal): Promise<Awaited<ReturnType<typeof getEnvironment>> | undefined> {
  const environment = await getEnvironment(tx, getEnv(principal));

  if (!environment) {
    return undefined;
  }

  return environment;
}

async function requireConfig(tx: Transaction, principal: PrivatePrincipal): Promise<BaseAgentViewConfig> {
  let environment = await getEnvironmentByPrincipal(tx, principal);

  if (!environment) {
    throw new HTTPException(404, { message: "Environment not found" });
  }

  return BaseConfigSchemaToZod.parse(environment.config)
}


function requireAgentConfig(config: BaseAgentViewConfig, name: string) {
  const agentConfig = config.agents?.find((agent) => agent.name === name)
  if (!agentConfig) {
    throw new HTTPException(404, { message: `Agent '${name}' not found in schema.` });
  }
  return agentConfig
}

function requireItemConfig(runConfig: ReturnType<typeof requireRunConfig>, sessionItems: SessionItem[], itemId: string, itemType?: "input" | "output" | "step") {
  let itemConfig = findItemConfigById(runConfig, sessionItems, itemId, itemType);

  if (!itemConfig) {
    throw new HTTPException(400, { message: `Item not found in configuration for item '${itemId}'.` });
  }

  return itemConfig
}

function requireScoreConfig(itemConfig: ReturnType<typeof requireItemConfig>["itemConfig"], scoreName: string) {
  const scoreConfig = itemConfig.scores?.find((scoreConfig) => scoreConfig.name === scoreName)
  if (!scoreConfig) {
    throw new HTTPException(400, { message: `Score name '${scoreName}' not found in configuration.'` });
  }
  return scoreConfig
}

// DATA HELPERS

function requireUUID(id: string) {
  if (!isUUID(id)) {
    throw new HTTPException(404, { message: "Not found" });
  }
}

async function requireSession(tx: Transaction, sessionId: string) {
  const session = await fetchSession(tx, sessionId)
  if (!session) {
    throw new HTTPException(404, { message: "Session not found" });
  }

  return session
}

async function requireRun(tx: Transaction, runId: string) {
  const run = await getRun(tx, runId);
  if (!run) {
    throw new HTTPException(404, { message: "Run not found" });
  }
  return run
}

async function requireSessionItem(session: Awaited<ReturnType<typeof requireSession>>, itemId: string): Promise<SessionItem> {
  const item = getAllSessionItems(session).find((a) => a.id === itemId)
  if (!item) {
    throw new HTTPException(404, { message: "Session item not found" });
  }
  return item as SessionItem
}


async function requireUser(tx: Transaction, arg: Parameters<typeof findUser>[1]) {
  const user = await findUser(tx, arg)
  if (!user) {
    throw new HTTPException(404, { message: "End user not found" });
  }
  return user
}

async function requireCommentMessageFromUser(tx: Transaction, itemId: string, commentId: string, user: BetterAuthUser) {
  const comment = await tx.query.commentMessages.findFirst({
    where: and(
      eq(commentMessages.id, commentId),
      eq(commentMessages.sessionItemId, itemId),
      isNull(commentMessages.deletedAt)
    )
  });

  if (!comment) {
    throw new HTTPException(404, { message: "Comment not found" });
  }

  if (comment.userId !== user.id) {
    throw new HTTPException(401, { message: "You can only edit your own comments." });
  }

  return comment
}



/* --------- COMMENT OPERATIONS --------- */

type CommentOperationResult = {
  commentId: string;
  userMentions: string[];
}

async function createComment(
  tx: Transaction,
  session: Session,
  item: SessionItem,
  user: BetterAuthUser,
  content: string | null,
  organizationId: string,
) {

  // Add comment
  const [newMessage] = await tx.insert(commentMessages).values({
    organizationId,
    sessionItemId: item.id,
    userId: user.id,
    content,
  }).returning();

  let userMentions: string[] = [];

  // Add comment mentions
  if (content) {
    const mentions = extractMentions(content);

    userMentions = mentions.user_id || [];

    if (userMentions.length > 0) {
      await tx.insert(commentMentions).values(
        userMentions.map((mentionedUserId: string) => ({
          organizationId,
          commentMessageId: newMessage.id,
          mentionedUserId,
        }))
      );
    }
  }

  // Emit event (default true, can be disabled for batch operations)
  const [event] = await tx.insert(events).values({
    organizationId,
    type: 'comment_created',
    authorId: user.id,
    payload: {
      comment_id: newMessage.id,
      has_comment: content ? true : false,
      user_mentions: userMentions,
    }
  }).returning();

  await updateInboxes(tx, event, session, item);

  return newMessage;
}

async function updateComment(
  tx: Transaction,
  session: Session,
  item: SessionItem,
  commentMessage: any,
  newContent: string | null,
  organizationId: string,
) {
  // Extract mentions from new content
  let newMentions, previousMentions;
  let newUserMentions: string[] = [], previousUserMentions: string[] = [];

  newMentions = extractMentions(newContent ?? "");
  previousMentions = extractMentions(commentMessage.content ?? "");
  newUserMentions = newMentions.user_id || [];
  previousUserMentions = previousMentions.user_id || [];

  // Store previous content in edit history
  await tx.insert(commentMessageEdits).values({
    organizationId,
    commentMessageId: commentMessage.id,
    previousContent: commentMessage.content,
  });

  // Update the comment message
  await tx.update(commentMessages)
    .set({ content: newContent, updatedAt: new Date().toISOString() })
    .where(eq(commentMessages.id, commentMessage.id));

  // Handle mentions for edits
  if (newUserMentions.length > 0 || previousUserMentions.length > 0) {
    // Get existing mentions for this message
    const existingMentions = await tx
      .select()
      .from(commentMentions)
      .where(eq(commentMentions.commentMessageId, commentMessage.id));

    const existingMentionedUserIds = existingMentions.map((m: any) => m.mentionedUserId);

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
          organizationId,
          commentMessageId: commentMessage.id,
          mentionedUserId,
        }))
      );
    }
  }

  // Emit event
  const [event] = await tx.insert(events).values({
    organizationId,
    type: 'comment_edited',
    authorId: commentMessage.userId,
    payload: {
      comment_id: commentMessage.id,
      has_comment: newContent ? true : false,
      user_mentions: newUserMentions,
    }
  }).returning();

  await updateInboxes(tx, event, session, item);

  return commentMessage;
}

async function deleteComment(
  tx: Transaction,
  session: Session,
  item: SessionItem,
  commentId: any,
  user: BetterAuthUser,
  organizationId: string,
): Promise<void> {
  await tx.delete(commentMentions).where(eq(commentMentions.commentMessageId, commentId));
  await tx.delete(scores).where(eq(scores.commentId, commentId));
  await tx.update(commentMessages).set({
    deletedAt: new Date().toISOString(),
    deletedBy: user.id
  }).where(eq(commentMessages.id, commentId));

  // Emit event (default true, can be disabled for batch operations)
  const [event] = await tx.insert(events).values({
    organizationId,
    type: 'comment_deleted',
    authorId: user.id,
    payload: {
      comment_id: commentId
    }
  }).returning();

  await updateInboxes(tx, event, session, item);
}


/* --------- END USERS --------- */

// // End user authentication endpoint (disabled for now)
// const clientAuthRoute = createRoute({
//   method: 'post',
//   path: '/api/end-users/auth',
//   request: {
//     body: body(z.object({
//       id_token: z.string().optional(),
//     })),
//   },
//   responses: {
//     200: response_data(z.object({
//       token: z.string(),
//       endUserId: z.string(),
//       expiresAt: z.iso.date(),
//     })),
//     401: response_error(),
//     404: response_error(),
//   },
// })

// app.openapi(clientAuthRoute, async (c) => {
//   const endUserSession = await getEndUserAuthSession({ headers: c.req.raw.headers })

//   if (endUserSession) {
//     return c.json({
//       endUserId: endUserSession.endUserId,
//       token: endUserSession.token,
//       expiresAt: endUserSession.expiresAt,
//     }, 200)
//   }

//   const endUser = await (async () => {
//     const body = await c.req.valid('json')

//     if (body.id_token) {
//       const jwtPayload = verifyJWT(body.id_token)

//       if (!jwtPayload) {
//         throw new HTTPException(401, { message: "Can't verify this ID token." });
//       }

//       const existingClient = await  (jwtPayload.external_id)

//       if (existingClient) {
//         return existingClient
//       } else {
//         return await createEndUser(jwtPayload.external_id)
//       }
//     }

//     return await createEndUser()
//   })()

//   const newendUsersession = await createEndUserAuthSession(endUser.id, {
//     ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
//     userAgent: c.req.header('user-agent'),
//   })

//   return c.json({
//     endUserId: client.id,
//     token: newendUsersession.token,
//     expiresAt: newendUsersession.expiresAt,
//   }, 200)
// })


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

async function createUser(principal: PrivatePrincipal, space_?: Space | null, externalId?: string | null, email?: string | null) {
  const env = getEnv(principal);
  const space : Space = space_ ?? (env.type === 'prod' ? 'production' : 'playground'); // default space is set based on environment

  await authorize(principal, { action: "end-user:create", space })

  return await withOrg(principal.organizationId, async (tx) => {
    if (externalId) {
      const existingUserWithExternalId = await findUser(tx, { externalId, organizationId: principal.organizationId })
      if (existingUserWithExternalId) {
        throw new AgentViewError('User with this external ID already exists', 422)
      }
    }
  
    const createdBy = getMemberId(principal);
    if (space === 'production' && createdBy !== null) { // sanity check
      throw new AgentViewError('Users in production space can be created only with production api key.', 401)
    }
    if ((space === 'playground' || space === 'shared-playground') && createdBy === null) {
      throw new AgentViewError(`Users in '${space}' space can't be created with production api key, only via member login.`, 401)
    }
  
    const [newEndUser] = await tx.insert(endUsers).values({
      organizationId: principal.organizationId,
      externalId,
      email,
      createdBy,
      space,
      token: randomBytes(32).toString('hex'),
    }).returning()
  
    return newEndUser
  })
}

app.openapi(usersPOSTRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const body = await c.req.valid('json')
  const newUser = await createUser(principal, body.space, body.externalId, body.email);
  return c.json(newUser, 201);
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
  const principal = await authn(c.req.raw.headers)
  const user = principal.user;

  if (!user) {
    throw new HTTPException(422, { message: "You must provide an end user token to access this endpoint." });
  }

  await authorize(principal, { action: "end-user:read", user })
  return c.json(user, 200);
})

const publicMeRoute = createRoute({
  method: 'get',
  path: '/api/public/me',
  summary: 'Retrieve the current user',
  tags: ['Public'],
  responses: {
    200: response_data(UserSchema),
    404: response_error()
  },
})

app.openapi(publicMeRoute, async (c) => {
  const principal = await authnUser(c.req.raw.headers)
  const user = principal.user;

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
  requireUUID(id);

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

  return withOrg(principal.organizationId, async (tx) => {
    const user = await requireUser(tx, { externalId: external_id, organizationId: principal.organizationId })
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

  return withOrg(principal.organizationId, async (tx) => {
    const user = await requireUser(tx, { id })
    await authorize(principal, { action: "end-user:update", user })

    const [updatedUser] = await tx.update(endUsers).set(body).where(eq(endUsers.id, id)).returning();
    return c.json(updatedUser, 200);
  })
})



/**
 * SESSIONS
 */

const DEFAULT_LIMIT = 50
const DEFAULT_PAGE = 1

function getSessionListFilter(params: z.infer<typeof SessionsGetQueryParamsSchema>, principal: Principal) {
  const { agent, space, userId } = params;

  const filters: any[] = []

  if (agent) {
    filters.push(eq(sessions.agent, agent));
  }

  if (principal.type === 'member' || principal.type === 'apiKey') {

    if (!space && !userId) {
      throw new HTTPException(422, { message: "You must set either `space` or `userId` to make this request." });
    }
    if (space && userId) {
      throw new HTTPException(422, { message: "You must set either `space` or `userId`, not both." });
    }
    if (userId && principal.user) {
      throw new HTTPException(422, { message: "You can't set both X-User-Token and userId query param" });
    }

    if (space) { // space
      filters.push(eq(endUsers.space, space));
    }

    if (userId) { // explicit user
      filters.push(eq(endUsers.id, userId));
    }

    if (principal.user) { // "as a user"
      filters.push(eq(endUsers.id, principal.user.id));
    }

    if (space === "playground") {

      if (principal.type === 'member') {
        filters.push(eq(endUsers.createdBy, principal.session.user.id));
      }
      else if (principal.type === 'apiKey') {
        filters.push(eq(endUsers.createdBy, principal.apiKey.userId));
      }
      // else {
      //   throw new HTTPException(401, { message: "`playground` can only be used with provided logged in user id." });
      // }
    }
  }
  else if (principal.type === 'user') {
    filters.push(eq(endUsers.id, principal.user.id));
  }

  return and(...filters);
}

function normalizeNumberParam(value: number | string | undefined, defaultValue: number) {
  let numValue: number;

  if (!value) {
    numValue = defaultValue;
  }
  else if (typeof value === 'string') {
    numValue = parseInt(value);
  }
  else {
    numValue = value;
  }

  if (isNaN(numValue)) {
    return 1;
  }

  return Math.max(numValue, 1);
}

function buildPaginationMetadata(totalCount: number, page: number, limit: number, offset: number) {
  const totalPages = Math.ceil(totalCount / limit);
  return {
    totalCount,
    totalPages,
    page,
    limit,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
    currentPageStart: offset + 1,
    currentPageEnd: Math.min(offset + limit, totalCount),
  };
}

function mapSessionRow(row: { sessions: typeof sessions.$inferSelect; end_users: typeof endUsers.$inferSelect | null }) {
  return {
    id: row.sessions.id,
    handle: row.sessions.handleNumber.toString() + (row.sessions.handleSuffix ?? ""),
    createdAt: row.sessions.createdAt,
    updatedAt: row.sessions.updatedAt,
    metadata: row.sessions.metadata as Record<string, any>,
    summary: row.sessions.summary,
    agent: row.sessions.agent,
    user: row.end_users!,
    space: row.end_users!.space,
    userId: row.end_users!.id,
    versions: row.sessions.versions ?? []
  };
}

async function getSessions(tx: Transaction, params: SessionsGetQueryParams, principal: Principal) {
  const limit = normalizeNumberParam(params.limit, DEFAULT_LIMIT);
  const page = normalizeNumberParam(params.page, DEFAULT_PAGE);

  const MAX_LIMIT = 1000;
  if (limit > MAX_LIMIT) {
    throw new HTTPException(422, { message: `Page limit cannot exceed ${MAX_LIMIT}` });
  }

  const offset = (page - 1) * limit;
  const baseFilter = getSessionListFilter(params, principal);

  // // Handle starred filter - requires joining with starredSessions table
  // const isStarred = params.starred === true || params.starred === 'true';
  // const starredJoin = (() => {
  //   if (!isStarred) return null;
  //   if (principal.type === 'user') {
  //     throw new HTTPException(422, { message: "starred filter is only available for staff users" });
  //   }
  //   const memberId = requireMemberId(principal);
  //   return and(
  //     eq(starredSessions.sessionId, sessions.id),
  //     eq(starredSessions.userId, memberId)
  //   );
  // })();

  // Build count query
  const countQuery = tx
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(sessions)
    .$dynamic();

  // if (starredJoin) {
  //   countQuery.innerJoin(starredSessions, starredJoin);
  // }

  const totalCountResult = await countQuery
    .leftJoin(endUsers, eq(sessions.userId, endUsers.id))
    .where(baseFilter);

  const totalCount = totalCountResult[0]?.count ?? 0;

  // Build sessions query
  const sessionsQuery = tx
    .select({ sessions, end_users: endUsers })
    .from(sessions)
    .$dynamic();

  // if (starredJoin) {
  //   sessionsQuery.innerJoin(starredSessions, starredJoin);
  // }

  const result = await sessionsQuery
    .leftJoin(endUsers, eq(sessions.userId, endUsers.id))
    .where(baseFilter)
    .orderBy(desc(sessions.updatedAt))
    .limit(limit)
    .offset(offset);

  return {
    sessions: result.map(mapSessionRow),
    pagination: buildPaginationMetadata(totalCount, page, limit, offset),
  };
}


// internal
const sessionsGETRoute = createRoute({
  method: 'get',
  path: '/api/sessions',
  summary: 'List sessions',
  tags: ['Sessions'],
  request: {
    query: SessionsGetQueryParamsSchema,
  },
  responses: {
    200: response_data(SessionsPaginatedResponseSchema),
    401: response_error(),
  },
})

app.openapi(sessionsGETRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const params = c.req.valid("query");

  return withOrg(principal.organizationId, async (tx) => {
    const sessions = await getSessions(tx, params, principal)
    return c.json(sessions, 200);
  })
})

// public
const publicSessionsGETRoute = createRoute({
  method: 'get',
  path: '/api/public/sessions',
  summary: 'List sessions',
  tags: ['Public'],
  request: {
    query: PublicSessionsGetQueryParamsSchema,
  },
  responses: {
    200: response_data(SessionsPaginatedResponseSchema),
    401: response_error(),
  },
})

app.openapi(publicSessionsGETRoute, async (c) => {
  const principal = await authnUser(c.req.raw.headers)
  const params = c.req.valid("query");

  return withOrg(principal.organizationId, async (tx) => {
    const sessions = await getSessions(tx, params, principal)
    return c.json(sessions, 200);
  })
})

type StatsResponse = {
  unseenCount: number,
  sessions?: {
    [sessionId: string]: {
      unseenEvents: any[],
      items: { [itemId: string]: { unseenEvents: any[] } }
    }
  }
}

const sessionsGETStatsRoute = createRoute({
  method: 'get',
  path: '/api/sessions/stats',
  summary: 'Get stats',
  tags: ['Sessions'],
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

  return withOrg(principal.organizationId, async (tx) => {
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
          getSessionListFilter(params, principal)
        )
      )

    const response: StatsResponse = {
      unseenCount: result[0].unreadSessions ?? 0,
    }

    if (granular) {
      const sessionsResult = await getSessions(tx, params, principal);
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

      sessionRows.map((session) => {
        const sessionInboxItem = session.inboxItems.find((inboxItem) => inboxItem.sessionItemId === null);
        const itemInboxItems = session.inboxItems.filter((inboxItem) => inboxItem.sessionItemId !== null);

        function getUnseenEvents(inboxItem: InferSelectModel<typeof inboxItems> | null | undefined) {
          if (isInboxItemUnread(inboxItem)) {
            const render: any = inboxItem?.render;
            return render?.events ?? [];
          }
          return [];
        }

        response.sessions![session.id] = {
          unseenEvents: getUnseenEvents(sessionInboxItem),
          items: {}
        }

        itemInboxItems.forEach((inboxItem) => {
          response.sessions![session.id].items[inboxItem.sessionItemId!] = {
            unseenEvents: getUnseenEvents(inboxItem),
          }
        });

      })
    }

    return c.json(response, 200);
  })
})


const sessionGETRoute = createRoute({
  method: 'get',
  path: '/api/sessions/{session_id}',
  summary: 'Retrieve a session',
  tags: ['Sessions'],
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

app.openapi(sessionGETRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const { session_id } = c.req.param()

  return withOrg(principal.organizationId, async (tx) => {
    const session = await requireSession(tx, session_id);
    await authorize(principal, { action: "end-user:read", user: session.user });
    return c.json(session, 200);
  })
})


const sessionPATCHRoute = createRoute({
  method: 'patch',
  path: '/api/sessions/{session_id}',
  summary: 'Update a session',
  tags: ['Sessions'],
  request: {
    params: z.object({
      session_id: z.string(),
    }),
    body: body(SessionUpdateSchema),
  },
  responses: {
    200: response_data(SessionSchema),
    401: response_error(),
    404: response_error(),
    422: response_error(),
  },
})

app.openapi(sessionPATCHRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const { session_id } = c.req.param()
  const body = await c.req.valid('json')

  return withOrg(principal.organizationId, async (tx) => {
    const session = await requireSession(tx, session_id);
    authorize(principal, { action: "end-user:update", user: session.user });

    const config = await requireConfig(tx, principal)
    const agentConfig = await requireAgentConfig(config, session.agent)

    const metadata = parseMetadata(agentConfig.metadata, agentConfig.allowUnknownMetadata ?? true, body.metadata, session.metadata);

    await tx.update(sessions).set({
      metadata,
      summary: body.summary,
      updatedAt: new Date().toISOString(),
    }).where(eq(sessions.id, session_id));

    const updatedSession = await requireSession(tx, session_id);
    return c.json(updatedSession, 200);
  })
})


const sessionCommentsGETRoute = createRoute({
  method: 'get',
  path: '/api/sessions/{session_id}/comments',
  summary: 'List comments',
  tags: ['Sessions'],
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
      where: eq(commentMessages.sessionItemId, sql`ANY(SELECT id FROM session_items WHERE session_id = ${session.id})`),
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
  tags: ['Sessions'],
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
      where: eq(scores.sessionItemId, sql`ANY(SELECT id FROM session_items WHERE session_id = ${session.id})`),
      orderBy: (score, { asc }) => [asc(score.createdAt)],
    });

    return c.json(sessionScores, 200);
  })
})


// // Star a session
// const sessionStarPUTRoute = createRoute({
//   method: 'put',
//   path: '/api/sessions/{session_id}/star',
//   summary: 'Star a session',
//   tags: ['Sessions'],
//   request: {
//     params: z.object({
//       session_id: z.string(),
//     }),
//   },
//   responses: {
//     200: response_data(z.object({ starred: z.boolean() })),
//     401: response_error(),
//     404: response_error(),
//   },
// })

// app.openapi(sessionStarPUTRoute, async (c) => {
//   const principal = await authn(c.req.raw.headers)
//   const { session_id } = c.req.param()

//   const memberId = requireMemberId(principal);

//   return withOrg(principal.organizationId, async (tx) => {
//     const session = await requireSession(tx, session_id);
//     authorize(principal, { action: "end-user:read", user: session.user });

//     await tx.insert(starredSessions).values({
//       organizationId: (principal as PrivatePrincipal).organizationId,
//       userId: memberId,
//       sessionId: session_id,
//     }).onConflictDoNothing();

//     return c.json({ starred: true }, 200);
//   })
// })

// // Unstar a session
// const sessionStarDELETERoute = createRoute({
//   method: 'delete',
//   path: '/api/sessions/{session_id}/star',
//   summary: 'Unstar a session',
//   tags: ['Sessions'],
//   request: {
//     params: z.object({
//       session_id: z.string(),
//     }),
//   },
//   responses: {
//     200: response_data(z.object({ starred: z.boolean() })),
//     401: response_error(),
//     404: response_error(),
//   },
// })

// app.openapi(sessionStarDELETERoute, async (c) => {
//   const principal = await authn(c.req.raw.headers)
//   const { session_id } = c.req.param()

//   const memberId = requireMemberId(principal);

//   return withOrg(principal.organizationId, async (tx) => {
//     const session = await requireSession(tx, session_id);
//     authorize(principal, { action: "end-user:read", user: session.user });

//     await tx.delete(starredSessions).where(
//       and(
//         eq(starredSessions.userId, memberId),
//         eq(starredSessions.sessionId, session_id)
//       )
//     );

//     return c.json({ starred: false }, 200);
//   })
// })

// // Check if session is starred
// const sessionStarGETRoute = createRoute({
//   method: 'get',
//   path: '/api/sessions/{session_id}/star',
//   summary: 'Get star status',
//   tags: ['Sessions'],
//   request: {
//     params: z.object({
//       session_id: z.string(),
//     }),
//   },
//   responses: {
//     200: response_data(z.object({ starred: z.boolean() })),
//     401: response_error(),
//     404: response_error(),
//   },
// })

// app.openapi(sessionStarGETRoute, async (c) => {
//   const principal = await authn(c.req.raw.headers)
//   const { session_id } = c.req.param()

//   const memberId = requireMemberId(principal);

//   return withOrg(principal.organizationId, async (tx) => {
//     const session = await requireSession(tx, session_id);
//     authorize(principal, { action: "end-user:read", user: session.user });

//     const star = await tx.query.starredSessions.findFirst({
//       where: and(
//         eq(starredSessions.userId, memberId),
//         eq(starredSessions.sessionId, session_id)
//       )
//     });

//     return c.json({ starred: !!star }, 200);
//   })
// })

const publicSessionGETRoute = createRoute({
  method: 'get',
  path: '/api/public/sessions/{session_id}',
  summary: 'Retrieve a session',
  tags: ['Public'],
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

app.openapi(publicSessionGETRoute, async (c) => {
  const principal = await authnUser(c.req.raw.headers)

  const { session_id } = c.req.param()
  requireUUID(session_id);

  return withOrg(principal.organizationId, async (tx) => {
    const session = await requireSession(tx, session_id);
    authorize(principal, { action: "end-user:read", user: session.user });

    return c.json(session, 200);
  })
})


const sessionsPOSTRoute = createRoute({
  method: 'post',
  path: '/api/sessions',
  summary: 'Create a session',
  tags: ['Sessions'],
  request: {
    body: body(SessionCreateSchema)
  },
  responses: {
    201: response_data(SessionSchema),
    422: response_error()
  },
})

app.openapi(sessionsPOSTRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const body = await c.req.valid('json')

  return withOrg(principal.organizationId, async (tx) => {
    const config = await requireConfig(tx, principal)
    const agentConfig = await requireAgentConfig(config, body.agent)

    // find user or create new one if not found
    const user = await (async () => {
      if (body.userId) {
        return await requireUser(tx, { id: body.userId });
      }

      if (principal.user) {
        return principal.user;
      }

      return await createUser(principal, body.space, undefined);
    })()

    authorize(principal, { action: "end-user:update", user });

    const newSession = await createSession(tx, {
      organizationId: principal.organizationId,
      agentConfig,
      userId: user.id,
      metadata: body.metadata,
      summary: body.summary,
      authorId: getMemberId(principal),
    });

    return c.json(newSession, 201);
  })
})


// watches session and its last run changes
async function* watchSession(organizationId: string, initSession: Session, wait: boolean, randomId: string, signal: AbortSignal) {
  console.log(`[watch ${randomId}] wait: `, wait);

  const initLastRunId = getLastRun(initSession)?.id;

  // if wait is true, we wait for the session to be in progress using lightweight polling
  if (wait) {
    while(true) {
      if (signal.aborted) {
        console.log(`[watch ${randomId}] signal aborted`);
        return;
      }

      // Use lightweight polling to check status without fetching full session
      const lastRunStatus = await withOrg(organizationId, async (tx) => fetchLastRunStatus(tx, initSession.id));

      if (lastRunStatus?.status === 'in_progress' || lastRunStatus?.id !== initLastRunId) {
        // Only fetch full session once we know it's in progress
        initSession = await withOrg(organizationId, async (tx) => requireSession(tx, initSession.id));
        break;
      }

      console.log(`[watch ${randomId}] waiting for session to be in progress...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`[watch ${randomId}] session is in progress, streaming...`);

  let prevLastRun = getLastRun(initSession);
  let prevUpdatedAt = prevLastRun?.updatedAt;

  yield {
    event: 'session.snapshot',
    data: initSession
  }

  // we do not stream session when run is *not* in progress
  if (prevLastRun?.status !== 'in_progress') {
    return;
  }

  while (true) {
    if (signal.aborted) {
      console.log(`[watch ${randomId}] signal aborted`);
      return;
    }

    // Use lightweight polling to check if updatedAt has changed
    const lastRunStatus = await withOrg(organizationId, async (tx) => fetchLastRunStatus(tx, initSession.id));

    if (!lastRunStatus) {
      throw new Error('unreachable');
    }

    if (prevLastRun.updatedAt === lastRunStatus.updatedAt) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }

    // Changes detected - fetch full session to get details
    const session = await withOrg(organizationId, async (tx) => requireSession(tx, initSession.id));
    const lastRun = getLastRun(session);

    if (!lastRun) {
      throw new Error('unreachable');
    }

    const hasNewRun = prevLastRun?.id !== lastRun.id;

    // current run changed
    if (hasNewRun) {

      throw new Error('unreachable - new run created while old one was being streamed');


      // // if previous last run existed and it's not in session.runs now it means it is both failed & not active -> therefore archived.
      // if (prevLastRun && !session.runs.find(r => r.id === prevLastRun?.id)) {
      //   yield {
      //     event: 'run.archived',
      //     data: {
      //       id: prevLastRun.id,
      //     },
      //   }
      // }

      // yield {
      //   event: 'run.created',
      //   data: lastRun,
      // }

      // prevLastRun = lastRun;
    }

    const changedFields: Partial<typeof lastRun> = {};

    const newItems = lastRun.sessionItems.filter(i => !prevLastRun?.sessionItems.find(i2 => i2.id === i.id))

    if (newItems.length > 0) {
      changedFields.sessionItems = newItems;
    }

    const runFieldsToCompare = ['id', 'status', 'finishedAt', 'failReason', 'metadata', 'updatedAt'] as const;

    for (const field of runFieldsToCompare) {
      if (JSON.stringify(prevLastRun![field] ?? null) !== JSON.stringify(lastRun[field] ?? null)) {
        changedFields[field] = lastRun[field];
      }
    }

    if (Object.keys(changedFields).length > 0) {
      yield {
        event: 'run.updated',
        data: {
          id: lastRun.id,
          ...changedFields,
        },
      };
    }

    if (lastRun.status !== 'in_progress') {
      break;
    }

    prevLastRun = lastRun;
    prevUpdatedAt = lastRun.updatedAt;

    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

const sessionStreamRoute = createRoute({
  method: 'get',
  path: '/api/sessions/{session_id}/stream',
  summary: 'Stream updates',
  tags: ['Sessions'],
  request: {
    params: z.object({
      session_id: z.string(),
    }),
    query: z.object({
       wait: z.string().optional()
    }),
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


app.openapi(sessionStreamRoute, async (c) => {
  const principal = await authn(c.req.raw.headers);

  const { session_id } = c.req.param()
  const query = c.req.valid("query");
  const wait = query.wait === "true";

  const session = await withOrg(principal.organizationId, async (tx) => requireSession(tx, session_id))

  authorize(principal, { action: "end-user:read", user: session.user });

  // if session is not in progress and no wait -> 204
  if (getLastRun(session)?.status !== 'in_progress' && !wait) {
    return c.body(null, 204);
  }

  const randomId = Math.random().toString(36).substring(2, 8);
  console.log(`[watch ${randomId}] starting request`)
  const generator = watchSession(principal.organizationId, session, wait, randomId, c.req.raw.signal);

  c.req.raw.signal.addEventListener('abort', () => {
    console.log(`[watch ${randomId}] close event`)
  })

  // TODO: heartbeat
  return streamSSE(c, async (stream) => {
    for await (const event of generator) {
      if (c.req.raw.signal.aborted) return;

      await stream.writeSSE({
        data: JSON.stringify(event.data),
        event: event.event,
      });
    }
  });
});


const sessionSeenRoute = createRoute({
  method: 'post',
  path: '/api/sessions/{sessionId}/seen',
  summary: 'Mark session as seen',
  tags: ['Sessions'],
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
  const principal = await authn(c.req.raw.headers)
  const userPrincipal = requireMemberPrincipal(principal);

  const { sessionId } = c.req.param()

  await withOrg(principal.organizationId, async tx => {
    await tx.update(inboxItems).set({
      lastReadEventId: sql`${inboxItems.lastNotifiableEventId}`,
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(inboxItems.userId, userPrincipal.session.user.id),
      eq(inboxItems.sessionId, sessionId),
      isNull(inboxItems.sessionItemId),
    ))
  })

  return c.json({}, 200);
})


/* --------- RUNS --------- */




const runsPOSTRoute = createRoute({
  method: 'post',
  path: '/api/runs',
  summary: 'Create a run',
  tags: ['Runs'],
  request: {
    body: body(RunCreateSchema)
  },
  responses: {
    201: response_data(RunSchema),
    400: response_error(),
    404: response_error()
  },
})

app.openapi(runsPOSTRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)
  const body = await c.req.valid('json')

  return withOrg(principal.organizationId, async (tx) => {
    const session = await requireSession(tx, body.sessionId);

    authorize(principal, { action: "end-user:update", user: session.user });

    const organizationId = principal.organizationId;
    const env = getEnv(principal);
    const environment = await requireEnvironment(tx, env);

    await createRun(tx, organizationId, environment, body);

    const updatedSession = await requireSession(tx, body.sessionId);
    const newRun = getLastRun(updatedSession)!;

    return c.json(newRun, 201);
  })
})




const runPATCHRoute = createRoute({
  method: 'patch',
  path: '/api/runs/{run_id}',
  summary: 'Update a run',
  tags: ['Runs'],
  request: {
    params: z.object({
      run_id: z.string(),
    }),
    body: body(RunUpdateSchema)
  },
  responses: {
    201: response_data(RunSchema),
    400: response_error(),
    404: response_error()
  },
})

app.openapi(runPATCHRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)

  const { run_id } = c.req.param()
  requireUUID(run_id);

  const body = await c.req.valid('json')

  return withOrg(principal.organizationId, async (tx) => {
    const run = await requireRun(tx, run_id);
    const session = await requireSession(tx, run.sessionId);

    authorize(principal, { action: "end-user:update", user: session.user });

    // Guard: API can only cancel auto-fetch runs which are being auto-fetched
    if (run.fetchStatus) {
      const hasOnlyStatus = body.status === 'cancelled'
        && !body.items?.length
        && body.metadata === undefined
        && body.state === undefined
        && body.failReason === undefined;

      if (!hasOnlyStatus) {
        throw new AgentViewError("Cannot modify a run while agent fetch is in progress. Only cancellation is allowed.", 422);
      }
    }

    //   // Cancel the auto-fetch run (it bypasses the 'applyRunPatch' which is not allowed when auto fetching)
    //   await tx.update(runs).set({
    //     status: 'cancelled',
    //     finishedAt: new Date().toISOString(),
    //     expiresAt: null,
    //     updatedAt: new Date().toISOString(),
    //   }).where(eq(runs.id, run.id));

    //   // const updatedSession = await requireSession(tx, session.id);
    //   // const newRun = getLastRun(updatedSession)!;
    //   // return c.json(newRun, 201);
    // }
    // else {
    //   const config = await requireConfig(tx, principal)
    //   const agentConfig = requireAgentConfig(config, session.agent)
  
    //   await applyRunPatch(tx, run.id, agentConfig, body);
    // }

    const config = await requireConfig(tx, principal)
    const agentConfig = requireAgentConfig(config, session.agent)

    await applyRunPatch(tx, run.id, agentConfig, body);

    const updatedSession = await requireSession(tx, session.id);
    const newRun = getLastRun(updatedSession)!;

    return c.json(newRun, 201);
  })
})

const runKeepAliveRoute = createRoute({
  method: 'post',
  path: '/api/runs/{run_id}/keep-alive',
  summary: 'Keep alive',
  tags: ['Runs'],
  responses: {
    200: response_data(z.object({ expiresAt: z.string().nullable() })),
    400: response_error(),
    404: response_error()
  },
})

app.openapi(runKeepAliveRoute, async (c) => {
  const principal = await authn(c.req.raw.headers)

  const { run_id } = c.req.param()
  requireUUID(run_id);

  return withOrg(principal.organizationId, async (tx) => {
    const run = await requireRun(tx, run_id);
    const session = await requireSession(tx, run.sessionId);

    authorize(principal, { action: "end-user:update", user: session.user });

    const config = await requireConfig(tx, principal);
    const agentConfig = requireAgentConfig(config, session.agent);
    const inputItem = run.sessionItems[0].content;
    const runConfig = requireRunConfig(agentConfig, inputItem);

    const status = run.status;
    const isFinished = status === 'completed' || status === 'failed' || status === 'cancelled';
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

// const runWatchRoute = createRoute({
//   method: 'get',
//   path: '/api/runs/{run_id}/watch',
//   summary: 'Watch Run',
//   tags: ['Runs'],
//   request: {
//     params: z.object({
//       run_id: z.string()
//     })
//   },
//   responses: {
//     200: {
//       content: {
//         'text/event-stream': {
//           schema: z.string(),
//         },
//       },
//       description: "Streams items from the run",
//     },
//     400: response_error(),
//     404: response_error()
//   },
// })


// app.openapi(runWatchRoute, async (c) => {
//   const principal = await authn(c.req.raw.headers);
//   const organizationId = principal.organizationId;

//   const { run_id } = c.req.param()

//   // Initial fetch with org context
//   const { session, lastRun } = await withOrg(organizationId, async (tx) => {
//     const run = await requireRun(tx, run_id)
//     const session_id = run.sessionId;
//     const session = await requireSession(tx, session_id)

//     authorize(principal, { action: "end-user:read", user: session.user });

//     const lastRun = getLastRun(session)
//     return { session, lastRun };
//   });

//   const session_id = session.id;

//   return streamSSE(c, async (stream) => {
//     let running = true;
//     stream.onAbort(() => {
//       running = false;
//     });

//     // let's start with sending full run snapshot
//     await stream.writeSSE({
//       data: JSON.stringify(lastRun ?? null),
//       event: 'run.snapshot',
//     });

//     // close stream for runs that are not in_progress
//     if (lastRun?.status !== 'in_progress') {
//       return;
//     }

//     let previousRun = lastRun;

//     /**
//      * POLLING HERE
//      * Soon we'll need to create a proper messaging, when some LLM API will be streaming characters then even NOTIFY/LISTEN won't make it performance-wise.
//      */
//     while (running) {
//       const session = await withOrg(organizationId, (tx) => requireSession(tx, session_id))
//       const lastRun = getLastRun(session)

//       if (!lastRun) {
//         throw new Error('unreachable');
//       }

//       // check for new items
//       const items = lastRun.sessionItems
//       const freshItems = items.filter(i => !previousRun.sessionItems.find(i2 => i2.id === i.id))

//       for (const item of freshItems) {
//         await stream.writeSSE({
//           data: JSON.stringify(item),
//           event: 'item.created',
//         });
//       }

//       previousRun = {
//         ...previousRun,
//         sessionItems: [...previousRun.sessionItems, ...freshItems],
//       }

//       // check for state change
//       const runFieldsToCompare = ['id', 'createdAt', 'finishedAt', 'sessionId', 'versionId', 'status', 'failReason', 'version', 'metadata'] as const;
//       const changedFields: Partial<typeof lastRun> = {};

//       for (const field of runFieldsToCompare) {
//         if (JSON.stringify(previousRun[field]) !== JSON.stringify(lastRun[field])) {
//           changedFields[field] = lastRun[field];
//         }
//       }

//       if (Object.keys(changedFields).length > 0) {
//         await stream.writeSSE({
//           data: JSON.stringify(changedFields),
//           event: 'run.state',
//         });

//         // Update previousRun with the new values (excluding sessionItems)
//         previousRun = {
//           ...previousRun,
//           ...changedFields,
//         };
//       }

//       // End if run is no longer in_progress
//       if (lastRun?.status !== 'in_progress') {
//         break;
//       }

//       // Wait 1s before next poll
//       await new Promise(resolve => setTimeout(resolve, 1000));
//     }
//   });
// });



/* --------- ITEMS --------- */

const itemSeenRoute = createRoute({
  method: 'post',
  path: '/api/sessions/{sessionId}/items/{itemId}/seen',
  summary: 'Mark item as seen',
  tags: ['Sessions'],
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
  const principal = await authn(c.req.raw.headers)
  const userPrincipal = requireMemberPrincipal(principal);

  const { sessionId, itemId } = c.req.param()

  return withOrg(principal.organizationId, async (tx) => {
    await tx.update(inboxItems).set({
      lastReadEventId: sql`${inboxItems.lastNotifiableEventId}`,
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(inboxItems.userId, userPrincipal.session.user.id),
      eq(inboxItems.sessionId, sessionId),
      eq(inboxItems.sessionItemId, itemId),
    ))

    return c.json({}, 200);
  })
})



/* --------- FEED --------- */


// function validateScore(config: BaseConfig, session: Session, item: SessionItem, user: BetterAuthUser, scoreName: string, scoreValue: any, options?: { mustNotExist?: boolean }) {
//   const agentConfig = requireAgentConfig(config, session.agent);
//   const itemConfig = requireItemConfig(agentConfig, item.type, item.role ?? undefined)
//   const itemTypeCuteName = `${item.type}' / '${item.role}`

//   // Find the score config for this item
//   const scoreConfig = itemConfig.scores?.find((scoreConfig) => scoreConfig.name === scoreName);
//   if (!scoreConfig) {
//     throw new HTTPException(400, { message: `Score name '${scoreName}' not found in configuration for item  '${itemTypeCuteName}' in agent '${session.agent}'` });
//   }

//   // Check if there is already a score with the same name in any commentMessage's scores
//   if (item.commentMessages && options?.mustNotExist === true) {
//     for (const message of item.commentMessages) {
//       if (message.scores) {
//         for (const score of message.scores) {
//           if (score.name === scoreName && !score.deletedAt && score.createdBy === user.id) {
//             throw new HTTPException(400, { message: `A score with name '${scoreName}' already exists.` });
//           }
//         }
//       }
//     }
//   }

//   // Validate value against the schema
//   const result = scoreConfig.schema.safeParse(scoreValue);
//   if (!result) {
//     throw new HTTPException(400, { message: `Error parsing the score value for score "${scoreName}"` }); // todo: add result.error.issues and "parse.schema" error code.
//   }
// }



const commentsPOSTRoute = createRoute({
  method: 'post',
  path: '/api/sessions/{sessionId}/items/{itemId}/comments',
  summary: 'Create a comment',
  tags: ['Comments'],
  request: {
    params: z.object({
      sessionId: z.string(),
      itemId: z.string(),
    }),
    body: body(CommentMessageCreateSchema)
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
  const userPrincipal = requireMemberPrincipal(principal);

  const body = await c.req.valid('json')
  const { sessionId, itemId } = c.req.param()

  return withOrg(principal.organizationId, async (tx) => {
    const session = await requireSession(tx, sessionId)
    const item = await requireSessionItem(session, itemId);

    await createComment(tx, session, item, userPrincipal.session.user, body.content ?? null, userPrincipal.organizationId);

    return c.json({}, 201);
  })
})


// Comments DELETE (delete comment)
const commentsDELETERoute = createRoute({
  method: 'delete',
  path: '/api/sessions/{sessionId}/items/{itemId}/comments/{commentId}',
  summary: 'Delete a comment',
  tags: ['Comments'],
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
  const principal = await authn(c.req.raw.headers)
  const userPrincipal = requireMemberPrincipal(principal);

  const { commentId, sessionId, itemId } = c.req.param()

  return withOrg(principal.organizationId, async (tx) => {
    const session = await requireSession(tx, sessionId)
    const item = await requireSessionItem(session, itemId);
    const commentMessage = await requireCommentMessageFromUser(tx, itemId, commentId, userPrincipal.session.user);

    await deleteComment(tx, session, item, commentMessage.id, userPrincipal.session.user, userPrincipal.organizationId);
    return c.json({}, 200);
  })
})


// Comments PUT (edit comment)
const commentsPUTRoute = createRoute({
  method: 'put',
  path: '/api/sessions/{sessionId}/items/{itemId}/comments/{commentId}',
  summary: 'Update a comment',
  tags: ['Comments'],
  request: {
    params: z.object({
      sessionId: z.string(),
      itemId: z.string(),
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
  const userPrincipal = requireMemberPrincipal(principal);

  const { sessionId, itemId, commentId } = c.req.param()
  const body = await c.req.valid('json')

  return withOrg(principal.organizationId, async (tx) => {
    const session = await requireSession(tx, sessionId)
    const item = await requireSessionItem(session, itemId)
    const commentMessage = await requireCommentMessageFromUser(tx, itemId, commentId, userPrincipal.session.user);

    try {
      await updateComment(tx, session, item, commentMessage, body.content, userPrincipal.organizationId);
    } catch (error) {
      return c.json({ message: `Invalid mention format: ${(error as Error).message}` }, 422);
    }

    return c.json({}, 200);
  })
})


/* --------- SCORES --------- */


// Scores PATCH (create or update scores for an item)
const scoresPATCHRoute = createRoute({
  method: 'patch',
  path: '/api/sessions/{sessionId}/items/{itemId}/scores',
  summary: 'Update scores',
  tags: ['Scores'],
  request: {
    params: z.object({
      sessionId: z.string(),
      itemId: z.string(),
    }),
    body: body(z.array(ScoreCreateSchema))
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
  const userPrincipal = requireMemberPrincipal(principal);

  const { sessionId, itemId } = c.req.param()
  const inputScores = await c.req.valid('json');

  return withOrg(principal.organizationId, async (tx) => {
    const config = await requireConfig(tx, principal)
    const session = await requireSession(tx, sessionId)
    const item = await requireSessionItem(session, itemId);
    const run = session.runs.find(r => r.id === item.runId)!

    const agentConfig = requireAgentConfig(config, session.agent);
    const runConfig = requireRunConfig(agentConfig, run.sessionItems[0].content);
    const itemConfig = requireItemConfig(runConfig, run.sessionItems, item.id).itemConfig;

    for (const score of inputScores) {
      const { name, value } = score;

      const scoreConfig = requireScoreConfig(itemConfig, name);

      // Check if score already exists for this user
      const existingScore = await tx.query.scores.findFirst({
        where: and(
          eq(scores.sessionItemId, itemId),
          eq(scores.name, name),
          eq(scores.createdBy, userPrincipal.session.user.id),
          isNull(scores.deletedAt)
        )
      });

      // delete
      if (value === null || value === undefined) {
        if (existingScore) {
          await deleteComment(tx, session, item, existingScore.commentId, userPrincipal.session.user, userPrincipal.organizationId);
          await tx.delete(scores)
            .where(eq(scores.id, existingScore.id));
        }
        else {
          // null value + non-existing score -> noop
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
          const commentMessage = await createComment(tx, session, item, userPrincipal.session.user, null, userPrincipal.organizationId);
          await tx.insert(scores).values({
            organizationId: userPrincipal.organizationId,
            sessionItemId: itemId,
            name,
            value,
            commentId: commentMessage.id,
            createdBy: userPrincipal.session.user.id,
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

  const { user, organization } = await withOrg(invitation.organizationId, async tx => {
    const user = await tx.query.users.findFirst({
      where: eq(users.email, invitation.email)
    })

    const organization = await tx.query.organizations.findFirst({
      where: eq(organizations.id, invitation.organizationId)
    })

    return {
      user,
      organization
    }
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
        // userId: true,
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

  return withOrg(principal.organizationId, async (tx) => {
    const environment = await getEnvironmentByPrincipal(tx, principal);
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
    console.log(error.issues)
    return c.json({ message: "Invalid config", code: 'parse.schema', details: error.issues }, 422);
  }

  return withOrg(principal.organizationId, async (tx) => {
    const environment = await getEnvironmentByPrincipal(tx, principal);

    // @ts-ignore
    if (environment && equalJSON(environment.config, data)) {
      return c.json(environment, 200)
    }

    const env = getEnv(principal);

    // Upsert: insert or update existing config for this user
    const [newEnvironment] = await tx.insert(environments).values({
      organizationId: principal.organizationId,
      userId: env.type === 'prod' ? null : env.memberId,
      config: data,
    })
    .onConflictDoUpdate({
      target: [environments.organizationId, environments.userId],
      set: {
        config: data,
      }
    })
    .returning()

    return c.json(newEnvironment, 200)
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


/* --------- GMAIL --------- */

import { gmailApp } from './gmail/index';
app.route('', gmailApp);

/* --------- CHANNELS --------- */

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
