import { redirect, useLoaderData, useFetcher, Outlet, Link, Form, data, useParams, useSearchParams } from "react-router";
import type { Route } from "./+types/thread";
import { Button } from "~/components/ui/button";
import { Header, HeaderTitle } from "~/components/header";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { useEffect, useState } from "react";
import { parseSSE } from "~/lib/parseSSE";
import { db } from "~/lib/db.server";
import { auth } from "~/.server/auth";
import { ItemsWithCommentsLayout } from "~/components/ItemsWithCommentsLayout";
import { CommentThread } from "~/components/comments";


export async function loader({ request, params }: Route.LoaderArgs) {
    const response = await fetch(`http://localhost:2138/threads/${params.id}`, {
        headers: {
            'Content-Type': 'application/json',
        }
    });

    const threadData = await response.json()

    if (!response.ok) {
        throw data(threadData, { status: 400 })
    }

    // Get current user

    const session = await auth.api.getSession({ headers: request.headers });
    const userId = session?.user?.id || null;

    const users = await db.query.users.findMany({
        columns: {
            id: true,
            email: true,
            name: true,
        }
    })

    return data({
        thread: threadData,
        userId,
        users
    });
}



export default function ThreadPageWrapper() {
    const loaderData = useLoaderData<typeof loader>();
    return <ThreadPage key={loaderData.thread.id} />
}

function ActivityMessage({ activity, isWhite = false, selected = false, onClick = () => { } }: { activity: any, isWhite?: boolean, selected?: boolean, onClick?: () => void }) {
    return <div className={`border p-3 rounded-lg hover:border-gray-300 ${isWhite ? "bg-white" : "bg-muted"} ${selected ? "border-gray-300" : ""}`} onClick={onClick} data-item={true}>
        <div dangerouslySetInnerHTML={{ __html: (activity.content as unknown as string) }}></div>
    </div>
}

function ActivityView({ activity, onSelect, selected = false }: { activity: any, onSelect: (activity: any) => void, selected: boolean }) {
    return <div key={activity.id} className="relative">
        <div className={`relative flex flex-col ${activity.role === "user" ? "pl-[10%] justify-end" : "pr-[10%] justify-start"}`}>
            <div className="relative">

                <ActivityMessage activity={activity} isWhite={activity.role === "user"} selected={selected} onClick={() => onSelect(activity)} />

                {/* { selected && !activity.commentThread && <div className="absolute top-2 -right-[16px]">
                <Button variant="outline" size="icon" onClick={onNewComment}>
                    <MessageCirclePlusIcon className="w-[32px] h-[32px]" />
                </Button>
            </div>} */}
            </div>
        </div>
    </div>
}

function ThreadDetails({ thread }: { thread: any }) {
    return <Card>
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
                    <label className="text-sm font-medium text-muted-foreground">Agent</label>
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
                <div>
                    <label className="text-sm font-medium text-muted-foreground">Type</label>
                    <p className="text-sm">
                        { thread.client.simulatedBy ? "Simulated by " + thread.client.simulatedBy.name : "Real"}
                        {/* {thread.client.simulated_by ? "Simulated" : "Real"} */}
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
}

function ThreadPage() {
    const loaderData = useLoaderData<typeof loader>();

    const [thread, setThread] = useState(loaderData.thread)
    const [formError, setFormError] = useState<string | null>(null)
    const [isStreaming, setStreaming] = useState(false)

    const users = loaderData.users

    const [searchParams, setSearchParams] = useSearchParams();
    const selectedActivityId = thread.activities.find((a: any) => a.id === searchParams.get('activityId'))?.id ?? undefined;
    const setSelectedActivityId = (id: string | undefined) => {
        setSearchParams((searchParams) => {
            if (id) {
                searchParams.set("activityId", id);
            } else {
                searchParams.delete("activityId");
            }
            return searchParams;
        }, { replace: true });
    }

    // temporary 
    useEffect(() => {
        if (!isStreaming) {
            setThread(loaderData.thread)
        }
    }, [loaderData.thread])

    useEffect(() => {
        if (thread.state === 'in_progress') {

            (async () => {
                try {
                    const query = thread.activities.length > 0 ? `?last_activity_id=${thread.activities[thread.activities.length - 1].id}` : ''

                    const response = await fetch(`http://localhost:2138/threads/${thread.id}/watch${query}`, {
                        headers: {
                            'Content-Type': 'application/json',
                        }
                    });

                    setStreaming(true)

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
                } finally {
                    setStreaming(false)
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
                    setThread(payload)
                }
            } catch (error) {
                console.error(error)
                setFormError(error instanceof Error ? error.message : 'Unknown error')
            }
        }
    }

    const handleCancel = async () => {
        await fetch(`http://localhost:2138/threads/${thread.id}/cancel`, {
            method: 'POST',
        })
    }

    // const [selectedActivity, setSelectedActivity] = useState<any | null>(null)

    return <>
        <Header>
            <HeaderTitle title={`Thread`} />
        </Header>
        <div className="flex-1 overflow-y-auto">

            <div className=" p-6 max-w-4xl space-y-6">
                <ThreadDetails thread={thread} />

                <ItemsWithCommentsLayout items={thread.activities.map((activity) => {

                    const hasComments = activity.commentThread && activity.commentThread.commentMessages.filter((m: any) => !m.deletedAt).length > 0

                    return {
                        id: activity.id,
                        itemComponent: <ActivityView
                            activity={activity}
                            onSelect={(a) => setSelectedActivityId(a?.id)}
                            selected={selectedActivityId === activity.id}
                        />,
                        commentsComponent: (hasComments || (selectedActivityId === activity.id/* && isNewCommentActive*/)) ?
                            <CommentThread
                                activity={activity}
                                userId={loaderData.userId}
                                selected={selectedActivityId === activity.id}
                                users={users}
                                onSelect={(a) => setSelectedActivityId(a?.id)}
                                threadId={thread.id}
                            /> : undefined
                    }
                })} selectedItemId={selectedActivityId}
                />

                <div>
                    {thread.state === 'in_progress' && <div>in progress...</div>}
                    {thread.state === 'failed' && <div>failed</div>}
                </div>

            </div>

        </div>


        { thread.client.simulatedBy?.id === loaderData.userId && <Card>
            <CardHeader>
                <CardTitle>New Activity</CardTitle>
            </CardHeader>
            <CardContent>
                <form method="post" onSubmit={handleSubmit}>
                    <Textarea name="message" placeholder="Reply here..." />
                    <Button type="submit" disabled={thread.state === 'in_progress'}>Send</Button>


                    {thread.state === 'in_progress' && <Button type="button" onClick={() => {
                        handleCancel()
                    }}>Cancel</Button>}
                </form>

                {formError && <div className="text-red-500">{formError}</div>}

            </CardContent>
        </Card> }
    </>
}
