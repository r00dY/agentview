import { pgTable, text, timestamp, uuid, varchar, jsonb, boolean, uniqueIndex, integer, bigserial, bigint, serial, unique } from "drizzle-orm/pg-core";
import { users, accounts, verifications, authSessions } from "./auth-schema";
import { relations, sql } from "drizzle-orm";

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull(),
  role: varchar("role", { length: 255 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  status: varchar({ length: 255 }).notNull(),
  invitedBy: text('invited_by').references(() => users.id, { onDelete: 'cascade' })
});

// Channels table for managing different communication channels
// export const channels = pgTable("channels", {
//   id: uuid("id").primaryKey().defaultRandom(),
//   type: varchar({ length: 255 }).notNull(), // 'slack', 'email', 'whatsapp', 'web_chat', etc.
//   name: varchar({ length: 255 }).notNull(),
//   config: jsonb("config"),
//   enabled: boolean("enabled").notNull().default(true),
//   createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
//   updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
// });

export const emails = pgTable("emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").references(() => users.id),
  to: varchar("to", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 255 }),
  body: text("body"),
  text: text("text"),
  from: varchar("from", { length: 255 }).notNull(),
  cc: varchar("cc", { length: 255 }),
  bcc: varchar("bcc", { length: 255 }),
  replyTo: varchar("reply_to", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  simulatedBy: text('simulated_by').references(() => users.id, { onDelete: 'set null' }),
  isShared: boolean("is_shared").notNull().default(false),
  
  external_id: varchar("external_id", { length: 255 }),
}, (table) => [uniqueIndex('client_external_id_unique').on(table.external_id)]);

export const clientAuthSessions = pgTable("client_auth_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" })
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: serial("string").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  metadata: jsonb("data"),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: 'cascade' }),
  agent: varchar("agent", { length: 255 }).notNull(),
});

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  versionId: uuid("version_id").references(() => versions.id), // version is nullable because when run is created, version is not yet created yet (no `run` was made)
  state: varchar("state", { length: 255 }).notNull(),
  failReason: jsonb("fail_reason"),
  responseData: jsonb("response_data"),
  metadata: jsonb("metadata")
});

export const sessionItems = pgTable("session_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: serial("string").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  content: jsonb("content"),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: 'set null' }),
  type: varchar("type", { length: 255 }).notNull(),
  role: varchar("role", { length: 255 }),
  metadata: jsonb("metadata")
})

//   channel_id: uuid("channel_id").references(() => channels.id, { onDelete: 'set null' }),
//   channel_session_item_id: varchar({ length: 255 }),
// }, (table) => [uniqueIndex('channel_session_item_unique').on(table.channel_id, table.channel_session_item_id)]);

export const versions = pgTable("versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: varchar("version", { length: 255 }).notNull(),
  env: varchar("env", { length: 255 }).notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex('version_env_unique').on(table.version, table.env)]);

// Comment messages within sessions
export const commentMessages = pgTable('comment_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionItemId: uuid('session_item_id').notNull().references(() => sessionItems.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),

  // Soft delete fields
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: "string" }),
  deletedBy: text('deleted_by').references(() => users.id, { onDelete: 'set null' }),
});

