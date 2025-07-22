import { redirect, useLoaderData, useFetcher, Outlet, Link, Form , data} from "react-router";
import type { Route } from "./+types/thread";
import { Button } from "~/components/ui/button";
// import { Plus } from "lucide-react";
// import { Badge } from "~/components/ui/badge";
import { Header, HeaderTitle } from "~/components/header";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
// import { isUUID } from "~/lib/isUUID";
import { Textarea } from "~/components/ui/textarea";
import { sendActivity } from "~/hooks/useThread";
import { useState } from "react";

export async function loader({ request, params }: Route.LoaderArgs) {
    try {
        const response = await fetch(`http://localhost:2138/threads/${params.id}`, {
            headers: {
                'Content-Type': 'application/json',
            }
        });

        const payload = await response.json()

        if (!response.ok) {
            return data(payload, { status: 400 })
        }

        return data({
            thread: payload.data,
        });

    } catch (error) {
        return data({
            error: "Failed to fetch thread"
        }, { status: 400 })
    }
}

export default function  ThreadPageWrapper() {
    const loaderData = useLoaderData<typeof loader>();
    return <ThreadPage key={loaderData.thread.id} />
}



function ThreadPage() {
  const loaderData = useLoaderData<typeof loader>();

  const [thread, setThread] = useState(loaderData.thread)

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()

        const formData = new FormData(e.target as HTMLFormElement)
        const message = formData.get("message")
        
        if (message) {
            try {
                for await (const event of sendActivity(thread.id, { type: "message", role: "user", content: message })) {
                    if (event.event === 'activity') {
                        setThread(thread => ({ ...thread, activities: [...thread.activities, event.data] }))
                    }
                    else if (event.event === 'thread.state') {
                        setThread(thread => ({ ...thread, state: event.data.state }))
                    }
                }
            } catch (error) {
                console.error(error)
            }
        }
    }

  return <>
    <Header>
      <HeaderTitle title={`Thread`} />
    </Header>

   <div className="flex-1 overflow-y-auto">

      <div className=" p-6 max-w-4xl space-y-6">
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
            <div>
              <label className="text-sm font-medium text-muted-foreground">State</label>
              <p className="text-sm font-mono">{thread.state}</p>
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

        <div>
            { thread.state === 'in_progress' && <div>in progress...</div>}
            { thread.state === 'failed' && <div>failed</div>}
        </div>

        { (thread.state === 'idle' || thread.state === 'in_progress') && <Card>
            <CardHeader>
                <CardTitle>New Activity</CardTitle>
            </CardHeader>
            <CardContent>
                <form method="post" onSubmit={handleSubmit}>
                    <Textarea name="message" placeholder="Reply here..."/>
                    <Button type="submit" disabled={thread.state !== 'idle'}>Send</Button>
                </form>

                {/* { fetcher.data?.error && (
                    <div className="text-red-500">{fetcher.data.error}</div>
                )} */}
                
            </CardContent>
        </Card> }

    </div>
    
    </div> 
  </>
}
