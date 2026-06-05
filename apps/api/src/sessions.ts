import { AgentViewError } from "agentview";
import type { ChannelThread, Environment, SessionBase, SessionsGetQueryParams, SessionsGetQueryParamsSchema, SessionsPaginatedResponse, SessionStatus, SessionUpdate, StandardSession, StandardSessionCreate } from "agentview/apiTypes";
import { randomBytes } from "crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type z from "zod";
import { resolveAgentRef } from "./agentRefs";
import { authorize } from "./authMiddleware";
import { getConfigFromEnvironment, requireConfig, requireEnvironment } from "./environments";
import { isUUID, requireUUID } from "./isUUID";
import { log, setContext } from "./logger";
import { parseMetadata } from "./parseMetadata";
import { agentRefs, channels, channelThreads, endUsers, events, runs, sessionItems, sessions } from "./schemas/schema";
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
  return eq(sessions.id, session_id);
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
      channelThread: {
        columns: {
          channelId: true,
        },
        with: {
          channel: {
            columns: {
              id: true,
              type: true,
              address: true,
            },
          },
        }
      }
    }
  });

  if (!row) {
    return undefined;
  }

  const channel = row.channelThread?.channel ? {
    id: row.channelThread.channel.id,
    type: row.channelThread.channel.type,
    address: row.channelThread.channel.address,
  } : null;

  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata: row.metadata,
    user: row.user,
    userId: row.user.id,
    title: row.title,
    agent: row.agentRef ? {
      name: row.agentRef.agent,
      version: row.agentRef.version,
      adapter: row.agentRef.adapter,
    } : null,
    active: row.active,
    channelThreadId: row.channelThreadId,
    channel
  } as SessionBase
}

export type FetchSessionOptions = {
  branchRunId?: string; // inactive run id that is BRANCH.
}

export async function fetchSession(tx: Transaction, session_id: string, options?: FetchSessionOptions): Promise<StandardSession | undefined> {
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
      runs: {
        columns: {
          id: true,
          createdAt: true,
          finishedAt: true,
          updatedAt: true,
          status: true,
          reason: true,
          metadata: true,
          sessionId: true,
          manual: true,
          active: true,
          previousRunId: true,
        },
        orderBy: (run, { asc }) => [asc(run.createdAt)],
        with: {
          agentRef: true,
          sessionItems: {
            orderBy: (sessionItem, { asc }) => [asc(sessionItem.sortOrder)],
            where: (sessionItem, { eq }) => eq(sessionItem.isState, false),
          },
        }
      },
      channelThread: {
        with: {
          channel: true,
          messages: {
            orderBy: (channelMessage, { asc }) => [asc(channelMessage.date)],
          },
        },
      },
    }
  });

  if (!row) {
    return undefined;
  }


  /**
   * Handle runs - build the correct lineage.
   * Default: all active runs (the main line).
   * branchRunId: trace from that run back via previousRunId to build the branch.
   */
  const activeRuns = (() => {
    if (!options?.branchRunId) {
      return row.runs.filter(r => r.active);
    }

    // Build branch by walking previousRunId chain
    const runsById = new Map(row.runs.map(r => [r.id, r]));
    const chain: typeof row.runs = [];
    let current = runsById.get(options.branchRunId);
    while (current) {
      chain.unshift(current);
      current = current.previousRunId ? runsById.get(current.previousRunId) : undefined;
    }
    return chain;
  })();

  const state = await fetchSessionState(tx, row.id, activeRuns.map(r => r.id));

  const channelThread: ChannelThread | null = row.channelThread ? {
    id: row.channelThread.id,
    sourceThreadId: row.channelThread.sourceThreadId,
    messages: row.channelThread.messages,
  } : null;

  const channel = row.channelThread?.channel ? {
    id: row.channelThread.channel.id,
    type: row.channelThread.channel.type,
    address: row.channelThread.channel.address,
  } : null;

  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata: row.metadata,
    user: row.user,
    userId: row.user.id,
    title: row.title,
    active: row.active,
    agent: row.agentRef ? {
      name: row.agentRef.agent,
      version: row.agentRef.version,
      adapter: row.agentRef.adapter,
    } : null,
    runs: activeRuns
      .filter((run, index) => {
        return true;

        if (run.status === "completed") {
          return true;
        }

        if (index === activeRuns.length - 1) { // for last one
          if (run.status === "in_progress" || run.status === "cancelled" || run.status === "failed") {
            return true;
          }
        }
        return false;
      }) // we always send last run unless it's pending/init
      .map(run => {
        const { previousRunId, agentRef, ...rest } = run;
        return {
          ...rest,
          agent: agentRef ? {
            name: agentRef.agent,
            version: agentRef.version,
            adapter: agentRef.adapter,
          } : null,
        }
      }),
    state: state ?? row.initialState ?? null,
    channelThreadId: row.channelThreadId,
    channelThread,
    channel,
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

