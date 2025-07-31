import { redirect, useLoaderData, useFetcher, Outlet, Link, Form, data, useParams } from "react-router";
import type { Route } from "./+types/thread";
import { Button } from "~/components/ui/button";
import { Header, HeaderTitle } from "~/components/header";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { useEffect, useRef, useState } from "react";
import { parseSSE } from "~/lib/parseSSE";
import { db } from "~/lib/db.server";
import { commentThreads, commentMessages, commentMessageEdits, commentMentions } from "~/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { auth } from "~/lib/auth.server";
import { useFetcherSuccess } from "~/hooks/useFetcherSuccess";
import { extractMentions } from "~/lib/utils";
import { TextEditor } from "~/components/wysiwyg/TextEditor";
import { ItemsWithCommentsLayoutTest } from "~/components/ItemsWithCommentsLayoutTest";
import { ItemsWithCommentsLayout } from "~/components/ItemsWithCommentsLayout";
import { MessageCirclePlus, MessageCirclePlusIcon, Trash2Icon } from "lucide-react";

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

export async function loader({ request, params }: Route.LoaderArgs) {
    const response = await fetch(`http://localhost:2138/threads/${params.id}`, {
        headers: {
            'Content-Type': 'application/json',
        }
    });

    const threadData = await response.json()

    if (!response.ok) {
        throw data(threadData, { status: 400 })
    }

    // Get current user

    const session = await auth.api.getSession({ headers: request.headers });
    const userId = session?.user?.id || null;

    const users = await db.query.user.findMany({
        columns: {
            id: true,
            email: true,
            name: true,
        }
    })

    return data({
        thread: threadData,
        userId,
        users
    });
}

export async function action({ request, params }: Route.ActionArgs) {
    const formData = await request.formData();
    const content = formData.get("content");
    const activityId = formData.get("activityId");
    const editCommentMessageId = formData.get("editCommentMessageId");

    // Editing a comment message
    if (editCommentMessageId && typeof editCommentMessageId === 'string') {
        if (!content || typeof content !== 'string') {
            return { error: "Comment content is required" };
        }
        try {
            // Get current user
            const session = await auth.api.getSession({ headers: request.headers });
            if (!session) {
                return { error: "Authentication required" };
            }
            // Find the comment message
            const [message] = await db
                .select()
                .from(commentMessages)
                .where(eq(commentMessages.id, editCommentMessageId));
            if (!message) {
                return { error: "Comment message not found" };
            }
            if (message.userId !== session.user.id) {
                return { error: "You can only edit your own comments." };
            }

            // Extract mentions from new content
            let newMentions, previousMentions;
            let newUserMentions: string[] = [], previousUserMentions: string[] = [];

            try {
                newMentions = extractMentions(content);
                previousMentions = extractMentions(message.content);
                newUserMentions = newMentions.user_id || [];
                previousUserMentions = previousMentions.user_id || [];
            } catch (error) {
                return { error: `Invalid mention format: ${(error as Error).message}` };
            }

            // Store previous content in edit history
            await db.insert(commentMessageEdits).values({
                commentMessageId: editCommentMessageId,
                previousContent: message.content,
            });

            // Update the comment message
            await db.update(commentMessages)
                .set({ content, updatedAt: new Date() })
                .where(eq(commentMessages.id, editCommentMessageId));

            // Handle mentions for edits
            if (newUserMentions.length > 0 || previousUserMentions.length > 0) {
                // Get existing mentions for this message
                const existingMentions = await db
                    .select()
                    .from(commentMentions)
                    .where(eq(commentMentions.commentMessageId, editCommentMessageId));

                const existingMentionedUserIds = existingMentions.map(m => m.mentionedUserId);

                // Find mentions to keep (existed before and still exist)
                const mentionsToKeep = newUserMentions.filter(mention =>
                    previousUserMentions.includes(mention) && existingMentionedUserIds.includes(mention)
                );

                // Find new mentions to add
                const newMentionsToAdd = newUserMentions.filter(mention =>
                    !existingMentionedUserIds.includes(mention)
                );

                // Find mentions to remove (existed before but not in new content)
                const mentionsToRemove = existingMentionedUserIds.filter(mention =>
                    !newUserMentions.includes(mention)
                );

                // Remove mentions that are no longer present
                if (mentionsToRemove.length > 0) {
                    await db.delete(commentMentions)
                        .where(and(
                            eq(commentMentions.commentMessageId, editCommentMessageId),
                            inArray(commentMentions.mentionedUserId, mentionsToRemove)
                        ));
                }

                // Add new mentions
                if (newMentionsToAdd.length > 0) {
                    await db.insert(commentMentions).values(
                        newMentionsToAdd.map(mentionedUserId => ({
                            commentMessageId: editCommentMessageId,
                            mentionedUserId,
                        }))
                    );
                }
            }

            return { status: 'success', data: null };
        } catch (error) {
            console.error('Error editing comment:', error);
            return { error: "Failed to edit comment" };
        }
    }

    if (!content || typeof content !== 'string') {
        return { error: "Comment content is required" };
    }

    if (!activityId || typeof activityId !== 'string') {
        return { error: "Activity ID is required" };
    }

    try {
        // Get current user
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) {
            return { error: "Authentication required" };
        }

        // Check if comment thread exists for this activity
        let commentThread = await db.query.commentThreads.findFirst({
            where: eq(commentThreads.activityId, activityId),
            with: {
                commentMessages: {
                    orderBy: (commentMessages, { asc }) => [asc(commentMessages.createdAt)]
                }
            }
        });

        const newMessage = await db.transaction(async (tx) => {

            // If no comment thread exists, create one
            if (!commentThread) {
                const [newThread] = await tx.insert(commentThreads).values({
                    activityId: activityId,
                }).returning();

                commentThread = {
                    ...newThread,
                    commentMessages: []
                };
            }

            // Create the comment message
            const [newMessage] = await tx.insert(commentMessages).values({
                commentThreadId: commentThread!.id,
                userId: session.user.id,
                content: content,
            }).returning();

            // Handle mentions for new comments
            let mentions;
            let userMentions: string[] = [];

            try {
                mentions = extractMentions(content);
                userMentions = mentions.user_id || [];
            } catch (error) {
                throw new Error(`Invalid mention format: ${(error as Error).message}`);
            }

            if (userMentions.length > 0) {
                await tx.insert(commentMentions).values(
                    userMentions.map(mentionedUserId => ({
                        commentMessageId: newMessage.id,
                        mentionedUserId,
                    }))
                );
            }

            return newMessage;
        })

        // Return success
        return { status: 'success', data: { message: newMessage } };

    } catch (error) {
        console.error('Error creating comment:', error);
        return { error: "Failed to create comment: " + error.message };
    }
}

