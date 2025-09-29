import { and, eq, not } from "drizzle-orm";
import { db } from "./db"
import { sessionItems, sessions } from "./schemas/schema"
import type { Transaction } from "./types";

export async function fetchSessions(session_id?: string, tx?: Transaction) {
    const sessionRows = await (tx || db).query.sessions.findMany({
      where: session_id ? eq(sessions.id, session_id) : undefined,
      with: {
        client: true,
        // client: {
        //   with: {
        //     simulatedBy: true
        //   }
        // },
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

    return sessionRows;
  }
  
  export async function fetchSession(session_id: string, tx? : Transaction) {
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