import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins"
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db.server";
import { user, session, account, verification } from "../db/auth-schema";
 
export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
            user,
            session,
            account,
            verification
        }
    }),
    emailAndPassword: {    
        enabled: true
    },
    plugins: [
        admin()
    ]
})