function CommentThread({ commentThread, activity, userId, selected = false, users, onSelect }: { commentThread: any, activity: any, userId: string | null, selected: boolean, users: any[], onSelect: (activity: any) => void }) {
    const fetcher = useFetcher();
    const isNewThread = !(commentThread?.commentMessages?.length > 0);

    const formRef = useRef<HTMLFormElement>(null);
    const [currentlyEditedItemId, setCurrentlyEditedItemId] = useState<string | null>(null); // "new" for new comment, comment id for edits

    useFetcherSuccess(fetcher, () => {
        setCurrentlyEditedItemId(null);
        formRef.current?.reset();
    });

    return (
        <div className={`space-y-6 py-3 px-3 rounded-lg ${selected ? "bg-white border" : "bg-muted"}`} data-comment={true} onClick={(e) => {
            if (!selected) {
                onSelect(activity)
            }
        }}>
            {/* Existing comments */}
            {commentThread?.commentMessages?.map((message: any) => (
                <CommentMessageItem
                    key={message.id}
                    message={message}
                    userId={userId}
                    fetcher={fetcher}
                    activityId={activity.id}
                    user={users.find((user) => user.id === message.userId)}
                    isEditing={currentlyEditedItemId === message.id}
                    onRequestEdit={() => setCurrentlyEditedItemId(message.id)}
                    onCancelEdit={() => setCurrentlyEditedItemId(null)}
                />
            ))}

            {selected && <>
                { isNewThread && <CommentMessageHeader title={users.find((user) => user.id === userId)?.name || "You"} />}

                { (isNewThread || currentlyEditedItemId === "new" || currentlyEditedItemId === null) && <fetcher.Form method="post" className="space-y-2" ref={formRef}>
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
                </fetcher.Form> }
            </>}



        </div>
    );
}

function CommentMessageHeader({ title, subtitle, actions }: { title: string, subtitle?: string, actions?: React.ReactNode }) {
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
function CommentMessageItem({ message, userId, activityId, user, isEditing, onRequestEdit, onCancelEdit }: { message: any, userId: string | null, fetcher: any, activityId: string, user: any, isEditing: boolean, onRequestEdit: () => void, onCancelEdit: () => void }) {
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
                isOwn && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="ml-2 text-xs"
                        onClick={() => onRequestEdit()}
                    >
                        Edit
                    </Button>
                )
            } />


            {/* Comment content */}
            <div className="text-sm mt-2">
                {isEditing ? (
                    <fetcher.Form method="post" className="space-y-2" onSubmit={() => { }}>
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
                    <div dangerouslySetInnerHTML={{ __html: highlightMentions(message.content) }} />
                )}
            </div>
        </div>
    );
}

