import { redirect, useLoaderData, useFetcher, Outlet, Link, Form, data, useParams, useSearchParams } from "react-router";
import type { Route } from "./+types/thread";
import { Button } from "~/components/ui/button";
import { Header, HeaderTitle } from "~/components/header";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { useEffect, useState } from "react";
import { parseSSE } from "~/lib/parseSSE";
import { authClient } from "~/lib/auth-client";
import { apiFetch } from "~/lib/apiFetch";
import { ItemsWithCommentsLayout } from "~/components/ItemsWithCommentsLayout";
import { CommentThread } from "~/components/comments";
import { getAPIBaseUrl } from "~/lib/getAPIBaseUrl";
import { getLastRun, getAllActivities, getVersions } from "~/lib/threadUtils";
import { type Thread } from "~/apiTypes";

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
    const response = await apiFetch<Thread>(`/api/threads/${params.id}`);

    if (!response.ok) {
        throw data(response.error, { status: response.status })
    }

    // Get current user
    const session = await authClient.getSession();
    const userId = session.data!.user!.id;

    // Get users for comments
    const usersResponse = await apiFetch('/api/members');

    if (!usersResponse.ok) {
        throw data(usersResponse.error, {
            status: usersResponse.status,
        });
    }

    return {
        thread: response.data,
        userId,
        users: usersResponse.data
    };
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
    const versions = getVersions(thread)

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
                    <label className="text-sm font-medium text-muted-foreground">Source</label>
                    <p className="text-sm">
                        {thread.client.simulatedBy ? "Simulated by " + thread.client.simulatedBy.name : "Real"}
                        {/* {thread.client.simulated_by ? "Simulated" : "Real"} */}
                    </p>
                </div>

                <div>
                    <label className="text-sm font-medium text-muted-foreground">State</label>
                    <p className="text-sm font-mono">{thread.lastRun?.state === "completed" ? "idle" : (thread.lastRun?.state ?? "idle")}</p>
                </div>

                <div>
                    <label className="text-sm font-medium text-muted-foreground">{ versions.length > 1 ? "Versions" : "Version"}</label>
                    <p className="text-sm font-mono">{versions.map(version => version.version + "." + version.env).join(", ")}</p>
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
}

export default function ThreadPageWrapper() {
    const loaderData = useLoaderData<typeof clientLoader>();
    return <ThreadPage key={loaderData.thread.id} />
}

