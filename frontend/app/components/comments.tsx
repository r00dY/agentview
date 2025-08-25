import { AlertCircleIcon, EllipsisVerticalIcon } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { config } from "~/agentview.config";
import type { Activity, CommentMessage, Thread, User } from "~/apiTypes";
import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useFetcherSuccess } from "~/hooks/useFetcherSuccess";
import { timeAgoShort } from "~/lib/timeAgo";
import { FormField } from "./form";
import { PropertyList } from "./PropertyList";
import { Alert, AlertDescription } from "./ui/alert";
import { TextEditor, textToElements } from "./wysiwyg/TextEditor";

export type CommentThreadProps = {
    thread: Thread,
    activity: Activity, 
    user: User, 
    users: User[], 
    collapsed?: boolean,
    singleLineMessageHeader?: boolean,
}

export type CommentThreadFloatingBoxProps = CommentThreadProps & {
    selected: boolean,
    onSelect: (activity: any) => void,
}

export type CommentThreadFloatingButtonProps = CommentThreadFloatingBoxProps & {
    thread: Thread,
    activity: Activity, 
    userId: string | null, 
    users: any[], 
    onSelect: (activity: any) => void,
}

export const CommentThread = forwardRef<any, CommentThreadProps>(({ thread, activity, user, collapsed = false, users, singleLineMessageHeader = false }, ref) => {
    const fetcher = useFetcher();

    const visibleMessages = activity.commentMessages.filter((m: any) => !m.deletedAt) ?? []     
    const hasZeroVisisbleComments = visibleMessages.length === 0

    const formRef = useRef<HTMLFormElement>(null);

    // const [currentlyEditedItemId, setCurrentlyEditedItemId] = useState<string | null>("new" /*null*/); // "new" for new comment, comment id for edits

    // Get scores for this activity type from config
    const threadConfig = config.threads.find((t: any) => t.type === thread.type);
    const activityConfig = threadConfig?.activities.find((a: any) => 
        a.type === activity.type && a.role === activity.role
    );
    const scoreConfigs = activityConfig?.scores || [];

    const scores: Record<string, any> = {};
    for (const message of visibleMessages) {
        for (const score of message.scores ?? []) {
            scores[score.name] = score.value;
        }
    }

    const unassignedScoreConfigs = scoreConfigs.filter((scoreConfig) => !scores[scoreConfig.name]);

    useFetcherSuccess(fetcher, () => {
        // setCurrentlyEditedItemId(null);
        // console.log('resetting form')
        formRef.current?.reset();
    });

    useImperativeHandle(ref, () => ({
        reset: () => {
            // setCurrentlyEditedItemId(null);
            formRef.current?.reset();   
        }
    }));

    // const messageScoresMap : Record<string, Score[]> = {}

    // for (const score of activity.scores ?? []) {
    //     if (score.commentId === null) {
    //         continue
    //     }
    //     messageScoresMap[score.commentId].push(score)
    // }

    return (<div ref={ref}>
            {/* Hot reload test comment */}
            <div className="flex flex-col gap-4">

                {/* Display comments */}
                {visibleMessages.map((message: any, index: number) => {
                    const count = visibleMessages.length;

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
                        userId={user.id}
                        fetcher={fetcher}
                        activityId={activity.id}
                        thread={thread}
                        user={users.find((user) => user.id === message.userId)}
                        compressionLevel={compressionLevel}
                        users={users}
                        singleLineMessageHeader={singleLineMessageHeader}
                    />
                })}

            </div>

            {!collapsed && <div className="ml-8 pt-4 border-t mt-4">

                { fetcher.state === 'idle' && fetcher.data?.ok === false && (
                    <Alert variant="destructive" className="mb-4">
                        <AlertCircleIcon className="h-4 w-4" />
                        <AlertDescription>{fetcher.data.error.message}</AlertDescription>
                    </Alert>
                )}


                <fetcher.Form method="post" action={`/threads/${thread.id}/activities/${activity.id}/comments`} ref={formRef}>

                { unassignedScoreConfigs.length > 0 && <div className="mb-4">
                    {unassignedScoreConfigs.map((scoreConfig) => (   
                        <FormField
                            key={scoreConfig.name}
                            id={scoreConfig.name}
                            label={scoreConfig.title ?? scoreConfig.name}
                            error={fetcher.data?.error?.fieldErrors?.["scores." + scoreConfig.name]}
                            name={"scores." + scoreConfig.name}
                            defaultValue={scores[scoreConfig.name] ?? undefined}
                            InputComponent={scoreConfig.input}
                            options={scoreConfig.options}
                        />
                    ))}
                    </div> }


                    <div>
                        <div className="text-sm mb-1 text-gray-700">Extra comment</div>
                        <TextEditor
                            mentionItems={users.map(user => ({
                                id: user.id,
                                label: user.name
                            }))}
                            name="comment"
                            placeholder={(hasZeroVisisbleComments ? "Comment" : "Reply") + " or tag other, using @"}
                            className="min-h-[10px] resize-none mb-0"
                            // onFocus={() => {
                            //     setCurrentlyEditedItemId("new");
                            // }}
                        />
                    </div>

                    <div className={`gap-2 justify-end mt-2 flex`}>
                        <Button
                            type="reset"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                                formRef.current?.reset();
                                // setCurrentlyEditedItemId(null);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            size="sm"
                            disabled={fetcher.state !== 'idle'}
                        >
                            {fetcher.state !== 'idle' ? 'Posting...' : 'Submit'}

                        </Button>
                    </div>
                </fetcher.Form>
            </div>}

            {/* {!collapsed && <div className="">
                {hasZeroVisisbleComments && <CommentMessageHeader title={users.find((u) => u.id === user.id)?.name || "You"} singleLineMessageHeader={singleLineMessageHeader}/>}

                {(hasZeroVisisbleComments || currentlyEditedItemId === "new" || currentlyEditedItemId === null) && <fetcher.Form method="post" action={`/threads/${thread.id}/comments`} className="mt-4" ref={formRef}>
                    <TextEditor
                        mentionItems={users.map(user => ({
                            id: user.id,
                            label: user.name
                        }))}
                        name="content"
                        placeholder={(hasZeroVisisbleComments ? "Comment" : "Reply") + " or tag other, using @"}
                        className="min-h-[10px] resize-none mb-0"
                        onFocus={() => {
                            setCurrentlyEditedItemId("new");
                        }}
                    />

                    <input type="hidden" name="activityId" value={activity.id} />
                    <div className={`gap-2 justify-end mt-2 ${(currentlyEditedItemId === "new" || hasZeroVisisbleComments) ? "flex" : "hidden"}`}>
                        <Button
                            type="reset"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                                setCurrentlyEditedItemId(null);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            size="sm"
                            disabled={fetcher.state !== 'idle'}
                        >
                            {fetcher.state !== 'idle' ? 'Posting...' : 'Comment'}
                        </Button>
                    </div>
                    {fetcher.data?.error && (
                        <div className="text-sm text-red-500">{fetcher.data.error}</div>
                    )}
                </fetcher.Form>}
            </div>} */}


        </div>
    );
});



