import { zodResolver } from "@hookform/resolvers/zod";
import { type ChannelMessage, type CommentMessage, type Run, type Score, type Session, type SessionBase, type SessionItem, type SessionsStats } from "agentview/apiTypes";
import { findItemConfigById, findMatchingRunConfigs, requireAgentConfig, requireChannelConfig } from "agentview/configUtils";
import { enhanceSession, getActiveRuns, getAllSessionItems, getLastRun, getVersions } from "agentview/sessionUtils";
import type { AgentConfig, ChannelConfig, ScoreConfig, SessionItemConfig, SessionItemDisplayComponentProps } from "agentview/types";
import { AlertCircleIcon, ChevronDown, CircleGauge, InfoIcon, Loader2, Lock, MessageCirclePlus, UsersIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useOptimistic, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type { LoaderFunctionArgs, RouteObject } from "react-router";
import { data, Link, Outlet, useFetcher, useLoaderData, useNavigate, useOutletContext, useRevalidator } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { DisplayProperties } from "../components/DisplayProperties";
import { Header, HeaderTitle } from "../components/header";
import { CommentsThread } from "../components/internal/comments";
import { ErrorBoundary } from "../components/internal/ErrorBoundary";
import { AVFormField } from "../components/internal/form";
import { ItemsWithCommentsLayout } from "../components/internal/ItemsWithCommentsLayout";
import { Loader } from "../components/internal/Loader";
import { Pill } from "../components/Pill";
import { PropertyList, PropertyListItem, PropertyListTextValue, PropertyListTitle } from "../components/PropertyList";
import { AssistantMessage, Step, StepContent, StepTitle, UserMessage } from "../components/session-item";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Form as HookForm } from "../components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { config } from "../config";
import { useFetcherSuccess } from "../hooks/useFetcherSuccess";
import { useRerender } from "../hooks/useRerender";
import { agentview, AgentViewError } from "../lib/agentview";
import { getListParams, toQueryParams } from "../lib/listParams";
import { useSessionContext } from "../lib/SessionContext";
import { useSession } from "../lib/useSession";
import React from "react";
import { LoadingIndicator } from "../components/internal/LoadingIndicator";

async function loader({ request, params, context }: LoaderFunctionArgs) {
    const sessionId = params.id!;

    try {
        const shouldLoadImmediately = !window.location.pathname.includes(`/sessions/${sessionId}`);

        const [session, comments, scores] = shouldLoadImmediately ?
            [agentview.getSessionSync({ id: sessionId }), agentview.getSessionCommentsSync({ id: sessionId }), agentview.getSessionScoresSync({ id: sessionId })] :
            await Promise.all([agentview.getSession({ id: sessionId }), agentview.getSessionComments({ id: sessionId }), agentview.getSessionScores({ id: sessionId })] as const);

        return {
            session,
            comments,
            scores,
            listParams: getListParams(request),
            sessionId
        };
    } catch (error) {
        if (error instanceof AgentViewError) {
            throw data({ message: error.message, ...error.details }, { status: error.statusCode });
        }
        throw error;
    }
}

function Component() {
    const { session, comments, scores, sessionId } = useLoaderData<typeof loader>();
    const { sessions } = useOutletContext<{ sessions?: SessionBase[] }>() ?? {};
    const sessionBase = sessions?.find((s) => s.id === sessionId);

    // Stage 1: No data at all - show loader
    if (!sessionBase && !session) {
        return <div className="pt-6"><LoadingIndicator /></div>;
    }

    // Stage 2: Have sessionBase but not full data - show header only
    if (!session || !comments || !scores) {
        return <SessionPageSkeleton sessionBase={sessionBase!} />;
    }

    // Stage 3: Full data available
    return <SessionPage session={session} comments={comments} scores={scores} />;
}

function SessionShell({
    sessionBase,
    channelConfig,
    headerExtra,
    children,
    footer,
    outletContext
}: {
    sessionBase: SessionBase,
    channelConfig: ChannelConfig,
    headerExtra?: React.ReactNode,
    children: React.ReactNode,
    footer?: React.ReactNode,
    outletContext?: any
}) {
    return <>
        <div className="flex-grow-1 border-r flex flex-col">
            <Header className="py-1" trigger={false}>
                <HeaderTitle title={`Session ${sessionBase.handle}`} />
                {headerExtra}
            </Header>
            <div className="flex-1 overflow-y-auto">
                <div className="p-6 border-b">
                    <SessionDetails sessionBase={sessionBase} channelConfig={channelConfig} />
                </div>
                {children}
            </div>
            {footer}
        </div>
        <Outlet context={outletContext} />
    </>;
}