function ThreadPage() {
    const loaderData = useLoaderData<typeof clientLoader>();

    console.log(loaderData.thread)

    const [thread, setThread] = useState(loaderData.thread)
    const [formError, setFormError] = useState<string | null>(null)
    const [isStreaming, setStreaming] = useState(false)

    const users = loaderData.users

    const [searchParams, setSearchParams] = useSearchParams();
    const activities = getAllActivities(thread)
    const activeActivities = getAllActivities(thread, { activeOnly: true })
    const lastRun = getLastRun(thread)
    const selectedActivityId = activities.find((a: any) => a.id === searchParams.get('activityId'))?.id ?? undefined;

    console.log('thread', thread)

    const setSelectedActivityId = (id: string | undefined) => {
        if (id === selectedActivityId) {
            return // prevents unnecessary revalidation of the page
        }

        setSearchParams((searchParams) => {
            const currentActivityId = searchParams.get('activityId') ?? undefined;

            if (currentActivityId === id) {
                return searchParams;
            }

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
        if (lastRun?.state === 'in_progress') {

            (async () => {
                try {
                    const response = await fetch(`${getAPIBaseUrl()}/api/threads/${thread.id}/watch_run`, {
                        headers: {
                            'Content-Type': 'application/json',
                        }
                    });

                    setStreaming(true)

                    for await (const event of parseSSE(response)) {


                        setThread((currentThread) => {
                            const lastRun = getLastRun(currentThread);
                            if (!lastRun) { throw new Error("Unreachable: Last run not found") };

                            let newRun: typeof lastRun;

                            if (event.event === 'activity') {
                                const newActivity = event.data;
                                const newActivityIndex = lastRun.activities.findIndex((a: any) => a.id === newActivity.id);

                                newRun = {
                                    ...lastRun,
                                    activities: newActivityIndex === -1 ?
                                        [...lastRun.activities, newActivity] : [
                                            ...lastRun.activities.slice(0, newActivityIndex),
                                            newActivity
                                        ]
                                }
                            }
                            else if (event.event === 'state') {
                                newRun = {
                                    ...lastRun,
                                    ...event.data
                                }
                            }

                            return {
                                ...currentThread,
                                runs: currentThread.runs.map((run: any) =>
                                    run.id === lastRun.id ? newRun : run
                                )
                            }

                        })

                    }

                } catch (error) {
                    console.error(error)
                } finally {
                    setStreaming(false)
                }
            })()
        }

    }, [lastRun?.state])


    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()

        setFormError(null)

        const formData = new FormData(e.target as HTMLFormElement)
        const message = formData.get("message")

        if (message) {
            try {
                const response = await apiFetch(`/api/threads/${thread.id}/runs`, {
                    method: 'POST',
                    body: {
                        input: {
                            type: "message",
                            role: "user",
                            content: message
                        }
                    }
                });

                if (!response.ok) {
                    console.error(response.error)
                    setFormError('response not ok') // FIXME: error format fucked up (Zod)
                }
                else {
                    console.log('activity pushed successfully')
                    setThread({
                        ...thread,
                        runs: [...thread.runs, response.data]
                    })
                }
            } catch (error) {
                console.error(error)
                setFormError(error instanceof Error ? error.message : 'Unknown error')
            }
        }
    }

    const handleCancel = async () => {
        await apiFetch(`/api/threads/${thread.id}/cancel_run`, {
            method: 'POST',
        })
    }

    return <>
        <Header>
            <HeaderTitle title={`Thread`} />
        </Header>
        <div className="flex-1 overflow-y-auto">

            <div className=" p-6 max-w-4xl space-y-6">
                <ThreadDetails thread={thread} />

                <ItemsWithCommentsLayout items={activeActivities.map((activity: any) => {

                    const hasComments = activity.commentThread && activity.commentThread.commentMessages.filter((m: any) => !m.deletedAt).length > 0

                    return {
                        id: activity.id,
                        itemComponent: <ActivityView
                            activity={activity}
                            onSelect={(a) => { setSelectedActivityId(a?.id) }}
                            selected={selectedActivityId === activity.id}
                        />,
                        commentsComponent: (hasComments || (selectedActivityId === activity.id/* && isNewCommentActive*/)) ?
                            <CommentThread
                                activity={activity}
                                userId={loaderData.userId}
                                selected={selectedActivityId === activity.id}
                                users={users}
                                onSelect={(a) => { setSelectedActivityId(a?.id) }}
                                threadId={thread.id}
                            /> : undefined
                    }
                })} selectedItemId={selectedActivityId}
                />

                <div>
                    {lastRun?.state === 'in_progress' && <div>in progress...</div>}
                    {lastRun?.state === 'failed' && <div>
                        <div>failed</div>
                        <div>{lastRun?.fail_reason?.message}</div>
                    </div>}
                </div>
            </div>

        </div>

        {thread.client.simulatedBy?.id === loaderData.userId && <Card>
            <CardHeader>
                <CardTitle>New Activity</CardTitle>
            </CardHeader>
            <CardContent>
                <form method="post" onSubmit={handleSubmit}>
                    <Textarea name="message" placeholder="Reply here..." />
                    <Button type="submit" disabled={lastRun?.state === 'in_progress'}>Send</Button>

                    {lastRun?.state === 'in_progress' && <Button type="button" onClick={() => {
                        handleCancel()
                    }}>Cancel</Button>}
                </form>

                {formError && <div className="text-red-500">{formError}</div>}
            </CardContent>
        </Card>}
    </>
}
