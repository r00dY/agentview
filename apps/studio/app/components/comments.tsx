import { AlertCircleIcon, EllipsisVerticalIcon, Gauge, GaugeIcon, Reply, ReplyIcon } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { config } from "agentview.config";
import type { SessionItem, CommentMessage, Session, User } from "~/lib/shared/apiTypes";
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
import { useSessionContext } from "~/lib/session";
import { apiFetch } from "~/lib/apiFetch";

export type CommentThreadProps = {
    thread: Session,
    activity: SessionItem,
    collapsed?: boolean,
    singleLineMessageHeader?: boolean,
    small?: boolean,
}

export type CommentThreadFloatingBoxProps = CommentThreadProps & {
    selected: boolean,
    onSelect: (activity: any) => void,
}

export type CommentThreadFloatingButtonProps = CommentThreadFloatingBoxProps & {
    thread: Session,
    activity: SessionItem,
    onSelect: (activity: any) => void,
}

function getAllScoreConfigs(thread: Session, activity: SessionItem) {
    const threadConfig = config.sessions?.find((t: any) => t.type === thread.type);
    if (!threadConfig) {
        throw new Error("Thread config not found");
    }

    const activityConfig = threadConfig?.items.find((a: any) =>
        a.type === activity.type && (!a.role || a.role === activity.role)   
    );
    const allScoreConfigs = activityConfig?.scores || [];

    return allScoreConfigs;
}

export const CommentThread = forwardRef<any, CommentThreadProps>(({ thread, activity, collapsed = false, singleLineMessageHeader = false, small=false }, ref) => {
    const fetcher = useFetcher();

    const visibleMessages = activity.commentMessages.filter((m: any) => !m.deletedAt) ?? []
    const hasZeroVisisbleComments = visibleMessages.length === 0

    const formRef = useRef<HTMLFormElement>(null);
    const { members, user } = useSessionContext();

    const allScoreConfigs = getAllScoreConfigs(thread, activity);

    const scores : Record<string, any> = {};
    for (const messageItem of visibleMessages) {
        for (const score of messageItem.scores ?? []) {
            if (score.deletedAt || score.createdBy !== user.id) {
                continue;
            }
            scores[score.name] = score.value;
        }
    }

    const unassignedScoreConfigs = allScoreConfigs.filter((scoreConfig) => scores[scoreConfig.name] === undefined || scores[scoreConfig.name] === null);

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

    return (<div ref={ref}>
        { visibleMessages.length > 0 && <div className={`flex flex-col gap-4 ${small ? "p-4" : "p-6"}`}>

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
                    fetcher={fetcher}
                    activity={activity}
                    thread={thread}
                    compressionLevel={compressionLevel}
                    singleLineMessageHeader={singleLineMessageHeader}
                />
            })}

        </div> }

        { !collapsed && visibleMessages.length > 0 && <div className={`border-t ${small ? "px-3" : "px-4"} max-w-2xl`}></div>}

        {!collapsed && <div className={`max-w-2xl ${small ? "p-4" : "p-6"}`}>


            <div className="flex flex-row gap-2">


                <div className={`rounded-full bg-gray-300 flex-shrink-0 ${unassignedScoreConfigs.length === 0 ? "mt-[6px]" : ""}`}
                    style={{ width: 24, height: 24 }}
                />

                <div className="flex-1">
                    {unassignedScoreConfigs.length > 0 && <div className="text-sm font-medium mb-3">Your Scores & Comment</div>}
{/* 
                <div className="flex flex-row items-center gap-2 mb-10">
                    <Button size="sm"><GaugeIcon />Add Score</Button>
                    <Button variant="outline" size="sm"><ReplyIcon /> Just reply</Button>
                </div> */}

                {fetcher.state === 'idle' && fetcher.data?.ok === false && (
                    <Alert variant="destructive" className="mb-4">
                        <AlertCircleIcon className="h-4 w-4" />
                        <AlertDescription>{fetcher.data.error.message}</AlertDescription>
                    </Alert>
                )}

                <fetcher.Form method="post" action={`/threads/${thread.id}/activities/${activity.id}/comments`} ref={formRef}>

                    {unassignedScoreConfigs.length > 0 && <div className="mb-4 space-y-2">
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
                    </div>}

                    <div>
                        { unassignedScoreConfigs.length > 0 && <div className="text-sm mb-1 text-gray-700">Comment</div>}
                        <TextEditor
                            mentionItems={members.filter((member) => member.id !== user.id).map(member => ({
                                id: member.id,
                                label: member.name ?? "Unknown"
                            }))}
                            name="comment"
                            placeholder={(hasZeroVisisbleComments ? "Comment" : "Reply") + " or tag other, using @"}
                            className="min-h-[10px] resize-none mb-0"
                        />
                    </div>

                    <div className={`gap-2 justify-end mt-2 flex`}>
                        <Button
                            type="reset"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                                formRef.current?.reset();
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
                </div>

            
            </div>
        </div>}

    </div>
    );
});