function SessionPageSkeleton({ sessionBase }: { sessionBase: SessionBase }) {
    const channelConfig = requireChannelConfig(config, sessionBase.channel);

    return (
        <SessionShell sessionBase={sessionBase} channelConfig={channelConfig}>
            <div className="p-6">
                <LoadingIndicator />
            </div>
        </SessionShell>
    );
}

function SessionPage(props: { session: Session, comments: CommentMessage[], scores: Score[] }) {
    // console.log('[SessionPage]');
    const loaderData = useLoaderData<typeof loader>();
    const revalidator = useRevalidator();
    const navigate = useNavigate();
    const { me } = useSessionContext();
    const { allStats } = useOutletContext<{ allStats?: SessionsStats, sessions?: SessionBase[] }>() ?? {};

    const [expectingRun, setExpectingRun] = useState(false);
    const session = useSession(props.session, { wait: expectingRun });

    const listParams = loaderData.listParams;
    const activeItems = getAllSessionItems(session, { activeOnly: true })
    const lastRun = getLastRun(session)

    const channelConfig = requireChannelConfig(config, session.channel);
    // const agentConfig = requireAgentConfig(config, channelConfig.agent);

    const searchParams = new URLSearchParams(window.location.search);
    const selectedItemId = activeItems.find((a: any) => a.id === searchParams.get('itemId'))?.id ?? undefined;

    const setselectedItemId = (id: string | undefined) => {
        /**
         * We're not using setSearchParams here from useSearchParams.
         * It's because:
         * - we must not touch the route if new id is the same as current one, it's bad for performance
         * - searchParams from the hook is not up-to-date when setSelectedItemId runs (closure)
         * - setSearchParams does take fresh searchParams as an argument, but it always runs `navigate`, you can't prevent that.
         * - the code in this function is almost like setSearchParams from RR7 (I checked the source code), we're not losing anything
         */
        const currentSearchParams = new URLSearchParams(window.location.search);
        const currentItemId = currentSearchParams.get('itemId') ?? undefined;

        if (currentItemId === id) {
            return;
        }

        if (id) {
            currentSearchParams.set("itemId", id);
        }
        else {
            currentSearchParams.delete("itemId");
        }

        navigate(`?${currentSearchParams.toString()}`, { replace: true });

    }

    useEffect(() => {
        const sessionStats = allStats?.sessions?.[session.id];
        if (sessionStats && sessionStats.unseenEvents.length > 0) {
            agentview.markSeen({ sessionId: session.id }) // only mark as seen if there are unseen events (do not overload backend and clean cache unnecessarily)
                .then(() => revalidator.revalidate())
                .catch((error) => console.error(error))
        };

    }, [])

    const bodyRef = useRef<HTMLDivElement>(null);

    const PADDING = 24;
    const COMMENTS_WIDTH = 310;
    const COMMENT_BUTTON_WIDTH = 28;
    const COMMENT_BUTTON_PADDING = 8;
    const TEXT_MAX_WIDTH = 720;

    let styles: Record<string, any> = {}

    if (!bodyRef.current) { // just first render for the purpose of the layout. useLayoutEffect makes sure that the component will be rerendered before paint with bodyRef.current set.
        styles = {
            padding: PADDING,
            commentsWidth: COMMENTS_WIDTH,
            commentButtonWidth: COMMENT_BUTTON_WIDTH,
            commentButtonPadding: COMMENT_BUTTON_PADDING,
            textWidth: TEXT_MAX_WIDTH,
            isSmallSize: false
        }
    }
    else {
        const isSmallSize = !window.matchMedia("(min-width: 1440px)").matches

        const textWidth = isSmallSize ?
            Math.min(bodyRef.current.offsetWidth - PADDING * 2, TEXT_MAX_WIDTH) :
            Math.min(bodyRef.current.offsetWidth - PADDING * 2 - COMMENT_BUTTON_WIDTH - COMMENT_BUTTON_PADDING * 2 - COMMENTS_WIDTH, TEXT_MAX_WIDTH)

        styles = {
            padding: PADDING,
            commentsWidth: COMMENTS_WIDTH,
            commentButtonWidth: COMMENT_BUTTON_WIDTH,
            commentButtonPadding: COMMENT_BUTTON_PADDING,
            textWidth,
            isSmallSize
        };
    }

    console.log(session);

    const rerender = useRerender();

    useLayoutEffect(() => {
        rerender();
    }, [])

    useEffect(() => {
        function handleResize() {
            rerender();
        }
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, [])


    return (
        <SessionShell
            sessionBase={session}
            channelConfig={channelConfig}
            headerExtra={session.user.createdBy === me.id && <ShareForm session={session} />}
            footer={session.user.createdBy === me.id && <InputForm session={session} channelConfig={channelConfig} styles={styles} onRunningStateChange={setExpectingRun} />}
            outletContext={{ session, allStats }}
        >
            <div ref={bodyRef}>
                <ItemsWithCommentsLayout items={getActiveRuns(session).map((run) => {

                    type ChannelMessageWallItem = {
                        id: string,
                        type: 'channel-message',
                        channelMessage: ChannelMessage,
                    }

                    type SessionItemWallItem = {
                        id: string,
                        type: 'session-item',
                        sessionItem: SessionItem,
                    }

                    type WallItem = ChannelMessageWallItem | SessionItemWallItem;

                    let wallItems: WallItem[] = [];

                    if (session.channel.type === 'api') {
                        wallItems = run.sessionItems.map((item) => ({
                            id: item.id,
                            type: 'session-item',
                            sessionItem: item,
                        }));
                    }
                    else {
                        const incomingChannelMessages = run.channelMessages.filter((message) => message.direction === 'incoming');
                        incomingChannelMessages.forEach((message) => {
                            wallItems.push({
                                id: message.id,
                                type: 'channel-message',
                                channelMessage: message,
                            });
                        });

                        const outgoingChannelMessages = run.channelMessages.filter((message) => message.direction === 'outgoing');

                        if (outgoingChannelMessages.length > 0) {
                            run.sessionItems.filter((item) => item.type === 'step').forEach((item) => {
                                wallItems.push({
                                    id: item.id,
                                    type: 'session-item',
                                    sessionItem: item,
                                });
                            });

                            wallItems.push({
                                id: outgoingChannelMessages[0].id,
                                type: 'channel-message',
                                channelMessage: outgoingChannelMessages[0],
                            });
                        }
                        else {
                            run.sessionItems.filter((item) => item.type === 'step' || item.type === 'output').forEach((item) => {
                                wallItems.push({
                                    id: item.id,
                                    type: 'session-item',
                                    sessionItem: item,
                                });
                            });
                        }
                    }

                    const runScores: Score[] = props.scores.filter((s) => s.runId === run.id);
                    const runComments: CommentMessage[] = props.comments.filter((c) => c.runId === run.id && !c.channelMessageId && !c.sessionItemId);
                    // const runScoreConfigs: ScoreConfig[] = run.version?.agent ? requireAgentConfig(config, run.version?.agent).scores : [];


                    return wallItems.map((wallItem, index) => {

                        /**
                         * TODO:
                         * - there's no 'agent' in the run. Think how to clean it up.
                         * - "createRun" should FORCE to set 'agent' property. How the fuck does it even work without it?????  ANSWER: run belongs to session which has agent connected :)
                         * - what if run has no agent at all? but has input? (input is a trait of our built-in integrations!!!) ANSWER: best-effort rendering. We have Streams Protocol for that matter. We could also if/else for channels :)
                         * - actually -> a lot of visual components are "built-in" in Streams Protocol :O
                         * - we must clean up config anyway (for Streams Protocol) AND think what to do with 'agent.protocol' property. So I guess it's a bit more complex here? And connected. 
                         * 
                         * Test those fucking emails!!
                         */


                        let content: React.ReactNode = null;
                        let comments: CommentMessage[] = [];

                        if (wallItem.type === 'channel-message') {
                            if (wallItem.channelMessage.direction === 'incoming') {
                                content = <div className="text-red-500">{wallItem.channelMessage.text}</div>
                            }
                            else {
                                content = <div className="text-blue-500">{wallItem.channelMessage.text}</div>;
                            }

                            comments = props.comments.filter((c) => c.channelMessageId === wallItem.channelMessage.id);
                        }
                        else {
                            if (wallItem.sessionItem.type === 'input') {
                                content = <div className="pl-[10%] relative">
                                    <DefaultInputComponent item={wallItem.sessionItem.content} sessionItem={wallItem.sessionItem} run={run} session={session} />
                                </div>
                            }
                            else {
                                content = <div className="pr-[10%] relative">
                                    <DefaultAssistantComponent item={wallItem.sessionItem.content} sessionItem={wallItem.sessionItem} run={run} session={session} />
                                </div>
                            }

                            comments = props.comments.filter((c) => c.sessionItemId === wallItem.sessionItem.id);
                        }

                        const isSelected = selectedItemId === wallItem.id;
                        const hasComments = false;
                        const isLastRunItem = index === wallItems.length - 1;



                        // const isLastRunItem = index === run.sessionItems.length - 1;
                        // const isInputItem = item.type === "input";

                        // const comments = props.comments.filter((c) => c.sessionItemId === item.id).filter((c) => !c.deletedAt);
                        // const scores = props.scores.filter((s) => s.sessionItemId === item.id).filter((s) => !s.deletedAt);

                        // const hasComments = comments.length > 0
                        // const isSelected = selectedItemId === item.id;

                        // let content: React.ReactNode = null;

                        // const itemConfigMatch : any = undefined;
                        // if (isInputItem) {
                        //     content = <div className="pl-[10%] relative">
                        //         <DefaultInputComponent item={item.content} sessionItem={item} run={run} session={session} />
                        //     </div>
                        // }
                        // else {
                        //     content = <div className="pr-[10%] relative">
                        //         <DefaultAssistantComponent item={item.content} sessionItem={item} run={run} session={session} />
                        //     </div>
                        // }





                        // if (run.version?.agent) {
                        //     const agentConfig = requireAgentConfig(config, run.version?.agent);
                        // }

                        // // const agentConfig = findAgentConfig(config, run.version?.agent);
                        // const runConfigMatches = findMatchingRunConfigs(agentConfig, run.sessionItems[0].content);
                        // const itemConfigMatch = runConfigMatches.length === 1 ? findItemConfigById(runConfigMatches[0], run.sessionItems, item.id) : undefined;

                        // if (itemConfigMatch?.itemConfig?.displayComponent === null) {
                        //     return null;
                        // }

                        // if (isInputItem) {
                        //     const Component = itemConfigMatch?.itemConfig?.displayComponent ?? DefaultInputComponent;
                        //     if (!Component) {
                        //         return null;
                        //     }
                        //     content = <div className="pl-[10%] relative">
                        //         <Component item={item.content} sessionItem={item} run={run} session={session} />
                        //     </div>
                        // }
                        // else if (itemConfigMatch?.type === "output") {
                        //     const Component = itemConfigMatch?.itemConfig?.displayComponent ?? DefaultAssistantComponent;
                        //     content = <Component item={item.content} sessionItem={item} run={run} session={session} />
                        // }
                        // else {
                        //     if (itemConfigMatch?.tool) {
                        //         let callContent: any = undefined;
                        //         let resultContent: any = undefined;
                        //         let Component: React.ComponentType<SessionItemDisplayComponentProps>;

                        //         if (itemConfigMatch?.tool.type === "call") {
                        //             if (itemConfigMatch?.tool?.hasResult) {
                        //                 return null;
                        //             }
                        //             else {
                        //                 callContent = itemConfigMatch.content;
                        //                 Component = itemConfigMatch?.itemConfig?.displayComponent ?? DefaultToolComponent;
                        //             }
                        //         }
                        //         else if (itemConfigMatch?.tool.type === "result") {
                        //             resultContent = itemConfigMatch.content;
                        //             callContent = itemConfigMatch.tool.call.content;
                        //             Component = itemConfigMatch?.tool.call.itemConfig?.displayComponent ?? DefaultToolComponent;
                        //         }
                        //         else {
                        //             throw new Error(`Unreachable`);
                        //         }

                        //         // const Component = itemConfigMatch?.itemConfig?.displayComponent ?? DefaultToolComponent;
                        //         content = <Component item={callContent} resultItem={resultContent} sessionItem={item} run={run} session={session} />
                        //     }
                        //     else {
                        //         const Component = itemConfigMatch?.itemConfig?.displayComponent ?? DefaultStepComponent;
                        //         content = <Component item={item.content} sessionItem={item} run={run} session={session} />
                        //     }

                        // }

                        return {
                            id: wallItem.id,
                            itemComponent: <div
                                className={`relative group`}
                            >
                                {!styles.isSmallSize && <div className={`absolute text-muted-foreground text-xs font-medium flex flex-row gap-1 z-10`} style={{ left: `${styles.padding + styles.textWidth + styles.commentButtonPadding}px` }}>
                                    {!isSelected && <Button className="group-hover:visible invisible" variant="outline" size="icon_xs" onClick={() => { setselectedItemId(wallItem.id) }}>
                                        <MessageCirclePlus className="size-3" />
                                    </Button>}
                                </div>}

                                <div className={`relative`} style={{ marginLeft: `${styles.padding}px`, width: `${styles.textWidth}px` }}>

                                    <div data-item /*onClick={() => { setselectedItemId(item.id) }}*/ >
                                        <ErrorBoundary>
                                            {content}
                                        </ErrorBoundary>
                                    </div>

                                    {/* <div>Footer</div> */}
                                    {/* <MessageFooter
                                        comments={comments}
                                        scores={scores}
                                        session={session}
                                        run={run}
                                        listParams={listParams}
                                        item={item}
                                        itemConfig={itemConfigMatch?.itemConfig}
                                        onSelect={() => { setselectedItemId(item.id) }}
                                        isSelected={isSelected}
                                        isSmallSize={styles.isSmallSize}
                                        isLastRunItem={isLastRunItem}
                                        isOutput={itemConfigMatch?.type === "output"}
                                        allStats={allStats}
                                    /> */}

                                    {isLastRunItem && run.status === "in_progress" && <div className="text-muted-foreground mt-6">
                                        <Loader />
                                    </div>}

                                </div>
                            </div>,
                            commentsComponent: !styles.isSmallSize && (hasComments || (isSelected)) ? <div>comments</div> : undefined
                            // <CommentsThread
                            //     item={item}
                            //     itemConfig={itemConfigMatch?.itemConfig}
                            //     session={session}
                            //     selected={isSelected}
                            //     onSelect={(a) => { setselectedItemId(a?.id) }}
                            //     allStats={allStats}
                            //     comments={comments}
                            //     scores={scores}
                            // /> : undefined
                        }
                    })
                }).flat().filter((item) => item !== undefined && item !== null)} selectedItemId={selectedItemId}
                    commentsContainer={{
                        style: {
                            width: `${styles.commentsWidth}px`,
                            left: `${styles.padding + styles.textWidth + styles.commentButtonWidth + styles.commentButtonPadding * 2}px`
                        }
                    }}
                />
            </div>
        </SessionShell>
    );
}


function SessionDetails({ sessionBase, channelConfig }: { sessionBase: SessionBase, channelConfig: ChannelConfig }) {
    const { organization: { members } } = useSessionContext();
    const versions = sessionBase.versions;
    const simulatedBy = members.find((member) => member.userId === sessionBase.user.createdBy);

    return (
        <div className="w-full">
            <PropertyList>
                {/* <PropertyListItem>
                    <PropertyListTitle>Agent</PropertyListTitle>
                    <PropertyListTextValue>{sessionBase.agent}</PropertyListTextValue>
                </PropertyListItem> */}
                <PropertyListItem>
                    <PropertyListTitle>Created</PropertyListTitle>
                    <PropertyListTextValue>
                        {new Date(sessionBase.createdAt).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        })}
                    </PropertyListTextValue>
                </PropertyListItem>
                <PropertyListItem>
                    <PropertyListTitle>Space</PropertyListTitle>
                    <PropertyListTextValue>
                        {simulatedBy ? <>Playground of <span className="text-cyan-700">{simulatedBy.user.name}</span></> : "Production"}
                    </PropertyListTextValue>
                </PropertyListItem>
                <PropertyListItem>
                    <PropertyListTitle>Channel</PropertyListTitle>
                    <PropertyListTextValue>
                        {sessionBase.channel.type} {sessionBase.channel.type === 'api' ? `(${sessionBase.channel.name})` : `(${sessionBase.channel.address})`}
                    </PropertyListTextValue>
                </PropertyListItem>
                <PropertyListItem>
                    <PropertyListTitle>
                        {versions.length > 1 ? "Versions" : "Version"}
                    </PropertyListTitle>
                    <PropertyListTextValue>
                        {versions.length === 0 && <span className="text-muted-foreground">-</span>}
                        {versions.length > 0 && <div className="flex flex-row gap-1">{versions.map(version => {
                            return <Pill key={version}>{version}</Pill>
                        })}</div>}
                    </PropertyListTextValue>
                </PropertyListItem>

                {channelConfig.displayProperties && <DisplayProperties displayProperties={channelConfig.displayProperties} inputArgs={{ session: sessionBase }} />}
            </PropertyList>
        </div>
    );
}

