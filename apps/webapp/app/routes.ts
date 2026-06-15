import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
    // General routes
    index("routes/landing.tsx"),

    route("accept-invitation", "routes/accept-invitation.tsx"),
    route("auth", "routes/auth.tsx"),
    route("cli", "routes/cli.tsx"),

    // Authenticated routes
    layout("routes/app/layout.tsx", [
        route("dashboard", "routes/app/dashboard.tsx"),
        route("logout", "routes/logout.tsx"),

        route("orgs/:orgId", "routes/app/org/layout.tsx", [
            index("routes/app/org/home.tsx"),
            route("cli", "routes/app/org/cli.tsx"),
            route("profile", "routes/app/org/profile.tsx"),
            route("password", "routes/app/org/password.tsx"),
            route("details", "routes/app/org/details.tsx"),
            route("api-keys", "routes/app/org/api-keys.tsx", [
                route("new", "routes/app/org/api-keys-new.tsx"),
                route(":pairId/delete", "routes/app/org/api-keys-delete.tsx"),
            ]),
            route("members", "routes/app/org/members.tsx", [
                route("invitations/new", "routes/app/org/members-invite.tsx"),
                route(":memberId/edit", "routes/app/org/members-edit.tsx"),
                route(":memberId/delete", "routes/app/org/members-delete.tsx"),
                route("invitations/:invitationId/cancel", "routes/app/org/members-invite-cancel.tsx"),
            ]),
            route("channels", "routes/app/org/channels.tsx", [
                route("gmail/new", "routes/app/org/channels-gmail-new.tsx"),
                route(":channelId/edit", "routes/app/org/channels-edit.tsx"),
            ]),
        ]),
    ]),

    // Unauthenticated routes
    layout("routes/public/layout.tsx", [
        route("login", "routes/public/login.tsx"),
        route("signup", "routes/public/signup.tsx"),
    ]),

] satisfies RouteConfig;
