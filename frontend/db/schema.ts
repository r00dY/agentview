import { integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { user, session, account, verification } from "./auth-schema";

// export const usersTable = pgTable("test_table", {
//   id: integer().primaryKey().generatedAlwaysAsIdentity(),
//   name: varchar({ length: 255 }).notNull(),
//   age: integer().notNull(),
//   email: varchar({ length: 255 }).notNull().unique(),
// });

export const invitations = pgTable("invitation", {
  id: text('id').primaryKey(),
  email: varchar({ length: 255 }).notNull(),
  role: varchar({ length: 255 }).notNull(),
  expires_at: timestamp().notNull(),
  created_at: timestamp().notNull(),
  status: varchar({ length: 255 }).notNull(),
  invited_by: text('invited_by').references(() => user.id, { onDelete: 'cascade' })
});

