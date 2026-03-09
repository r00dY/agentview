import { AlertCircleIcon } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import type { SessionItem, CommentMessage, Session, Score, SessionsStats } from "agentview/apiTypes";
import { Button } from "../ui/button";
import { useFetcherSuccess } from "../../hooks/useFetcherSuccess";
import { timeAgoShort } from "../../lib/timeAgo";
import { AVFormField } from "./form";
import { Alert, AlertDescription } from "../ui/alert";
import { TextEditor, textToElements } from "./TextEditor";
import { useSessionContext } from "../../lib/SessionContext";
import { agentview } from "../../lib/agentview";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form } from "../ui/form";
import React from "react";
import { type AgentViewConfig, type SessionItemConfig } from "agentview/types";
import { UserAvatar } from "./UserAvatar";
import { type Member } from "../../lib/auth-client";

export type CommentsThreadRawProps = {
    session: Session,
    item: SessionItem,
    comments: CommentMessage[],
    scores: Score[],
    itemConfig?: SessionItemConfig,
    collapsed?: boolean,
    singleLineMessageHeader?: boolean,
    small?: boolean,
}

export type CommentsThreadProps = CommentsThreadRawProps & {
    selected: boolean,
    onSelect: (item: any) => void,
    allStats?: SessionsStats,
}

export type CommentSessionFloatingButtonProps = CommentsThreadProps & {
    session: Session,
    item: SessionItem,
    onSelect: (item: any) => void,
}

type StackedCommentMessage = CommentMessage & {
    scores: Score[],
}

function getStackedCommentMessages(messages: CommentMessage[]): StackedCommentMessage[] {
    const result: StackedCommentMessage[] = [];
    let i = 0;

    while (i < messages.length) {
        const currentMessage = messages[i];
        const currentUserId = currentMessage.userId;

        // Start a new group for this user
        const groupScores: Score[] = [];
        let groupContent: CommentMessage | null = null;
        let groupStartIndex = i;

        // Collect consecutive messages from the same user
        while (i < messages.length && messages[i].userId === currentUserId) {
            const msg = messages[i];

            if (msg.score !== null) {
                // This message has a score
                groupScores.push(msg.score);
            } else if (msg.content !== null && msg.content.trim() !== '') {
                // This message has content
                if (groupContent === null) {
                    groupContent = msg;
                } else {
                    // If we already have content, this breaks the group
                    // Start a new group from this message
                    break;
                }
            }

            i++;
        }

        // Create the result entry
        // Use the first message of the group as the base, or the content message if exists
        const baseMessage = groupContent || messages[groupStartIndex];

        result.push({
            ...baseMessage,
            scores: groupScores,
        });
    }

    return result;
}

