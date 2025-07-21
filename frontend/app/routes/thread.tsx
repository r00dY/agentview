import { redirect, useLoaderData, useFetcher, Outlet, Link, Form , data} from "react-router";
import type { Route } from "./+types/thread";
// import { auth } from "~/lib/auth.server";
// import { db } from "~/lib/db.server";
// import { thread, activity, run } from "~/db/schema";
// import { eq, ne } from "drizzle-orm";
// import {
//   Table,
//   TableHeader,
//   TableBody,
//   TableHead,
//   TableRow,
//   TableCell,
// } from "~/components/ui/table";
// import { Button } from "~/components/ui/button";
// import { Plus } from "lucide-react";
// import { Badge } from "~/components/ui/badge";
import { Header, HeaderTitle } from "~/components/header";
// import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
// import { isUUID } from "~/lib/isUUID";
// import { Textarea } from "~/components/ui/textarea";
import { useThread } from "~/hooks/useThread";

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
            thread_id: params.id
        });

    } catch (error) {
        return data({
            error: "Failed to fetch thread"
        }, { status: 400 })
    }

}

// export async function action({ request, params }: Route.ActionArgs) {
//     const formData = await request.formData();
//     const message = formData.get("message");

//     try {
//         const response = await fetch(`http://localhost:2138/threads/${params.id}/activities`, {
//             method: 'POST',
//             headers: {
//                 'Content-Type': 'application/json',
//             },
//             body: JSON.stringify({
//                 input: {
//                     type: "message",
//                     role: "user",
//                     content: message
//                 }
//             }),
//         });

//         const payload = await response.json()

//         if (!response.ok) {
//             return data(payload, { status: 400 })
//         }

//         return data(payload);

//     } catch (error) {
//         console.log(error);
//         return data({
//             error: "Failed to send message"
//         }, { status: 400 })
//     }
// }





export default function ThreadPage() {
  const { thread_id } = useLoaderData<typeof loader>();
//   const fetcher = useFetcher<typeof action>();

    const data = useThread(thread_id)

    console.log(data)

  return <>
    <Header>
      <HeaderTitle title={`Thread`} />
    </Header>

    { data.state === 'loading' && <div>Loading...</div>}
    { data.state === 'error' && <div>Error</div>}

    { data.state === 'success' && <div className="flex-1 overflow-y-auto">

      {/* <div className=" p-6 max-w-4xl space-y-6">
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

    </div> */}
    
    </div> }
  </>
}
