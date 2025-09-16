import { redirect, useLoaderData, useFetcher, Outlet, Link, Form, data, useParams, useSearchParams, useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/thread";
import { Button } from "~/components/ui/button";
import { Header, HeaderTitle } from "~/components/header";
import { Textarea } from "~/components/ui/textarea";
import { useEffect, useState } from "react";
import { parseSSE } from "~/lib/parseSSE";
import { authClient } from "~/lib/auth-client";
import { apiFetch } from "~/lib/apiFetch";
import { getAPIBaseUrl } from "~/lib/getAPIBaseUrl";
import { getLastRun, getAllActivities, getVersions } from "~/lib/shared/threadUtils";
import { type Thread } from "~/lib/shared/apiTypes";
import { getThreadListParams } from "~/lib/utils";
import { PropertyList } from "~/components/PropertyList";
import { SendHorizonalIcon, Share, SquareIcon, UserIcon, UsersIcon } from "lucide-react";
import { useFetcherSuccess } from "~/hooks/useFetcherSuccess";
import { Badge } from "~/components/ui/badge";
import { useSessionContext } from "~/lib/session";
import { config } from "../../agentview.config";
import type { ActivityConfig, ThreadConfig } from "~/types";
import { FormField } from "~/components/form";
import { parseFormData } from "~/lib/parseFormData";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import type { BaseActivityConfig } from "~/lib/shared/configTypes";

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
    const response = await apiFetch<Thread>(`/api/threads/${params.id}`);

    if (!response.ok) {
        throw data(response.error, { status: response.status })
    }

    const listParams = getThreadListParams(request)

    return {
        listParams,
        thread: response.data
    };
}

// function ActivityMessage({ activity, isWhite = false, selected = false, onClick = () => { } }: { activity: any, isWhite?: boolean, selected?: boolean, onClick?: () => void }) {
//     return <div className={`border p-3 rounded-lg hover:border-gray-300 ${isWhite ? "bg-white" : "bg-muted"} ${selected ? "border-gray-300" : ""}`} onClick={onClick} data-item={true}>
//         <div dangerouslySetInnerHTML={{ __html: (activity.content as unknown as string) }}></div>
//     </div>
// }

// function ActivityView({ activity, onSelect, selected = false }: { activity: any, onSelect: (activity: any) => void, selected: boolean }) {
//     return <div key={activity.id} className="relative">
//         <div className={`relative flex flex-col ${activity.role === "user" ? "pl-[10%] justify-end" : "pr-[10%] justify-start"}`}>
//             <div className="relative">

//                 <ActivityMessage activity={activity} isWhite={activity.role === "user"} selected={selected} onClick={() => onSelect(activity)} />

//                 {/* { selected && !activity.commentThread && <div className="absolute top-2 -right-[16px]">
//                 <Button variant="outline" size="icon" onClick={onNewComment}>
//                     <MessageCirclePlusIcon className="w-[32px] h-[32px]" />
//                 </Button>
//             </div>} */}
//             </div>
//         </div>
//     </div>
// }

function ThreadDetails({ thread, threadConfig }: { thread: Thread, threadConfig: ThreadConfig }) {
    const versions = getVersions(thread);
    const { members } = useSessionContext();

    const simulatedBy = members.find((member) => member.id === thread.client.simulated_by);

    return (
        <div className="w-full">
            <PropertyList.Root>
                <PropertyList.Item>
                    <PropertyList.Title>Agent</PropertyList.Title>
                    <PropertyList.TextValue>{thread.type}</PropertyList.TextValue>
                </PropertyList.Item>
                <PropertyList.Item>
                    <PropertyList.Title>Created</PropertyList.Title>
                    <PropertyList.TextValue>
                        {new Date(thread.created_at).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        })}
                    </PropertyList.TextValue>
                </PropertyList.Item>
                <PropertyList.Item>
                    <PropertyList.Title>Source</PropertyList.Title>
                    <PropertyList.TextValue>
                        {simulatedBy ? <>Simulated by <span className="text-cyan-700">{simulatedBy.name}</span></> : "Real"}
                    </PropertyList.TextValue>
                </PropertyList.Item>
                <PropertyList.Item>
                    <PropertyList.Title>
                        {versions.length > 1 ? "Versions" : "Version"}
                    </PropertyList.Title>
                    <PropertyList.TextValue>
                        {versions.length > 0 ? versions.map(version => (version?.version ?? "") + "." + (version?.env ?? "")).join(", ") : "-"}
                    </PropertyList.TextValue>
                </PropertyList.Item>


                {(threadConfig.metadata ?? []).map((metafield: any) => (
                    <PropertyList.Item className="items-start">
                        <PropertyList.Title>{metafield.title ?? metafield.name}</PropertyList.Title>
                        <PropertyList.TextValue><metafield.display value={thread.metadata?.[metafield.name]} options={metafield.options} /></PropertyList.TextValue>
                    </PropertyList.Item>
                ))}
            </PropertyList.Root>
        </div>
    );
}