export const CommentsThreadRaw = forwardRef<any, CommentsThreadRawProps>(({ session, item, itemConfig, collapsed = false, singleLineMessageHeader = false, small = false, comments, scores }, ref) => {
    const { organization: { members }, me } = useSessionContext();
    const fetcher = useFetcher();

    // const visibleMessages = item.commentMessages.filter((m: any) => !m.deletedAt) ?? []

    const stackedMessages = getStackedCommentMessages(comments);
    const hasZeroVisisbleComments = stackedMessages.length === 0

    const [comment, setComment] = useState("");

    const submit = () => {
        fetcher.submit({ comment }, { method: 'post', action: `/sessions/${session.id}/items/${item.id}/comments`, encType: 'application/json' })
    }

    useFetcherSuccess(fetcher, () => {
        setComment("");
    });

    useImperativeHandle(ref, () => ({
        reset: () => {
            setComment("");
        }
    }));

    return (<div ref={ref}>
        {stackedMessages.length > 0 && <div className={`flex flex-col gap-4 ${small ? "p-3" : "p-6"}`}>

            {/* Display comments */}
            {stackedMessages.map((message: any, index: number) => {
                const count = stackedMessages.length;

                let compressionLevel: MessageCompressionLevel = "none";

                if (message.deletedAt) {
                    return null
                }

                if (collapsed) {
                    if (count === 1) {
                        compressionLevel = "high"
                    }
                    else {
                        compressionLevel = "medium";
                        if (count >= 3 && index != 0 && index != count - 1) {

                            if (index === 1) {
                                return (
                                    <div className="flex items-center" key="separator">
                                        <hr className="flex-grow border-gray-300" />
                                        <span className="mx-2 text-xs text-muted-foreground px-2 rounded select-none">
                                            {count - 2} more comment{(count - 2) > 1 ? "s" : ""}
                                        </span>
                                        <hr className="flex-grow border-gray-300" />
                                    </div>
                                )
                            }
                            return null
                        }
                    }
                }

                return <CommentMessageItem
                    key={message.id}
                    message={message}
                    fetcher={fetcher}
                    item={item}
                    itemConfig={itemConfig}
                    session={session}
                    compressionLevel={compressionLevel}
                    singleLineMessageHeader={singleLineMessageHeader}
                />
            })}

        </div>}

        {!collapsed && stackedMessages.length > 0 && <div className={`${small ? "px-3" : "px-4"} max-w-2xl`}></div>}

        {!collapsed && <div className={`max-w-xl ${small ? "p-3" : "p-6"}`}>

            <div className="flex flex-row gap-2">

                <UserAvatar image={me.image} className="flex-shrink-0 mt-[6px]"/>

                <div className="flex-1">
                    {fetcher.state === 'idle' && fetcher.data?.ok === false && (
                        <Alert variant="destructive" className="mb-4">
                            <AlertCircleIcon className="h-4 w-4" />
                            <AlertDescription>{fetcher.data.error.message}</AlertDescription>
                        </Alert>
                    )}

                    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-2">
                        <div>
                            <TextEditor
                                mentionItems={members.filter((member) => member.userId !== me.id).map(member => ({
                                    id: member.userId,
                                    label: member.user.name ?? "Unknown"
                                }))}
                                placeholder={(hasZeroVisisbleComments ? "Comment" : "Reply") + " or tag other, using @"}
                                className="min-h-[10px] resize-none mb-0"
                                value={comment}
                                onChange={(value) => setComment(value ?? "")}
                            />
                        </div>
                        <div className={`gap-2 justify-end mt-2 flex ${ comment.trim() === "" ? "hidden" : ""}`}>
                            <Button
                                type="reset"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setComment("");
                                }}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                size="sm"
                                disabled={fetcher.state !== 'idle' || comment.trim() === ""}
                            >
                                {fetcher.state !== 'idle' ? 'Sending...' : 'Send'}
                            </Button>
                        </div>


                    </form>
                </div>


            </div>
        </div>}

    </div>
    );
});

export function CommentsThread({ session, item, itemConfig, selected = false, onSelect, allStats, comments, scores }: CommentsThreadProps) {
    const commentThreadRef = useRef<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const revalidator = useRevalidator();

    useEffect(() => {
        if (!selected) {
            commentThreadRef.current?.reset();
        }
    }, [selected])

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        const itemStats = allStats?.sessions?.[session.id]?.items?.[item.id];
        
        if (itemStats && itemStats.unseenEvents.length > 0) {
            const observer = new IntersectionObserver(
                (entries) => {
                    entries.forEach((entry) => {
                        if (entry.isIntersecting) {
                            agentview.markSeen({ sessionItemId: item.id })
                                .then(() => revalidator.revalidate())
                                .catch((error) => console.error(error))
                            observer.disconnect();
                        }
                    });
                },
                { threshold: 0.1 }
            );
    
            observer.observe(element);
    
            return () => observer.disconnect();
        }

    }, [])

    useEffect(() => {
        const handlePointerDownOutside = (e: PointerEvent) => {
            const target = e.target as Element | null;

            if (!target) return;

            const isClickingItem = target.closest('[data-item]');
            const isClickingComment = target.closest('[data-comment]');
            const isClickingPortal = target.closest('[data-radix-popper-content-wrapper]')

            // Deselect if clicking outside both item and comment areas
            if (!isClickingItem && !isClickingComment && !isClickingPortal) {
                onSelect(null);
            }
        };

        document.addEventListener('pointerdown', handlePointerDownOutside);
        return () => document.removeEventListener('pointerdown', handlePointerDownOutside);
    }, []);

    return (
        <div ref={containerRef} className={`rounded-lg ${selected ? "bg-white border" : "bg-neutral-50"}`} data-comment={true} onClick={(e) => {
            if (!selected) {
                onSelect(item)
            }
        }}>
            <CommentsThreadRaw
                comments={comments}
                scores={scores}
                session={session}
                item={item}
                itemConfig={itemConfig}
                collapsed={!selected}
                ref={commentThreadRef}
                small={true}
                singleLineMessageHeader={true}
            />
        </div>
    );
}


