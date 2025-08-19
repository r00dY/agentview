import { pgTable, text, timestamp, uuid, varchar, jsonb, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth-schema";
import { relations } from "drizzle-orm";

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
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("data"),
  client_id: uuid("client_id").notNull().references(() => client.id, { onDelete: 'cascade' }),
  type: varchar({ length: 255 }).notNull(),
});

export const activity = pgTable("activity", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  content: text('content').notNull(),
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
  previousContent: text('previous_content').notNull(),
  editedAt: timestamp('edited_at', { withTimezone: true }).notNull().defaultNow(),
});

export const scores = pgTable('scores', {
  id: uuid('id').primaryKey().defaultRandom(),
  activityId: uuid('activity_id').notNull().references(() => activity.id, { onDelete: 'cascade' }),

  type: varchar('type', { length: 255 }).notNull(),
  value: jsonb('value').notNull(),
  commentId: uuid('comment_id').references(() => commentMessages.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  // Soft delete fields
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: text('deleted_by').references(() => users.id, { onDelete: 'set null' }),
});


export const threadRelations = relations(thread, ({ many, one }) => ({
  activities: many(activity),
  runs: many(run),
  client: one(client, {
    fields: [thread.client_id],
    references: [client.id],
  }),
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
  mentions: many(commentMentions),
  edits: many(commentMessageEdits),
}))