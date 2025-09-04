import { pgTable, text, timestamp, uuid, varchar, jsonb, boolean, uniqueIndex, integer, bigserial, bigint, serial, unique } from "drizzle-orm/pg-core";
import { users } from "./auth-schema";
import { relations, sql } from "drizzle-orm";

export const invitations = pgTable("invitation", {
  id: text('id').primaryKey(),
  email: varchar({ length: 255 }).notNull(),
  role: varchar({ length: 255 }).notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  status: varchar({ length: 255 }).notNull(),
  invited_by: text('invited_by').references(() => users.id, { onDelete: 'cascade' })
});

// Channels table for managing different communication channels
export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: varchar({ length: 255 }).notNull(), // 'slack', 'email', 'whatsapp', 'web_chat', etc.
  name: varchar({ length: 255 }).notNull(),
  config: jsonb("config"),
  enabled: boolean("enabled").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const email = pgTable("email", {
  id: text('id').primaryKey(),
  user_id: text('user_id').references(() => users.id),
  to: varchar({ length: 255 }).notNull(),
  subject: varchar({ length: 255 }),
  body: text('body'),
  text: text('text'),
  from: varchar({ length: 255 }).notNull(),
  cc: varchar({ length: 255 }),
  bcc: varchar({ length: 255 }),
  reply_to: varchar({ length: 255 }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const client = pgTable("client", {
  id: uuid("id").primaryKey().defaultRandom(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  simulated_by: text('simulated_by').references(() => users.id, { onDelete: 'set null' }),
  is_shared: boolean("is_shared").notNull().default(false),
});

export const thread = pgTable("thread", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: serial("string").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("data"),
  client_id: uuid("client_id").notNull().references(() => client.id, { onDelete: 'cascade' }),
  type: varchar({ length: 255 }).notNull(),
});

export const activity = pgTable("activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: serial("string").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  content: jsonb("content"),
  thread_id: uuid("thread_id").notNull().references(() => thread.id, { onDelete: 'cascade' }),
  run_id: uuid("run_id").notNull().references(() => run.id, { onDelete: 'set null' }),
  type: varchar({ length: 255 }).notNull(),
  role: varchar({ length: 255 }).notNull(),

  channel_id: uuid("channel_id").references(() => channels.id, { onDelete: 'set null' }),
  channel_activity_id: varchar({ length: 255 }),
}, (table) => ({
  channelActivityUnique: uniqueIndex('channel_activity_unique').on(table.channel_id, table.channel_activity_id),
}));

export const versions = pgTable("versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: varchar({ length: 255 }).notNull(),
  env: varchar({ length: 255 }).notNull().default("dev"),
  metadata: jsonb("metadata"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  versionEnvUnique: uniqueIndex('version_env_unique').on(table.version, table.env),
}));

export const run = pgTable("run", {
  id: uuid("id").primaryKey().defaultRandom(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finished_at: timestamp("finished_at", { withTimezone: true }),
  thread_id: uuid("thread_id").notNull().references(() => thread.id, { onDelete: 'cascade' }),
  version_id: uuid("version_id").references(() => versions.id), // version is nullable because when run is created, version is not yet created yet (no `run` was made)
  state: varchar({ length: 255 }).notNull(),
  fail_reason: jsonb("fail_reason"),
});

// Comment messages within threads
export const commentMessages = pgTable('comment_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  activityId: uuid('activity_id').notNull().references(() => activity.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

  // Soft delete fields
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: text('deleted_by').references(() => users.id, { onDelete: 'set null' }),
});

// User mentions within comment messages
export const commentMentions = pgTable('comment_mentions', {
  id: uuid('id').primaryKey().defaultRandom(),
  commentMessageId: uuid('comment_message_id').notNull().references(() => commentMessages.id, { onDelete: 'cascade' }),
  mentionedUserId: text('mentioned_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});


// Edit history for comment messages
export const commentMessageEdits = pgTable('comment_message_edits', {
  id: uuid('id').primaryKey().defaultRandom(),
  commentMessageId: uuid('comment_message_id').notNull().references(() => commentMessages.id, { onDelete: 'cascade' }),
  previousContent: text('previous_content'),
  editedAt: timestamp('edited_at', { withTimezone: true }).notNull().defaultNow(),
});

export const scores = pgTable('scores', {
  id: uuid('id').primaryKey().defaultRandom(),
  activityId: uuid('activity_id').notNull().references(() => activity.id, { onDelete: 'cascade' }),

  name: varchar('type', { length: 255 }).notNull(),
  value: jsonb('value').notNull(),
  commentId: uuid('comment_id').notNull().references(() => commentMessages.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  // Soft delete fields
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: text('deleted_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  activityNameUnique: uniqueIndex('scores_activity_name_unique').on(table.activityId, table.name),
}));



export const events = pgTable('events', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  authorId: text('author_id').references(() => users.id),
  type: varchar('type', { length: 256 }).notNull(),  // "comment_created", "comment_edited", "comment_deleted", etc...
  payload: jsonb('payload').notNull(),

  // activityId: uuid('activity_id').references(() => activity.id), // this is derived and temporary!!! Allows us easily to fetch inbox_items with events.
  // commentId: uuid('comment_id').references(() => commentMessages.id),
  // threadId: uuid('thread_id').references(() => thread.id),
});

export const inboxItems = pgTable('inbox_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

  userId: text('user_id').notNull().references(() => users.id),
  activityId: uuid('activity_id').references(() => activity.id), // for now (user x activity) is the only possible "inbox item", later maybe (user x thread) will happen
  threadId: uuid('thread_id').notNull().references(() => thread.id),
  
  // lastEventId: bigint('last_event_id', { mode: 'number' }).references(() => events.id),

  lastReadEventId: bigint('last_read_event_id', { mode: 'number' }).references(() => events.id),
  lastNotifiableEventId: bigint('last_notifiable_event_id', { mode: 'number' }).references(() => events.id),
  render: jsonb('render').notNull(),

  // unreadCount: integer('unread_count').notNull().default(0),
  // firstActiveEventId: bigint('first_active_event_id', { mode: 'number' }).references(() => events.id),

  // lastActiveEventId: bigint('last_active_event_id', { mode: 'number' }).references(() => events.id),

  // lastReadEventId: bigint('last_read_event_id', { mode: 'number' }).references(() => events.id),
  // lastEventId: bigint('last_event_id', { mode: 'number' }).references(() => events.id),

  // payload: jsonb('payload').notNull(),

  // lastEventAt: timestamp('last_event_at', { withTimezone: true }),

  // unreadCount: integer('unread_count').notNull().default(0),
  // attentionLevel: integer('attention_level').notNull().default(0), // 0: none, 1: low, 2: high (mention)
}, (table) => [
  unique().on(table.userId, table.activityId, table.threadId).nullsNotDistinct()
]);



// Schemas
export const schemas = pgTable('schemas', {
  id: uuid('id').primaryKey().defaultRandom(),
  schema: jsonb('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
});

export const threadRelations = relations(thread, ({ many, one }) => ({
  activities: many(activity),
  runs: many(run),
  client: one(client, {
    fields: [thread.client_id],
    references: [client.id],
  }),
  inboxItems: many(inboxItems),
}));

export const clientRelations = relations(client, ({ many, one }) => ({
  threads: many(thread),
  simulatedBy: one(users, {
    fields: [client.simulated_by],
    references: [users.id],
  }),
}));

export const channelsRelations = relations(channels, ({ many }) => ({
  activities: many(activity),
}));

export const versionsRelations = relations(versions, ({ many }) => ({
  runs: many(run),
}));

export const runRelations = relations(run, ({ one, many }) => ({
  thread: one(thread, {
    fields: [run.thread_id],
    references: [thread.id],
  }),
  version: one(versions, {
    fields: [run.version_id],
    references: [versions.id],
  }),
  activities: many(activity)
}));

export const activityRelations = relations(activity, ({ one, many }) => ({
  thread: one(thread, {
    fields: [activity.thread_id],
    references: [thread.id],
  }),
  run: one(run, {
    fields: [activity.run_id],
    references: [run.id],
  }),
  channel: one(channels, {
    fields: [activity.channel_id],
    references: [channels.id],
  }),
  commentMessages: many(commentMessages),
  scores: many(scores),
}));

export const commentMessagesRelations = relations(commentMessages, ({ one, many }) => ({
  activity: one(activity, {
    fields: [commentMessages.activityId],
    references: [activity.id],
  }),
  user: one(users, {
    fields: [commentMessages.userId],
    references: [users.id],
  }),
  mentions: many(commentMentions),
  edits: many(commentMessageEdits),
  scores: many(scores),
}));

export const commentMentionsRelations = relations(commentMentions, ({ one }) => ({
  commentMessage: one(commentMessages, {
    fields: [commentMentions.commentMessageId],
    references: [commentMessages.id],
  }),
  mentionedUser: one(users, {
    fields: [commentMentions.mentionedUserId],
    references: [users.id],
  }),
}));

export const commentMessageEditsRelations = relations(commentMessageEdits, ({ one }) => ({
  commentMessage: one(commentMessages, {
    fields: [commentMessageEdits.commentMessageId],
    references: [commentMessages.id],
  }),
}));

export const scoresRelations = relations(scores, ({ one }) => ({
  activity: one(activity, {
    fields: [scores.activityId],
    references: [activity.id],
  }),
  comment: one(commentMessages, {
    fields: [scores.commentId],
    references: [commentMessages.id],
  }),
  createdByUser: one(users, {
    fields: [scores.createdBy],
    references: [users.id],
  }),
  deletedByUser: one(users, {
    fields: [scores.deletedBy],
    references: [users.id],
  }),
}));

export const inboxItemsRelations = relations(inboxItems, ({ one, many }) => ({
  activity: one(activity, {
    fields: [inboxItems.activityId],
    references: [activity.id],
  }),
  thread: one(thread, {
    fields: [inboxItems.threadId],
    references: [thread.id],

  }),
  user: one(users, {
    fields: [inboxItems.userId],
    references: [users.id],
  }),
  lastReadEvent: one(events, {
    fields: [inboxItems.lastReadEventId],
    references: [events.id],
  }),
  lastNotifiableEvent: one(events, {
    fields: [inboxItems.lastNotifiableEventId],
    references: [events.id],
  }),
  // lastReadEvent: one(events, {
  //   fields: [inboxItems.lastReadEventId],
  //   references: [events.id],
  // }),
  // lastEvent: one(events, {
  //   fields: [inboxItems.lastEventId],
  //   references: [events.id],
  // }),
  events: many(events),
}));

export const usersRelations = relations(users, ({ many }) => ({
  inboxItems: many(inboxItems),
}));