import { zodResolver } from "@hookform/resolvers/zod";
import { type ChannelMessage, type CommentMessage, type InputTarget, type StandardRun, type Score, type Session, type SessionBase, type SessionItem, type SessionsStats, type SessionStats, type StandardSession, type RunBase } from "agentview/apiTypes";
import { findAgentConfig, findAgentConfigBySession, findItemConfigById, findRunConfig, requireAgentConfigByName, requireAgentConfigBySession } from "agentview/baseConfigUtils";
import { enhanceSession, getActiveRuns, getAllSessionItems, getLastRun } from "agentview/sessionUtils";
import { unwrapError } from "agentview";
import type { AgentConfig, AgentInputComponent, InputUIMessage, ScoreConfig, UserMessageDisplayComponent } from "../types";
import { AlertCircleIcon, Brain, ChevronDown, CircleGauge, Ellipsis, InfoIcon, Loader2, Lock, MessageCirclePlus, RotateCcw, UserIcon, UsersIcon, Wrench } from "lucide-react";
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
import { AssistantMessage, Step, StepContent, StepTitle, UserMessage, UserMessageInput } from "../components/session-item";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Form as HookForm } from "../components/ui/form";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
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
import { useChat } from '@ai-sdk/react'
import type { UIMessage } from "ai"

type PartDisplayProps = { value: UIMessage['parts'][number], session: Session };

