import { useLoaderData, useFetcher, Outlet, Link, Form, data, useParams, useSearchParams, useNavigate, useRevalidator } from "react-router";
import type { LoaderFunctionArgs, RouteObject } from "react-router";
import { Button } from "~/components/ui/button";
import { Header, HeaderTitle } from "~/components/header";
import { useEffect, useState } from "react";
import { parseSSE } from "~/lib/parseSSE";
import { apiFetch } from "~/lib/apiFetch";
import { getAPIBaseUrl } from "~/lib/getAPIBaseUrl";
import { getLastRun, getAllSessionItems, getVersions } from "~/lib/shared/sessionUtils";
import { type Session } from "~/lib/shared/apiTypes";
import { getListParams } from "~/lib/utils";
import { PropertyList } from "~/components/PropertyList";
import { MessageCircleIcon, MessageSquareTextIcon, SendHorizonalIcon, Share, SquareIcon, UserIcon, UsersIcon } from "lucide-react";
import { useFetcherSuccess } from "~/hooks/useFetcherSuccess";
import { useSessionContext } from "~/lib/session";
import type { SessionItemConfig, SessionConfig } from "~/types";
import { FormField } from "~/components/form";
import { parseFormData } from "~/lib/parseFormData";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { ItemsWithCommentsLayout } from "~/components/ItemsWithCommentsLayout";
import { CommentSessionFloatingBox } from "~/components/comments";
import { config } from "~/config";

async function loader({ request, params }: LoaderFunctionArgs) {
    const response = await apiFetch<Session>(`/api/sessions/${params.id}`);

    if (!response.ok) {
        throw data(response.error, { status: response.status })
    }

    const listParams = getListParams(request)

    return {
        listParams,
        session: response.data
    };
}


