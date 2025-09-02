import { drizzle } from 'drizzle-orm/node-postgres';
import { users, sessions, accounts, verifications } from "./db/auth-schema";
import {
  invitations,
  email,
  client,
  thread,
  activity,
  threadRelations,
  activityRelations,
  run,
  runRelations,
  commentMessages,
  commentMentions,
  commentMessagesRelations,
  channels,
  channelsRelations,
  clientRelations,
  versions,
  versionsRelations,
  scores,
  scoresRelations,
  schemas,
  events,
  inboxItems,
  inboxItemsRelations,
  usersRelations
} from "./db/schema";

export const schema = {
  users,
  sessions,
  accounts,
  verifications,
  invitations,
  email,
  client,
  thread,
  activity,
  run,
  threadRelations,
  activityRelations,
  runRelations,
  commentMessages,
  commentMentions,
  commentMessagesRelations,
  channels,
  channelsRelations,
  clientRelations,
  versions,
  versionsRelations,
  scores,
  scoresRelations,
  schemas,
  events,
  inboxItems,
  inboxItemsRelations,
  usersRelations
}

export const db = drizzle(process.env.DATABASE_URL!, {
  schema
});
