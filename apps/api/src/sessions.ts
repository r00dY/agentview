import { AgentViewError } from "agentview";
import type { ChannelRef, Environment, SessionBase, SessionsGetQueryParams, SessionsGetQueryParamsSchema, SessionStatus, SessionUpdate, StandardSession, StandardSessionCreate } from "agentview/apiTypes";
import { randomBytes } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type z from "zod";
import { resolveAgentRef } from "./agentRefs";
import { authorize } from "./authMiddleware";
import { getConfigFromEnvironment, requireConfig, requireEnvironment } from "./environments";
import { isUUID, requireUUID } from "./isUUID";
import { parseMetadata } from "./parseMetadata";
import { endUsers, events, runs, sessionItems, sessions } from "./schemas/schema";
import type { Transaction } from "./types";
import { updateInboxes } from "./updateInboxes";
import { createUser, requireUser } from "./users";
import type { OrgTransaction, TenantTransaction } from "./withOrg";
import { requireAgentConfigByName, requireAgentConfigBySession } from "agentview/baseConfigUtils";

export type LastRunStatus = {
  id: string;
  status: string;
  updatedAt: string;
};

/**
 * Lightweight function to fetch only the last run's status and updatedAt.
 * Used for efficient polling in watchSession to detect changes without
 * fetching the full session with all relations.
 */
export async function fetchLastRunStatus(
  tx: Transaction,
  sessionId: string
): Promise<LastRunStatus | null> {
  const run = await tx.query.runs.findFirst({
    columns: {
      id: true,
      status: true,
      updatedAt: true,
    },
    where: eq(runs.sessionId, sessionId),
    orderBy: (runs, { desc }) => [desc(runs.createdAt)],
  });
  return run ?? null;
}

function sessionWhere(session_id: string) {
  let where: ReturnType<typeof eq> | undefined;

  if (isUUID(session_id)) { // id
    where = eq(sessions.id, session_id);
  }
  else { // handle
    const match = session_id.match(/^(\d+)(.*)$/);
    if (match) {
      const handleNumber = parseInt(match[1], 10);
      const handleSuffix = match[2] || "";

      where = and(eq(sessions.handleNumber, handleNumber), eq(sessions.handleSuffix, handleSuffix));
    }
    else {
      return undefined;
    }
  }

  return where;
}


export async function fetchSessionBase(tx: Transaction, session_id: string): Promise<SessionBase | undefined> {
  requireUUID(session_id);

  const where = sessionWhere(session_id);
  if (!where) {
    return undefined;
  }

  const row = await tx.query.sessions.findFirst({
    where,
    with: {
      user: true,
      agentRef: true,
    }
  });

  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    handle: row.handleNumber.toString() + (row.handleSuffix ?? ""),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata: row.metadata,
    channel: row.channelType === 'api'
      ? { type: 'api' as const, name: row.channelAddress }
      : { type: row.channelType, address: row.channelAddress },
    user: row.user,
    userId: row.user.id,
    space: row.user.space,
    summary: row.summary,
    agentRef: row.agentRef ?? null,
    agentRefs: row.agentRefs ?? [],
  } as SessionBase
}

export type FetchSessionOptions = {
  includeInitRun?: boolean;
  includePendingRun?: boolean;
  includeDiscardedRun?: boolean;
}