function ShareForm({ session }: { session: Session }) {
    const fetcher = useFetcher();
    const isProcessing = fetcher.state !== 'idle';
    return <fetcher.Form method="put" action={`/users/${session.user.id}/update`}>
        <input type="hidden" name="space" value={session.user.space === "shared-playground" ? "playground" : "shared-playground"} />
        <Button variant={"outline"} size="sm" type="submit" disabled={isProcessing}>
            {isProcessing ? <Loader2 className="animate-spin" /> : <UsersIcon fill={session.user.space === "shared-playground" ? "black" : "none"} stroke={session.user.space === "shared-playground" ? "none" : "black"} />} {session.user.space === "shared-playground" ? "Shared" : "Share"}
        </Button>
    </fetcher.Form>
}

function DefaultInputComponent({ item }: SessionItemDisplayComponentProps) {
    return <UserMessage>{item}</UserMessage>
}

function DefaultAssistantComponent({ item }: SessionItemDisplayComponentProps) {
    return <AssistantMessage>{item}</AssistantMessage>
}

function DefaultStepComponent({ item }: SessionItemDisplayComponentProps) {
    return <Step>
        <StepContent>
            {item}
        </StepContent>
    </Step>
}

function DefaultToolComponent({ item, resultItem }: SessionItemDisplayComponentProps) {
    const result = {
        call: item,
        result: resultItem
    }

    return <Step>
        <StepContent>
            {/* @ts-ignore */}
            {result}
        </StepContent>
    </Step>
}

