import { and, desc, eq } from "drizzle-orm";
import { endUsers, events, runs, sessionItems, sessions } from "./schemas/schema"
import type { Transaction } from "./types";
import { isUUID, requireUUID } from "./isUUID";
import type { ChannelRef, Environment, SessionBase, StandardSession } from "agentview/apiTypes";
import { updateInboxes } from "./updateInboxes";
import { parseMetadata } from "./parseMetadata";
import { requireChannelConfig } from "agentview/baseConfigUtils";
import { getConfigFromEnvironment } from "./environments";
import type { SessionStatus } from "agentview/apiTypes";
import type { OrgTransaction } from "./withOrg";
import { randomBytes } from "crypto";
import { AgentViewError } from "agentview";

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
  let where : ReturnType<typeof eq> | undefined;

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


export async function fetchSession(tx: Transaction, session_id: string, options?: { includeInitRun?: boolean }): Promise<StandardSession | undefined> {
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


export async function requireSession(tx: Transaction, sessionId: string) {
  const session = await fetchSession(tx, sessionId)
  if (!session) {
    throw new AgentViewError("Session not found", 404);
  }

  return session
}

export async function requireSessionBase(tx: Transaction, sessionId: string) {
  const session = await fetchSessionBase(tx, sessionId);
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

export function getSessionStatusFields(session: StandardSession) : { status: SessionStatus, failReason: any | null } {
  const lastRun = session.runs[session.runs.length - 1];
  const failReason = lastRun?.failReason;

  return {
    status: (!lastRun || lastRun.status === 'completed') ? 'idle' : (lastRun.status as SessionStatus),
    failReason
  }
}


/**
 * Mutations. Locks required.
 */

export async function createInactiveSession(tx: OrgTransaction, params: {
  environment: Environment;
  channelRef: ChannelRef;
  userId: string;
  metadata?: Record<string, any> | null;
  summary?: string | null;
  channelThreadId?: string | null;
  agentRefId?: string | null;
  initialState?: any;
  createdBy?: string | null;
}) {
  await tx.acquireLock({ type: "create_resource" });

  const config = getConfigFromEnvironment(params.environment);
  const channelConfig = requireChannelConfig(config, params.channelRef);

  const metadata : Record<string, any> = channelConfig.type === 'api' ? 
    parseMetadata(channelConfig.metadata, channelConfig.allowUnknownMetadata ?? true, params.metadata ?? {}, {}) : 
    {};

  const user = await tx.query.endUsers.findFirst({
    where: eq(endUsers.id, params.userId),
  });
  if (!user) {
    throw new Error("[Internal Error] User not found");
  }

  const [newSessionRow] = await tx.insert(sessions).values({
    organizationId: tx.organizationId,
    handleNumber: 0,
    handleSuffix: randomBytes(32).toString('hex'),
    metadata,
    channelType: params.channelRef.type,
    channelAddress: params.channelRef.type === 'api' ? params.channelRef.name : params.channelRef.address,
    userId: params.userId,
    summary: params.summary ?? null,
    channelThreadId: params.channelThreadId ?? null,
    agentRefId: params.agentRefId ?? null,
    initialState: params.initialState ?? null,
    createdBy: params.createdBy ?? null,
    active: false
  }).returning();

  return newSessionRow;
}

export async function activateSession(tx: OrgTransaction, sessionId: string) {
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
    console.log(`[activateSession][${sessionId}] Session is already active`);
    return;
  }

  // handle!
  const handleSuffix = session.user.createdBy ? "s" : "";

  const sessionWithHighestHandleNumber = await tx.query.sessions.findFirst({
    orderBy: (sessions, { desc }) => [desc(sessions.handleNumber)],
    where: and(eq(sessions.handleSuffix, handleSuffix), eq(sessions.active, true)),
  });

  const newHandleNumber = sessionWithHighestHandleNumber ? sessionWithHighestHandleNumber.handleNumber + 1 : 1;

  await tx.update(sessions).set({
    active: true,
    handleNumber: newHandleNumber,
    handleSuffix: handleSuffix,
  }).where(eq(sessions.id, session.id));

  const [event] = await tx.insert(events).values({
    organizationId: tx.organizationId,
    type: 'session_created',
    authorId: session.createdBy ?? null,
    payload: {
      session_id: session.id,
    }
  }).returning();

  await updateInboxes(tx, event);
}