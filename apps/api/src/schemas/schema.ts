import { pgTable, text, timestamp, uuid, varchar, jsonb, boolean, uniqueIndex, integer, bigserial, bigint, serial, unique, smallint, index, pgPolicy, check, type AnyPgColumn, pgEnum } from "drizzle-orm/pg-core";
import { users, accounts, verifications, authSessions, apikeys, organizations, members, invitations, invitationsRelations, organizationsRelations, membersRelations } from "./auth-schema";
import { relations, sql } from "drizzle-orm";

// RLS policy for multi-tenancy - applied to all tenant-scoped tables
// Note: Each table needs its own policy with a unique name
function createTenantPolicy(tableName: string) {
  return pgPolicy(`${tableName}_tenant_isolation`, {
    for: 'all',
    using: sql`organization_id = current_setting('app.organization_id', true)`,
    withCheck: sql`organization_id = current_setting('app.organization_id', true)`,
  });
}

export const endUsers = pgTable("end_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  externalId: varchar("external_id", { length: 255 }),

  name: text("name"),
  email: varchar("email", { length: 255 }),
  headline: text("headline"),
  details: text("details"),

  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),

  ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
  space: varchar("space", { length: 24 }).notNull().$type<'production' | 'playground'>(),
  shared: boolean("shared").notNull().default(false),

}, (table) => [
  uniqueIndex('end_user_external_id_org_unique').on(table.externalId, table.organizationId),
  uniqueIndex('end_user_email_org_unique').on(table.email, table.organizationId),
  createTenantPolicy('end_users'),
  // If space = 'production' then ownerId must be null and shared must be false; otherwise ownerId must be defined
  check('end_users_owner_id_space_check', sql`(space = 'production' AND owner_id IS NULL AND shared = false) OR (space = 'playground' AND owner_id IS NOT NULL)`),
]);

export const endUserTokens = pgTable("end_user_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid("end_user_id").notNull().references(() => endUsers.id, { onDelete: 'cascade' }),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  index('end_user_tokens_user_id_idx').on(table.userId),
  createTenantPolicy('end_user_tokens'),
]);


export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  metadata: jsonb("metadata"),
  userId: uuid("end_user_id").notNull().references(() => endUsers.id, { onDelete: 'cascade' }),
  title: text("title"),
  agentRefId: uuid("agent_ref_id").references(() => agentRefs.id),
  initialState: jsonb("initial_state"),
  channelThreadId: uuid("channel_thread_id").references(() => channelThreads.id, { onDelete: 'set null' }),
  active: boolean("active").notNull().default(true),
}, (table) => [
  index('sessions_channel_thread_idx').on(table.channelThreadId),
  createTenantPolicy('sessions'),
]);


export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  agentRefId: uuid("agent_ref_id").references(() => agentRefs.id), // nullable because when run is created, agent ref is not yet known (auto-fetch provides it) -> NOW COULD BE NOT NULL!!!
  status: varchar("status", { length: 255 }).notNull(),//.$type<'in_progress' | 'completed' | 'cancelled' | 'failed'>(),
  reason: jsonb("reason"),
  responseData: jsonb("response_data"),
  metadata: jsonb("metadata"),
  manual: boolean("manual").notNull().default(false),
  environmentId: uuid("environment_id").references(() => environments.id), // required for auto-fetch

  previousRunId: uuid("previous_run_id").references((): AnyPgColumn => runs.id, { onDelete: 'set null' }),
  active: boolean("active").notNull(), // active runs are 'the main branch'

}, (table) => [
  index('runs_expires_at_status_idx').on(table.expiresAt, table.status),
  index('runs_session_id_created_at_idx').on(table.sessionId, table.createdAt),
  index('runs_status_idx').on(table.status),
  createTenantPolicy('runs'),
]);