export default function ThreadPageWrapper() {
    const loaderData = useLoaderData<typeof loader>();
    return <ThreadPage key={loaderData.thread.id} />
}

function ActivityMessage({ activity, isWhite = false, selected = false, onClick = () => { } }: { activity: any, isWhite?: boolean, selected?: boolean, onClick?: () => void }) {
    return <div className={`border p-3 rounded-lg hover:border-gray-300 ${isWhite ? "bg-white" : "bg-muted"} ${selected ? "border-gray-300" : ""}`} onClick={onClick}>
        <div dangerouslySetInnerHTML={{ __html: (activity.content as unknown as string) }}></div>
    </div>
}

function ActivityView({ activity, onSelect, selected = false, onNewComment = () => { } }: { activity: any, onSelect: (activity: any) => void, selected: boolean, onNewComment: () => void }) {
    return <div key={activity.id} className="relative" data-item={true}>
        <div className={`relative flex flex-col ${activity.role === "user" ? "pl-[10%] justify-end" : "pr-[10%] justify-start"}`}>
            <div className="relative">

                <ActivityMessage activity={activity} isWhite={activity.role === "user"} selected={selected} onClick={() => onSelect(activity)} />

                {/* { selected && !activity.commentThread && <div className="absolute top-2 -right-[16px]">
                <Button variant="outline" size="icon" onClick={onNewComment}>
                    <MessageCirclePlusIcon className="w-[32px] h-[32px]" />
                </Button>
            </div>} */}
            </div>
        </div>
    </div>
}

function ThreadDetails({ thread }: { thread: any }) {
    return <Card>
        <CardHeader>
            <CardTitle>Thread Details</CardTitle>
        </CardHeader>
        <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="text-sm font-medium text-muted-foreground">ID</label>
                    <p className="text-sm font-mono">{thread.id}</p>
                </div>
                <div>
                    <label className="text-sm font-medium text-muted-foreground">Type</label>
                    <p className="text-sm">{thread.type}</p>
                </div>
                <div>
                    <label className="text-sm font-medium text-muted-foreground">Client ID</label>
                    <p className="text-sm font-mono">{thread.client_id}</p>
                </div>
                <div>
                    <label className="text-sm font-medium text-muted-foreground">Created</label>
                    <p className="text-sm">
                        {new Date(thread.created_at).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        })}
                    </p>
                </div>
                {thread.metadata && (
                    <div className="md:col-span-2">
                        <label className="text-sm font-medium text-muted-foreground">Metadata</label>
                        <pre className="text-sm bg-muted p-2 rounded mt-1 overflow-x-auto">
                            {JSON.stringify(thread.metadata, null, 2)}
                        </pre>
                    </div>
                )}
            </div>
            <div>
                <label className="text-sm font-medium text-muted-foreground">State</label>
                <p className="text-sm font-mono">{thread.state}</p>
            </div>
        </CardContent>
    </Card>
}

function TextEditorDemo() {

    const ITEMS = [
        { id: '1', label: 'Lea Thompson' },
        { id: '2', label: 'Cyndi Lauper' },
        { id: '3', label: 'Tom Cruise' },
        { id: '4', label: 'Madonna' },
        { id: '5', label: 'Jerry Hall' },
        { id: '6', label: 'Joan Collins' },
        { id: '7', label: 'Winona Ryder' },
        { id: '8', label: 'Christina Applegate' },
        { id: '9', label: 'Alyssa Milano' },
        { id: '10', label: 'Molly Ringwald' },
        { id: '11', label: 'Ally Sheedy' },
        { id: '12', label: 'Debbie Harry' },
        { id: '13', label: 'Olivia Newton-John' },
        { id: '14', label: 'Elton John' },
        { id: '15', label: 'Michael J. Fox' },
        { id: '16', label: 'Axl Rose' },
        { id: '17', label: 'Emilio Estevez' },
        { id: '18', label: 'Ralph Macchio' },
        { id: '19', label: 'Rob Lowe' },
        { id: '20', label: 'Jennifer Grey' },
        { id: '21', label: 'Mickey Rourke' },
        { id: '22', label: 'John Cusack' },
        { id: '23', label: 'Matthew Broderick' },
        { id: '24', label: 'Justine Bateman' },
        { id: '25', label: 'Lisa Bonet' },
    ]

    return <div>
        <TextEditor mentionItems={ITEMS} placeholder="Add a comment..." defaultValue={"Hello @[user_id:7]!\n\nWhat do you think about @[user_id:3] and @[user_id:2]?\n\nCheers"} />
    </div>
}

