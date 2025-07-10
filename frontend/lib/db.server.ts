// import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { user, session, account, verification } from "../db/auth-schema";
import { invitations  } from "../db/schema";

export const db = drizzle(process.env.DATABASE_URL!, {
  schema: {
    user,
    session,
    account,
    verification,
    invitations
  }
});