function InputForm({ session, channelConfig, styles, onRunningStateChange }: { session: Session, channelConfig: ChannelConfig, styles: Record<string, number>, onRunningStateChange?: (isRunning: boolean) => void }) {
    const lastRun = getLastRun(session)

    const [abortController, setAbortController] = useState<AbortController | undefined>(undefined)

    const submit = async (url: string, body: Record<string, any>, init?: RequestInit) => {
        const abortController = new AbortController();
        setAbortController(abortController);
        onRunningStateChange?.(true);

        const fetchOptions: RequestInit = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            ...(init ?? {}),
            signal: abortController.signal, // you can't override the signal if you're using `submit`
        }

        try {
            const response = await fetch(url, fetchOptions);

            if (!response.ok) {
                console.error(`The fetch to '${url}' (done via 'submit' function) returned error response (${response.status} ${response.statusText}). Check Network tab in browser for error details.`);
                toast.error(`Error: "${response.status} ${response.statusText}". Check console.`);
            }

            await response.text(); // this is important. It waits until the full stream finished. Only after that we can call "finally" and reset abort controller.

            return response;

        } catch (error: any) {
            console.log('catch: ', error?.name);
            if (error?.name === 'AbortError') {
                console.log('stream aborted');
                throw error;
            }

            console.error(`The fetch to '${url}' (done via 'submit' function) threw an error. Check Network tab in browser for error details.`);
            console.error(error);
            toast.error(`Error: "${error.message}". Check console.`);
            throw error;

        } finally {
            setAbortController(undefined);
            onRunningStateChange?.(false);
        }
    }

    const submit2 = async (items: any[]) => {
        onRunningStateChange?.(true);
        try {
            await agentview.createRun({ sessionId: session.id, items });
        } catch (error: any) {
            console.error('Error creating run:', error);
            toast.error(`Error: "${error.message}". Check console.`);
        } finally {
            onRunningStateChange?.(false);
        }
    }

    const cancel = async () => {
        if (lastRun?.status === 'in_progress') {
            await agentview.updateRun({ id: lastRun.id, status: 'cancelled', sessionId: session.id });

            // must go *after* request above to prevent race
            abortController?.abort();
        }

        setAbortController(undefined);
    }

    // submit, cancel are *special* (shorthand). isRunning is legit when session is running. It's THAT SIMPLE. Trivial. Do not overthink it.

    const isRunning = lastRun?.status === 'in_progress' || !!abortController;

    const InputComponent = channelConfig.inputComponent;
    if (InputComponent === null) {
        return null;
    }

    return <div className="border-t">
        <div className={`p-6 pr-0`} style={{ maxWidth: `${styles.textWidth + styles.padding}px` }}>
            {!InputComponent && <div className="text-sm text-muted-foreground">No input component</div>}

            {InputComponent && (
                <div>
                    <InputComponent
                        cancel={cancel}
                        submit={submit}
                        submit2={submit2}
                        isRunning={isRunning}
                        session={enhanceSession(session)}
                        token={session.user.token}
                    />
                </div>
            )}

        </div>
    </div>
}

