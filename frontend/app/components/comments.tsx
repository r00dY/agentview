import { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useEffect, useRef, useState } from "react";
import { useFetcherSuccess } from "~/hooks/useFetcherSuccess";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import { EllipsisVerticalIcon, PencilIcon } from "lucide-react";


/**
 * Thread page with comment functionality including mentions.
 * 
 * Mention Format: @[property:value] where property is currently only 'user_id'
 * Examples:
 * - "Hello @[user_id:user123] how are you?"
 * - "Thanks @[user_id:admin456] for the help!"
 * 
 * Features:
 * - Extract mentions from comment content with validation
 * - Store mentions in comment_mentions table
 * - Handle mentions during edits (keep existing, add new, remove old)
 * - Visual highlighting of mentions in the UI
 * - Throws error for invalid @[...] format
 */
// Helper function to highlight mentions in content
function highlightMentions(content: string) {
    return content.replace(/@\[([^\]]+)\]/g, (match, inside) => {
        const colonIndex = inside.indexOf(':');
        if (colonIndex === -1) {
            return match; // Don't highlight invalid format
        }

        const property = inside.substring(0, colonIndex).trim();
        const value = inside.substring(colonIndex + 1).trim();

        if (property === 'user_id' && value) {
            return `<span class="bg-blue-100 text-blue-800 px-1 py-0.5 rounded text-xs font-medium">@${value}</span>`;
        }

        return match; // Don't highlight unsupported properties
    });
}

export function CommentThread({ threadId, commentThread, activity, userId, selected = false, users, onSelect }: { threadId: string, commentThread: any, activity: any, userId: string | null, selected: boolean, users: any[], onSelect: (activity: any) => void }) {
    const fetcher = useFetcher();
    const isNewThread = !(commentThread?.commentMessages?.length > 0);

    const formRef = useRef<HTMLFormElement>(null);
    const [currentlyEditedItemId, setCurrentlyEditedItemId] = useState<string | null>(null); // "new" for new comment, comment id for edits

    useFetcherSuccess(fetcher, () => {
        setCurrentlyEditedItemId(null);
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
        <div className={`flex flex-col gap-3 py-3 px-3 rounded-lg ${selected ? "bg-white border" : "bg-muted"}`} data-comment={true} onClick={(e) => {
            if (!selected) {
                onSelect(activity)
            }
        }}>
            {/* Existing comments */}
            {commentThread?.commentMessages?.map((message: any, index: number) => {
                const count = commentThread?.commentMessages.length;

                let lineClamp: number | undefined;

                if (!selected) {
                    if (count === 1) {
                        lineClamp = 6
                    }
                    else {
                        lineClamp = 3;
                        if (count >= 3 && index != 0 && index != count - 1) {

                            if (index === 1) {
                                return (
                                    <div className="flex items-center my-2">
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
                    lineClamp={lineClamp}
                />
            })}

            {selected && <>
                {isNewThread && <CommentMessageHeader title={users.find((user) => user.id === userId)?.name || "You"} />}

                {(isNewThread || currentlyEditedItemId === "new" || currentlyEditedItemId === null) && <fetcher.Form method="post" action={`/threads/${threadId}/comments`} className="space-y-2" ref={formRef}>
                    <Textarea
                        name="content"
                        placeholder={(isNewThread ? "Comment" : "Reply") + " or tag other, using @"}
                        className="min-h-[10px] resize-none mb-0"
                        required
                        onFocus={() => {
                            setCurrentlyEditedItemId("new");
                        }}
                    />

                    <input type="hidden" name="activityId" value={activity.id} />
                    <div className={`gap-2 justify-end mt-2 ${(currentlyEditedItemId === "new" || isNewThread) ? "flex" : "hidden"}`}>
                        <Button
                            type="reset"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                                // e.stopPropagation();
                                setCurrentlyEditedItemId(null);

                                if (isNewThread) {
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
            </>}



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


// New subcomponent for comment message item with edit logic
export function CommentMessageItem({ message, userId, activityId, threadId, user, isEditing, onRequestEdit, onCancelEdit, lineClamp }: { message: any, userId: string | null, fetcher: any, activityId: string, threadId: string, user: any, isEditing: boolean, onRequestEdit: () => void, onCancelEdit: () => void, lineClamp?: number }) {
    const fetcher = useFetcher();
    const isOwn = userId && message.userId === userId;
    const subtitle = new Date(message.createdAt).toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }) + (message.updatedAt && message.updatedAt !== message.createdAt ? " · Edited" : "")

    useFetcherSuccess(fetcher, () => {
        onCancelEdit();
    });

    return (
        <div className="">

            <CommentMessageHeader title={user.name} subtitle={subtitle} actions={
                isOwn && (<DropdownMenu>
                    <DropdownMenuTrigger asChild onPointerDown={(e) => {
                        // console.log('dropdown', e)
                        // e.stopPropagation();
                    }}>
                        <Button size="icon" variant="ghost" onPointerDownCapture={(e) => {
                            // console.log('dropdown2', e)
                            // e.stopPropagation();
                        }}
                        
                        
                        >
                            <EllipsisVerticalIcon className="w-4 h-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-32" align="start">
                        <DropdownMenuItem onClick={(e) => {
                            console.log('edit', e)
                            // e.stopPropagation();
                            onRequestEdit()
                        }}>
                            Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                    // <Button
                    //     type="button"
                    //     variant="ghost"
                    //     size="xs"
                    //     className="ml-2 text-xs"
                    //     onClick={() => onRequestEdit()}
                    // >
                    //     Edit
                    // </Button>
                )
            } />


            {/* Comment content */}
            <div className="text-sm mt-2">
                {isEditing ? (
                    <fetcher.Form method="post" action={`/threads/${threadId}/comments`} className="space-y-2">
                        {/* <TextEditor
                            mentionItems={users.map(user => ({
                                id: user.id,
                                label: user.name
                            }))}
                            name="content"
                            defaultValue={editValue}
                            // onChange={e => setEditValue(e.target.value)}
                            className="min-h-[60px]"
                            // required
                        /> */}


                        <Textarea
                            name="content"
                            defaultValue={message.content}
                            className="min-h-[60px]"
                            required
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
                ) : (
                    <div dangerouslySetInnerHTML={{ __html: highlightMentions(message.content) }} className={`${lineClamp ? `line-clamp-${lineClamp}` : ""}`} />
                )}
            </div>
        </div>
    );
}