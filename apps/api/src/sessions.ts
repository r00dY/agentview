import { eq } from "drizzle-orm";
import { db } from "./db"
import { sessions } from "./schemas/schema"
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
          orderBy: (run, { asc }) => [asc(run.created_at)],
          with: {
            version: true,
            sessionItems: {
              orderBy: (sessionItem, { asc }) => [asc(sessionItem.created_at)],
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
  
  export async function fetchSession(thread_id: string, tx? : Transaction) {
    const threads = await fetchSessions(thread_id, tx)

    if (threads.length === 0) {
      return undefined;
    }

    return threads[0]
  }