export function CommentMessageHeader({ title, subtitle, actions, singleLineMessageHeader = false, member }: { title: string, subtitle?: string, actions?: React.ReactNode, singleLineMessageHeader?: boolean, member: Member }) {

    if (singleLineMessageHeader) {
        return <div className="flex flex-row justify-between mb-1">

            <div className="flex flex-row items-center gap-2">
                <UserAvatar image={member.user.image} className="flex-shrink-0"/>
                <div className="text-sm font-medium">
                    {title}
                </div>
                <div className="text-xs text-neutral-400">
                    {subtitle}
                </div>
            </div>
            {actions}
        </div>
    }

    return <div className="flex items-center gap-2 mb-1">
        {/* Thumbnail */}
        <div
            className="w-8 h-8 rounded-full bg-neutral-300 flex-shrink-0"
            style={{ width: 32, height: 32 }}
        />
        <div className="flex-1">
            <div className="flex items-start justify-between">
                <div>
                    <div className="text-sm font-medium ">
                        {title}
                    </div>
                    <div className="text-xs text-neutral-400">
                        {subtitle}
                    </div>
                </div>
                {actions}
            </div>
        </div>
    </div>
}

type MessageCompressionLevel = "none" | "medium" | "high";

// New subcomponent for comment message item with edit logic
export function CommentMessageItem({ message, item, itemConfig, session, compressionLevel = "none", singleLineMessageHeader = false }: { message: StackedCommentMessage, fetcher: any, item: SessionItem, itemConfig?: SessionItemConfig, session: Session, compressionLevel?: MessageCompressionLevel, singleLineMessageHeader?: boolean }) {
    if (message.deletedAt) {
        throw new Error("Deleted messages don't have rendering code.")
    }

    const { me, organization: { members } } = useSessionContext();
    const author = members.find((m) => m.userId === message.userId);
    if (!author) {
        throw new Error("Author not found");
    }

    const fetcher = useFetcher();
    // const isOwn = author.id === me.id;

    const createdAt = timeAgoShort(message.createdAt);
    const subtitle = createdAt + (message.updatedAt && message.updatedAt !== message.createdAt ? " · edited" : "")

    const [isEditing, setIsEditing] = useState(false);

    const schema = z.object({
        comment: z.string()
    }).partial();

    const form = useForm({
        resolver: zodResolver(schema),
        defaultValues: {
            comment: message.content ?? undefined,
            // scores: scores
        }
    });

    const submit = (data: z.infer<typeof schema>) => {
        fetcher.submit(data as any, { method: 'put', action: `/sessions/${session.id}/items/${item.id}/comments/${message.id}`, encType: 'application/json' })
    }

    useFetcherSuccess(fetcher, () => {
        setIsEditing(false);
    });

    // score configs
    const getScoreConfig = (score: Score) => {
        return itemConfig?.scores?.find((scoreConfig) => scoreConfig.name === score.name);
    }

    return (
        <div>
            <CommentMessageHeader title={author.user.name ?? author.user.email} subtitle={subtitle} singleLineMessageHeader={singleLineMessageHeader} member={author} />

            <div className="text-sm ml-8">
                {isEditing ? (<div>

                    {fetcher.state === 'idle' && fetcher.data?.ok === false && (
                        <Alert variant="destructive" className="mb-4">
                            <AlertCircleIcon className="h-4 w-4" />
                            <AlertDescription>{fetcher.data.error.message}</AlertDescription>
                        </Alert>
                    )}

                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(submit)} className="space-y-2">
                            <AVFormField
                                key={"comment"}
                                label={"Comment"}
                                name={"comment"}
                                control={(props) => <TextEditor
                                    mentionItems={members.filter((member) => member.userId !== me.id).map(member => ({
                                        id: member.userId,
                                        label: member.user.name ?? "Unknown"
                                    }))}
                                    placeholder={"Edit or tag others, using @"}
                                    className="min-h-[10px] resize-none mb-0"
                                    {...props}
                                />}
                            />

                            <div className="flex gap-2 mt-1">
                                <Button type="submit" size="sm" disabled={fetcher.state !== 'idle'}>
                                    {fetcher.state !== 'idle' ? 'Saving...' : 'Save'}
                                </Button>
                                <Button
                                    type="reset"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        form.reset();
                                        setIsEditing(false);
                                    }}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </form>
                    </Form>

                </div>) : <div className="space-y-2">

                    <div className="space-y-2">
                        {message.scores.map((score) => {
                            const scoreConfig = getScoreConfig(score)!;
                            if (!scoreConfig) {
                                return null;
                            }
                            return (
                                <div key={score.name}>
                                    {scoreConfig.displayComponent && <scoreConfig.displayComponent value={score.value} />}
                                </div>
                            )
                        })}
                    </div>

                    {message.content && <div className={`${compressionLevel === "high" ? "line-clamp-6" : compressionLevel === "medium" ? "line-clamp-3" : ""}`}>
                        {textToElements(message.content, members.map((member) => ({
                            id: member.userId,
                            label: member.user.name ?? "Unknown"
                        })))}
                    </div>}
                </div>}
            </div>
        </div>
    );
}
