import type { Route } from "./+types/threadComments";
import { db } from "~/lib/db.server";
import { commentThreads, commentMessages, commentMessageEdits, commentMentions } from "~/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { auth } from "~/lib/auth.server";
import { extractMentions } from "~/lib/utils";

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