# Architecture Requirements Document: Comments Feature

## Overview

Add commenting functionality to AgentView, allowing users to comment on individual activities within threads. Each activity will have its own comment thread where users can discuss, provide feedback, or ask questions about specific agent responses or user messages.

## Requirements

### Functional Requirements

1. **Comment Threads**: Each activity has a dedicated comment thread
2. **Comment Messages**: Users can add text messages with @mentions to comment threads
3. **User Mentions**: Support @{user_id} mentions that are validated and stored separately
4. **Edit History**: Track all edits to comment messages with full history
5. **User Attribution**: Each message is linked to user_id, activity_id, and thread_id
6. **Simple Text Format**: Plain text content with mentions only, no rich formatting

### Non-Functional Requirements

1. **Performance**: Comment loading should not significantly impact thread loading time
2. **Scalability**: Support up to 100 messages per comment thread
3. **Data Integrity**: All mentions must reference valid user IDs
4. **Audit Trail**: Complete edit history for all messages

## Data Model

### Database Schema (Drizzle)

```typescript
// Comment threads - one per activity
export const commentThreads = pgTable('comment_threads', {
    id: uuid('id').primaryKey().defaultRandom(),
    activityId: uuid('activity_id').notNull().references(() => activities.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Comment messages within threads
export const commentMessages = pgTable('comment_messages', {
    id: uuid('id').primaryKey().defaultRandom(),
    commentThreadId: uuid('comment_thread_id').notNull().references(() => commentThreads.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id').notNull().references(() => activities.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    editCount: integer('edit_count').default(0),
}, (table) => ({
    commentThreadIdIdx: index('idx_comment_messages_thread_id').on(table.commentThreadId),
    userIdIdx: index('idx_comment_messages_user_id').on(table.userId),
    activityIdIdx: index('idx_comment_messages_activity_id').on(table.activityId),
    createdAtIdx: index('idx_comment_messages_created_at').on(table.createdAt),
}));

// User mentions within comment messages
export const commentMentions = pgTable('comment_mentions', {
    id: uuid('id').primaryKey().defaultRandom(),
    commentMessageId: uuid('comment_message_id').notNull().references(() => commentMessages.id, { onDelete: 'cascade' }),
    mentionedUserId: uuid('mentioned_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    mentioningUserId: uuid('mentioning_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(), // Character position in content where mention starts
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
    commentMessageIdIdx: index('idx_comment_mentions_message_id').on(table.commentMessageId),
    mentionedUserIdIdx: index('idx_comment_mentions_mentioned_user_id').on(table.mentionedUserId),
    uniqueMessagePosition: unique().on(table.commentMessageId, table.position),
}));

// Edit history for comment messages
export const commentMessageEdits = pgTable('comment_message_edits', {
    id: uuid('id').primaryKey().defaultRandom(),
    commentMessageId: uuid('comment_message_id').notNull().references(() => commentMessages.id, { onDelete: 'cascade' }),
    previousContent: text('previous_content').notNull(),
    editedBy: uuid('edited_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
    editedAt: timestamp('edited_at', { withTimezone: true }).defaultNow(),
    editReason: text('edit_reason'), // Optional reason for edit
}, (table) => ({
    commentMessageIdIdx: index('idx_comment_message_edits_message_id').on(table.commentMessageId),
    editedAtIdx: index('idx_comment_message_edits_edited_at').on(table.editedAt),
}));
```

### TypeScript Types

```typescript
interface CommentThread {
    id: string;
    activity_id: string;
    thread_id: string;
    created_at: string;
    updated_at: string;
    message_count?: number;
}

interface CommentMessage {
    id: string;
    comment_thread_id: string;
    user_id: string;
    thread_id: string;
    activity_id: string;
    content: string;
    created_at: string;
    updated_at: string;
    edit_count: number;
    user?: User;
    mentions?: CommentMention[];
}

interface CommentMention {
    id: string;
    comment_message_id: string;
    mentioned_user_id: string;
    mentioning_user_id: string;
    position: number;
    created_at: string;
    mentioned_user?: User;
}

interface CommentMessageEdit {
    id: string;
    comment_message_id: string;
    previous_content: string;
    edited_by: string;
    edited_at: string;
    edit_reason?: string;
    editor?: User;
}
```

