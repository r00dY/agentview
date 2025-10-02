import { and, eq, not } from "drizzle-orm";
import { db } from "./db"
import { sessionItems, sessions } from "./schemas/schema"
import type { Transaction } from "./types";
import { isUUID } from "./isUUID";

export async function fetchSessions(session_id?: string, tx?: Transaction) {

  const where = (() => {
    if (!session_id) {
      return undefined;
    }
    else if (isUUID(session_id)) { // id
      return eq(sessions.id, session_id);
    }
    else { // handle
      const match = session_id.match(/^(\d+)(.*)$/);
      if (match) {
        const handleNumber = parseInt(match[1], 10);
        const handleSuffix = match[2] || "";
        return and(
          eq(sessions.handleNumber, handleNumber),
          eq(sessions.handleSuffix, handleSuffix)
        );
      }
    }

  })();

  const sessionRows = await (tx || db).query.sessions.findMany({
    where,
    with: {
      client: true,
      runs: {
        orderBy: (run, { asc }) => [asc(run.createdAt)],
        with: {
          version: true,
          sessionItems: {
            orderBy: (sessionItem, { asc }) => [asc(sessionItem.createdAt)],
            where: (sessionItem, { ne }) => ne(sessionItem.type, "__state__"),
            with: {
              commentMessages: {
                orderBy: (commentMessages, { asc }) => [asc(commentMessages.createdAt)],
                with: {
                  scores: true
                }
              }
            }
          }
        }
      }
    }
  });

  return sessionRows.map((row) => ({
    id: row.id,
    handle: row.handleNumber.toString() + (row.handleSuffix ?? ""),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    context: row.context,
    agent: row.agent,
    clientId: row.clientId,
    client: row.client,
    runs: row.runs,
  }));
}

export async function fetchSession(session_id: string, tx?: Transaction) {
  const sessions = await fetchSessions(session_id, tx)

  if (sessions.length === 0) {
    return undefined;
  }

  return sessions[0]
}


export async function fetchSessionState(session_id: string, tx?: Transaction) {
  // Fetch the latest __state__ session item by createdAt descending
  const stateItem = await (tx || db).query.sessionItems.findFirst({
    where: and(eq(sessionItems.sessionId, session_id), eq(sessionItems.type, "__state__")),
    orderBy: (sessionItem, { desc }) => [desc(sessionItem.createdAt)],
  });

  if (!stateItem) {
    return null
  }

  return stateItem.content as any
}