export const sessionItems = pgTable("session_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  sortOrder: serial("sort_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  content: jsonb("content"),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: 'cascade' }),
  isState: boolean("is_state").notNull().default(false),
  type: varchar("type", { length: 24 }).$type<'input' | 'output' | 'step'>(),
  metadata: jsonb("metadata")
}, () => [createTenantPolicy('session_items')]);

//   channel_id: uuid("channel_id").references(() => channels.id, { onDelete: 'set null' }),
//   channel_session_item_id: varchar({ length: 255 }),
// }, (table) => [uniqueIndex('channel_session_item_unique').on(table.channel_id, table.channel_session_item_id)]);

export const agentRefs = pgTable("agent_refs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  version: varchar("version", { length: 255 }).notNull(),
  agent: varchar("agent", { length: 255 }).notNull(),
  adapter: varchar("adapter", { length: 24 }).notNull().$type<'agentview' | 'ai-sdk'>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('agent_ref_version_agent_adapter_org_unique').on(table.version, table.agent, table.adapter, table.organizationId),
  createTenantPolicy('agent_refs'),
]);

// Comment messages within sessions
export const commentMessages = pgTable('comment_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // target fields
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  sessionItemId: uuid('session_item_id').references(() => sessionItems.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
  channelMessageId: uuid('channel_message_id').references(() => channelMessages.id, { onDelete: 'cascade' }),

  content: text('content'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),

  // Soft delete fields
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: "string" }),
  deletedBy: text('deleted_by').references(() => users.id, { onDelete: 'set null' }),
}, () => [
  check('comment_messages_target_check', sql`(
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NOT NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NOT NULL)
  )`),
  createTenantPolicy('comment_messages'),
]);

// User mentions within comment messages
export const commentMentions = pgTable('comment_mentions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  commentMessageId: uuid('comment_message_id').notNull().references(() => commentMessages.id, { onDelete: 'cascade' }),
  mentionedUserId: text('mentioned_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: "string" }).notNull().defaultNow()
}, () => [createTenantPolicy('comment_mentions')]);

// Edit history for comment messages
export const commentMessageEdits = pgTable('comment_message_edits', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  commentMessageId: uuid('comment_message_id').notNull().references(() => commentMessages.id, { onDelete: 'cascade' }),
  previousContent: text('previous_content'),
  editedAt: timestamp('edited_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, () => [createTenantPolicy('comment_message_edits')]);

export const scores = pgTable('scores', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),

  // target fields
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
  sessionItemId: uuid('session_item_id').references(() => sessionItems.id, { onDelete: 'cascade' }),
  channelMessageId: uuid('channel_message_id').references(() => channelMessages.id, { onDelete: 'cascade' }),

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
  check('scores_target_check', sql`(
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NOT NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NOT NULL)
  )`),

  unique().on(table.createdBy, table.sessionId, table.runId, table.sessionItemId, table.channelMessageId, table.name).nullsNotDistinct(),

  // uniqueIndex('scores_session_item_unique').on(table.sessionItemId, table.name, table.createdBy).where(sql`session_item_id IS NOT NULL`),
  // uniqueIndex('scores_run_unique').on(table.runId, table.name, table.createdBy).where(sql`run_id IS NOT NULL`),
  createTenantPolicy('scores'),
]);



export const events = pgTable('events', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  authorId: text('author_id').references(() => users.id),
  type: varchar('type', { length: 256 }).notNull(),  // "comment_created", "comment_edited", "comment_deleted", etc...
  payload: jsonb('payload').notNull(),

  // sessionItemId: uuid('session_item_id').references(() => sessionItems.id), // this is derived and temporary!!! Allows us easily to fetch inbox_items with events.
  // commentId: uuid('comment_id').references(() => commentMessages.id),
  // sessionId: uuid('session_id').references(() => sessions.id),
}, () => [createTenantPolicy('events')]);

