import { betterAuth } from "better-auth";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { admin } from "better-auth/plugins"
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { users } from "./schemas/auth-schema";
import { getValidInvitation, acceptInvitation, getInvitation } from "./invitations";
import { eq } from "drizzle-orm";
import { areThereRemainingAdmins } from "./areThereRemainingAdmins";
import { getUsersCount } from "./users";
import { getStudioURL } from "./getStudioURL";  

export const auth = betterAuth({
    trustedOrigins: [getStudioURL()],
    database: drizzleAdapter(db, {
        provider: "pg",
        usePlural: true
    }),
    session: {
        modelName: "userSession"
    },
    emailAndPassword: {
        enabled: true
    },
    plugins: [
        admin()
    ],
    hooks: {
        before: createAuthMiddleware(async (ctx) => {
            if (ctx.path === "/admin/set-role") {
                if (ctx.body?.role !== "admin") {
                    if (!await areThereRemainingAdmins(ctx.body?.userId)) {
                        throw new APIError("BAD_REQUEST", {
                            message: "Cannot downgrade the last admin user.",
                        });
                    }
                }
                return;
            }
            else if (ctx.path === "/admin/remove-user") {
                if (!await areThereRemainingAdmins(ctx.body?.userId)) {
                    throw new APIError("BAD_REQUEST", {
                        message: "Cannot remove the last admin user.",
                    });
                }
            }
            else if (ctx.path === "/sign-up/email") {

                // first admin
                if (await getUsersCount() === 0) {
                    return;
                }

                try {
                    const invitation = await getValidInvitation(ctx.body?.invitationId)
    
                    // if user doesn't have valid invitation, then do not allow to sign up
                    if (invitation.email !== ctx.body?.email) {
                        throw new APIError("BAD_REQUEST", {
                            message: "Invalid invitation.",
                        });
                    }
    
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
            }
        }),
        after: createAuthMiddleware(async (ctx) => {
            if (ctx.path === "/sign-up/email") {
                const usersCount = await getUsersCount()

                if (usersCount === 0) {
                    throw new APIError("BAD_REQUEST", {
                        message: "Unreachable.",
                    });
                }
                else if (usersCount === 1) {
                    await db.update(users).set({
                        role: "admin"
                    }).where(eq(users.email, ctx.body.email))
                }
                else {
                    // I have no idea how to use better-auth "internals" to update this role, api.admin.setRole seems to be available only when I'm logged as admin user, but here it's basically "system"
                    
                    // accept invitation and update user role to the role from invitation
                    await acceptInvitation(ctx.body?.invitationId)
                    const invitation = await getInvitation(ctx.body?.invitationId)

                    await db.update(users).set({
                        role: invitation.role
                    }).where(eq(users.email, ctx.body.email))

                }

            }
        })
    },
    telemetry: {
        enabled: false
    }
})