export function CommentThreadFloatingBox({ thread, activity, user, selected = false, users, onSelect }: CommentThreadFloatingBoxProps) {
    const commentThreadRef = useRef<any>(null);

    useEffect(() => {
        if (!selected) {
            commentThreadRef.current?.reset();
        }       
    }, [selected])

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
        <div className={`py-3 px-3 rounded-lg ${selected ? "bg-white border" : "bg-muted"}`} data-comment={true} onClick={(e) => {
            if (!selected) {
                onSelect(activity)
            }
        }}>
            <CommentThread
                thread={thread}
                activity={activity}
                user={user}
                users={users}
                collapsed={!selected}
                ref={commentThreadRef}
            />
        </div>
    );
}




export function CommentMessageHeader({ title, subtitle, actions, singleLineMessageHeader = false }: { title: string, subtitle?: string, actions?: React.ReactNode, singleLineMessageHeader?: boolean }) {

    if (singleLineMessageHeader) {
        return <div className="flex flex-row justify-between">
        
        <div className="flex flex-row items-center gap-2">
            <div className="rounded-full bg-gray-300 flex-shrink-0"
                style={{ width: 24, height: 24 }}
            />
            <div className="text-sm font-medium">
                {title}
            </div>
            <div className="text-xs text-gray-400">
                {subtitle}
            </div>
        </div>
        {actions}
        </div>
    }

    return <div className="flex items-center gap-2">
        {/* Thumbnail */}
        <div
            className="w-8 h-8 rounded-full bg-gray-300 flex-shrink-0"
            style={{ width: 32, height: 32 }}
        />
        <div className="flex-1">
            <div className="flex items-start justify-between">
                <div>
                    <div className="text-sm font-medium ">
                        {title}
                    </div>
                    <div className="text-xs text-gray-400">
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
export function CommentMessageItem({ message, userId, activityId, thread, user, users, compressionLevel = "none", singleLineMessageHeader = false }: { message: CommentMessage, userId: string | null, fetcher: any, activityId: string, thread: Thread, user: any, users: any[], compressionLevel?: MessageCompressionLevel, singleLineMessageHeader?: boolean }) {
    if (message.deletedAt) {
        throw new Error("Deleted messages don't have rendering code.")
    }

    const fetcher = useFetcher();
    const isOwn = userId && message.userId === userId;

    const createdAt = timeAgoShort(message.createdAt);
    const subtitle = createdAt + (message.updatedAt && message.updatedAt !== message.createdAt ? " · edited" : "")

    const [isEditing, setIsEditing] = useState(false);

    useFetcherSuccess(fetcher, () => {
        setIsEditing(false);
    });

    return (
        <div>

            <CommentMessageHeader title={user.name} subtitle={subtitle} singleLineMessageHeader={singleLineMessageHeader} actions={
                isOwn && (<DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost">
                            <EllipsisVerticalIcon className="w-4 h-4 text-gray-400" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-32" align="start">
                        <DropdownMenuItem onClick={(e) => {
                            setIsEditing(true);
                        }}>
                            Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => {
                            e.preventDefault();
                            if (confirm('Are you sure you want to delete this comment?')) {
                                fetcher.submit(null, { method: 'delete', action: `/threads/${thread.id}/activities/${activityId}/comments/${message.id}` }); // that could be fetcher.Form!
                            }
                        }}>
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                )
            } />

            {/* Comment content */}
            <div className="text-sm">
                {isEditing ? (
                    <fetcher.Form method="post" action={`/threads/${thread.id}/comment-edit`} className="space-y-2">
                        <TextEditor
                            mentionItems={users.map(user => ({
                                id: user.id,
                                label: user.name
                            }))}
                            name="content"
                            placeholder={"Edit or tag others, using @"}
                            defaultValue={message.content ?? ""}
                            className="min-h-[10px] resize-none mb-0"
                        />
                        <input type="hidden" name="editCommentMessageId" value={message.id} />
                        <div className="flex gap-2 mt-1">
                            <Button type="submit" size="sm" disabled={fetcher.state !== 'idle'}>
                                {fetcher.state !== 'idle' ? 'Saving...' : 'Save'}
                            </Button>
                            <Button
                                type="reset"
                                variant="outline"
                                size="sm"
                                onClick={() => { setIsEditing(false) }}
                            >
                                Cancel
                            </Button>
                        </div>
                        {fetcher.data?.error?.message && (
                            <div className="text-sm text-red-500">{fetcher.data.error.message}</div>
                        )}
                    </fetcher.Form>
                ) : <div className="ml-8">

                    { message.scores && message.scores.length > 0 && <div>
                        <PropertyList.Root className="mb-2">
                            {message.scores.map((score) => (
                                <PropertyList.Item key={score.id}>
                                    <PropertyList.Title>{score.name}</PropertyList.Title>
                                    <PropertyList.TextValue>{JSON.stringify(score.value)}</PropertyList.TextValue>
                                </PropertyList.Item>
                            ))}
                        </PropertyList.Root>
                    </div>}
                    
                    { message.content && <div className={`${compressionLevel === "high" ? "line-clamp-6" : compressionLevel === "medium" ? "line-clamp-3" : ""}`}>
                        {textToElements(message.content, users.map((user: any) => ({
                            id: user.id,
                            label: user.name
                        })))}
                    </div>}
                </div>}
            </div>
        </div>
    );
}