export const inboxItems = pgTable('inbox_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),

  userId: text('user_id').notNull().references(() => users.id),

  // target fields
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
  sessionItemId: uuid('session_item_id').references(() => sessionItems.id, { onDelete: 'cascade' }),
  channelMessageId: uuid('channel_message_id').references(() => channelMessages.id, { onDelete: 'cascade' }),

  lastReadEventId: bigint('last_read_event_id', { mode: 'number' }).references(() => events.id),
  lastNotifiableEventId: bigint('last_notifiable_event_id', { mode: 'number' }).references(() => events.id),

  hasImportant: boolean('has_important').notNull().default(false),

  render: jsonb('render').notNull(),

}, (table) => [
  unique().on(table.userId, table.sessionId, table.runId, table.sessionItemId, table.channelMessageId).nullsNotDistinct(),
  check('inbox_items_target_check', sql`(
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NOT NULL AND session_item_id IS NOT NULL AND channel_message_id IS NULL) OR
    (session_id IS NOT NULL AND run_id IS NULL AND session_item_id IS NULL AND channel_message_id IS NOT NULL)
  )`),
  createTenantPolicy('inbox_items'),
]);


export const environments = pgTable('environments', {
  id: uuid('id').primaryKey().defaultRandom(),
  handle: varchar('handle', { length: 255 }).notNull(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text("user_id").references(() => users.id, { onDelete: 'cascade' }), // NULL = production, non-NULL = user's dev environment
  config: jsonb('value'),
  tunnelUrl: text('tunnel_url'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  unique('environments_org_handle_unique').on(table.organizationId, table.handle),
  unique('environments_org_user_unique').on(table.organizationId, table.userId).nullsNotDistinct(),
  check('environments_tunnel_url_user_check', sql`tunnel_url IS NULL OR user_id IS NOT NULL`),
  createTenantPolicy('environments')
]);

export const starredSessions = pgTable('starred_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  unique().on(table.userId, table.sessionId),
  createTenantPolicy('starred_sessions'),
]);

export const webhookJobs = pgTable('webhook_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  environmentId: uuid('environment_id').notNull().references(() => environments.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: "string" }).notNull().defaultNow(),

  eventType: varchar('event_type', { length: 255 }).notNull(),
  payload: jsonb('payload').notNull(),

  // Denormalized for efficient querying (nullable for non-session events in future)
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }),

  status: varchar('status', { length: 64 }).notNull().$type<'pending' | 'processing' | 'completed' | 'failed'>(),
  attempts: smallint('attempts').notNull().default(0),
  maxAttempts: smallint('max_attempts').notNull().default(3),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: "string" }),
  lastError: text('last_error'),
}, (table) => [
  index('webhook_jobs_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
  index('webhook_jobs_session_id_idx').on(table.sessionId),
  createTenantPolicy('webhook_jobs'),
]);

export const workerHeartbeats = pgTable('worker_heartbeats', {
  workerId: text('worker_id').primaryKey(),
  lastBeatAt: timestamp('last_beat_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const sessionRelations = relations(sessions, ({ many, one }) => ({
  sessionItems: many(sessionItems),
  runs: many(runs),
  user: one(endUsers, {
    fields: [sessions.userId],
    references: [endUsers.id],
  }),
  agentRef: one(agentRefs, {
    fields: [sessions.agentRefId],
    references: [agentRefs.id],
  }),
  inboxItems: many(inboxItems),
  starredSessions: many(starredSessions),
  channelThread: one(channelThreads, {
    fields: [sessions.channelThreadId],
    references: [channelThreads.id],
  }),
}));

export const endUserRelations = relations(endUsers, ({ many, one }) => ({
  sessions: many(sessions),
  owner: one(users, {
    fields: [endUsers.ownerId],
    references: [users.id],
  }),
  tokens: many(endUserTokens),
}));

export const endUserTokensRelations = relations(endUserTokens, ({ one }) => ({
  user: one(endUsers, {
    fields: [endUserTokens.userId],
    references: [endUsers.id],
  }),
}));

