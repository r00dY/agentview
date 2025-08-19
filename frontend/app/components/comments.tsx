import { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { useFetcherSuccess } from "~/hooks/useFetcherSuccess";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import { EllipsisVerticalIcon, PencilIcon } from "lucide-react";
import { TextEditor, textToElements } from "./wysiwyg/TextEditor";
import type { Activity } from "~/apiTypes";


export function CommentThread({ threadId, activity, userId, selected = false, users, onSelect }: { threadId: string, activity: Activity, userId: string | null, selected: boolean, users: any[], onSelect: (activity: any) => void }) {
    const fetcher = useFetcher();

    const visibleMessages = activity.commentMessages.filter((m: any) => !m.deletedAt) ?? []
    const hasZeroVisisbleComments = visibleMessages.length === 0

    const formRef = useRef<HTMLFormElement>(null);
    const [currentlyEditedItemId, setCurrentlyEditedItemId] = useState<string | null>(null); // "new" for new comment, comment id for edits

    useFetcherSuccess(fetcher, () => {
        setCurrentlyEditedItemId(null);
        console.log('resetting form')
        formRef.current?.reset();
    });

    useEffect(() => {
        if (!selected) {
            setCurrentlyEditedItemId(null);
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
            <div className="flex flex-col gap-6">
                {visibleMessages.map((message: any, index: number) => {
                    const count = visibleMessages.length;

                    let compressionLevel: MessageCompressionLevel = "none";

                    if (message.deletedAt) {
                        return null
                    }

                    if (!selected) {
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
                        userId={userId}
                        fetcher={fetcher}
                        activityId={activity.id}
                        threadId={threadId}
                        user={users.find((user) => user.id === message.userId)}
                        isEditing={currentlyEditedItemId === message.id}
                        onRequestEdit={() => setCurrentlyEditedItemId(message.id)}
                        onCancelEdit={() => setCurrentlyEditedItemId(null)}
                        compressionLevel={compressionLevel}
                        users={users}
                    />
                })}

            </div>


            {selected && <div className="">
                {hasZeroVisisbleComments && <CommentMessageHeader title={users.find((user) => user.id === userId)?.name || "You"} />}

                {(hasZeroVisisbleComments || currentlyEditedItemId === "new" || currentlyEditedItemId === null) && <fetcher.Form method="post" action={`/threads/${threadId}/comments`} className="mt-4" ref={formRef}>
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

                                if (hasZeroVisisbleComments) {
                                    onSelect(null)
                                }
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



        </div>
    );
}

export function CommentMessageHeader({ title, subtitle, actions }: { title: string, subtitle?: string, actions?: React.ReactNode }) {
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
                    <div className="text-xs text-muted-foreground">
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
export function CommentMessageItem({ message, userId, activityId, threadId, user, users, isEditing, onRequestEdit, onCancelEdit, compressionLevel = "none" }: { message: any, userId: string | null, fetcher: any, activityId: string, threadId: string, user: any, users: any[], isEditing: boolean, onRequestEdit: () => void, onCancelEdit: () => void, compressionLevel?: MessageCompressionLevel }) {
    const isDeleted = message.deletedAt;
    const fetcher = useFetcher();
    const isOwn = userId && message.userId === userId;
    const subtitle = new Date(message.createdAt).toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }) + (message.updatedAt && message.updatedAt !== message.createdAt ? " · Edited" : "") + (isDeleted ? " · Deleted" : "")

    useFetcherSuccess(fetcher, () => {
        onCancelEdit();
    });

    return (
        <div className={`${isDeleted ? 'opacity-60' : ''}`}>

            <CommentMessageHeader title={user.name} subtitle={subtitle} actions={
                isOwn && !isDeleted && (<DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost">
                            <EllipsisVerticalIcon className="w-4 h-4" />
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
                                fetcher.submit(formData, { method: 'post', action: `/threads/${threadId}/comments` });
                            }
                        }}>
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                )
            } />
            

            {/* Comment content */}
            <div className="text-sm mt-2">
                {isEditing ? (
                    <fetcher.Form method="post" action={`/threads/${threadId}/comments`} className="space-y-2">

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
                    <div className={`gówno ${compressionLevel === "high" ? "line-clamp-6" : compressionLevel === "medium" ? "line-clamp-3" : ""}`}>
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