export async function fetchSession(tx: Transaction, session_id: string, options?: FetchSessionOptions): Promise<StandardSession | undefined> {
  const where = sessionWhere(session_id);
  if (!where) {
    return undefined;
  }

  const row = await tx.query.sessions.findFirst({
    where,
    with: {
      user: true,
      agentRef: true,
      runs: {
        columns: {
          id: true,
          createdAt: true,
          finishedAt: true,
          updatedAt: true,
          status: true,
          failReason: true,
          metadata: true,
          sessionId: true,
          agentRefId: true,
          manual: true,
        },
        orderBy: (run, { asc }) => [asc(run.createdAt)],
        with: {
          agentRef: true,
          sessionItems: {
            orderBy: (sessionItem, { asc }) => [asc(sessionItem.sortOrder)],
            where: (sessionItem, { eq }) => eq(sessionItem.isState, false),
          },
          channelMessages: {
            orderBy: (channelMessage, { asc }) => [asc(channelMessage.date)],
          },
        }
      }
    }
  });

  if (!row) {
    return undefined;
  }

  const state = await fetchSessionState(tx, row.id);

  return {
    id: row.id,
    handle: row.handleNumber.toString() + (row.handleSuffix ?? ""),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata: row.metadata,
    channel: row.channelType === 'api'
      ? { type: 'api' as const, name: row.channelAddress }
      : { type: row.channelType, address: row.channelAddress },
    user: row.user,
    userId: row.user.id,
    space: row.user.space,
    summary: row.summary,
    agentRef: row.agentRef ?? null,
    agentRefs: row.agentRefs ?? [],
    runs: row.runs
      .filter((run, index) => {
        if (run.status === "completed") {
          return true;
        }

        if (index === row.runs.length - 1) { // for last one
          if (run.status === "in_progress" || run.status === "cancelled" || run.status === "failed") {
            return true;
          }

          if (options?.includeInitRun && run.status === "init") {
            return true;
          }

          if (options?.includePendingRun && run.status === "pending") {
            return true;
          }

          if (options?.includeDiscardedRun && run.status === "discarded") {
            return true;
          }

        }
        return false;

      }) // we always send last run unless it's pending/init
      .map(run => ({
        ...run,
        // agentRef: run.agentRef ?? : null,
        sessionItems: run.sessionItems.map((item, index) => ({
          ...item,
          type: item.type ?? (index === 0 ? 'input' : 'step') // this condition is totally unimportant, just backward compat with nothing lol
        })),
      })),
    state: state ?? row.initialState ?? null,
  } as StandardSession;
}


export async function requireSession(tx: Transaction, sessionId: string, options?: FetchSessionOptions) {
  const session = await fetchSession(tx, sessionId, options)
  if (!session) {
    throw new AgentViewError("Session not found", 404);
  }

  return session
}

export async function requireSessionBase(tx: Transaction, sessionId: string, options?: FetchSessionOptions) {
  const session = await fetchSession(tx, sessionId, options);
  if (!session) {
    throw new AgentViewError("Session not found", 404);
  }
  return session
}

async function fetchSessionState(tx: Transaction, session_id: string) {
  // Fetch the latest __state__ session item by createdAt descending
  const stateItem = await tx.query.sessionItems.findFirst({
    where: and(eq(sessionItems.sessionId, session_id), eq(sessionItems.isState, true)),
    orderBy: (sessionItem, { desc }) => [desc(sessionItem.createdAt)],
  });

  if (!stateItem) {
    return null
  }

  return stateItem.content as any
}

export function getSessionStatusFields(session: StandardSession): { status: SessionStatus, failReason: any | null } {
  const lastRun = session.runs[session.runs.length - 1];
  const failReason = lastRun?.failReason;

  return {
    status: (!lastRun || lastRun.status === 'completed') ? 'idle' : (lastRun.status as SessionStatus),
    failReason
  }
}

/**
 * 
 * Lists
 * /
 * 
 * 
/**
 * SESSIONS
 */

const DEFAULT_LIMIT = 50
const DEFAULT_PAGE = 1

