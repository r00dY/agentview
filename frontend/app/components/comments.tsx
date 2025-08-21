import { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import { act, forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { useFetcherSuccess } from "~/hooks/useFetcherSuccess";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import { EllipsisVerticalIcon } from "lucide-react";
import { TextEditor, textToElements } from "./wysiwyg/TextEditor";
import type { Activity, Thread, User } from "~/apiTypes";
import { config } from "~/agentview.config";
import { timeAgoShort } from "~/lib/timeAgo";
import { Input } from "./ui/input";
import { FormField } from "./form";


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
    const [currentlyEditedItemId, setCurrentlyEditedItemId] = useState<string | null>(null); // "new" for new comment, comment id for edits

    // Get scores for this activity type from config
    const threadConfig = config.threads.find((t: any) => t.type === thread.type);
    const activityConfig = threadConfig?.activities.find((a: any) => 
        a.type === activity.type && a.role === activity.role
    );
    const scoreConfigs = activityConfig?.scores || [];

    const scores: Record<string, any> = {};
    for (const score of activity.scores ?? []) {
        scores[score.name] = score.value;
    }

    const unassignedScoreConfigs = scoreConfigs.filter((scoreConfig) => !scores[scoreConfig.name]);


    useFetcherSuccess(fetcher, () => {
        setCurrentlyEditedItemId(null);
        console.log('resetting form')
        formRef.current?.reset();
    });

    useImperativeHandle(ref, () => ({
        reset: () => {
            setCurrentlyEditedItemId(null);
            formRef.current?.reset();   
        }
    }));

    return (<div ref={ref}>
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
                        isEditing={currentlyEditedItemId === message.id}
                        onRequestEdit={() => setCurrentlyEditedItemId(message.id)}
                        onCancelEdit={() => setCurrentlyEditedItemId(null)}
                        compressionLevel={compressionLevel}
                        users={users}
                        singleLineMessageHeader={singleLineMessageHeader}
                    />
                })}

            </div>

            {!collapsed && <div className="ml-8 pt-4 border-t mt-4">

                {/* <ProfileForm /> */}

                {true && <fetcher.Form method="post" action={`/threads/${thread.id}/comments`} ref={formRef}>



                { unassignedScoreConfigs.length > 0 && <div className="mb-4">
                    {unassignedScoreConfigs.map((scoreConfig) => (   
                        <FormField<string | null>
                            key={scoreConfig.name}
                            id={scoreConfig.name}
                            label={scoreConfig.title ?? scoreConfig.name}
                            error={`Incorrect value`}
                            name={scoreConfig.name}
                            defaultValue={"dupa"}
                            InputComponent={({ value, onChange, name, id })=> <Input value={value ?? ""} placeholder="Enter value" onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} name={name} id={id}/>}
                        />
                        // <FormField
                        //     key={scoreConfig.name}
                        //     id={scoreConfig.name}
                        //     label={scoreConfig.title ?? scoreConfig.name}
                        //     error={`Incorrect value`}
                        // >
                        //     <Input type="text" placeholder="Enter value" id={scoreConfig.name} name={scoreConfig.name} defaultValue={scores[scoreConfig.name]}/>
                        // </FormField>
                    ))}
                    </div> }

                  {/* { unassignedScoreConfigs.length > 0 && <PropertyList className="mb-4">
                    {unassignedScoreConfigs.map((scoreConfig) => (   
                        <PropertyList.Item>
                            <PropertyList.Title>{scoreConfig.title ?? scoreConfig.name}</PropertyList.Title>
                            <PropertyList.TextValue isMuted={false}>
                                <Input type="text" placeholder="Enter value" />
                            </PropertyList.TextValue>
                        </PropertyList.Item>
                    ))}
                    </PropertyList> } */}


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
export function CommentMessageItem({ message, userId, activityId, thread, user, users, isEditing, onRequestEdit, onCancelEdit, compressionLevel = "none", singleLineMessageHeader = false }: { message: any, userId: string | null, fetcher: any, activityId: string, thread: Thread, user: any, users: any[], isEditing: boolean, onRequestEdit: () => void, onCancelEdit: () => void, compressionLevel?: MessageCompressionLevel, singleLineMessageHeader?: boolean }) {
    const isDeleted = message.deletedAt;
    const fetcher = useFetcher();
    const isOwn = userId && message.userId === userId;


    const createdAt = timeAgoShort(message.createdAt);
    const subtitle = createdAt + (message.updatedAt && message.updatedAt !== message.createdAt ? " · edited" : "") + (isDeleted ? " · deleted" : "")

    useFetcherSuccess(fetcher, () => {
        onCancelEdit();
    });

    return (
        <div className={`${isDeleted ? 'opacity-60' : ''}`}>

            <CommentMessageHeader title={user.name} subtitle={subtitle} singleLineMessageHeader={singleLineMessageHeader} actions={
                isOwn && !isDeleted && (<DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost">
                            <EllipsisVerticalIcon className="w-4 h-4 text-gray-400" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-32" align="start">
                        <DropdownMenuItem onClick={(e) => {
                            onRequestEdit()
                        }}>
                            Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => {
                            e.preventDefault();
                            if (confirm('Are you sure you want to delete this comment?')) {
                                const formData = new FormData();
                                formData.append('deleteCommentMessageId', message.id);
                                formData.append('activityId', activityId);
                                fetcher.submit(formData, { method: 'post', action: `/threads/${thread.id}/comments` });
                            }
                        }}>
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                )
            } />
            

            {/* <PropertyList className="ml-8 mb-4">
                <PropertyList.Item>
                    <PropertyList.Title>User satisfaction</PropertyList.Title>
                    <PropertyList.TextValue isMuted={false}>Bad</PropertyList.TextValue>
                </PropertyList.Item>

                <PropertyList.Item>
                    <PropertyList.Title>Can go to client?</PropertyList.Title>
                    <PropertyList.TextValue isMuted={false}>Kind of</PropertyList.TextValue>
                </PropertyList.Item>
            </PropertyList> */}

            {/* Comment content */}
            <div className="text-sm">
                {isEditing ? (
                    <fetcher.Form method="post" action={`/threads/${thread.id}/comments`} className="space-y-2">

                        <TextEditor
                            mentionItems={users.map(user => ({
                                id: user.id,
                                label: user.name
                            }))}
                            name="content"
                            placeholder={"Edit or tag others, using @"}
                            defaultValue={message.content}
                            className="min-h-[10px] resize-none mb-0"
                        />
                        <input type="hidden" name="editCommentMessageId" value={message.id} />
                        <input type="hidden" name="activityId" value={activityId} />
                        <div className="flex gap-2 mt-1">
                            <Button type="submit" size="sm" disabled={fetcher.state !== 'idle'}>
                                {fetcher.state !== 'idle' ? 'Saving...' : 'Save'}
                            </Button>
                            <Button
                                type="reset"
                                variant="outline"
                                size="sm"
                                onClick={() => onCancelEdit()}
                            >
                                Cancel
                            </Button>
                        </div>
                        {fetcher.data?.error && (
                            <div className="text-sm text-red-500">{fetcher.data.error}</div>
                        )}
                    </fetcher.Form>
                ) : isDeleted ? (
                    <div className="text-muted-foreground italic">
                        This comment was deleted
                    </div>
                ) : (
                    <div className={`ml-8 ${compressionLevel === "high" ? "line-clamp-6" : compressionLevel === "medium" ? "line-clamp-3" : ""}`}>
                        {textToElements(message.content, users.map((user: any) => ({
                            id: user.id,
                            label: user.name
                        })))}
                    </div>
                )}
            </div>
        </div>
    );
}