export const sessionRoute: RouteObject = {
    Component,
    loader,
}

type MessageFooterProps = {
    session: Session,
    comments: CommentMessage[],
    scores: Score[],
    run: Run,
    listParams: ReturnType<typeof getListParams>,
    item: SessionItem,
    itemConfig?: SessionItemConfig,
    onSelect: () => void,
    isSelected: boolean,
    isSmallSize: boolean,
    isLastRunItem: boolean,
    isOutput: boolean,
    allStats?: SessionsStats,
}


/**
 * ACTION BAR DESIGN GUIDELINES:
 * - we must start with the "Pill", that must be quite minimalistic, otherwise everything is too heavy.
 * - the pill with "md" size looks good, it's almost like in Notion, just 2px higher and this allows font 14px to be set (the same as in the button)
 * - this in turn makes it look good with buttons from shadcn. Ghost, sm.
 * - clickable height 32px
 * - outline buttons should be avoided, but if you want to use them, use outline xs. Look fine.
 * 
 * Problem?
 * - pills in comments must be "xs", otherwise are too large. It'd be good to have 1 type of pill. But either we keep it Notion-like *or* look good with off-the-shelf shadcn.
 */


function MessageFooter(props: MessageFooterProps) {
    const { session, run, listParams, item, comments, scores, itemConfig, onSelect, isSelected, isSmallSize, isLastRunItem, isOutput, allStats } = props;
    const [scoreDialogOpen, setScoreDialogOpen] = useState(false);

    const allScoreConfigs = itemConfig?.scores ?? [];

    const actionBarScores = allScoreConfigs.filter(scoreConfig => scoreConfig.actionBarComponent);
    const remainingScores = allScoreConfigs.filter(scoreConfig => !scoreConfig.actionBarComponent);

    if (actionBarScores.length === 0 && remainingScores.length === 0 && !isSmallSize && !isLastRunItem) {
        return null;
    }


    let blocks: React.ReactNode[] = [];

    // Error
    if (isLastRunItem && (run.status === "failed" || run.status === "cancelled")) {
        const errorMessage = run.status === "failed" ?
            (run.failReason?.message ?? "Failed for unknown reason") :
            "Cancelled by user";

        blocks.push(<div className="text-md mt-6 mb-3 text-red-500">
            <span className="">{errorMessage}</span>
        </div>);
    }

    // Toolbar
    const toolbarBlocks: React.ReactNode[] = [];

    if (actionBarScores.length > 0) {
        toolbarBlocks.push(...actionBarScores.map((scoreConfig) => (
            <ActionBarScoreForm
                scores={scores}
                key={scoreConfig.name}
                session={session}
                item={item}
                scoreConfig={scoreConfig}
            />
        )));
    }

    if (remainingScores.length > 0) {
        toolbarBlocks.push(<ScoreDialog
            scores={scores}
            session={session}
            item={item}
            open={scoreDialogOpen}
            onOpenChange={setScoreDialogOpen}
            scoreConfigs={remainingScores}
        />);
    }

    if (run.status !== "in_progress" && isLastRunItem) {
        toolbarBlocks.push(<Button variant="ghost" size="sm" asChild>
            <Link to={`/sessions/${session.id}/runs/${run.id}?${toQueryParams(listParams)}`}><InfoIcon className="size-4" />Run</Link>
        </Button>);
    }

    if (toolbarBlocks.length > 0) {
        blocks.push(<div>
            <div className="text-xs flex justify-between gap-2 items-start">
                <div className="flex flex-row flex-wrap gap-1 items-center -ml-2">
                    {toolbarBlocks}
                </div>
            </div>
        </div>)
    }

    // comments
    if (isSmallSize) {
        blocks.push(<div className={`relative mt-4 mb-2`}>
            <CommentsThread
                comments={comments}
                scores={scores}
                item={item}
                session={session}
                selected={isSelected}
                small={true}
                singleLineMessageHeader={true}
                onSelect={onSelect}
                allStats={allStats}
            />
        </div>)
    }

    if (blocks.length > 0) {
        return <div className="mt-3 mb-8">
            {blocks}
        </div>
    }

    return null;
}


