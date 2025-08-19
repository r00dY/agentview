import { eq } from "drizzle-orm";
import { db } from "./db"
import { thread } from "./db/schema"

export async function fetchThreads(thread_id?: string) {
    const threadRows = await db.query.thread.findMany({
      where: thread_id ? eq(thread.id, thread_id) : undefined,
      with: {
        client: {
          with: {
            simulatedBy: true
          }
        },
        runs: {
          orderBy: (run, { asc }) => [asc(run.created_at)],
          with: {
            version: true,
            activities: {
              orderBy: (activity, { asc }) => [asc(activity.created_at)],
              with: {
                commentMessages: {
                  orderBy: (commentMessages, { asc }) => [asc(commentMessages.createdAt)]
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
  
  export async function fetchThread(thread_id: string) {
    return (await fetchThreads(thread_id))[0]
  }