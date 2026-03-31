import { and, eq, inArray, isNull } from "drizzle-orm";
import { type OrgTransaction } from "./withOrg";
import { type Target } from "./target";
import { updateInboxes } from "./updateInboxes";
import { commentMentions, events, commentMessageEdits, scores, commentMessages } from "./schemas/schema";
import { AgentViewError } from "agentview";

export async function requireCommentMessage(tx: OrgTransaction, commentId: string) {
  const comment = await tx.query.commentMessages.findFirst({
    where: and(
      eq(commentMessages.id, commentId),
      isNull(commentMessages.deletedAt)
    )
  });

  if (!comment) {
    throw new AgentViewError("Comment not found", 404);
  }

  return comment
}

export function requireCommentOwnership(comment: { userId: string }, memberId: string) {
  if (comment.userId !== memberId) {
    throw new AgentViewError("You can only edit your own comments.", 401);
  }
}

export async function createComment(
  tx: OrgTransaction,
  target: Target,
  memberId: string,
  content: string | null,
) {
  // Add comment
  const [newMessage] = await tx.insert(commentMessages).values({
    organizationId: tx.organizationId,
    ...target.ids,
    userId: memberId,
    content,
  }).returning();

  let userMentions: string[] = [];

  // Add comment mentions
  if (content) {
    const mentions = extractMentions(content);

    userMentions = mentions.user_id || [];

    if (userMentions.length > 0) {
      await tx.insert(commentMentions).values(
        userMentions.map((mentionedUserId: string) => ({
          organizationId: tx.organizationId,
          commentMessageId: newMessage.id,
          mentionedUserId,
        }))
      );
    }
  }

  // Emit event
  const [event] = await tx.insert(events).values({
    organizationId: tx.organizationId,
    type: 'comment_created',
    authorId: memberId,
    payload: {
      comment_id: newMessage.id,
      has_comment: content ? true : false,
      user_mentions: userMentions,
    }
  }).returning();

  await updateInboxes(tx, event);

  return newMessage;
}

export async function updateComment(
  tx: OrgTransaction,
  commentMessage: any,
  newContent: string | null,
) {
  // Extract mentions from new content
  let newMentions, previousMentions;
  let newUserMentions: string[] = [], previousUserMentions: string[] = [];

  newMentions = extractMentions(newContent ?? "");
  previousMentions = extractMentions(commentMessage.content ?? "");
  newUserMentions = newMentions.user_id || [];
  previousUserMentions = previousMentions.user_id || [];

  // Store previous content in edit history
  await tx.insert(commentMessageEdits).values({
    organizationId: tx.organizationId,
    commentMessageId: commentMessage.id,
    previousContent: commentMessage.content,
  });

  // Update the comment message
  await tx.update(commentMessages)
    .set({ content: newContent, updatedAt: new Date().toISOString() })
    .where(eq(commentMessages.id, commentMessage.id));

  // Handle mentions for edits
  if (newUserMentions.length > 0 || previousUserMentions.length > 0) {
    // Get existing mentions for this message
    const existingMentions = await tx
      .select()
      .from(commentMentions)
      .where(eq(commentMentions.commentMessageId, commentMessage.id));

    const existingMentionedUserIds = existingMentions.map((m: any) => m.mentionedUserId);

    // Find new mentions to add
    const newMentionsToAdd = newUserMentions.filter((mention: string) =>
      !existingMentionedUserIds.includes(mention)
    );

    // Find mentions to remove (existed before but not in new content)
    const mentionsToRemove = existingMentionedUserIds.filter((mention: string) =>
      !newUserMentions.includes(mention)
    );

    // Remove mentions that are no longer present
    if (mentionsToRemove.length > 0) {
      await tx.delete(commentMentions)
        .where(and(
          eq(commentMentions.commentMessageId, commentMessage.id),
          inArray(commentMentions.mentionedUserId, mentionsToRemove)
        ));
    }

    // Add new mentions
    if (newMentionsToAdd.length > 0) {
      await tx.insert(commentMentions).values(
        newMentionsToAdd.map((mentionedUserId: string) => ({
          organizationId: tx.organizationId,
          commentMessageId: commentMessage.id,
          mentionedUserId,
        }))
      );
    }
  }

  // Emit event
  const [event] = await tx.insert(events).values({
    organizationId: tx.organizationId,
    type: 'comment_edited',
    authorId: commentMessage.userId,
    payload: {
      comment_id: commentMessage.id,
      has_comment: newContent ? true : false,
      user_mentions: newUserMentions,
    }
  }).returning();

  await updateInboxes(tx, event);

  return commentMessage;
}

export async function deleteComment(
  tx: OrgTransaction,
  commentId: any,
  memberId: string,
): Promise<void> {
  await tx.delete(commentMentions).where(eq(commentMentions.commentMessageId, commentId));
  await tx.delete(scores).where(eq(scores.commentId, commentId));
  await tx.update(commentMessages).set({
    deletedAt: new Date().toISOString(),
    deletedBy: memberId
  }).where(eq(commentMessages.id, commentId));

  // Emit event
  const [event] = await tx.insert(events).values({
    organizationId: tx.organizationId,
    type: 'comment_deleted',
    authorId: memberId,
    payload: {
      comment_id: commentId
    }
  }).returning();

  await updateInboxes(tx, event);
}



/**
 * Extracts mentions from comment content in the format @[property:value]
 * Currently supports: user_id
 * @param content The comment content to parse
 * @returns Dictionary where key is property and value is array of values
 * @throws Error if @[...] format is invalid
 */
function extractMentions(content: string): Record<string, string[]> {
  if (content === null || content === undefined) {
    return {};
  }

  const mentionRegex = /@\[([^\]]+)\]/g;
  const mentions: Record<string, string[]> = {};
  let match;

  while ((match = mentionRegex.exec(content)) !== null) {
    const inside = match[1];

    // Parse property:value format
    const colonIndex = inside.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Invalid mention format: @[${inside}]. Expected format: @[property:value]`);
    }

    const property = inside.substring(0, colonIndex).trim();
    const value = inside.substring(colonIndex + 1).trim();

    // Validate property
    if (property !== 'user_id') {
      throw new Error(`Unsupported mention property: ${property}. Only 'user_id' is currently supported.`);
    }

    // Validate value is not empty
    if (!value) {
      throw new Error(`Invalid mention value for property ${property}: empty value`);
    }

    // Add to mentions dictionary
    if (!mentions[property]) {
      mentions[property] = [];
    }

    // Avoid duplicates
    if (!mentions[property].includes(value)) {
      mentions[property].push(value);
    }
  }

  return mentions;
}