// export const endUserAuthSessionsRelations = relations(endUserAuthSessions, ({ one }) => ({
//   endUser: one(endUsers, {
//     fields: [endUserAuthSessions.endUserId],
//     references: [endUsers.id],
//   }),
// }));

// export const channelsRelations = relations(channels, ({ many }) => ({
//   sessionItems: many(sessionItems),
// }));

export const agentRefsRelations = relations(agentRefs, ({ many }) => ({
  runs: many(runs),
  sessions: many(sessions),
}));

export const runRelations = relations(runs, ({ one, many }) => ({
  session: one(sessions, {
    fields: [runs.sessionId],
    references: [sessions.id],
  }),
  agentRef: one(agentRefs, {
    fields: [runs.agentRefId],
    references: [agentRefs.id],
  }),
  sessionItems: many(sessionItems),
  commentMessages: many(commentMessages),
  scores: many(scores),
  channelMessages: many(channelMessages),
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
  run: one(runs, {
    fields: [commentMessages.runId],
    references: [runs.id],
  }),
  channelMessage: one(channelMessages, {
    fields: [commentMessages.channelMessageId],
    references: [channelMessages.id],
  }),
  user: one(users, {
    fields: [commentMessages.userId],
    references: [users.id],
  }),
  mentions: many(commentMentions),
  edits: many(commentMessageEdits),

  score: one(scores, {
    fields: [commentMessages.id],
    references: [scores.commentId],
  }),
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
  run: one(runs, {
    fields: [scores.runId],
    references: [runs.id],
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
  run: one(runs, {
    fields: [inboxItems.runId],
    references: [runs.id],
  }),
  channelMessage: one(channelMessages, {
    fields: [inboxItems.channelMessageId],
    references: [channelMessages.id],
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
  starredSessions: many(starredSessions),
}));

export const starredSessionsRelations = relations(starredSessions, ({ one }) => ({
  user: one(users, {
    fields: [starredSessions.userId],
    references: [users.id],
  }),
  session: one(sessions, {
    fields: [starredSessions.sessionId],
    references: [sessions.id],
  }),
}));


export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 64 }).notNull(), // 'gmail', 'mock-email', etc.
  address: varchar('address', { length: 255 }).notNull(),
  config: jsonb('config').notNull(),
  environmentId: uuid('environment_id').references(() => environments.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => [
  unique('channels_type_address_org_unique').on(table.type, table.address, table.organizationId),
  index('channels_address_idx').on(table.address),
  createTenantPolicy('channels'),
]);



export const channelThreads = pgTable('channel_threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  sourceThreadId: varchar('source_thread_id', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),

  // activeRunStatus: varchar('active_run_status', { length: 32 }).$type<'idle' | 'connecting' | 'failed_to_connect'???? | 'streaming' | 'finished'>(),
  // activeRunId: uuid('active_run_id'),
  // activeRunResult: jsonb('active_run_result'),

  // INCOMING: pending, processing, done, error?
  // OUTGOING: pending, processing, done, error?

  // THERE IS ALWAYS OUTGOING. incoming, incoming, incoming... OUTGOING. Always!!! FOR NOW.
  // Channel run is *everything* from 'STARTING RUN' (intent) to 'SYNCING OUTGOING' (done).
  // ACTIVE_RUN LASTS THIS ENTIRE TIME. So when we didn't manage to create RUN, and waiting for error with run_id === null -> active run still exists. 




}, (table) => [
  unique('channel_threads_channel_source_unique').on(table.channelId, table.sourceThreadId),
  index('channel_threads_channel_id_idx').on(table.channelId),
  createTenantPolicy('channel_threads'),
  // check('active_run_check', sql`(
  //   (${table.activeRunStatus} IS NULL OR ${table.activeRunStatus} IN ('idle', 'connecting', 'streaming', 'finished'))
  //   AND
  //   (${table.activeRunId} IS NULL OR ${table.activeRunStatus} IN ('streaming', 'finished'))
  //   AND
  //   (${table.activeRunResult} IS NULL OR ${table.activeRunStatus} = 'finished')
  // )`),
]);

export const channelMessages = pgTable('channel_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  channelThreadId: uuid('channel_thread_id').notNull().references(() => channelThreads.id, { onDelete: 'cascade' }),

  direction: varchar('direction', { length: 16 }).notNull().$type<'incoming' | 'outgoing'>(), // 'incoming' | 'outgoing'
  status: varchar('status', { length: 32 }).notNull().$type<'pending' | 'done' | 'error' | /* in progress incoming */ 'run_connecting' | 'run_streaming' | /* in progress outgoing */ 'sending'>(),
  reason: jsonb('reason'),

  sourceId: varchar('source_id', { length: 255 }),
  text: text('text'),
  authorEmail: varchar('author_email', { length: 255 }),
  authorName: varchar('author_name', { length: 255 }),
  authorHeadline: varchar('author_headline', { length: 255 }),
  authorDetails: text('author_details'),

  attachments: jsonb('attachments'),
  providerData: jsonb('provider_data'),
  date: timestamp('date', { withTimezone: true, mode: 'string' }).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
  
  internal: boolean('internal').notNull().default(false),

}, (table) => [
  uniqueIndex('channel_messages_thread_source_unique').on(table.channelThreadId, table.sourceId),
  index('channel_messages_thread_id_idx').on(table.channelThreadId),
  index('channel_messages_status_direction_idx').on(table.status, table.direction),
  index('channel_messages_date_idx').on(table.date),
  index('channel_messages_run_id_idx').on(table.runId),
  createTenantPolicy('channel_messages'),
]);