function SessionPage() {
    const loaderData = useLoaderData<typeof loader>();
    const revalidator = useRevalidator();
    const { user } = useSessionContext();

    const [session, setSession] = useState(loaderData.session)
    const [isStreaming, setStreaming] = useState(false)

    const listParams = loaderData.listParams

    const [searchParams, setSearchParams] = useSearchParams();
    const activeItems = getAllSessionItems(session, { activeOnly: true })
    const lastRun = getLastRun(session)

    const sessionConfig = config.sessions?.find((sessionConfig) => sessionConfig.type === session.type);
    if (!sessionConfig) {
        throw new Error(`Session config not found for type "${session.type}"`);
    }

    const selectedItemId = activeItems.find((a: any) => a.id === searchParams.get('itemId'))?.id ?? undefined;


    const setselectedItemId = (id: string | undefined) => {
        if (id === selectedItemId) {
            return // prevents unnecessary revalidation of the page
        }

        setSearchParams((searchParams) => {
            const currentItemId = searchParams.get('itemId') ?? undefined;

            if (currentItemId === id) {
                return searchParams;
            }

            if (id) {
                searchParams.set("itemId", id);
            } else {
                searchParams.delete("itemId");
            }
            return searchParams;
        }, { replace: true });
    }

    useEffect(() => {
        apiFetch(`/api/sessions/${session.id}/seen`, {
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
            setSession(loaderData.session)
        }
    }, [loaderData.session])

    useEffect(() => {
        if (lastRun?.state === 'in_progress') {

            (async () => {
                try {
                    const response = await fetch(`${getAPIBaseUrl()}/api/sessions/${session.id}/watch_run`, {
                        headers: {
                            'Content-Type': 'application/json',
                        }
                    });

                    setStreaming(true)

                    for await (const event of parseSSE(response)) {


                        setSession((currentSession) => {
                            const lastRun = getLastRun(currentSession);
                            if (!lastRun) { throw new Error("Unreachable: Last run not found") };

                            let newRun: typeof lastRun;

                            if (event.event === 'item') {
                                const newItem = event.data;
                                const newItemIndex = lastRun.sessionItems.findIndex((a: any) => a.id === newItem.id);

                                newRun = {
                                    ...lastRun,
                                    sessionItems: newItemIndex === -1 ?
                                        [...lastRun.sessionItems, newItem] : [
                                            ...lastRun.sessionItems.slice(0, newItemIndex),
                                            newItem
                                        ]
                                }
                            }
                            else if (event.event === 'state') {
                                newRun = {
                                    ...lastRun,
                                    ...event.data
                                }
                            }
                            else {
                                throw new Error(`Unknown event type: ${event.event}`)
                            }

                            return {
                                ...currentSession,
                                runs: currentSession.runs.map((run: any) =>
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

    return <>
        {/* <div className="basis-[720px] flex-shrink-0 flex-grow-0 border-r  flex flex-col"> */}
        <div className="basis-[1080px] flex-shrink-0 flex-grow-0 border-r  flex flex-col">

            <Header>
                <HeaderTitle title={`Session ${session.number}`} />

                <ShareForm session={session} listParams={listParams} />
            </Header>
            <div className="flex-1 overflow-y-auto">

                <div className="p-6 border-b">
                    <SessionDetails session={session} sessionConfig={sessionConfig} />
                </div>

                <div className="">
                    {/* <div className="flex flex-col pb-16">
                        {activeItems.map((item) => {

                            let content: React.ReactNode = null;

                            const itemConfig = sessionConfig.items.find((a) => a.type === item.type && (!a.role || a.role === item.role));
                            if (!itemConfig) {
                                content = <div className="text-muted-foreground italic">No component (type: "{item.type}")</div>
                            }
                            else {
                                content = <itemConfig.display value={item.content} options={itemConfig.options} />
                            }

                            return <div className={`px-6 py-4  ${params.itemId === item.id ? "bg-stone-50" : "hover:bg-gray-50"}`} onClick={() => { navigate(`/sessions/${session.id}/items/${item.id}?list=${listParams.list}&type=${listParams.type}`) }}>
                                {content}
                            </div>


                            // return <itemView
                            //     item={item}
                            //     onSelect={(a) => { navigate(`/sessions/${session.id}/items/${a?.id}?list=${listParams.list}&type=${listParams.type}`) }}
                            //     selected={params.itemId === item.id}
                            // />
                        })}

                        {lastRun?.state === "in_progress" && <div className="px-6 gap-2 pt-3 flex flex-row items-end text-muted-foreground">
                            <Loader />
                        </div>}
                    </div> */}

                    <ItemsWithCommentsLayout items={activeItems.map((item) => {
                        const hasComments = item.commentMessages.filter((m: any) => !m.deletedAt).length > 0

                        let content: React.ReactNode = null;

                        const itemConfig = sessionConfig.items.find((a) => a.type === item.type && (!a.role || a.role === item.role));
                        if (!itemConfig) {
                            content = <div className="text-muted-foreground italic">No component (type: "{item.type}")</div>
                        }
                        else {
                            content = <itemConfig.display value={item.content} options={itemConfig.options} />
                        }

                        return {
                            id: item.id,
                            itemComponent: <div 
                                className={`relative pl-6 py-2 pr-[420px] group ${selectedItemId === item.id ? "bg-gray-50" : "hover:bg-gray-50"}`} 
                                onClick={() => {
                                     if (selectedItemId === item.id) { 
                                        setselectedItemId(undefined) 
                                    } else { 
                                        setselectedItemId(item?.id) 
                                    }
                                }}
                            >
                                {content}
                                {/* { !hasComments && <div className="absolute top-[8px] right-[408px] opacity-0 group-hover:opacity-100">
                                    <Button variant="outline" size="icon_xs" onClick={() => { setselectedItemId(item.id) }}><MessageSquareTextIcon /></Button>
                                </div>} */}
                            </div>,
                            // itemComponent: <div 
                            //     className={`relative pl-6 py-2 pr-[444px] group ${params.itemId === item.id ? "bg-gray-50" : "hover:bg-gray-50"}`} 
                            //     onClick={() => { navigate(`/sessions/${session.id}/items/${item?.id}?list=${listParams.list}&type=${listParams.type}`) }}>

                            //     {content}
                            //     {/* { !hasComments && <div className="absolute top-[8px] right-[408px] opacity-0 group-hover:opacity-100">
                            //         <Button variant="outline" size="icon_xs" onClick={() => { setselectedItemId(item.id) }}><MessageSquareTextIcon /></Button>
                            //     </div>} */}
                            // </div>,
                            commentsComponent: (hasComments || (selectedItemId === item.id)) ? 
                            <div className="relative pt-2 pr-4"><CommentSessionFloatingBox
                                    item={item}
                                    session={session}
                                    selected={selectedItemId === item.id}
                                    onSelect={(a) => { setselectedItemId(a?.id) }}
                                /></div> : undefined
                        }
                    })} selectedItemId={selectedItemId}
                    />

                </div>

            </div>

            {session.client.simulated_by === user.id && <InputForm session={session} sessionConfig={sessionConfig} />}

        </div>

        <Outlet context={{ session }} />
    </>
}



function SessionDetails({ session, sessionConfig }: { session: Session, sessionConfig: SessionConfig }) {
    const versions = getVersions(session);
    const { members } = useSessionContext();

    const simulatedBy = members.find((member) => member.id === session.client.simulated_by);

    return (
        <div className="w-full">
            <PropertyList.Root>
                <PropertyList.Item>
                    <PropertyList.Title>Agent</PropertyList.Title>
                    <PropertyList.TextValue>{session.type}</PropertyList.TextValue>
                </PropertyList.Item>
                <PropertyList.Item>
                    <PropertyList.Title>Created</PropertyList.Title>
                    <PropertyList.TextValue>
                        {new Date(session.created_at).toLocaleDateString('en-US', {
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


                {(sessionConfig.metadata ?? []).map((metafield: any) => (
                    <PropertyList.Item className="items-start">
                        <PropertyList.Title>{metafield.title ?? metafield.name}</PropertyList.Title>
                        <PropertyList.TextValue><metafield.display value={session.metadata?.[metafield.name]} options={metafield.options} /></PropertyList.TextValue>
                    </PropertyList.Item>
                ))}
            </PropertyList.Root>
        </div>
    );
}

function ShareForm({ session, listParams }: { session: Session, listParams: ReturnType<typeof getListParams> }) {
    const fetcher = useFetcher();
    const navigate = useNavigate();

    useFetcherSuccess(fetcher, () => {
        navigate(`/sessions/${session.id}?list=${listParams.list}&type=${listParams.type}`);
    });

    if (session.client.is_shared) {
        return <div className="flex flex-row gap-1 items-center text-xs text-white bg-cyan-700 px-2 py-1 rounded-md font-medium"><UsersIcon className="size-3" />Shared</div>
        // return <Badge>Public</Badge>
    }

    return <fetcher.Form method="put" action={`/clients/${session.client.id}/share`}>
        <input type="hidden" name="is_shared" value="true" />
        <Button variant="outline" size="sm" type="submit"><Share /> {fetcher.state === "submitting" ? "Making public..." : "Make public"}</Button>
    </fetcher.Form>
}

function Component() {
    const loaderData = useLoaderData<typeof loader>();
    return <SessionPage key={loaderData.session.id} />
}

function InputForm({ session, sessionConfig }: { session: Session, sessionConfig: SessionConfig }) {
    const [formError, setFormError] = useState<string | null>(null)

    const lastRun = getLastRun(session)
    const sessionStatus = lastRun?.state === "completed" ? "idle" : (lastRun?.state ?? "idle")

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
                const response = await apiFetch(`/api/sessions/${session.id}/runs`, {
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
            } catch (error) {
                console.error(error)
                setFormError(error instanceof Error ? error.message : 'Unknown error')
            }
        }
    }

    const handleCancel = async () => {
        await apiFetch(`/api/sessions/${session.id}/cancel_run`, {
            method: 'POST',
        })
    }

    const inputConfigs = sessionConfig.items.filter((item) => item.isInput)

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
                        {sessionStatus === "in_progress" && <div>Running...</div>}
                        {sessionStatus === "failed" && <div className="text-red-500">Failed: {lastRun?.fail_reason?.message ?? "Unknown reason"}</div>}
                    </div>}
                    {formError && <div className="text-red-500">{formError}</div>}
                </div>

            </div>
        </form>
    </div>
}

function InputFormFields({ inputConfig }: { inputConfig: SessionItemConfig }) {
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

export const sessionRoute: RouteObject = {
  Component,
  loader,
}