async function fetchSessionState(tx: Transaction, session_id: string, activeRunIds: string[]) {
  if (activeRunIds.length === 0) return null;

  // Fetch the latest state item scoped to the active run lineage
  const result = await tx
    .select({ content: sessionItems.content })
    .from(sessionItems)
    .where(and(
      eq(sessionItems.sessionId, session_id),
      eq(sessionItems.isState, true),
      inArray(sessionItems.runId, activeRunIds),
    ))
    .orderBy(desc(sessionItems.createdAt))
    .limit(1);

  return result[0]?.content as any ?? null;
}

export function getSessionStatusFields(session: StandardSession): { status: SessionStatus, reason: any | null } {
  const lastRun = session.runs[session.runs.length - 1];
  const reason = lastRun?.reason;

  return {
    status: (!lastRun || lastRun.status === 'completed') ? 'idle' : (lastRun.status as SessionStatus),
    reason
  }
}

// Takes into account "connecting" phase.
export async function getCurrentlyStreamingOrConnectingRun(tx: Transaction, sessionId: string) {
  return await tx.query.runs.findFirst({
    where: and(eq(runs.sessionId, sessionId), eq(runs.status, 'in_progress')),
  });
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
  const { space, userId, shared, ownerId } = params;
  const principal = tx.principal;

  const filters: any[] = [
    eq(sessions.active, true),
  ]

  // Resolve ownerId once for all principal branches
  let resolvedOwnerId: string | undefined = ownerId;
  if (ownerId !== undefined) {
    if (space !== 'playground') {
      throw new AgentViewError("`ownerId` filter is only allowed when `space` is 'playground'.", 422);
    }
    if (ownerId === 'me') {
      if (principal.type !== 'member') {
        throw new AgentViewError("`ownerId=me` is only allowed for member principals.", 422);
      }
      resolvedOwnerId = principal.session.user.id;
    }
  }

  if (principal.type === 'member' || principal.type === 'apiKey') {

    if (space) {
      filters.push(eq(endUsers.space, space));
    }

    if (userId) {
      filters.push(eq(endUsers.id, userId));
    }

    if (shared !== undefined) {
      filters.push(eq(endUsers.shared, shared));
    }

    if (resolvedOwnerId !== undefined) {
      filters.push(eq(endUsers.ownerId, resolvedOwnerId));
    }

    // Members can only see playground users they own or that are shared. Combined with
    // an optional shared filter above, this gives the expected behavior:
    //  - no shared filter → own + all shared
    //  - shared=true → all shared
    //  - shared=false → only own non-shared
    // if (space === "playground" && principal.type === 'member') {
    //   filters.push(or(eq(endUsers.ownerId, principal.session.user.id), eq(endUsers.shared, true))!);
    // }

    if (principal.type === 'member') {
      filters.push(or(
        eq(endUsers.space, 'production'),
        and(eq(endUsers.space, 'playground'), eq(endUsers.ownerId, principal.session.user.id)),
        and(eq(endUsers.space, 'playground'), eq(endUsers.shared, true)),
      ))
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

function mapSessionRow(row: {
  sessions: typeof sessions.$inferSelect;
  end_users: typeof endUsers.$inferSelect | null;
  agent_refs: typeof agentRefs.$inferSelect | null;
  channels: typeof channels.$inferSelect | null;
}): SessionBase {
  return {
    id: row.sessions.id,
    createdAt: row.sessions.createdAt,
    updatedAt: row.sessions.updatedAt,
    metadata: row.sessions.metadata as Record<string, any>,
    title: row.sessions.title,
    user: row.end_users!,
    userId: row.end_users!.id,
    agent: row.agent_refs ? {
      name: row.agent_refs.agent,
      version: row.agent_refs.version,
      adapter: row.agent_refs.adapter,
    } : null,
    active: row.sessions.active,
    channelThreadId: row.sessions.channelThreadId,
    channel: row.channels ? {
      id: row.channels.id,
      type: row.channels.type,
      address: row.channels.address,
    } : null,
  };
}

export async function getSessions(tx: TenantTransaction, params: SessionsGetQueryParams): Promise<SessionsPaginatedResponse> {
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
    .select({ sessions, end_users: endUsers, agent_refs: agentRefs, channels })
    .from(sessions)
    .$dynamic();

  const result = await sessionsQuery
    .leftJoin(endUsers, eq(sessions.userId, endUsers.id))
    .leftJoin(agentRefs, eq(sessions.agentRefId, agentRefs.id))
    .leftJoin(channelThreads, eq(sessions.channelThreadId, channelThreads.id))
    .leftJoin(channels, eq(channelThreads.channelId, channels.id))
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
  id?: string;
  userId?: string;
  title?: string | null;
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
    ...(params.id ? { id: params.id } : {}),
    organizationId: tx.organizationId,
    userId: user.id,
    title: params.title ?? null,
    channelThreadId: params.channelThreadId ?? null,
    active: false
  }).returning();

  setContext({ sessionId: newSessionRow.id });
  log.info({ userId: user.id, channelThreadId: params.channelThreadId ?? null }, 'session created');

  return newSessionRow;
}


export type SetAgentForSessionBody = {
  agent: string // obsolete for API sessions, this is already encoded in channel name
  metadata?: Record<string, any> | null;
  initialState?: any;
}

export async function setAgentForSession(tx: TenantTransaction, sessionId: string, body: SetAgentForSessionBody) {
  setContext({ sessionId });
  await tx.acquireLock({ type: "edit_session", sessionId });

  const session = await requireSessionBase(tx, sessionId);
  const config = await requireConfig(tx)

  const agentConfig = requireAgentConfigByName(config, body.agent);

  const metadata = parseMetadata(agentConfig.metadata, agentConfig.allowUnknownMetadata ?? true, body.metadata ?? {}, {});

  // const environment = await requireEnvironment(tx);

  // Resolve agent ref at session creation
  const agentRefWithId = await resolveAgentRef(tx, {
    agentRef: { version: agentConfig.version, name: agentConfig.name, adapter: agentConfig.adapter },
  });

  const [updatedSession] = await tx.update(sessions).set({
    agentRefId: agentRefWithId.id,
    metadata: metadata,
    initialState: body.initialState,
  }).where(eq(sessions.id, session.id)).returning();

  log.info({ agent: body.agent, agentRefId: agentRefWithId.id }, 'agent assigned to session');

  return updatedSession;
}

export async function activateSession(tx: OrgTransaction, sessionId: string, authorId?: string) {
  setContext({ sessionId });
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
    return;
  }

  await tx.update(sessions).set({
    active: true,
  }).where(eq(sessions.id, session.id));

  const [event] = await tx.insert(events).values({
    organizationId: tx.organizationId,
    type: 'session_created',
    authorId: authorId ?? null,
    payload: {
      session_id: session.id,
    }
  }).returning();

  await updateInboxes(tx, event);

  log.info({ authorId: authorId ?? null }, 'session activated');
}

export async function updateSession(tx: TenantTransaction, session_id: string, body: SessionUpdate) {
  setContext({ sessionId: session_id });
  await tx.acquireLock({ type: "edit_session", sessionId: session_id });

  const session = await requireSessionBase(tx, session_id);

  authorize(tx.principal, { action: "end-user:update", user: session.user });

  const config = await requireConfig(tx)
  const agentConfig = requireAgentConfigBySession(config, session);

  const metadata = parseMetadata(agentConfig.metadata, agentConfig.allowUnknownMetadata, body.metadata, session.metadata);

  const [updatedSession] = await tx.update(sessions).set({
    metadata,
    title: body.title,
    updatedAt: new Date().toISOString(),
  }).where(eq(sessions.id, session_id)).returning();

  const changed = Object.keys(body).filter(k => body[k as keyof typeof body] !== undefined);
  log.info({ changed }, 'session updated');

  return updatedSession;
}