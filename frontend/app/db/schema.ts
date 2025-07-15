import { integer, pgTable, text, timestamp, uuid, varchar, jsonb } from "drizzle-orm/pg-core";
import { user, session, account, verification } from "./auth-schema";
import type { Database } from "lucide-react";

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
  data: jsonb("data"),
  client_id: uuid("client_id").notNull().references(() => client.id, { onDelete: 'cascade' }),
  type: varchar({ length: 255 }).notNull(),
});

export const activity = pgTable("activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  created_at: timestamp().notNull().defaultNow(),
  updated_at: timestamp().notNull().defaultNow(),
  data: jsonb("data"),
  thread_id: uuid("thread_id").notNull().references(() => thread.id, { onDelete: 'cascade' }),
  type: varchar({ length: 255 }).notNull(),
  role: varchar({ length: 255 }).notNull(),
});

