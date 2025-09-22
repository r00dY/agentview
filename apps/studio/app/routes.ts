import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
    layout("routes/sidebar_layout.tsx", [
        index("routes/home.tsx"),
        route("user", "routes/user.tsx"),
        route("members", "routes/members.tsx", [
            route("invitations/new", "routes/membersInvite.tsx"),
            route("invitations/:invitationId/cancel", "routes/membersInviteCancel.tsx"),
            route(":userId/edit", "routes/membersEdit.tsx"),
            route(":userId/delete", "routes/membersDelete.tsx"),
        ]),
        route("emails", "routes/emails.tsx"),
        route("emails/:id", "routes/emailDetail.tsx"),

        route("clients/:clientId/share", "routes/clientShare.tsx"),

        route("sessions", "routes/sessions.tsx", [
            index("routes/sessionsIndex.tsx"),
            route("new", "routes/sessionNew.tsx"),
            route(":id", "routes/session.tsx", [
                route("activities/:activityId", "routes/sessionActivity.tsx"),
                route("activities/:activityId/comments", "routes/sessionActivityComments.tsx"),
                route("activities/:activityId/comments/:commentId", "routes/sessionActivityComment.tsx")
            ]),
        ]),
        route("inbox", "routes/inbox.tsx"),
        route("schemas", "routes/schemas.tsx"),

        route("logout", "routes/logout.tsx"),
        route("change-password", "routes/change-password.tsx"),
    ]),
    route("login", "routes/login.tsx"),
    route("signup", "routes/signup.tsx"),

] satisfies RouteConfig;