export const channelsRelations = relations(channels, ({ many, one }) => ({
  channelThreads: many(channelThreads),
  environment: one(environments, {
    fields: [channels.environmentId],
    references: [environments.id],
  }),
}));

export const channelThreadsRelations = relations(channelThreads, ({ one, many }) => ({
  channel: one(channels, {
    fields: [channelThreads.channelId],
    references: [channels.id],
  }),
  messages: many(channelMessages),
  sessions: many(sessions),
}));

export const channelMessagesRelations = relations(channelMessages, ({ one, many }) => ({
  channelThread: one(channelThreads, {
    fields: [channelMessages.channelThreadId],
    references: [channelThreads.id],
  }),
  run: one(runs, {
    fields: [channelMessages.runId],
    references: [runs.id],
  }),
  commentMessages: many(commentMessages),
}));

export const environmentsRelations = relations(environments, ({ one }) => ({
  user: one(users, {
    fields: [environments.userId],
    references: [users.id],
  }),
}));

export const schema = {
  users,
  authSessions,
  accounts,
  verifications,
  organizations, members, invitations, invitationsRelations, organizationsRelations, membersRelations,

  // invitations,
  apikeys,

  endUsers,
  endUserTokens,
  // endUserAuthSessions,
  sessions,
  sessionItems,
  agentRefs,
  runs,
  commentMessages,
  commentMentions,
  commentMessageEdits,
  scores,

  events,
  inboxItems,
  environments,
  starredSessions,
  webhookJobs,
  workerHeartbeats,
  channels,
  channelThreads,
  channelMessages,

  // endUserAuthSessionsRelations,
  sessionRelations,
  endUserRelations,
  endUserTokensRelations,
  agentRefsRelations,
  runRelations,
  sessionItemsRelations,


  commentMessagesRelations,
  commentMentionsRelations,
  commentMessageEditsRelations,

  scoresRelations,
  inboxItemsRelations,
  usersRelations,
  starredSessionsRelations,
  channelsRelations,
  channelThreadsRelations,
  channelMessagesRelations,
  environmentsRelations
}