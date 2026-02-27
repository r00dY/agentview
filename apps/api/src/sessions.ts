import { and, desc, eq } from "drizzle-orm";
import { endUsers, events, runs, sessionItems, sessions } from "./schemas/schema"
import type { Transaction } from "./types";
import { isUUID } from "./isUUID";
import type { Session } from "agentview/apiTypes";
import type { BaseChannelConfig } from "agentview/configTypes";
import { updateInboxes } from "./updateInboxes";
import { parseMetadata } from "./parseMetadata";

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


export async function fetchSession(tx: Transaction, session_id: string): Promise<Session | undefined> {
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

  const row = await tx.query.sessions.findFirst({
    where,
    with: {
      user: true,
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
          versionId: true,
        },
        orderBy: (run, { asc }) => [asc(run.createdAt)],
        with: {
          version: true,
          sessionItems: {
            orderBy: (sessionItem, { asc }) => [asc(sessionItem.sortOrder)],
            where: (sessionItem, { eq }) => eq(sessionItem.isState, false),
          }
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
    agent: row.agent,
    channel: row.channel,
    user: row.user,
    userId: row.user.id,
    space: row.user.space,
    runs: row.runs.filter((run, index) => run.status === "in_progress" || run.status === "completed" || index === row.runs.length - 1).map(run => ({
      ...run,
      version: run.version?.version,
    })),
    summary: row.summary,
    state,
    versions: row.versions ?? []
  } as Session;
}

export async function createSession(tx: Transaction, params: {
  organizationId: string;
  channelConfig: BaseChannelConfig;
  agentName: string;
  userId: string;
  metadata?: Record<string, any> | null;
  summary?: string | null;
  channelThreadId?: string | null;
  authorId?: string | null;
}): Promise<Session> {
  const metadata = parseMetadata(params.channelConfig.metadata, params.channelConfig.allowUnknownMetadata ?? true, params.metadata ?? {}, {});

  const user = await tx.query.endUsers.findFirst({
    where: eq(endUsers.id, params.userId),
  });
  if (!user) {
    throw new Error("[Internal Error] User not found");
  }
  const handleSuffix = user.createdBy ? "s" : "";

  const sessionWithHighestHandleNumber = await tx.query.sessions.findFirst({
    orderBy: (sessions, { desc }) => [desc(sessions.handleNumber)],
    where: eq(sessions.handleSuffix, handleSuffix),
  });

  const newHandleNumber = sessionWithHighestHandleNumber ? sessionWithHighestHandleNumber.handleNumber + 1 : 1;

  const [newSessionRow] = await tx.insert(sessions).values({
    organizationId: params.organizationId,
    handleNumber: newHandleNumber,
    handleSuffix,
    metadata,
    agent: params.agentName,
    channel: params.channelConfig.name,
    userId: params.userId,
    summary: params.summary ?? null,
    channelThreadId: params.channelThreadId ?? null,
  }).returning();

  const [event] = await tx.insert(events).values({
    organizationId: params.organizationId,
    type: 'session_created',
    authorId: params.authorId ?? null,
    payload: {
      session_id: newSessionRow.id,
    }
  }).returning();

  const newSession = await fetchSession(tx, newSessionRow.id);
  if (!newSession) {
    throw new Error("[Internal Error] Session not found");
  }

  await updateInboxes(tx, event, newSession, null);

  return newSession;
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