async function loader({ request, params, context }: LoaderFunctionArgs) {
    const sessionId = params.id!;

    try {
        const shouldLoadImmediately = !window.location.pathname.includes(`/sessions/${sessionId}`);

        const [session, comments, scores] = shouldLoadImmediately ?
            [agentview().sessions.getCached(sessionId), agentview().comments.listCached({ sessionId }), agentview().scores.listCached({ sessionId })] :
            await Promise.all([agentview().sessions.get(sessionId), agentview().comments.list({ sessionId }), agentview().scores.list({ sessionId })] as const);

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
    const { sessions, allStats } = useOutletContext<{ sessions?: SessionBase[], allStats?: SessionsStats }>() ?? {};
    const sessionBase = sessions?.find((s) => s.id === sessionId);
    const sessionStats = allStats?.sessions?.[sessionId];

    console.log('session base', sessionBase);
    console.log('session', session);

    // Stage 1: No data at all - show loader
    if (!sessionBase && !session) {
        return <div className="pt-6"><LoadingIndicator /></div>;
    }

    // Stage 2: Have sessionBase but not full data - show header only
    if (!session || !comments || !scores) {
        return <SessionPageSkeleton sessionBase={sessionBase!} key={sessionBase!.id} />;
    }

    // Stage 3: Full data available
    return <SessionPage session={session} comments={comments} scores={scores} sessionStats={sessionStats} key={session.id} />;
}

function SessionShell({
    sessionBase,
    agentConfig,
    headerExtra,
    children,
    footer,
    outletContext
}: {
    sessionBase: SessionBase,
    agentConfig?: AgentConfig,
    headerExtra?: React.ReactNode,
    children: React.ReactNode,
    footer?: React.ReactNode,
    outletContext?: any
}) {
    return <>
        <div className="flex-grow-1 border-r flex flex-col">
            <Header className="py-1" trigger={false}>
                <HeaderTitle title={`${sessionBase.title ?? "Untitled"}`} />
                {headerExtra}
            </Header>
            <div className="flex-1 overflow-y-auto">
                <div className="p-6 border-b">
                    <SessionDetails sessionBase={sessionBase} agentConfig={agentConfig} />
                </div>
                {children}
            </div>
            {footer}
        </div>
        <Outlet context={outletContext} />
    </>;
}

function SessionPageSkeleton({ sessionBase }: { sessionBase: SessionBase }) {
    const agentConfig = findAgentConfigBySession(config, sessionBase);

    return (
        <SessionShell sessionBase={sessionBase} agentConfig={agentConfig}>
            <div className="p-6">
                <LoadingIndicator />
            </div>
        </SessionShell>
    );
}

type CommentsThreadData = { target: InputTarget, comments: CommentMessage[], scores?: Score[], scoreConfigs?: ScoreConfig[] };

type SendMessageFunction = ReturnType<typeof useChat>['sendMessage'];

type WallItem = {
    id: string,
    element: React.ReactNode,
    commentsAndScores?: CommentsThreadData,

    // run settings
    run?: {
        id: string,
        status: string,
        reason: any,
    }

    messageId?: string,

    // is last run item -> show run footer
    showRunFooter?: boolean
};


/**
 * Get incoming channel messages for a specific run or unassigned ones.
 * With runId: returns incoming messages assigned to that run via runId.
 * Without runId: returns incoming messages not assigned to any run.
 */
function getIncomingChannelMessages(session: Session, runId?: string): ChannelMessage[] {
    const channelMessages = session.channelMessages ?? [];
    const incoming = channelMessages.filter(m => m.direction === 'incoming' && !m.internal);

    if (runId) {
        return incoming.filter(m => m.runId === runId);
    }

    // Unassigned: no runId
    return incoming.filter(m => !m.runId);
}

function SessionPage(props: { session: Session, comments: CommentMessage[], scores: Score[], sessionStats?: SessionStats }) {
    const loaderData = useLoaderData<typeof loader>();
    const revalidator = useRevalidator();
    const navigate = useNavigate();
    const { me } = useSessionContext();
    const { sessionStats, session: initialSession } = props;

    const getUnseenEvents = (target: InputTarget): any[] | undefined => {
        return sessionStats?.inboxItems?.find(i =>
            i.sessionId === target.sessionId &&
            i.runId === (target.runId ?? null) &&
            (i.sessionItemId === (target.sessionItemId ?? null) || i.sessionItemIndex === (target.sessionItemIndex ?? null)) &&
            i.runId === (target.runId ?? null) &&
            i.channelMessageId === (target.channelMessageId ?? null)
        )?.unseenEvents;
    };

    console.log('initial session', initialSession);
    return <div>session</div>

    const [initialResume] = useState(initialSession.status === 'in_progress');

    const { messages, sendMessage: sendMessage_, status, error, regenerate, setMessages } = useChat({
        id: initialSession.id,
        generateId: () => crypto.randomUUID(),
        messages: initialSession.messages,
        resume: initialResume,
        // transport: agentview().asUser({ id: initialSession.user.id }).createTransport(),
        transport: agentview().createTransport(),
    });

    const isRunning = (status === 'streaming' || status === 'submitted');

    // Revalidate when we start streaming (initialSession could have become active) 
    useEffect(() => {
        if (!initialSession.active && status === 'streaming') {

            /**
             * TODO: clear cache here. Lists gets updated.
             */
            revalidator.revalidate();
        }
    }, [initialSession.active, status]);

    const session = {
        ...initialSession,
        messages,
    }

    /**
     * ERROR HANDLING
     * 
     * There are 2 types of errors:
     * - error while streaming after run was created (assistant message exists)
     * - error *before* streaming and before run was created (no run, therefore no assistant message).
     * 
     * Streaming errors:
     * 
     * They're stored in assistant message metadata. We use this info OVER the `error` from `useChat`.
     * It's because when app is reloaded the `error` is gone anyway, and if we use the one from assistant message metadata, it's still there.
     * Also, we might actually show errors in previous messages, if the session was continued with error run (or aborted).
     * 
     * Connection errors:
     * 
     * Here we don't have any other way than use `error` from `useChat`. `useChat` optimistically adds user message, and we can't override this.
     * The UX is not super good... after reload the "temporary" user message disappears which I don't really like.
     * But for now it's good enough.
     */

    const localError = error && (messages.length > 0 && messages[messages.length - 1]?.role === "user") && unwrapError(error); // local uncommited error from useChat

    const sendMessage: typeof sendMessage_ = (input) => {
        if (localError) {
            setMessages(messages.slice(0, -1));
        }
        return sendMessage_(input);
    }

    /**
     * Build the wall
     */
    const agentConfig = findAgentConfigBySession(config, session);

    const wallItems: WallItem[] = [];

    // Check if all incoming channel messages belong to the session user (single talker)
    const allIncoming = (session.channelMessages ?? []).filter(m => m.direction === 'incoming');
    const isSingleTalker = allIncoming.length > 0 && allIncoming.every(m =>
        (m.authorEmail && m.authorEmail === session.user.email) ||
        (!m.authorEmail && m.authorName && m.authorName === session.user.name)
    );

    function addChannelMessages(channelMessages: ChannelMessage[]) {
        channelMessages.forEach((channelMessage) => {

            let header: React.ReactNode | undefined = undefined;

            if (!isSingleTalker) {
                let name: React.ReactNode | null = null;
                let headline: string | null = channelMessage.authorHeadline;
                if (channelMessage.authorName && channelMessage.authorEmail) {
                    name = <><span className="text-sm font-semibold">{channelMessage.authorName}</span> <span className="text-sm text-muted-foreground">&lt;{channelMessage.authorEmail}&gt;</span></>
                }
                else if (channelMessage.authorName) {
                    name = <span className="text-sm font-semibold">{channelMessage.authorName}</span>;
                }
                else if (channelMessage.authorEmail) {
                    name = <span className="text-sm font-semibold">{channelMessage.authorEmail}</span>;
                }

                if (name || headline) {
                    header = <div>
                        <div>{name}</div>
                        {headline && <div className="text-sm text-muted-foreground">{headline}</div>}
                    </div>
                }
            }

            const element = <div className="pl-[10%] relative">
                <UserMessage header={header}>
                    {/* {header} */}
                    {channelMessage.text}
                </UserMessage>
            </div>

            wallItems.push({
                id: channelMessage.id,
                element,
                commentsAndScores: {
                    target: { sessionId: session.id, channelMessageId: channelMessage.id },
                    comments: props.comments.filter((c) => c.channelMessageId === channelMessage.id),
                },
            })
        });
    }


    messages.forEach((message, index) => {

        /**
         * Here we assume that there might be temporary moments when run is undefined:
         * - when user message is in array but assistant is not yet there (obvious case)
         * - when assistant message was just added (I think it's possible that assitant shows up with random id first, and only then 'message-start' with metadata comes).
         */
        const runMetadata = message.role === "user" ? messages[index + 1]?.metadata?._agentview : message.metadata?._agentview;
        const run = runMetadata?.id ? {
            id: runMetadata.id,
            status: runMetadata.status,
            reason: runMetadata.reason,
        } : undefined;

        if (message.role === "user") {
            if (session.channel.type === 'api') {

                if (agentConfig?.run?.userMessage?.displayComponent === null) {
                    return;
                }

                const Component = agentConfig?.run?.userMessage?.displayComponent ?? DefaultUserMessageDisplayComponent;
                const element = <div className="pl-[10%] relative">
                    <Component value={message} session={session} />
                </div>

                const commentsAndScores: CommentsThreadData | undefined = run && {
                    target: { sessionId: session.id, runId: run.id, sessionItemIndex: 0 },
                    comments: props.comments.filter((c) => c.sessionItemIndex === 0 && c.runId === run.id),
                };

                wallItems.push({
                    id: message.id,
                    element,
                    commentsAndScores,
                    run,
                    messageId: message.id,
                })
            }
            else {
                const incomingMessages = run
                    ? getIncomingChannelMessages(session, run.id)
                    : [];

                addChannelMessages(incomingMessages);

                // for (const channelMessage of incomingMessages) {
                //     const element = <div className="pl-[10%] relative">
                //         <UserMessage>{channelMessage.text}</UserMessage>
                //     </div>

                //     const commentsAndScores: CommentsThreadData | undefined = {
                //         target: { sessionId: session.id, channelMessageId: channelMessage.id },
                //         comments: props.comments.filter((c) => c.channelMessageId === channelMessage.id),
                //     }

                //     wallItems.push({
                //         id: channelMessage.id,
                //         element,
                //         commentsAndScores,
                //         run,
                //         messageId: message.id,
                //     })
                // }
            }
        }
        else if (message.role === "assistant") {
            const isLast = index === messages.length - 1;

            const status = message.metadata?._agentview?.status;
            const reason = message.metadata?._agentview?.reason;

            /**
             * OUTPUT PARTS HEURISTICS 
             *
             * Here we need to split parts into step parts and output parts. There are 2 reasons for this:
             * - scores belong to the run and should be displayed with comments in a single thread
             * - we might collapse steps in the future and just show output (like ChatGPT / Claude)
             * 
             * Since in 99% of cases the output is single 'text' node (potentially with some data nodes), we can make it super simply.
             * 
             * Algorithm: we essentially take all the "last consecutive blocks" that don't have any 'step-start', 'reasoning' or tool parts.
             * 
             * Btw, this is 100% UI only!
             * 
             * Also, output squashing only applies to 'completed' runs. For cancelled / eror runs we have no idea whether output is actually there (probably not, as run was interrupted), so we display error state as a wall item that represents the run.
             */

            const relevantParts = message.parts.filter((part) => {
                if (part.type.startsWith('data-agentview-')) {
                    return false;
                }
                return true;
            });
            
            const stepParts: UIMessage['parts'][number][] = [];
            const outputParts: UIMessage['parts'][number][] = [];

            // only for completed runs we try to select output parts
            if (status === 'completed') {
                relevantParts.forEach((part, index) => {
                    if (part.type === 'step-start' || part.type === 'reasoning' || part.type.startsWith('tool-')) { // reasoning or step-start "resets" and pushes all speculated output parts into step parts
                        stepParts.push(...outputParts);
                        outputParts.length = 0;
                        stepParts.push(part);
                    }
                    // else if (outputParts.length === 0 && part.type !== 'text') {
                    //     stepParts.push(part);
                    // }
                    else {
                        outputParts.push(part);
                    }
                });
            }
            else {
                stepParts.push(...relevantParts);
            }

            /**
             * Get display component for a part: config override first, then defaults.
             */
            const getPartComponent = (part: UIMessage['parts'][number]): React.ComponentType<PartDisplayProps> | null => {
                const partConfig = agentConfig?.run?.assistantMessage?.parts?.find(p => p.type === part.type);
                if (partConfig?.displayComponent !== undefined) {
                    return partConfig.displayComponent as React.ComponentType<PartDisplayProps> | null;
                }

                switch (part.type) {
                    case "text":
                        return DefaultTextPartComponent;
                    case "reasoning":
                        return DefaultReasoningPartComponent;
                    case "step-start":
                        return null;
                    default:
                        if (part.type.startsWith("tool-")) {
                            return DefaultToolPartComponent;
                        }
                        return DefaultPartComponent;
                }
            }


            // step parts (separate wall items)
            for (const [index, part] of stepParts.entries()) {
                const Component = getPartComponent(part);

                if (Component === null) {
                    continue;
                }

                const element = <Component value={part} session={session} />

                let commentsAndScores: CommentsThreadData | undefined = run && {
                    target: { sessionId: session.id, runId: run.id, sessionItemIndex: index + 1 },
                    comments: props.comments.filter((c) => c.sessionItemIndex === index + 1 && c.runId === run.id),
                };

                wallItems.push({
                    id: message.id + "." + index,
                    element,
                    commentsAndScores,
                    run,
                    messageId: message.id,
                })
            }

            // LAST ITEM - run level
            let runCommentsAndScores: CommentsThreadData | undefined = undefined;
            if (run) {
                const runScoreConfigs = agentConfig?.run?.scores ?? []
                const runComments: CommentMessage[] = props.comments.filter((c) => c.runId === run.id && !c.channelMessageId && !c.sessionItemId);
                const runScores: Score[] = props.scores.filter((s) => s.runId === run.id && !s.channelMessageId && !s.sessionItemId);
                const runTarget: InputTarget = { sessionId: session.id, runId: run.id };

                runCommentsAndScores = {
                    target: runTarget,
                    comments: runComments,
                    scoreConfigs: runScoreConfigs,
                    scores: runScores,
                };
            }

            const showRunFooter = !isLast || !isRunning

            /**
             * We only "squash" output parts if run is completed & there are output parts available.
             * In case of error / cancel it's no sense to guess output since there's no output.
             */
            if (status === 'completed') {
                if (outputParts.length > 0) {
                    const elements: React.ReactNode[] = [];
                    for (const [index, part] of outputParts.entries()) {
                        const Component = getPartComponent(part);
                        if (Component === null) {
                            continue;
                        }
                        const element = <Component value={part} session={session} />
                        elements.push(element);
                    }

                    const element = <div className="space-y-4">{elements}</div>

                    wallItems.push({
                        id: message.id,
                        element,
                        commentsAndScores: runCommentsAndScores,
                        run,
                        showRunFooter,
                        messageId: message.id,
                    })
                }
                else {
                    wallItems.push({
                        id: message.id,
                        element: <div className="italic text-muted-foreground">No output parts</div>, // edge case -> completed run -> no output parts.
                        commentsAndScores: runCommentsAndScores,
                        run,
                        showRunFooter,
                        messageId: message.id,
                    })
                }
            }
            else {
                let element: React.ReactNode;

                if (status === "failed") {
                    element = <div className="text-md text-red-500">
                        <span className="">{reason?.message ?? "Failed for unknown reason"}</span>
                    </div>;
                }
                else if (status === "cancelled") {
                    element = <div className="text-md text-muted-foreground italic">
                        <span className="">Cancelled by user.</span>
                    </div>;
                }
                else {
                    return; // in_progress
                }

                wallItems.push({
                    id: message.id,
                    element, // edge case -> completed run -> no output parts.
                    commentsAndScores: runCommentsAndScores,
                    run,
                    showRunFooter,
                    messageId: message.id,
                })
            }
        }
    })


    // Pending channel messages: incoming messages not yet consumed by any run
    if (session.channel.type !== 'api') {
        const pendingMessages = getIncomingChannelMessages(session);

        addChannelMessages(pendingMessages);

        // pendingMessages.forEach((channelMessage) => {
        //     const element = <div className="pl-[10%] relative">
        //         <UserMessage>{channelMessage.text}</UserMessage>
        //     </div>

        //     wallItems.push({
        //         id: channelMessage.id,
        //         element,
        //         commentsAndScores: {
        //             target: { sessionId: session.id, channelMessageId: channelMessage.id },
        //             comments: props.comments.filter((c) => c.channelMessageId === channelMessage.id),
        //         },
        //     })
        // });
    }

    const cancelRun = async () => {
        console.log('cancelling run');
        agentview().sessions.cancelRun(session.id)
    }

    const listParams = loaderData.listParams;

    const searchParams = new URLSearchParams(window.location.search);
    const selectedItemId = searchParams.get('itemId') ?? undefined;

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
        // Session-level inbox items: no runId, sessionItemId, or channelMessageId
        const sessionLevelUnreads = sessionStats?.inboxItems?.some(i => !i.runId && !i.sessionItemId && !i.channelMessageId && i.unseenEvents.length > 0);
        if (sessionLevelUnreads) {
            agentview().comments.markSeen({ sessionId: session.id }) // only mark as seen if there are unseen events (do not overload backend and clean cache unnecessarily)
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
            agentConfig={agentConfig}
            headerExtra={<SessionHeaderActions session={session} isMine={session.user.ownerId === me.id} />}
            footer={session.user.ownerId === me.id && session.channel.type === 'api' ? <InputForm session={session} agentConfig={agentConfig} styles={styles} sendMessage={sendMessage} cancelRun={cancelRun} isRunning={isRunning} /> : undefined}
            outletContext={{ session }}
        >
            <div ref={bodyRef}>
                <ItemsWithCommentsLayout items={wallItems.map((wallItem, index) => {
                    const isLastWallItem = index === wallItems.length - 1;

                    const { id, element, commentsAndScores, showRunFooter, run } = wallItem;

                    const isSelected = selectedItemId === wallItem.id;
                    const hasComments = commentsAndScores ? commentsAndScores.comments.length > 0 : false;

                    return {
                        id,
                        itemComponent: <div
                            className={`relative group`}
                        >
                            {!styles.isSmallSize && <div className={`absolute text-muted-foreground text-xs font-medium flex flex-row gap-1 z-10`} style={{ left: `${styles.padding + styles.textWidth + styles.commentButtonPadding}px` }}>
                                {!isSelected && commentsAndScores && <Button className="group-hover:visible invisible" variant="outline" size="icon_xs" onClick={() => { setselectedItemId(wallItem.id) }}>
                                    <MessageCirclePlus className="size-3" />
                                </Button>}
                            </div>}

                            <div className={`relative`} style={{ marginLeft: `${styles.padding}px`, width: `${styles.textWidth}px` }}>

                                <div data-item /*onClick={() => { setselectedItemId(item.id) }}*/ >
                                    <ErrorBoundary>
                                        {element}
                                    </ErrorBoundary>
                                </div>

                                {isLastWallItem && isRunning && <div className="text-muted-foreground mt-6">
                                    <Loader />
                                </div>}

                                {isLastWallItem && localError && <div className="text-muted-foreground mt-6">
                                    <span className="text-red-500">{localError.message}</span>
                                </div>}

                                {showRunFooter && <RunFooter
                                    session={session}
                                    run={run}
                                    commentsAndScores={commentsAndScores}
                                    listParams={listParams}
                                    isSelected={isSelected}
                                    isSmallSize={styles.isSmallSize}
                                    regenerate={() => {
                                        if (wallItem.messageId) {
                                            regenerate({ messageId: wallItem.messageId });
                                        }
                                    }}
                                />}

                            </div>
                        </div>,
                        commentsComponent: !styles.isSmallSize && (hasComments || (isSelected)) && commentsAndScores ?
                            <CommentsThread
                                target={commentsAndScores.target}
                                selected={isSelected}
                                onSelect={(a) => {
                                    if (a) {
                                        setselectedItemId(wallItem.id);
                                    }
                                    else {
                                        setselectedItemId(undefined);
                                    }
                                }}
                                unseenEvents={getUnseenEvents(commentsAndScores.target)}
                                comments={commentsAndScores.comments}
                                scoreConfigs={commentsAndScores.scoreConfigs}
                            /> : undefined
                    }
                })}
                    selectedItemId={selectedItemId}
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


function SessionDetails({ sessionBase, agentConfig }: { sessionBase: SessionBase, agentConfig?: AgentConfig }) {
    const { organization: { members } } = useSessionContext();
    const owner = members.find((member) => member.userId === sessionBase.user.ownerId);

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
                        {owner ? <>Playground of <span className="text-cyan-700">{owner.user.name}</span></> : "Production"}
                    </PropertyListTextValue>
                </PropertyListItem>
                <PropertyListItem>
                    <PropertyListTitle>Channel</PropertyListTitle>
                    <PropertyListTextValue>
                        {sessionBase.channel.type} {sessionBase.channel.type === 'api' ? `(${sessionBase.channel.name})` : `(${sessionBase.channel.address})`}
                    </PropertyListTextValue>
                </PropertyListItem>
                <PropertyListItem>
                    <PropertyListTitle>User</PropertyListTitle>
                    <PropertyListTextValue>
                        {(() => {
                            const user = sessionBase.user;
                            const displayName = user.name || user.email;
                            if (!displayName) return <span className="text-muted-foreground">Anonymous</span>;
                            return <a href="#" className="text-cyan-700 hover:underline">
                                {displayName}{user.headline && <span className="text-muted-foreground"> · {user.headline}</span>}
                            </a>;
                        })()}
                    </PropertyListTextValue>
                </PropertyListItem>
                <PropertyListItem>
                    <PropertyListTitle>
                        Agent
                    </PropertyListTitle>
                    <PropertyListTextValue>
                        {!sessionBase.agent && <span className="text-muted-foreground">-</span>}
                        {sessionBase.agent && <Pill>{sessionBase.agent.name}@{sessionBase.agent.version}</Pill>}
                    </PropertyListTextValue>
                </PropertyListItem>

                {agentConfig?.displayProperties && <DisplayProperties displayProperties={agentConfig.displayProperties} inputArgs={{ session: sessionBase }} />}
            </PropertyList>
        </div>
    );
}

function SessionHeaderActions({ session, isMine }: { session: Session, isMine: boolean }) {
    return <div className="flex items-center gap-2">
        {isMine && <ShareForm session={session} />}
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon_sm">
                    <Ellipsis className="size-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => console.log(session)}>
                    Print Session to console
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    </div>
}

function ShareForm({ session }: { session: SessionBase }) {
    const fetcher = useFetcher();
    const isProcessing = fetcher.state !== 'idle';
    return <fetcher.Form method="put" action={`/users/${session.user.id}/update`}>
        <input type="hidden" name="space" value={session.user.space === "shared-playground" ? "playground" : "shared-playground"} />
        <Button variant={"outline"} size="sm" type="submit" disabled={isProcessing}>
            {isProcessing ? <Loader2 className="animate-spin" /> : <UsersIcon fill={session.user.space === "shared-playground" ? "black" : "none"} stroke={session.user.space === "shared-playground" ? "none" : "black"} />} {session.user.space === "shared-playground" ? "Shared" : "Share"}
        </Button>
    </fetcher.Form>
}


const DefaultUserMessageDisplayComponent: UserMessageDisplayComponent = ({ value }) => {
    return <UserMessage>{value.parts?.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n\n")}</UserMessage>
}

function DefaultTextPartComponent({ value }: PartDisplayProps) {
    if (value.type !== 'text') {
        throw new Error(`DefaultTextPartComponent expected 'text' part, got ${value.type}`);
    }
    return <AssistantMessage>{value.text}</AssistantMessage>
}

function DefaultReasoningPartComponent({ value }: PartDisplayProps) {
    if (value.type !== 'reasoning') {
        throw new Error(`DefaultReasoningPartComponent expected 'reasoning' part, got ${value.type}`);
    }
    return <Step collapsible>
        <StepTitle><Brain /> Thinking</StepTitle>
        <StepContent>
            {value.text}
        </StepContent>
    </Step>
}

function DefaultToolPartComponent({ value }: PartDisplayProps) {
    const toolName = value.type.substring(5);

    return <Step collapsible>
        <StepTitle><Wrench /> {toolName}</StepTitle>
        <StepContent>
            {value as any}
        </StepContent>
    </Step>
}

function DefaultPartComponent({ value }: PartDisplayProps) {
    return <Step>
        <StepContent>
            {value as any}
        </StepContent>
    </Step>
}

const DefaultUserInputComponent: AgentInputComponent = ({ session, isRunning, cancel, sendMessage }) => {
    const submit = async (stringVal: string) => {
        await sendMessage(stringVal)
    }

    return <UserMessageInput isRunning={isRunning} onCancel={cancel} onSubmit={submit} />
}

function InputForm({ session, agentConfig, styles, sendMessage, cancelRun, isRunning }: { session: Session, agentConfig?: AgentConfig, styles: Record<string, number>, sendMessage: SendMessageFunction, cancelRun: () => Promise<void>, isRunning: boolean }) {
    const submit = async (input: InputUIMessage) => {
        if (typeof input === 'string') {
            input = {
                role: "user",
                parts: [
                    { type: "text", text: input }
                ]
            }
        }

        try {
            await sendMessage(input);
        } catch (error: any) {
            console.error('Error creating run:', error);
            toast.error(`Error: "${error.message}". Check console.`);
        }
    }

    const InputComponent = agentConfig?.inputComponent ?? DefaultUserInputComponent;

    return <div className="border-t">
        <div className={`p-6 pr-0`} style={{ maxWidth: `${styles.textWidth + styles.padding}px` }}>
            {!InputComponent && <div className="text-sm text-muted-foreground">No input component</div>}

            {InputComponent && (
                <div>
                    <InputComponent
                        cancel={cancelRun}
                        sendMessage={submit}
                        isRunning={isRunning}
                        session={session}
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


type RunFooterProps = {
    session: Session,
    listParams: ReturnType<typeof getListParams>,
    isSelected: boolean,
    isSmallSize: boolean,

    commentsAndScores?: CommentsThreadData,
    run: WallItem['run'],

    regenerate: () => void,
}


// : { target, comments, scores = [], scoreConfigs = [] }

function RunFooter(props: RunFooterProps) {
    const { commentsAndScores, isSmallSize, run, session, listParams } = props;
    const [scoreDialogOpen, setScoreDialogOpen] = useState(false);

    if (!run) {
        throw new Error("Run is required in RunFooter");
    }

    let verticalBlocks: React.ReactNode[] = [];

    // // Error
    // if (run.status === "failed") {
    //     blocks.push(<div className="text-md mt-6 mb-3 text-red-500">
    //         <span className="">{run.reason?.message ?? "Failed for unknown reason"}</span>
    //     </div>);
    // }
    // else if (run.status === "cancelled") {
    //     blocks.push(<div className="text-md mt-6 mb-3 text-muted-foreground italic">
    //         <span className="">Cancelled by user.</span>
    //     </div>);
    // }

    // Toolbar
    const runFooterBlocks: React.ReactNode[] = [];

    if (commentsAndScores) {
        const { target, comments, scores = [], scoreConfigs = [] } = commentsAndScores;

        const runFooterScores = scoreConfigs.filter(scoreConfig => scoreConfig.runFooterComponent);
        const remainingScores = scoreConfigs.filter(scoreConfig => !scoreConfig.runFooterComponent);

        if (runFooterScores.length > 0) {
            runFooterBlocks.push(...runFooterScores.map((scoreConfig) => (
                <RunFooterScore
                    scores={scores}
                    key={scoreConfig.name}
                    target={target}
                    scoreConfig={scoreConfig}
                />
            )));
        }

        if (remainingScores.length > 0) {
            runFooterBlocks.push(<ScoresDialog
                key="score-dialog"
                scores={scores}
                target={target}
                open={scoreDialogOpen}
                onOpenChange={setScoreDialogOpen}
                scoreConfigs={remainingScores}
            />);
        }

        runFooterBlocks.push(<Button key="regenerate" variant="ghost" size="icon_sm" onClick={props.regenerate}><RotateCcw className="size-4" /></Button>);
    }

    runFooterBlocks.push(<Button key="run-info" variant="ghost" size="sm" asChild>
        <Link to={`/sessions/${session.id}/runs/${run.id}?${toQueryParams(listParams)}`}><InfoIcon className="size-4" />Run</Link>
    </Button>);

    if (runFooterBlocks.length > 0) {
        verticalBlocks.push(<div key="toolbar">
            <div className="text-xs flex justify-between gap-2 items-start">
                <div className="flex flex-row flex-wrap gap-1 items-center -ml-2">
                    {runFooterBlocks}
                </div>
            </div>
        </div>)
    }

    /**
     * For now commented out. It should PROBABLY be in caller component, not here. Let footer be FOOTER.
     */
    // // comments
    // if (isSmallSize) {
    //     blocks.push(<div className={`relative mt-4 mb-2`}>
    //         <CommentsThread
    //             comments={comments}
    //             target={target}
    //             scoreConfigs={scoreConfigs}
    //             selected={isSelected}
    //             small={true}
    //             singleLineMessageHeader={true}
    //             onSelect={(selected) => { if (selected) onSelect(); }}
    //             unseenEvents={unseenEvents}
    //         />
    //     </div>)
    // }

    if (verticalBlocks.length > 0) {
        return <div className="mt-3 mb-8">
            {verticalBlocks}
        </div>
    }

    return null;
}


// function MessageFooter(props: MessageFooterProps) {
//     const { session, target, run, listParams, comments, scores, scoreConfigs, onSelect, isSelected, isSmallSize, isLastRunItem, unseenEvents } = props;
//     const [scoreDialogOpen, setScoreDialogOpen] = useState(false);

//     const actionBarScores = scoreConfigs.filter(scoreConfig => scoreConfig.runFooterComponent);
//     const remainingScores = scoreConfigs.filter(scoreConfig => !scoreConfig.runFooterComponent);

//     if (actionBarScores.length === 0 && remainingScores.length === 0 && !isSmallSize && !isLastRunItem) {
//         return null;
//     }

//     let blocks: React.ReactNode[] = [];

//     // Error
//     if (isLastRunItem && (run.status === "failed" || run.status === "cancelled")) {
//         const errorMessage = run.status === "failed" ?
//             (run.reason?.message ?? "Failed for unknown reason") :
//             "Cancelled by user";

//         blocks.push(<div className="text-md mt-6 mb-3 text-red-500">
//             <span className="">{errorMessage}</span>
//         </div>);
//     }

//     // Toolbar
//     const toolbarBlocks: React.ReactNode[] = [];

//     if (actionBarScores.length > 0) {
//         toolbarBlocks.push(...actionBarScores.map((scoreConfig) => (
//             <RunFooterScore
//                 scores={scores}
//                 key={scoreConfig.name}
//                 target={target}
//                 scoreConfig={scoreConfig}
//             />
//         )));
//     }

//     if (remainingScores.length > 0) {
//         toolbarBlocks.push(<ScoreDialog
//             scores={scores}
//             target={target}
//             open={scoreDialogOpen}
//             onOpenChange={setScoreDialogOpen}
//             scoreConfigs={remainingScores}
//         />);
//     }

//     if (run.status !== "in_progress" && isLastRunItem) {
//         toolbarBlocks.push(<Button variant="ghost" size="sm" asChild>
//             <Link to={`/sessions/${session.id}/runs/${run.id}?${toQueryParams(listParams)}`}><InfoIcon className="size-4" />Run</Link>
//         </Button>);
//     }

//     if (toolbarBlocks.length > 0) {
//         blocks.push(<div>
//             <div className="text-xs flex justify-between gap-2 items-start">
//                 <div className="flex flex-row flex-wrap gap-1 items-center -ml-2">
//                     {toolbarBlocks}
//                 </div>
//             </div>
//         </div>)
//     }

//     // comments
//     if (isSmallSize) {
//         blocks.push(<div className={`relative mt-4 mb-2`}>
//             <CommentsThread
//                 comments={comments}
//                 target={target}
//                 scoreConfigs={scoreConfigs}
//                 selected={isSelected}
//                 small={true}
//                 singleLineMessageHeader={true}
//                 onSelect={(selected) => { if (selected) onSelect(); }}
//                 unseenEvents={unseenEvents}
//             />
//         </div>)
//     }

//     if (blocks.length > 0) {
//         return <div className="mt-3 mb-8">
//             {blocks}
//         </div>
//     }

//     return null;
// }


function ScoresDialog({ target, open, onOpenChange, scoreConfigs, scores }: { target: InputTarget, open: boolean, onOpenChange: (open: boolean) => void, scoreConfigs: ScoreConfig[], scores: Score[] }) {
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
        const scores = Object.entries(data).map(([name, value]) => ({ name, value }));

        fetcher.submit({ ...target, scores } as any, {
            method: 'patch',
            action: `/scores`,
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


function RunFooterScore({ target, scoreConfig, scores }: { target: InputTarget, scoreConfig: ScoreConfig, scores: Score[] }) {
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

    const RunFooterComponent = scoreConfig.runFooterComponent;

    if (!RunFooterComponent) {
        return null;
    }

    const submit = async (value: any) => {
        const scores = [{ name: scoreConfig.name, value }];

        fetcher.submit({ ...target, scores } as any, {
            method: 'patch',
            action: `/scores`,
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
        <RunFooterComponent
            value={value}
            onChange={submit}
            name={scoreConfig.name}
        />
    </form>
    );
}

