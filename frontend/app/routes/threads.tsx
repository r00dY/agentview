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


  if (!params.id) {
    // Find the thread with the youngest activity
    const threadWithYoungestActivity = await db
      .select({
        thread_id: thread.id,
        thread_created_at: thread.created_at,
        youngest_activity_created_at: activity.created_at
      })
      .from(thread)
      .innerJoin(activity, eq(thread.id, activity.thread_id))
      .orderBy(desc(activity.created_at))
      .limit(1);

    if (threadWithYoungestActivity.length === 0) {
      return redirect("/threads")
    }

    return redirect(`/threads/${threadWithYoungestActivity[0].thread_id}`)
  }

  


  return {
    threads: []
  }

}


export default function Threads() {
  const data = useLoaderData<typeof loader>();

  return <div className="flex flex-row items-stretch h-full">

    <div className="basis-[320px] flex-shrink-0 flex-grow-0 border-r flex flex-col ">

      <Header>
        <HeaderTitle title={`Threads`} />
      </Header>

      <div className="flex-1 overflow-y-auto">
        {Array.from({ length: 100 }).map((_, i) => (
          <div key={i}>Lorem ipsum</div>
        ))}
      </div>

    </div>

    <div className="flex-1 flex flex-col">  
      <Outlet />
    </div>

  </div>
}
