import { integer, pgTable, text, timestamp, uuid, varchar, jsonb } from "drizzle-orm/pg-core";
import { user, session, account, verification } from "./auth-schema";
import type { Database } from "lucide-react";
import { asc, relations } from "drizzle-orm";

export const invitations = pgTable("invitation", {
  id: text('id').primaryKey(),
  email: varchar({ length: 255 }).notNull(),
  role: varchar({ length: 255 }).notNull(),
  expires_at: timestamp().notNull(),
  created_at: timestamp().notNull(),
  status: varchar({ length: 255 }).notNull(),
  invited_by: text('invited_by').references(() => user.id, { onDelete: 'cascade' })
});

export const email = pgTable("email", {
  id: text('id').primaryKey(),
  user_id: text('user_id').references(() => user.id),
  to: varchar({ length: 255 }).notNull(),
  subject: varchar({ length: 255 }),
  body: text('body'),
  text: text('text'),
  from: varchar({ length: 255 }).notNull(),
  cc: varchar({ length: 255 }),
  bcc: varchar({ length: 255 }),
  reply_to: varchar({ length: 255 }),
  created_at: timestamp().notNull().defaultNow(),
  updated_at: timestamp().notNull().defaultNow(),
});

export const client = pgTable("client", {
  id: uuid("id").primaryKey().defaultRandom(),
  created_at: timestamp().notNull().defaultNow(),
  updated_at: timestamp().notNull().defaultNow(),
});

export const thread = pgTable("thread", {
  id: uuid("id").primaryKey().defaultRandom(),
  created_at: timestamp().notNull().defaultNow(),
  updated_at: timestamp().notNull().defaultNow(),
  metadata: jsonb("data"),
  client_id: uuid("client_id").notNull().references(() => client.id, { onDelete: 'cascade' }),
  type: varchar({ length: 255 }).notNull(),
});

export const activity = pgTable("activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  created_at: timestamp().notNull().defaultNow(),
  updated_at: timestamp().notNull().defaultNow(),
  content: jsonb("content"),
  thread_id: uuid("thread_id").notNull().references(() => thread.id, { onDelete: 'cascade' }),
  run_id: uuid("run_id").references(() => run.id, { onDelete: 'set null' }),
  type: varchar({ length: 255 }).notNull(),
  role: varchar({ length: 255 }).notNull(),
});

export const run = pgTable("run", {
  id: uuid("id").primaryKey().defaultRandom(),
  created_at: timestamp().notNull().defaultNow(),
  finished_at: timestamp(),
  thread_id: uuid("thread_id").notNull().references(() => thread.id, { onDelete: 'cascade' }),
  state: varchar({ length: 255 }).notNull(),
});


export const commentThreads = pgTable('comment_threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  activityId: uuid('activity_id').notNull().references(() => activity.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Comment messages within threads
export const commentMessages = pgTable('comment_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  commentThreadId: uuid('comment_thread_id').notNull().references(() => commentThreads.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// User mentions within comment messages
export const commentMentions = pgTable('comment_mentions', {
  id: uuid('id').primaryKey().defaultRandom(),
  commentMessageId: uuid('comment_message_id').notNull().references(() => commentMessages.id, { onDelete: 'cascade' }),
  mentionedUserId: text('mentioned_user_id').notNull().references(() => user.id, { onDelete: 'cascade' })
});


// Edit history for comment messages
export const commentMessageEdits = pgTable('comment_message_edits', {
  id: uuid('id').primaryKey().defaultRandom(),
  commentMessageId: uuid('comment_message_id').notNull().references(() => commentMessages.id, { onDelete: 'cascade' }),
  previousContent: text('previous_content').notNull(),
  editedAt: timestamp('edited_at', { withTimezone: true }).defaultNow(),
});


export const threadRelations = relations(thread, ({ many }) => ({
  activities: many(activity),
  runs: many(run)
}));

export const runRelations = relations(run, ({ one, many }) => ({
  thread: one(thread, {
    fields: [run.thread_id],
    references: [thread.id],
  }),
  activities: many(activity)
}));

export const activityRelations = relations(activity, ({ one }) => ({
  thread: one(thread, {
    fields: [activity.thread_id],
    references: [thread.id],
  }),
  run: one(run, {
    fields: [activity.run_id],
    references: [run.id],
  }),
  commentThread: one(commentThreads, {
    fields: [activity.id],
    references: [commentThreads.activityId],
  }),
}));

export const commentThreadsRelations = relations(commentThreads, ({ many }) => ({
  commentMessages: many(commentMessages),
}))

export const commentMessagesRelations = relations(commentMessages, ({ one, many }) => ({
  commentThread: one(commentThreads, {
    fields: [commentMessages.commentThreadId],
    references: [commentThreads.id],
  }),
  mentions: many(commentMentions),
  edits: many(commentMessageEdits),
}))