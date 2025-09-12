import { eq } from "drizzle-orm";
import { db } from "./db"
import { thread } from "./schemas/schema"
import type { Transaction } from "./types";

export async function fetchThreads(thread_id?: string, tx?: Transaction) {
    const threadRows = await (tx || db).query.thread.findMany({
      where: thread_id ? eq(thread.id, thread_id) : undefined,
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
            activities: {
              orderBy: (activity, { asc }) => [asc(activity.created_at)],
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

    return threadRows;
  
    // return threadRows.map((threadRow) => ({
    //   ...threadRow,
    //   runs: threadRow.runs.filter((run, index) => run.state === 'completed' || index === threadRow.runs.length - 1), // last run & completed ones
    // }))
  }
  
  export async function fetchThread(thread_id: string, tx? : Transaction) {
    const threads = await fetchThreads(thread_id, tx)

    if (threads.length === 0) {
      return undefined;
    }

    return threads[0]
  }