function ShareForm({ thread, listParams }: { thread: Thread, listParams: ReturnType<typeof getThreadListParams> }) {
    const fetcher = useFetcher();
    const navigate = useNavigate();

    useFetcherSuccess(fetcher, () => {
        navigate(`/threads/${thread.id}?list=${listParams.list}&type=${listParams.type}`);
    });

    if (thread.client.is_shared) {
        return <div className="flex flex-row gap-1 items-center text-xs text-white bg-cyan-700 px-2 py-1 rounded-md font-medium"><UsersIcon className="size-3" />Shared</div>
        // return <Badge>Public</Badge>
    }

    return <fetcher.Form method="put" action={`/clients/${thread.client.id}/share`}>
        <input type="hidden" name="is_shared" value="true" />
        <Button variant="outline" size="sm" type="submit"><Share /> {fetcher.state === "submitting" ? "Making public..." : "Make public"}</Button>
    </fetcher.Form>
}

export default function ThreadPageWrapper() {
    const loaderData = useLoaderData<typeof clientLoader>();
    return <ThreadPage key={loaderData.thread.id} />
}

function ThreadPage() {
    const loaderData = useLoaderData<typeof clientLoader>();
    const params = useParams();
    const navigate = useNavigate();
    const revalidator = useRevalidator();
    const { user } = useSessionContext();

    const [thread, setThread] = useState(loaderData.thread)
    const [isStreaming, setStreaming] = useState(false)

    const listParams = loaderData.listParams
    // const users = loaderData.users

    // const [searchParams, setSearchParams] = useSearchParams();
    // const activities = getAllActivities(thread)
    const activeActivities = getAllActivities(thread, { activeOnly: true })
    const lastRun = getLastRun(thread)

    const threadConfig = config.threads?.find((threadConfig) => threadConfig.type === thread.type);
    if (!threadConfig) {
        throw new Error(`Thread config not found for type "${thread.type}"`);
    }


    // const selectedActivityId = activities.find((a: any) => a.id === searchParams.get('activityId'))?.id ?? undefined;

    // const threadStatus = lastRun?.state === "completed" ? "idle" : (lastRun?.state ?? "idle")

    // console.log(thread)


    // const setSelectedActivityId = (id: string | undefined) => {
    //     if (id === selectedActivityId) {
    //         return // prevents unnecessary revalidation of the page
    //     }

    //     setSearchParams((searchParams) => {
    //         const currentActivityId = searchParams.get('activityId') ?? undefined;

    //         if (currentActivityId === id) {
    //             return searchParams;
    //         }

    //         if (id) {
    //             searchParams.set("activityId", id);
    //         } else {
    //             searchParams.delete("activityId");
    //         }
    //         return searchParams;
    //     }, { replace: true });
    // }

    useEffect(() => {
        apiFetch(`/api/threads/${thread.id}/seen`, {
            method: 'POST',
        }).then((data) => {
            if (data.ok) {
                revalidator.revalidate();
            }
            else {
                console.error(data.error)
            }
        })
    }, [])

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


    console.log(activeActivities)

    {/* <div className="flex-1 flex flex-col">  
      <Outlet />
    </div> */}
    return <>
        <div className="basis-[720px] flex-shrink-0 flex-grow-0 border-r  flex flex-col">
            <Header>
                <HeaderTitle title={`Thread ${thread.number}`} />

                <ShareForm thread={thread} listParams={listParams} />
            </Header>
            <div className="flex-1 overflow-y-auto">

                <div className="p-6 border-b">
                    <ThreadDetails thread={thread} threadConfig={threadConfig} />
                </div>

                <div className="">
                    <div className="flex flex-col">
                        {activeActivities.map((activity) => {

                            let content: React.ReactNode = null;

                            const activityConfig = threadConfig.activities.find((a) => a.type === activity.type && (!a.role || a.role === activity.role));
                            if (!activityConfig) {
                                content = <div className="text-muted-foreground italic">No component (type: "{activity.type}")</div>
                            }
                            else {
                                content = <activityConfig.display value={activity.content} options={activityConfig.options} />
                            }

                            return <div className={`px-6 py-4  ${params.activityId === activity.id ? "bg-stone-50" : "hover:bg-gray-50"}`} onClick={() => { navigate(`/threads/${thread.id}/activities/${activity.id}?list=${listParams.list}&type=${listParams.type}`) }}>
                                {content}
                            </div>


                            // return <ActivityView
                            //     activity={activity}
                            //     onSelect={(a) => { navigate(`/threads/${thread.id}/activities/${a?.id}?list=${listParams.list}&type=${listParams.type}`) }}
                            //     selected={params.activityId === activity.id}
                            // />
                        })}
                    </div>

                    {/* <ItemsWithCommentsLayout items={activeActivities.map((activity) => {

                    const hasComments = activity.commentMessages.filter((m: any) => !m.deletedAt).length > 0

                    return {
                        id: activity.id,
                        itemComponent: <ActivityView
                            activity={activity}
                            onSelect={(a) => { setSelectedActivityId(a?.id) }}
                            selected={selectedActivityId === activity.id}
                        />,
                        commentsComponent: (hasComments || (selectedActivityId === activity.id)) ?
                            <CommentThreadFloatingBox
                                activity={activity}
                                userId={loaderData.userId}
                                selected={selectedActivityId === activity.id}
                                users={users}
                                onSelect={(a) => { setSelectedActivityId(a?.id) }}
                                thread={thread}
                            /> : undefined
                    }
                })} selectedItemId={selectedActivityId}
                /> */}

                </div>

            </div>

            {thread.client.simulated_by === user.id && <InputForm thread={thread} threadConfig={threadConfig} />}

        </div>

        <Outlet context={{ thread }} />
    </>
}


