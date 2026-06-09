import { colorValues } from "agentview/colors";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { apiKey, bearer, organization } from "better-auth/plugins";
import { and, eq, sql } from "drizzle-orm";
import { Resend } from 'resend';
import { db__dangerous } from "./db";
import { createEnvironment } from "./environments";
import { emailToEnvSlug } from "agentview/slugs";
import { getAllowedOrigin } from "./getAllowedOrigin";
import { getWebAppUrl } from "./getWebAppUrl";
import { log } from "./logger";
import { requireValidInvitation } from "./invitations";
import { invitations, members } from "./schemas/auth-schema";

if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not set');
}

if (!process.env.AGENTVIEW_EMAIL_ROOT_DOMAIN) {
    throw new Error('AGENTVIEW_EMAIL_ROOT_DOMAIN is not set');
}

const resend = new Resend(process.env.RESEND_API_KEY);

export const auth = betterAuth({
    // trustedOrigins: [getStudioURL()],
    trustedOrigins: async (request) => {
        const allowedOrigin = getAllowedOrigin(request.headers);
        if (allowedOrigin) {
            return [allowedOrigin];
        }

        return [];
    },

    database: drizzleAdapter(db__dangerous, {
        provider: "pg",
        usePlural: true
    }),
    session: {
        modelName: "authSession"
    },
    emailAndPassword: {
        enabled: true
    },
    plugins: [
        bearer(),
        // admin(),
        apiKey({
            keyExpiration: {
                defaultExpiresIn: 60 * 60 * 24 * 365
            },
            rateLimit: {
                enabled: false // for now
            },
            enableMetadata: true
        }),
        organization({
            async sendInvitationEmail(invitation) {
                const signupUrl = `${getWebAppUrl()}/accept-invitation?invitationId=${encodeURIComponent(invitation.id)}`;
                const organization = invitation.organization;

                const subject = `You're invited to join ${organization.name}`;

                if (process.env.RESEND_DISABLED === 'true') {
                    log.info({ email: invitation.email, subject }, 'resend mock mail');
                    return;
                }

                const { error } = await resend.emails.send({
                    from: `AgentView <noreply@${process.env.AGENTVIEW_EMAIL_ROOT_DOMAIN}>`,
                    to: [invitation.email],
                    subject,
                    html: `<p>Hello,</p>
<p>You've been invited to join <strong>${organization.name}</strong> as a <strong>${invitation.role}</strong>.</p>
<p>To accept your invitation and create your account, please click the link below:</p>
<p><a href="${signupUrl}">Accept Invitation</a></p>
<p>If you did not expect this invitation, you can safely ignore this email.</p>
<p>Best regards,<br/>The AgentView Team</p>`,
                    text: `Hello,

You've been invited to join ${organization.name} as ${invitation.role}.

To accept your invitation and create your account, please visit:
${signupUrl}

If you did not expect this invitation, you can safely ignore this email.

Best regards,
The AgentView Team`,
                });

                if (error) {
                    log.error({ err: error }, 'error sending invitation email');
                }

            },
            organizationHooks: {

                afterCreateOrganization: async ({ organization }) => {
                    await createEnvironment(organization.id, `production`, null);
                },

                afterAddMember: async ({
                    user,
                    organization,
                }) => {
                    await createEnvironment(organization.id, emailToEnvSlug(user.email), user.id);
                },

                afterAcceptInvitation: async ({
                    user,
                    organization,
                }) => {
                    await createEnvironment(organization.id, emailToEnvSlug(user.email), user.id);
                },
            }
        })
    ],
    hooks: {
        before: createAuthMiddleware(async (ctx) => {

            // When invitation is provided, validate it
            if (ctx.path === "/sign-up/email") {
                if (ctx.body.invitationId) {
                    await requireValidInvitation(ctx.body.invitationId, undefined, ctx.body.email)
                }
            }

            // Enforce max 3 members per org on the free plan
            if (ctx.path === "/organization/invite-member") {
                const organizationId = ctx.body.organizationId;
                if (organizationId) {
                    const [memberCount] = await db__dangerous
                        .select({ count: sql<number>`count(*)::int` })
                        .from(members)
                        .where(eq(members.organizationId, organizationId));

                    const [pendingCount] = await db__dangerous
                        .select({ count: sql<number>`count(*)::int` })
                        .from(invitations)
                        .where(and(
                            eq(invitations.organizationId, organizationId),
                            eq(invitations.status, "pending")
                        ));

                    const total = memberCount.count + pendingCount.count;
                    if (total >= 3) {
                        throw new APIError("FORBIDDEN", {
                            message: "You've reached the maximum of 3 members on the free plan. Reach out to the founder if you need more."
                        });
                    }
                }
            }
        }),
        after: createAuthMiddleware(async (ctx) => {

            if (ctx.path === "/sign-up/email") {

                // extract headers
                const headers = new Headers();
                const setCookie = ctx.context.responseHeaders?.get("set-cookie");
                headers.set("cookie", setCookie?.split(";")[0] || ""); // Extract just the cookie value

                // Generate image property: ${color}:${firstLetterFromName}
                const randomColor = colorValues[Math.floor(Math.random() * colorValues.length)];
                const firstLetter = ctx.body.name ? ctx.body.name.charAt(0).toUpperCase() : "A";
                const image = `color:${randomColor}:${firstLetter}`;

                // TODO: does it work?

                await auth.api.updateUser({
                    body: {
                        image
                    },
                    headers
                })

                // Send welcome email
                const welcomeSubject = `Welcome to AgentView`;
                const appUrl = getWebAppUrl();
                const greetingName = ctx.body.name || 'there';

                if (process.env.RESEND_DISABLED === 'true') {
                    log.info({ email: ctx.body.email, subject: welcomeSubject }, 'resend mock mail');
                } else {
                    const { error: welcomeError } = await resend.emails.send({
                        from: `AgentView <noreply@${process.env.AGENTVIEW_EMAIL_ROOT_DOMAIN}>`,
                        to: [ctx.body.email],
                        subject: welcomeSubject,
                        html: `<p>Hi ${greetingName},</p>
<p>Welcome to <strong>AgentView</strong>! We're excited to have you on board.</p>
<p>You can get started by visiting your dashboard:</p>
<p><a href="${appUrl}">Open AgentView</a></p>
<p>If you have any questions or feedback, just reply to this email — we'd love to hear from you.</p>
<p>Best regards,<br/>The AgentView Team</p>`,
                        text: `Hi ${greetingName},

Welcome to AgentView! We're excited to have you on board.

You can get started by visiting your dashboard:
${appUrl}

If you have any questions or feedback, just reply to this email — we'd love to hear from you.

Best regards,
The AgentView Team`,
                    });

                    if (welcomeError) {
                        log.error({ err: welcomeError }, 'error sending welcome email');
                    }
                }


                // await db__dangerous.update(users).set({
                //     image: image
                // }).where(eq(users.email, ctx.body.email))

                /**
                 * This is commented for now. We rely on manual accept in UI or auto-accept on the front-end side.
                 */
                // // If sign-up was done via invitation to org, auto-accept it.
                // if (ctx.body.invitationId) {
                //     await auth.api.acceptInvitation({
                //         body: {
                //             invitationId: ctx.body.invitationId
                //         },
                //         headers
                //     })
                // }
            }
        })
    },
    telemetry: {
        enabled: false
    }
})