// User mentions within comment messages
export const commentMentions = pgTable('comment_mentions', {
  id: uuid('id').primaryKey().defaultRandom(),
  commentMessageId: uuid('comment_message_id').notNull().references(() => commentMessages.id, { onDelete: 'cascade' }),
  mentionedUserId: text('mentioned_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: "string" }).notNull().defaultNow()
});

// Edit history for comment messages
export const commentMessageEdits = pgTable('comment_message_edits', {
  id: uuid('id').primaryKey().defaultRandom(),
  commentMessageId: uuid('comment_message_id').notNull().references(() => commentMessages.id, { onDelete: 'cascade' }),
  previousContent: text('previous_content'),
  editedAt: timestamp('edited_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const scores = pgTable('scores', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionItemId: uuid('session_item_id').notNull().references(() => sessionItems.id, { onDelete: 'cascade' }),

  name: varchar('name', { length: 255 }).notNull(),
  value: jsonb('value').notNull(),
  commentId: uuid('comment_id').notNull().references(() => commentMessages.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  // Soft delete fields
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: "string" }),
  deletedBy: text('deleted_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => [
  unique().on(table.sessionItemId, table.name, table.createdBy)
]);



export const events = pgTable('events', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  authorId: text('author_id').references(() => users.id),
  type: varchar('type', { length: 256 }).notNull(),  // "comment_created", "comment_edited", "comment_deleted", etc...
  payload: jsonb('payload').notNull(),

  // sessionItemId: uuid('session_item_id').references(() => sessionItems.id), // this is derived and temporary!!! Allows us easily to fetch inbox_items with events.
  // commentId: uuid('comment_id').references(() => commentMessages.id),
  // sessionId: uuid('session_id').references(() => sessions.id),
});

export const inboxItems = pgTable('inbox_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),

  userId: text('user_id').notNull().references(() => users.id),
  sessionItemId: uuid('session_item_id').references(() => sessionItems.id),
  sessionId: uuid('session_id').notNull().references(() => sessions.id),
  
  lastReadEventId: bigint('last_read_event_id', { mode: 'number' }).references(() => events.id),
  lastNotifiableEventId: bigint('last_notifiable_event_id', { mode: 'number' }).references(() => events.id),

  render: jsonb('render').notNull(),
  
}, (table) => [
  unique().on(table.userId, table.sessionItemId, table.sessionId).nullsNotDistinct()
]);


export const configs = pgTable('configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  config: jsonb('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
});


export const sessionRelations = relations(sessions, ({ many, one }) => ({
  sessionItems: many(sessionItems),
  runs: many(runs),
  client: one(clients, {
    fields: [sessions.clientId],
    references: [clients.id],
  }),
  inboxItems: many(inboxItems),
}));

export const clientRelations = relations(clients, ({ many, one }) => ({
  sessions: many(sessions),
  simulatedBy: one(users, {
    fields: [clients.simulatedBy],
    references: [users.id],
  }),
}));

export const clientAuthSessionsRelations = relations(clientAuthSessions, ({ one }) => ({
  client: one(clients, {
    fields: [clientAuthSessions.clientId],
    references: [clients.id],
  }),
}));

// export const channelsRelations = relations(channels, ({ many }) => ({
//   sessionItems: many(sessionItems),
// }));

export const versionsRelations = relations(versions, ({ many }) => ({
  runs: many(runs),
}));

export const runRelations = relations(runs, ({ one, many }) => ({
  session: one(sessions, {
    fields: [runs.sessionId],
    references: [sessions.id],
  }),
  version: one(versions, {
    fields: [runs.versionId],
    references: [versions.id],
  }),
  sessionItems: many(sessionItems)
}));

export const sessionItemsRelations = relations(sessionItems, ({ one, many }) => ({
  session: one(sessions, {
    fields: [sessionItems.sessionId],
    references: [sessions.id],
  }),
  run: one(runs, {
    fields: [sessionItems.runId],
    references: [runs.id],
  }),
  // channel: one(channels, {
  //   fields: [sessionItems.channelId],
  //   references: [channels.id],
  // }),
  commentMessages: many(commentMessages),
  scores: many(scores),
}));

export const commentMessagesRelations = relations(commentMessages, ({ one, many }) => ({
  sessionItem: one(sessionItems, {
    fields: [commentMessages.sessionItemId],
    references: [sessionItems.id],
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
  sessionItem: one(sessionItems, {
    fields: [scores.sessionItemId],
    references: [sessionItems.id],
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
  sessionItem: one(sessionItems, {
    fields: [inboxItems.sessionItemId],
    references: [sessionItems.id],
  }),
  session: one(sessions, {
    fields: [inboxItems.sessionId],
    references: [sessions.id],

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


export const schema = {
  users,
  authSessions,
  accounts,
  verifications,
  invitations,

  emails,

  clients,
  clientAuthSessions,
  sessions,
  sessionItems,
  versions,
  runs,
  commentMessages,
  commentMentions,
  commentMessageEdits,
  scores,

  events,
  inboxItems,
  configs,

  clientAuthSessionsRelations,
  sessionRelations,
  clientRelations,
  versionsRelations,
  runRelations,
  sessionItemsRelations,


  commentMessagesRelations,
  commentMentionsRelations,
  commentMessageEditsRelations,

  scoresRelations,
  inboxItemsRelations,
  usersRelations,
}