function ScoreDialog({ session, item, open, onOpenChange, scoreConfigs, scores }: { session: Session, item: SessionItem, open: boolean, onOpenChange: (open: boolean) => void, scoreConfigs: ScoreConfig[], scores: Score[] }) {
    const { me } = useSessionContext();
    const fetcher = useFetcher();

    const schema = z.object(
        Object.fromEntries(
            scoreConfigs.map((scoreConfig) => [
                scoreConfig.name,
                scoreConfig.schema.optional().nullable()
            ])
        )
    )

    const defaultValues: Record<string, any> = {};
    for (const score of scores ?? []) {
        if (score.deletedAt || score.createdBy !== me.id) {
            continue;
        }
        defaultValues[score.name] = score.value;
    }

    const form = useForm({
        resolver: zodResolver<any, any, any>(schema),
        values: defaultValues
    });

    const submit = (data: z.infer<typeof schema>) => {
        const payload = Object.entries(data).map(([name, value]) => ({ name, value }));

        // @ts-ignore i don't know why but payload as array is not correct body but it's correct JSON.
        fetcher.submit(payload, {
            method: 'patch',
            action: `/sessions/${session.id}/items/${item.id}/scores`,
            encType: 'application/json'
        });
    }

    useFetcherSuccess(fetcher, () => {
        onOpenChange(false);
    });

    useEffect(() => {
        if (!open) {
            form.reset();
        }
    }, [open])

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="sm">
                    <CircleGauge />Scores <ChevronDown />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[450px] p-3">
                <div>
                    <div className="font-medium text-sm mb-4">Scores</div>

                    {fetcher.state === 'idle' && fetcher.data?.ok === false && (
                        <Alert variant="destructive" className="mb-4">
                            <AlertCircleIcon className="h-4 w-4" />
                            <AlertDescription>{fetcher.data.error.message}</AlertDescription>
                        </Alert>
                    )}

                    <HookForm {...form}>
                        <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
                            <div className="space-y-2">
                                {scoreConfigs.map((scoreConfig) => (
                                    <AVFormField
                                        variant="row"
                                        key={scoreConfig.name}
                                        label={scoreConfig.title ?? scoreConfig.name}
                                        name={scoreConfig.name}
                                        control={scoreConfig.inputComponent}
                                    />
                                ))}
                            </div>
                            <div className="flex gap-2 justify-end mt-4">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onOpenChange(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    size="sm"
                                    disabled={fetcher.state !== 'idle'}
                                >
                                    {fetcher.state !== 'idle' ? 'Saving...' : 'Save'}
                                </Button>
                            </div>
                        </form>
                    </HookForm>

                </div>
            </PopoverContent>
        </Popover>
    );
}