function ThreadPage() {
    const loaderData = useLoaderData<typeof loader>();

    const [thread, setThread] = useState(loaderData.thread)
    const [formError, setFormError] = useState<string | null>(null)
    const [isStreaming, setStreaming] = useState(false)

    const users = loaderData.users

    // temporary 
    useEffect(() => {
        if (!isStreaming) {
            setThread(loaderData.thread)
        }
    }, [loaderData.thread])

    useEffect(() => {
        if (thread.state === 'in_progress') {

            (async () => {
                try {
                    const query = thread.activities.length > 0 ? `?last_activity_id=${thread.activities[thread.activities.length - 1].id}` : ''

                    const response = await fetch(`http://localhost:2138/threads/${thread.id}/watch${query}`, {
                        headers: {
                            'Content-Type': 'application/json',
                        }
                    });

                    setStreaming(true)

                    for await (const event of parseSSE(response)) {
                        if (event.event === 'activity') {
                            setThread(prevThread => {
                                const existingIdx = prevThread.activities.findIndex(a => a.id === event.data.id);
                                if (existingIdx === -1) {
                                    // New activity, append
                                    return { ...prevThread, activities: [...prevThread.activities, event.data] };
                                } else {
                                    // Existing activity, replace and remove all after
                                    return {
                                        ...prevThread,
                                        activities: [
                                            ...prevThread.activities.slice(0, existingIdx),
                                            event.data
                                        ]
                                    };
                                }
                            });
                        }
                        else if (event.event === 'thread.state') {
                            setThread(thread => ({ ...thread, state: event.data.state }))
                        }
                    }

                } catch (error) {
                    console.error(error)
                } finally {
                    setStreaming(false)
                }
            })()
        }

    }, [thread.state])


    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()

        setFormError(null)

        const formData = new FormData(e.target as HTMLFormElement)
        const message = formData.get("message")

        if (message) {
            try {
                const response = await fetch(`http://localhost:2138/threads/${thread.id}/activities`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        input: {
                            type: "message",
                            role: "user",
                            content: message
                        }
                    })
                });

                const payload = await response.json()

                if (!response.ok) {
                    console.error(payload)
                    setFormError('response not ok') // FIXME: error format fucked up (Zod)
                }
                else {
                    console.log('activity pushed successfully')
                    setThread(payload)
                }
            } catch (error) {
                console.error(error)
                setFormError(error instanceof Error ? error.message : 'Unknown error')
            }
        }
    }

    const handleCancel = async () => {
        await fetch(`http://localhost:2138/threads/${thread.id}/cancel`, {
            method: 'POST',
        })
    }

    const [selectedActivity, _setSelectedActivity] = useState<any | null>(null)
    const [isNewCommentActive, setIsNewCommentActive] = useState<boolean>(false)

    function setSelectedActivity(activity: any) {
        setIsNewCommentActive(false)
        _setSelectedActivity(activity)
    }

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Element | null;

            if (!target) return;

            const isClickingItem = target.closest('[data-item]');
            const isClickingComment = target.closest('[data-comment]');

            // Deselect if clicking outside both item and comment areas
            if (!isClickingItem && !isClickingComment) {
                setSelectedActivity(null);
            }
        };

        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    return <>
        <Header>
            <HeaderTitle title={`Thread`} />
        </Header>
        <div className="flex-1 overflow-y-auto">

            <div className=" p-6 max-w-4xl space-y-6">
                <ThreadDetails thread={thread} />

                <ItemsWithCommentsLayout items={thread.activities.map((activity) => {
                    return {
                        id: activity.id,
                        itemComponent: <ActivityView
                            activity={activity}
                            onSelect={(a) => setSelectedActivity(a)}
                            selected={selectedActivity === activity}
                            onNewComment={() => { console.log('onNewComment'); setIsNewCommentActive(true) }}
                        />,
                        commentsComponent: (activity.commentThread || (selectedActivity?.id === activity.id/* && isNewCommentActive*/)) ?
                            <CommentThread
                                commentThread={activity.commentThread}
                                activity={activity}
                                userId={loaderData.userId}
                                selected={selectedActivity?.id === activity.id}
                                users={users}
                                onSelect={(a) => setSelectedActivity(a)}
                            /> : undefined
                    }
                })} selectedItemId={selectedActivity?.id}
                />

                <div>
                    {thread.state === 'in_progress' && <div>in progress...</div>}
                    {thread.state === 'failed' && <div>failed</div>}
                </div>

            </div>

        </div>


        <Card>
            <CardHeader>
                <CardTitle>New Activity</CardTitle>
            </CardHeader>
            <CardContent>
                <form method="post" onSubmit={handleSubmit}>
                    <Textarea name="message" placeholder="Reply here..." />
                    <Button type="submit" disabled={thread.state === 'in_progress'}>Send</Button>


                    {thread.state === 'in_progress' && <Button type="button" onClick={() => {
                        handleCancel()
                    }}>Cancel</Button>}
                </form>

                {formError && <div className="text-red-500">{formError}</div>}

            </CardContent>
        </Card>
    </>
}
