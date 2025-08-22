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

        route("threads", "routes/threads.tsx", [
            index("routes/threadsIndex.tsx"),
            route("new", "routes/threadNew.tsx"),
            route(":id", "routes/thread.tsx", [
                // route("comments", "routes/threadComments.tsx"),
                // route("comment-edit", "routes/threadCommentEdit.tsx"),
                route("activities/:activityId", "routes/threadActivity.tsx"),
                route("activities/:activityId/comments", "routes/threadComments.tsx"),
                // route("activities/:activityId/scores", "routes/threadScores.tsx"),
                // route("activities/:activityId/scores_and_comments", "routes/threadScoresAndComments.tsx"),
            ]),
        ]),

        route("logout", "routes/logout.tsx"),
        route("change-password", "routes/change-password.tsx"),
    ]),
    route("login", "routes/login.tsx"),
    route("signup", "routes/signup.tsx"),

] satisfies RouteConfig;