function ActionBarScoreForm({ session, item, scoreConfig, scores }: { session: Session, item: SessionItem, scoreConfig: ScoreConfig, scores: Score[] }) {
    const { me } = useSessionContext();
    const fetcher = useFetcher();
    const revalidator = useRevalidator();

    // Get the current score value for this user
    const score = scores.find(
        score => score.name === scoreConfig.name &&
            score.createdBy === me.id &&
            !score.deletedAt
    );

    const [value, setValue] = useState<any>(score?.value ?? null);

    // external data sync
    useEffect(() => {
        setValue(score?.value ?? null);
    }, [score?.value]);

    const ActionBarComponent = scoreConfig.actionBarComponent;

    if (!ActionBarComponent) {
        return null;
    }

    // const isRunning = fetcher.state !== 'idle';

    const submit = async (value: any) => {
        const payload = [{ name: scoreConfig.name, value }];

        // @ts-ignore - fetcher.submit accepts JSON payload
        fetcher.submit(payload, {
            method: 'patch',
            action: `/sessions/${session.id}/items/${item.id}/scores`,
            encType: 'application/json'
        });
    };

    // Handle fetcher errors
    useEffect(() => {
        if (fetcher.state === 'idle' && fetcher.data?.ok === false) {
            console.error(fetcher.data.error);
            alert(fetcher.data.error.message);
        } else if (fetcher.state === 'idle' && fetcher.data?.ok === true) {
            revalidator.revalidate();
        }
    }, [fetcher.state, fetcher.data]);

    return (<form method="post" onSubmit={(e) => { e.preventDefault(); submit(value); }}>
        <ActionBarComponent
            value={value}
            onChange={submit}
            name={scoreConfig.name}
        />
    </form>
    );
}

