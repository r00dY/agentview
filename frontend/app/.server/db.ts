import { drizzle } from 'drizzle-orm/node-postgres';
import { users, sessions, accounts, verifications } from "~/.server/db/auth-schema";
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
  commentThreads,
  commentMessages,
  commentMentions,
  commentThreadsRelations,
  commentMessagesRelations,
  channels,
  channelsRelations,
  clientRelations,
  versions,
  versionsRelations
} from "~/.server/db/schema";

export const db = drizzle(process.env.DATABASE_URL!, {
  schema: {
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
    commentThreads,
    commentMessages,
    commentMentions,
    commentThreadsRelations,
    commentMessagesRelations,
    channels,
    channelsRelations,
    clientRelations,
    versions,
    versionsRelations,
  }
});
