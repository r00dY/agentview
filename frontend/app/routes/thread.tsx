import { redirect, useLoaderData, useFetcher, Outlet, Link, Form , data, useParams} from "react-router";
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
    let userId = null;
    try {
        const session = await auth.api.getSession({ headers: request.headers });
        userId = session?.user?.id || null;
    } catch {}

    return data({
        thread: threadData,
        userId,
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

function CommentThread({ commentThread, activityId, userId }: { commentThread: any, activityId: string, userId: string | null }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const fetcher = useFetcher();

    const commentCount = commentThread?.commentMessages?.length || 0;

    // console.log(commentCount)

    return (
        <div className="mt-2">
            <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-xs text-muted-foreground hover:text-foreground"
            >
                💬 {commentCount} comment{commentCount !== 1 ? 's' : ''}
            </Button>
            
            {isExpanded && (
                <div className="mt-3 space-y-3">
                    {/* Existing comments */}
                    {commentThread?.commentMessages?.map((message: any) => (
                        <CommentMessageItem
                            key={message.id}
                            message={message}
                            userId={userId}
                            fetcher={fetcher}
                            activityId={activityId}
                        />
                    ))}
                    
                    {/* New comment form */}
                    <fetcher.Form method="post" className="space-y-2">
                        <Textarea 
                            name="content" 
                            placeholder="Add a comment..." 
                            className="min-h-[80px]"
                            required
                        />
                        <input type="hidden" name="activityId" value={activityId} />
                        <div className="flex gap-2">
                            <Button 
                                type="submit" 
                                size="sm" 
                                disabled={fetcher.state !== 'idle'}
                            >
                                {fetcher.state !== 'idle' ? 'Posting...' : 'Post Comment'}
                            </Button>
                            <Button 
                                type="button" 
                                variant="outline" 
                                size="sm"
                                onClick={() => setIsExpanded(false)}
                            >
                                Cancel
                            </Button>
                        </div>
                        {fetcher.data?.error && (
                            <div className="text-sm text-red-500">{fetcher.data.error}</div>
                        )}
                    </fetcher.Form>
                </div>
            )}
        </div>
    );
}

// New subcomponent for comment message item with edit logic
function CommentMessageItem({ message, userId, activityId }: { message: any, userId: string | null, fetcher: any, activityId: string }) {
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState(message.content);
    const fetcher = useFetcher();

    if (isEditing) {
        console.log('fetcher state', fetcher.state)
    }

    const isOwn = userId && message.userId === userId;

    useFetcherSuccess(fetcher, (data) => {
        console.log('fetcher success', data)
        setIsEditing(false)
    })

    if (isEditing) {
        return (
            <fetcher.Form method="post" className="space-y-2">
                <Textarea
                    name="content"
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    className="min-h-[60px]"
                    required
                />
                <input type="hidden" name="editCommentMessageId" value={message.id} />
                <input type="hidden" name="activityId" value={activityId} />
                <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={fetcher.state !== 'idle'}>
                        {fetcher.state !== 'idle' ? 'Saving...' : 'Save'}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsEditing(false)}>
                        Cancel
                    </Button>
                </div>
                {fetcher.data?.error && (
                    <div className="text-sm text-red-500">{fetcher.data.error}</div>
                )}
            </fetcher.Form>
        );
    }

    return (
        <div className="bg-muted/50 p-3 rounded-lg">
            <div className="flex items-start gap-2">
                <div className="flex-1">
                    <div className="text-sm font-medium text-muted-foreground">
                        {message.userId}
                    </div>
                    <div className="text-sm mt-1">
                        <div dangerouslySetInnerHTML={{ __html: highlightMentions(message.content) }} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                        {new Date(message.createdAt).toLocaleString()}
                        {message.updatedAt && message.updatedAt !== message.createdAt && (
                            <>
                                {" · "}
                                Edited
                            </>
                        )}
                    </div>
                </div>
                {isOwn && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="ml-2 text-xs"
                        onClick={() => setIsEditing(true)}
                    >
                        Edit
                    </Button>
                )}
            </div>
        </div>
    );
}

export default function  ThreadPageWrapper() {
    const loaderData = useLoaderData<typeof loader>();
    return <ThreadPage key={loaderData.thread.id} />
}

function ThreadPage() {
    const loaderData = useLoaderData<typeof loader>();

    const [thread, setThread] = useState(loaderData.thread)
    const [formError, setFormError] = useState<string | null>(null)
    const [isStreaming, setStreaming] = useState(false)

    // temporary 
    useEffect(() => {
        if (!isStreaming) {
            setThread(loaderData.thread)
        }
    }, [loaderData.thread])

    // console.log('first comment thread', thread.activities[0].commentThread)
    // console.log('first comment thread messages length', thread.activities[0].commentThread?.commentMessages?.length)

    useEffect(() => {
        // let abortController : AbortController | undefined = undefined;

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
        const response = await fetch(`http://localhost:2138/threads/${thread.id}/cancel`, {
            method: 'POST',
        })
    }

    
  return <>
    <Header>
      <HeaderTitle title={`Thread`} />
    </Header>

   <div className="flex-1 overflow-y-auto">

      <div className=" p-6 max-w-4xl space-y-6">
      <Card>
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

        <div className="space-y-6 mt-12">
            {thread.activities.map((activity) => { 
                return <div key={activity.id} className="relative">

                { activity.role === "user" && (<div className="pl-[25%] relative flex flex-col justify-end">
                    { activity.type === "message" && (<div className="border bg-muted p-3 rounded-lg">
                        <div dangerouslySetInnerHTML={{ __html: (activity.content as unknown as string) }}></div>
                        {/* <div className="text-xs text-muted-foreground">{activity.run.state}</div> */}
                    </div>)}
                    { activity.type !== "message" && (<div className="border bg-muted p-3 rounded-lg italic text-muted-foreground">no view</div>)}
                </div>)}
                
                { activity.role !== "user" && (<div className="pr-[25%] relative flex flex-col justify-start">
                    { activity.type === "message" && (<div className="border p-3 rounded-lg">
                        <div dangerouslySetInnerHTML={{ __html: (activity.content as unknown as string) }}></div>
                        {/* <div className="text-xs text-muted-foreground">{activity.run.state}</div> */}
                    </div>)}
                    { activity.type !== "message" && (<div className="border p-3 rounded-lg italic text-muted-foreground">no view</div>)}
                </div>)}
                
                {/* Comment thread for each activity */}
                <div className="mt-2">
                    <CommentThread 
                        commentThread={activity.commentThread} 
                        activityId={activity.id} 
                        userId={loaderData.userId}
                    />
                </div>
            </div>
             })}
        </div>

        <div>
            { thread.state === 'in_progress' && <div>in progress...</div>}
            { thread.state === 'failed' && <div>failed</div>}
        </div>

    </div>
    
    </div> 


    <Card>
            <CardHeader>
                <CardTitle>New Activity</CardTitle>
            </CardHeader>
            <CardContent>
                <form method="post" onSubmit={handleSubmit}>
                    <Textarea name="message" placeholder="Reply here..."/>
                    <Button type="submit" disabled={thread.state === 'in_progress'}>Send</Button>

                    
                        { thread.state === 'in_progress' && <Button type="button" onClick={() => {
                            handleCancel()
                    }}>Cancel</Button> }
                </form>

                { formError && <div className="text-red-500">{formError}</div> }

                {/* { fetcher.data?.error && (
                    <div className="text-red-500">{fetcher.data.error}</div>
                )} */}
                
            </CardContent>
        </Card>
  </>
}
