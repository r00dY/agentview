import { redirect, useLoaderData, useFetcher, Outlet, Link, Form , data} from "react-router";
import type { Route } from "./+types/thread";
// import { auth } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { thread, activity, run } from "~/db/schema";
import { eq, ne } from "drizzle-orm";
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
    if (!isUUID(params.id)) {
        throw new Response("Thread not found", { status: 404 });
    }

  // Get the thread with its related activities and runs
  const threadRow = await db.query.thread.findFirst({
    where: eq(thread.id, params.id),
    with: {
      activities: {
        orderBy: (activity, { asc }) => [asc(activity.created_at)]
      },
      runs: {
        where: ne(run.state, 'completed')
      }
    }
  });

  if (!threadRow) {
    throw new Response("Thread not found", { status: 404 });
  }

  return { thread: threadRow, activeRun: threadRow.runs.length > 0 ? threadRow.runs[0] : null };
}

export async function action({ request, params }: Route.ActionArgs) {
    const formData = await request.formData();
    const message = formData.get("message");

    try {
        const response = await fetch(`http://localhost:2138/threads/${params.id}/activities`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                type: "message",
                role: "user",
                content: message
            }),
        });

        const payload = await response.json()

        if (!response.ok) {
            return data(payload, { status: 400 })
        }

        return data(payload);

    } catch (error) {
        console.log(error);
        return data({
            error: "Failed to send message"
        }, { status: 400 })
    }
}


export default function ThreadPage() {
  const { thread, activeRun } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  console.log('fetcher.data', fetcher.data)
    
  return <div className="flex-1 overflow-y-auto">
    <Header>
      <HeaderTitle title={`Thread`} />
    </Header>

    <div className="p-6 max-w-4xl space-y-6 ">
      {/* Thread Details */}
      <Card>
        <CardHeader>
          <CardTitle>Thread Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">ID</label>
              <p className="text-sm font-mono">{thread.id}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Type</label>
              <p className="text-sm">{thread.type}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Client ID</label>
              <p className="text-sm font-mono">{thread.client_id}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Created</label>
              <p className="text-sm">
                {new Date(thread.created_at).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </div>
            {thread.metadata && (
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-muted-foreground">Metadata</label>
                <pre className="text-sm bg-muted p-2 rounded mt-1 overflow-x-auto">
                  {JSON.stringify(thread.metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </CardContent>
      </Card>



        <div className="space-y-6 mt-12">
            {thread.activities.map((activity) => (
            <div key={activity.id} className="relative">

                { activity.role === "user" && (<div className="pl-[25%] relative flex flex-col justify-end">
                    { activity.type === "message" && (<div className="border bg-muted p-3 rounded-lg" dangerouslySetInnerHTML={{ __html: (activity.content as unknown as string) }}></div>)}
                    { activity.type !== "message" && (<div className="border bg-muted p-3 rounded-lg italic text-muted-foreground">no view</div>)}
                </div>)}
                
                { activity.role !== "user" && (<div className="pr-[25%] relative flex flex-col justify-start">
                    { activity.type === "message" && (<div className="border p-3 rounded-lg" dangerouslySetInnerHTML={{ __html: (activity.content as unknown as string) }}></div>)}
                    { activity.type !== "message" && (<div className="border p-3 rounded-lg italic text-muted-foreground">no view</div>)}
                </div>)}
            </div>
            ))}
        </div>

        {/* <Badge>
            { activeRun ? activeRun.state : "idle"}
        </Badge> */}

        <Card>
            <CardHeader>
                <CardTitle>New Activity</CardTitle>
            </CardHeader>
            <CardContent>
                <fetcher.Form method="post">
                    <Textarea name="message" placeholder="Reply here..."/>
                    <Button type="submit" disabled={fetcher.state !== 'idle'}>Send</Button>
                </fetcher.Form>

                { fetcher.data?.error && (
                    <div className="text-red-500">{fetcher.data.error}</div>
                )}
                
            </CardContent>
        </Card>

      {/* Runs */}
      {/* <Card>
        <CardHeader>
          <CardTitle>Runs ({thread.runs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {thread.runs.length > 0 ? (
            <div className="space-y-4">
              {thread.runs.map((run) => (
                <div key={run.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={run.state === 'completed' ? 'default' : 'secondary'}>
                        {run.state}
                      </Badge>
                      <span className="text-sm font-mono">{run.id}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(run.created_at).toLocaleString()}
                    </span>
                  </div>
                  {run.finished_at && (
                    <p className="text-xs text-muted-foreground">
                      Finished: {new Date(run.finished_at).toLocaleString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No runs yet.</p>
          )}
        </CardContent>
      </Card> */}
    </div>
  </div>
}
