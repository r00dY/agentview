import { betterAuth } from "better-auth";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { admin } from "better-auth/plugins"
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db.server";
import { user, session, account, verification } from "../db/auth-schema";
import { getValidInvitation, acceptInvitation } from "./invitations";
 
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
    ],

    hooks: {
        before: createAuthMiddleware(async (ctx) => {
            if (ctx.path !== "/sign-up/email") {
                return;
            }

            try {
                const invitation = await getValidInvitation(ctx.body?.invitationId)

                if (invitation.email !== ctx.body?.email) {
                    throw new APIError("BAD_REQUEST", {
                        message: "Invalid invitation.",
                    });
                }

                await acceptInvitation(ctx.body?.invitationId)

            } catch (error) {
                if (error instanceof Error) {
                    throw new APIError("BAD_REQUEST", {
                        message: error.message,
                    });
                }
                throw new APIError("BAD_REQUEST", {
                    message: "Invalid invitation.",
                });
            }

            // console.log("invitation", invitation)

            // if (!invitation) {

            // console.log(ctx)

            // console.log("ctx.body", ctx.body)

            // if (!ctx.body?.email.endsWith("@example.com")) {
            //     throw new APIError("BAD_REQUEST", {
            //         message: "Email must end with @example.com",
            //     });
            // }
        }),
    },
})
