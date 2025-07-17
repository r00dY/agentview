import { redirect, useLoaderData, useFetcher, Outlet, Link, Form , data} from "react-router";
import type { Route } from "./+types/threads";
// import { auth } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { thread, activity, run } from "~/db/schema";
import { eq, ne, desc } from "drizzle-orm";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "~/components/ui/table";
import { Button } from "~/components/ui/button";
import { Plus } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Header, HeaderTitle } from "~/components/header";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { isUUID } from "~/lib/isUUID";
import { Textarea } from "~/components/ui/textarea";

export async function loader({ request, params }: Route.LoaderArgs) {

  const threadRows = await db.query.thread.findMany({
    with: {
      activities: true
    },
    orderBy: (thread, { desc }) => [desc(thread.updated_at)]
  })

  // const threadRows = await db
  //     .select({
  //       thread_id: thread.id,
  //       thread_created_at: thread.created_at,
  //       youngest_activity_created_at: activity.created_at
  //     })
  //     .from(thread)
  //     .innerJoin(activity, eq(thread.id, activity.thread_id))
  //     .orderBy(desc(activity.created_at))

  // redirect to the newest thread
  if (!params.id) {
    // // Find the thread with the youngest activity
    // const threadWithYoungestActivity = await db
    //   .select({
    //     thread_id: thread.id,
    //     thread_created_at: thread.created_at,
    //     youngest_activity_created_at: activity.created_at
    //   })
    //   .from(thread)
    //   .innerJoin(activity, eq(thread.id, activity.thread_id))
    //   .orderBy(desc(activity.created_at))
    //   .limit(1);

    // if (threadWithYoungestActivity.length === 0) {
    //   return redirect("/threads")
    // }

    return redirect(`/threads/${threadRows[0].id}`)
  }

  return {
    threads: threadRows,
    activeThreadId: params.id
  }

}


export default function Threads() {
  const { threads, activeThreadId } = useLoaderData<typeof loader>();

  return <div className="flex flex-row items-stretch h-full">

    <div className="basis-[335px] flex-shrink-0 flex-grow-0 border-r flex flex-col ">

      <Header className="px-3">
        <HeaderTitle title={`Threads`} />
      </Header>

      <div className="flex-1 overflow-y-auto">

        {threads.map((thread) => (
          <div key={thread.id}>
            <Link to={`/threads/${thread.id}`}>
              <div className={`p-3 border-b hover:bg-gray-50 transition-colors duration-50 ${thread.id === activeThreadId ? 'bg-gray-100' : ''}`}>
                <div className="flex flex-col gap-1">
                    <div className="text-sm font-medium">{thread.id}</div>
                    <div className="text-xs text-gray-500">
                      {thread.activities.length > 0 
                        ? thread.activities[0].created_at.toLocaleString()
                        : thread.updated_at.toLocaleString()
                      }
                    </div>
                </div>
              </div>
            </Link>
          </div>
        ))}
      </div>

    </div>

    <div className="flex-1 flex flex-col">  
      <Outlet />
    </div>

  </div>
}