function InputForm({ thread, threadConfig }: { thread: Thread, threadConfig: ThreadConfig }) {
    const [formError, setFormError] = useState<string | null>(null)

    const lastRun = getLastRun(thread)
    const threadStatus = lastRun?.state === "completed" ? "idle" : (lastRun?.state ?? "idle")

    const revalidator = useRevalidator()

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()

        setFormError(null)

        const formData = new FormData(e.target as HTMLFormElement)
        const data = parseFormData(formData, { excludedFields: ['type', 'role'] })

        const type = formData.get('type') as string;
        const role = formData.get('role') === "" ? undefined : formData.get('role') as string;

        if (data.value) {
            try {
                const response = await apiFetch(`/api/threads/${thread.id}/runs`, {
                    method: 'POST',
                    body: {
                        input: {
                            type,
                            role,
                            content: data.value
                        }
                    }
                });

                if (!response.ok) {
                    console.error(response.error)
                    setFormError('response not ok') // FIXME: error format fucked up (Zod)
                }
                else {
                    revalidator.revalidate();
                }

                // else {
                //     console.log('activity pushed successfully')
                //     setThread({
                //         ...thread,
                //         runs: [...thread.runs, response.data]
                //     })
                // }
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

    const inputConfigs = threadConfig.activities.filter((activity) => activity.isInput)

    return <div className="p-6 border-t">

        {inputConfigs.length === 0 && <div className="text-sm text-muted-foreground">No input fields</div>}

        <form method="post" onSubmit={handleSubmit}>

            {inputConfigs.length === 1 ? (
                // Single input config - no tabs
                <div>

                    <InputFormFields inputConfig={inputConfigs[0]} />
{/* 
                    {inputConfigs[0].input && (

                        <FormField
                            id={"inputFormValue"}
                            // error={fetcher.data?.error?.fieldErrors?.[`metadata.${metafield.name}`]}
                            name={"inputFormValue"}
                            defaultValue={undefined}
                            // defaultValue={scores[metafield.name] ?? undefined}
                            InputComponent={inputConfigs[0].input}
                            options={inputConfigs[0].options}
                        />
                    )} */}
                </div>
            ) : (
                // Multiple input configs - use tabs
                <Tabs defaultValue={`${inputConfigs[0].type}-${inputConfigs[0].role || 'default'}`}>
                    <TabsList>
                        {inputConfigs.map((inputConfig, index) => {
                            const tabName = inputConfig.title || (inputConfig.role
                                ? `${inputConfig.type} / ${inputConfig.role}`
                                : inputConfig.type)
                            const tabValue = `${inputConfig.type}-${inputConfig.role || 'default'}`;

                            return (
                                <TabsTrigger key={index} value={tabValue}>
                                    {tabName}
                                </TabsTrigger>
                            );
                        })}
                    </TabsList>

                    {inputConfigs.map((inputConfig, index) => {
                        const tabValue = `${inputConfig.type}-${inputConfig.role || 'default'}`;

                        return (
                            <TabsContent key={index} value={tabValue}>
                                <InputFormFields inputConfig={inputConfig} />
                            </TabsContent>
                        );
                    })}
                </Tabs>
            )}

            {/* <Textarea name="message" placeholder="Reply here..." rows={1} className="mb-2" /> */}

            <div className="flex flex-row gap-2 items-center mt-2">

                {lastRun?.state !== 'in_progress' && <Button type="submit">Send <SendHorizonalIcon /></Button>}
                {lastRun?.state === 'in_progress' && <Button type="button" onClick={() => {
                    handleCancel()
                }}>Cancel <SquareIcon /></Button>}

                <div className="gap-2 text-sm text-muted-foreground">
                    {!formError && <div>
                        {threadStatus === "in_progress" && <div>Running...</div>}
                        {threadStatus === "failed" && <div className="text-red-500">Failed: {lastRun?.fail_reason?.message ?? "Unknown reason"}</div>}
                    </div>}
                    {formError && <div className="text-red-500">{formError}</div>}
                </div>

            </div>
        </form>
    </div>
}

function InputFormFields({ inputConfig }: { inputConfig: ActivityConfig }) {
    return <>
        <input type="hidden" name="type" value={inputConfig.type} />
        <input type="hidden" name="role" value={inputConfig.role} />

        {inputConfig.input && (
            <FormField
                id={"inputFormValue"}
                // error={fetcher.data?.error?.fieldErrors?.[`metadata.${metafield.name}`]}
                name={"value"}
                defaultValue={undefined}
                // defaultValue={scores[metafield.name] ?? undefined}
                InputComponent={inputConfig.input}
                options={inputConfig.options}
            />
        )}
    </>
}