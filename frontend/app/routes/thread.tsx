import { redirect, useLoaderData, useFetcher, Outlet, Link, Form , data} from "react-router";
import type { Route } from "./+types/thread";
import { Button } from "~/components/ui/button";
import { Header, HeaderTitle } from "~/components/header";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { useEffect, useRef, useState } from "react";

export async function loader({ request, params }: Route.LoaderArgs) {
    console.log('loader')
    
    const response = await fetch(`http://localhost:2138/threads/${params.id}`, {
        headers: {
            'Content-Type': 'application/json',
        }
    });

    const payload = await response.json()

    console.log('response.ok?', response.ok)
    console.log('payload', payload)

    if (!response.ok) {
        throw data(payload, { status: 400 })
    }

    return data({
        thread: payload.data,
    });
}

export default function  ThreadPageWrapper() {
    const loaderData = useLoaderData<typeof loader>();
    return <ThreadPage key={loaderData.thread.id} />
}


export async function* parseSSE(response: Response) {
    if (!response.body) throw new Error('No response body for SSE');
    if (!response.ok) throw new Error('Response not ok');
    
    const reader = response.body.getReader();
    let buffer = '';
    let done = false;
  
    // Helper to parse SSE events as an async generator
    async function* parseSSE(chunk: string) {
      const eventStrings = chunk.split("\n\n");
  
      for (const eventStr of eventStrings) {
        let eventType: string | undefined = undefined;
        let data : string = '';
  
        for (const line of eventStr.split('\n')) {
          if (line.startsWith('event:')) {
            eventType = line.replace('event:', '').trim();
          } else if (line.startsWith('data:')) {
            data += line.replace('data:', '').trim();
          }
        }
  
        if (eventType && data !== '') {
          yield { event: eventType, data: JSON.parse(data) };
          if (eventType === 'end') {
            done = true;
          }
        }
      }
    }
  
    while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += new TextDecoder().decode(value);
        let lastEventIdx = buffer.lastIndexOf('\n\n');
        if (lastEventIdx !== -1) {
            const eventsChunk = buffer.slice(0, lastEventIdx);
            for await (const event of parseSSE(eventsChunk)) {
            yield event;
            }
            buffer = buffer.slice(lastEventIdx + 2);
        }
    }
  }

  

function ThreadPage() {
    const loaderData = useLoaderData<typeof loader>();

    const [thread, setThread] = useState(loaderData.thread)
    const [formError, setFormError] = useState<string | null>(null)

    useEffect(() => {
        // let abortController : AbortController | undefined = undefined;

        if (thread.state === 'in_progress') {

            (async () => {
                try {
                    const query = thread.activities.length > 0 ? `?last_activity_id=${thread.activities[thread.activities.length - 1].id}` : ''
        
                    const response = await fetch(`http://localhost:2138/threads/${thread.id}/watch${query}`, {
                        headers: {
                            'Content-Type': 'application/json',
                        }
                    });
        
                    for await (const event of parseSSE(response)) {
                        if (event.event === 'activity') {
                            setThread(prevThread => {
                                const existingIdx = prevThread.activities.findIndex(a => a.id === event.data.id);
                                if (existingIdx === -1) {
                                    // New activity, append
                                    return { ...prevThread, activities: [...prevThread.activities, event.data] };
                                } else {
                                    // Existing activity, replace and remove all after
                                    return {
                                        ...prevThread,
                                        activities: [
                                            ...prevThread.activities.slice(0, existingIdx),
                                            event.data
                                        ]
                                    };
                                }
                            });
                        }
                        else if (event.event === 'thread.state') {
                            setThread(thread => ({ ...thread, state: event.data.state }))
                        }
                    }
        
                } catch (error) {
                    console.error(error)
                }
            })()
        }

    }, [thread.state])


    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()

        setFormError(null)

        const formData = new FormData(e.target as HTMLFormElement)
        const message = formData.get("message")
        
        if (message) {
            try {
                const response = await fetch(`http://localhost:2138/threads/${thread.id}/activities`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        input: {
                            type: "message",
                            role: "user",
                            content: message
                        }
                    })
                });
                
                const payload = await response.json()

                if (!response.ok) {
                    console.error(payload)
                    setFormError('response not ok') // FIXME: error format fucked up (Zod)
                }
                else {
                    console.log('activity pushed successfully')
                    setThread(payload.data)
                }
            } catch (error) {
                console.error(error)
                setFormError(error instanceof Error ? error.message : 'Unknown error')
            }
        }
    }

    const handleCancel = async () => {
        const response = await fetch(`http://localhost:2138/threads/${thread.id}/cancel`, {
            method: 'POST',
        })
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
            {thread.activities.map((activity) => { 
                return <div key={activity.id} className="relative">

                { activity.role === "user" && (<div className="pl-[25%] relative flex flex-col justify-end">
                    { activity.type === "message" && (<div className="border bg-muted p-3 rounded-lg">
                        <div dangerouslySetInnerHTML={{ __html: (activity.content as unknown as string) }}></div>
                        {/* <div className="text-xs text-muted-foreground">{activity.run.state}</div> */}
                    </div>)}
                    { activity.type !== "message" && (<div className="border bg-muted p-3 rounded-lg italic text-muted-foreground">no view</div>)}
                </div>)}
                
                { activity.role !== "user" && (<div className="pr-[25%] relative flex flex-col justify-start">
                    { activity.type === "message" && (<div className="border p-3 rounded-lg">
                        <div dangerouslySetInnerHTML={{ __html: (activity.content as unknown as string) }}></div>
                        {/* <div className="text-xs text-muted-foreground">{activity.run.state}</div> */}
                    </div>)}
                    { activity.type !== "message" && (<div className="border p-3 rounded-lg italic text-muted-foreground">no view</div>)}
                </div>)}
            </div>
             })}
        </div>

        <div>
            { thread.state === 'in_progress' && <div>in progress...</div>}
            { thread.state === 'failed' && <div>failed</div>}
        </div>


    </div>
    
    </div> 


    <Card>
            <CardHeader>
                <CardTitle>New Activity</CardTitle>
            </CardHeader>
            <CardContent>
                <form method="post" onSubmit={handleSubmit}>
                    <Textarea name="message" placeholder="Reply here..."/>
                    <Button type="submit" disabled={thread.state === 'in_progress'}>Send</Button>

                    
                        { thread.state === 'in_progress' && <Button type="button" onClick={() => {
                            handleCancel()
                    }}>Cancel</Button> }
                </form>

                { formError && <div className="text-red-500">{formError}</div> }

                {/* { fetcher.data?.error && (
                    <div className="text-red-500">{fetcher.data.error}</div>
                )} */}
                
            </CardContent>
        </Card>
  </>
}