export function getSessionListFilter(tx: TenantTransaction, params: z.infer<typeof SessionsGetQueryParamsSchema>) {
  const { space, userId } = params;
  const principal = tx.principal;

  const filters: any[] = [
    eq(sessions.active, true),
  ]

  if (principal.type === 'member' || principal.type === 'apiKey') {

    if (!space && !userId) {
      throw new AgentViewError("You must set either `space` or `userId` to make this request.", 422);
    }
    if (space && userId) {
      throw new AgentViewError("You must set either `space` or `userId`, not both.", 422);
    }

    if (space) { // space
      filters.push(eq(endUsers.space, space));
    }

    if (userId) { // explicit user
      filters.push(eq(endUsers.id, userId));
    }

    if (space === "playground") {

      if (principal.type === 'member') {
        filters.push(eq(endUsers.ownerId, principal.session.user.id));
      }
      // else if (principal.type === 'apiKey') {
      //   filters.push(eq(endUsers.ownerId, principal.apiKey.userId));
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
    channel: row.sessions.channelType === 'api'
      ? { type: 'api' as const, name: row.sessions.channelAddress }
      : { type: row.sessions.channelType as "gmail" | "mock", address: row.sessions.channelAddress },
    user: row.end_users!,
    space: row.end_users!.space,
    userId: row.end_users!.id,
    agentRef: null, // not resolved in list view
    agentRefs: row.sessions.agentRefs ?? []
  };
}

export async function getSessions(tx: TenantTransaction, params: SessionsGetQueryParams) {
  const limit = normalizeNumberParam(params.limit, DEFAULT_LIMIT);
  const page = normalizeNumberParam(params.page, DEFAULT_PAGE);

  const MAX_LIMIT = 1000;
  if (limit > MAX_LIMIT) {
    throw new AgentViewError(`Page limit cannot exceed ${MAX_LIMIT}`, 422);
  }

  const offset = (page - 1) * limit;
  const baseFilter = getSessionListFilter(tx, params);

  // Build count query
  const countQuery = tx
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(sessions)
    .$dynamic();

  const totalCountResult = await countQuery
    .leftJoin(endUsers, eq(sessions.userId, endUsers.id))
    .where(baseFilter);

  const totalCount = totalCountResult[0]?.count ?? 0;

  // Build sessions query
  const sessionsQuery = tx
    .select({ sessions, end_users: endUsers })
    .from(sessions)
    .$dynamic();

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




/**
 * Mutations. Locks required.
 */


/**
 * Session creation
 * 
 * It's split into 2 phases:
 * 1. Create session without agent assigned (required for channels, where we must create the session, but agent assignment is postponed)
 * 2. Assign agent.
 * 
 * There's also a step: activate session, which can happen after 1., but not necessarily before 2.
 * 
 * ISSUE!!!
 * 
 * Right now for channel session there's no place where we can set metadata / initial state. They're by default undefined (so is session.agent)
 */

export type CreateSessionWithoutAgentBody = {
  userId?: string;
  summary?: string | null;
  channel: ChannelRef
  channelThreadId?: string | null;
}

export async function createSession(tx: TenantTransaction, params: CreateSessionWithoutAgentBody) {
  await tx.acquireLock({ type: "create_resource" });

  // find user or create new one if not found
  const user = await (async () => {
    if (params.userId) {
      return await requireUser(tx, { id: params.userId });
    }

    if (tx.principal.type === 'user') {
      return tx.principal.user;
    }

    throw new AgentViewError("Invalid request. You must provide `userId` or be authenticated as a user.", 422);

    // return await createUser(tx, { space: body.space, createdBy: body.createdBy });
  })()

  authorize(tx.principal, { action: "end-user:update", user });

  const [newSessionRow] = await tx.insert(sessions).values({
    organizationId: tx.organizationId,
    handleNumber: 0,
    handleSuffix: randomBytes(32).toString('hex'),
    channelType: params.channel.type,
    channelAddress: params.channel.type === 'api' ? params.channel.name : params.channel.address,
    userId: user.id,
    summary: params.summary ?? null,
    channelThreadId: params.channelThreadId ?? null,
    active: false
  }).returning();

  return newSessionRow;
}


export type SetAgentForSessionBody = {
  agent: string // obsolete for API sessions, this is already encoded in channel name
  metadata?: Record<string, any> | null;
  initialState?: any;
}

export async function setAgentForSession(tx: TenantTransaction, sessionId: string, body: SetAgentForSessionBody) {
  await tx.acquireLock({ type: "create_resource" });

  const session = await requireSessionBase(tx, sessionId);
  const config = await requireConfig(tx)

  const agentConfig = requireAgentConfigByName(config, body.agent);

  const metadata = parseMetadata(agentConfig.metadata, agentConfig.allowUnknownMetadata ?? true, body.metadata ?? {}, {});

  // const environment = await requireEnvironment(tx);

  // Resolve agent ref at session creation
  const agentRefWithId = await resolveAgentRef(tx, {
    agentRef: { version: agentConfig.version, agent: agentConfig.name, adapter: agentConfig.adapter },
  });

  const [updatedSession] = await tx.update(sessions).set({
    agentRefId: agentRefWithId.id,
    metadata: metadata,
    initialState: body.initialState,
  }).where(eq(sessions.id, session.id)).returning();

  return updatedSession;
}


// export async function createInactiveSession(tx: OrgTransaction, params: {
//   environment: Environment;
//   channelRef: ChannelRef;
//   userId: string;
//   metadata?: Record<string, any> | null;
//   summary?: string | null;
//   channelThreadId?: string | null;
//   agentRefId?: string | null;
//   initialState?: any;
// }) {
//   await tx.acquireLock({ type: "create_resource" });

//   const config = getConfigFromEnvironment(params.environment);
//   // const channelConfig = requireChannelConfig(config, params.channelRef);

//   let metadata: Record<string, any> = {};

//   if (params.channelRef.type === 'api') {
//     const agentConfig = requireAgentConfigByName(config, params.channelRef.name);
//     metadata = parseMetadata(agentConfig.metadata, agentConfig.allowUnknownMetadata ?? true, params.metadata ?? {}, {});
//   }

//   // const metadata: Record<string, any> = channelConfig.type === 'api' ?
//   //   parseMetadata(channelConfig.metadata, channelConfig.allowUnknownMetadata ?? true, params.metadata ?? {}, {}) :
//   //   {};

//   const user = await tx.query.endUsers.findFirst({
//     where: eq(endUsers.id, params.userId),
//   });
//   if (!user) {
//     throw new Error("[Internal Error] User not found");
//   }

//   const [newSessionRow] = await tx.insert(sessions).values({
//     organizationId: tx.organizationId,
//     handleNumber: 0,
//     handleSuffix: randomBytes(32).toString('hex'),
//     metadata,
//     channelType: params.channelRef.type,
//     channelAddress: params.channelRef.type === 'api' ? params.channelRef.name : params.channelRef.address,
//     userId: params.userId,
//     summary: params.summary ?? null,
//     channelThreadId: params.channelThreadId ?? null,
//     agentRefId: params.agentRefId ?? null,
//     initialState: params.initialState ?? null,
//     active: false
//   }).returning();

//   return newSessionRow;
// }

export async function activateSession(tx: OrgTransaction, sessionId: string, authorId?: string) {
  await tx.acquireLock({ type: "edit_session", sessionId });

  const session = await tx.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    with: {
      user: true,
    },
  });

  if (!session) {
    throw new Error("[Internal Error] Session not found");
  }

  if (session.active) {
    // log.info({ sessionId }, 'session already active');
    return;
  }

  // handle!
  // const handleSuffix = session.user.createdBy ? "s" : "";

  // const sessionWithHighestHandleNumber = await tx.query.sessions.findFirst({
  //   orderBy: (sessions, { desc }) => [desc(sessions.handleNumber)],
  //   where: and(eq(sessions.handleSuffix, handleSuffix), eq(sessions.active, true)),
  // });

  // const newHandleNumber = sessionWithHighestHandleNumber ? sessionWithHighestHandleNumber.handleNumber + 1 : 1;

  await tx.update(sessions).set({
    active: true,
    // handleNumber: newHandleNumber,
    // handleSuffix: handleSuffix,
  }).where(eq(sessions.id, session.id));

  // const [event] = await tx.insert(events).values({
  //   organizationId: tx.organizationId,
  //   type: 'session_created',
  //   authorId: session.createdBy ?? null,
  //   payload: {
  //     session_id: session.id,
  //   }
  // }).returning();

  // await updateInboxes(tx, event);
}

export async function updateSession(tx: TenantTransaction, session_id: string, body: SessionUpdate) {
  const session = await requireSessionBase(tx, session_id);

  authorize(tx.principal, { action: "end-user:update", user: session.user });

  const config = await requireConfig(tx)
  const agentConfig = requireAgentConfigBySession(config, session);

  const metadata = parseMetadata(agentConfig.metadata, agentConfig.allowUnknownMetadata, body.metadata, session.metadata);

  const [updatedSession] = await tx.update(sessions).set({
    metadata,
    summary: body.summary,
    updatedAt: new Date().toISOString(),
  }).where(eq(sessions.id, session_id)).returning();

  return updatedSession;
}