export function CommentThreadFloatingBox({ thread, activity, selected = false, onSelect }: CommentThreadFloatingBoxProps) {
    const commentThreadRef = useRef<any>(null);
    const revalidator = useRevalidator();

    useEffect(() => {
        if (!selected) {
            commentThreadRef.current?.reset();
        }

        if (selected) {
            apiFetch(`/api/sessions/${thread.id}/items/${activity.id}/seen`, {
                method: 'POST',
            }).then((data) => {
                if (data.ok) {
                    revalidator.revalidate();
                }
                else {
                    console.error(data.error)
                }
            })
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
        <div className={`rounded-lg ${selected ? "bg-white border" : "bg-muted"}`} data-comment={true} onClick={(e) => {
            if (!selected) {
                onSelect(activity)
            }
        }}>
            <CommentThread
                thread={thread}
                activity={activity}
                collapsed={!selected}
                ref={commentThreadRef}
                small={true}
                singleLineMessageHeader={true}
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
export function CommentMessageItem({ message, activity, thread,compressionLevel = "none", singleLineMessageHeader = false }: { message: CommentMessage, fetcher: any, activity: SessionItem, thread: Session,  compressionLevel?: MessageCompressionLevel, singleLineMessageHeader?: boolean }) {
    if (message.deletedAt) {
        throw new Error("Deleted messages don't have rendering code.")
    }

    const { user, members } = useSessionContext();
    const author = members.find((m) => m.id === message.userId);
    if (!author) {
        throw new Error("Author not found");
    }

    const fetcher = useFetcher();
    const isOwn = author.id === user.id;
    const formRef = useRef<HTMLFormElement>(null);

    const createdAt = timeAgoShort(message.createdAt);
    const subtitle = createdAt + (message.updatedAt && message.updatedAt !== message.createdAt ? " · edited" : "")

    const [isEditing, setIsEditing] = useState(false);


    const allScoreConfigs = getAllScoreConfigs(thread, activity);

    const scores : Record<string, any> = {};
    for (const score of message.scores ?? []) {
        if (score.deletedAt !== null) {
            continue;
        }
        scores[score.name] = score.value;
    }


    // const { scores, allScoreConfigs } = getScoresInfo(thread, activity, user);

    const messageScoreConfigs = allScoreConfigs.filter(
        (scoreConfig) =>
            message.scores &&
            message.scores.some((score) => score.name === scoreConfig.name)
    );



    

    useFetcherSuccess(fetcher, () => {
        setIsEditing(false);
    });

    return (
        <div>

            <CommentMessageHeader title={author.name ?? author.email} subtitle={subtitle} singleLineMessageHeader={singleLineMessageHeader} actions={
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
                                fetcher.submit(null, { method: 'delete', action: `/threads/${thread.id}/activities/${activity.id}/comments/${message.id}` }); // that could be fetcher.Form!
                            }
                        }}>
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                )
            } />

            {/* Comment content */}
            <div className="text-sm ml-8">
                {isEditing ? (<div>

                    {fetcher.state === 'idle' && fetcher.data?.ok === false && (
                        <Alert variant="destructive" className="mb-4">
                            <AlertCircleIcon className="h-4 w-4" />
                            <AlertDescription>{fetcher.data.error.message}</AlertDescription>
                        </Alert>
                    )}

                    <fetcher.Form method="put" action={`/threads/${thread.id}/activities/${activity.id}/comments/${message.id}`} ref={formRef} className="space-y-2">
                        {messageScoreConfigs.length > 0 && <div className="mb-4 space-y-2">
                            {messageScoreConfigs.map((scoreConfig) => <FormField
                                key={scoreConfig.name}
                                id={scoreConfig.name}
                                label={scoreConfig.title ?? scoreConfig.name}
                                error={fetcher.data?.error?.fieldErrors?.["scores." + scoreConfig.name]}
                                name={"scores." + scoreConfig.name}
                                defaultValue={scores[scoreConfig.name] ?? undefined}
                                InputComponent={scoreConfig.input}
                                options={scoreConfig.options}
                            />)}
                        </div>}

                        <TextEditor
                            mentionItems={members.filter((member) => member.id !== user.id).map(member => ({
                                id: member.id,
                                label: member.name ?? "Unknown"
                            }))}
                            name="comment"
                            placeholder={"Edit or tag others, using @"}
                            defaultValue={message.content ?? ""}
                            className="min-h-[10px] resize-none mb-0"
                        />

                        <div className="flex gap-2 mt-1">
                            <Button type="submit" size="sm" disabled={fetcher.state !== 'idle'}>
                                {fetcher.state !== 'idle' ? 'Saving...' : 'Save'}
                            </Button>
                            <Button
                                type="reset"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    formRef.current?.reset();
                                    setIsEditing(false);
                                }}
                            >
                                Cancel
                            </Button>
                        </div>
                    </fetcher.Form>

                </div>) : <div>

                    {messageScoreConfigs.length > 0 && <div>
                        <PropertyList.Root className="mb-2">
                            {messageScoreConfigs.map((scoreConfig) => (
                                <PropertyList.Item key={scoreConfig.name}>
                                    <PropertyList.Title>{scoreConfig.title ?? scoreConfig.name}</PropertyList.Title>
                                    <PropertyList.TextValue><scoreConfig.display value={scores[scoreConfig.name]} options={scoreConfig.options} /></PropertyList.TextValue>
                                </PropertyList.Item>
                            ))}
                        </PropertyList.Root>
                    </div>}

                    {message.content && <div className={`${compressionLevel === "high" ? "line-clamp-6" : compressionLevel === "medium" ? "line-clamp-3" : ""}`}>
                        {textToElements(message.content, members.map((member) => ({
                            id: member.id,
                            label: member.name ?? "Unknown"
                        })))}
                    </div>}
                </div>}
            </div>
        </div>
    );
}