## API Design

### REST Endpoints

```
GET /threads/{thread_id}/activities/{activity_id}/comments
- Returns paginated comments for an activity
- Query params: limit, offset, order (asc/desc)

POST /threads/{thread_id}/activities/{activity_id}/comments
- Creates a new comment
- Body: { content: string }
- Returns: Comment object

PUT /threads/{thread_id}/activities/{activity_id}/comments/{comment_id}
- Updates comment content (only by original author)
- Body: { content: string }

DELETE /threads/{thread_id}/activities/{activity_id}/comments/{comment_id}
- Deletes comment (only by original author or admin)
```

### Real-time Events

Comments shouldn't be stream via `/watch`. 

## UI/UX Design

### Component Structure

```
ActivityItem
├── ActivityContent (existing)
├── CommentSection (new)
    ├── CommentList
    │   └── CommentItem[]
    └── CommentForm
```

### User Interface

1. **Comment Toggle**: Small comment icon/count next to each activity
2. **Comment Section**: Expandable section below each activity
3. **Comment Form**: Simple textarea with submit button
4. **Comment Display**: User avatar, name, timestamp, and content
5. **Comment Actions**: Edit/delete for own comments (inline editing)

### Interaction Flow

1. User clicks comment icon on an activity
2. Comment section expands showing existing comments
3. Comment form appears at bottom
4. User types and submits comment
5. Comment appears immediately in UI
6. Real-time update sent to other users viewing the thread

## Technical Implementation

### Database Layer (Drizzle)

Add comments table to `app/db/schema.ts`:

```typescript
export const comments = pgTable('comments', {
    id: uuid('id').primaryKey().defaultRandom(),
    activityId: uuid('activity_id').notNull().references(() => activities.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
    activityIdIdx: index('idx_comments_activity_id').on(table.activityId),
    userIdIdx: index('idx_comments_user_id').on(table.userId),
    createdAtIdx: index('idx_comments_created_at').on(table.createdAt),
}));
```

### API Routes

Add comment routes to React Router:

```typescript
// app/routes/threads.$threadId.activities.$activityId.comments.ts
// app/routes/threads.$threadId.activities.$activityId.comments.$commentId.ts
```

### Real-time Integration

Extend existing SSE infrastructure to broadcast comment events alongside activity updates.

### Frontend Components

Create new components in `app/components/`:
- `CommentSection.tsx`
- `CommentList.tsx` 
- `CommentItem.tsx`
- `CommentForm.tsx`

## Security Considerations

1. **Authorization**: Users can only comment on threads they have access to
2. **Content Validation**: Sanitize comment content to prevent XSS
3. **Rate Limiting**: Prevent comment spam with rate limiting
4. **Permissions**: Only comment authors can edit/delete their comments
5. **Thread Access**: Comments inherit thread visibility permissions

## Performance Considerations

1. **Lazy Loading**: Comments load only when comment section is expanded
2. **Pagination**: Implement pagination for threads with many comments
3. **Caching**: Cache comment counts per activity
4. **Database Indexing**: Proper indexes on activity_id and created_at
5. **Real-time Optimization**: Batch comment events when possible

## Migration Strategy

1. **Phase 1**: Database schema migration
2. **Phase 2**: Backend API implementation
3. **Phase 3**: Frontend UI components
4. **Phase 4**: Real-time integration
5. **Phase 5**: Testing and performance optimization

## Future Considerations

1. **Rich Text**: Support for markdown or rich text formatting
2. **Reactions**: Quick emoji reactions to comments
3. **Mentions**: @mention functionality for users
4. **File Attachments**: Ability to attach files to comments
5. **Comment Moderation**: Admin tools for managing comments