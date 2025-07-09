import { betterAuth } from "better-auth";
import { organization as organizationPlugin } from "better-auth/plugins"
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db.server";
import { user, session, account, verification, organization, member, invitation } from "../db/auth-schema";
 
export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
            user,
            session,
            account,
            verification,
            organization,
            member,
            invitation
        }
    }),
    emailAndPassword: {    
        enabled: true
    },
    plugins: [
        organizationPlugin() 
    ]
})
