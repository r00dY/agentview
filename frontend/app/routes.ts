import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
    layout("routes/sidebar_layout.tsx", [
        index("routes/home.tsx"),
        route("user", "routes/user.tsx"),
        route("members", "routes/members.tsx", [
            route("invite", "routes/membersInvite.tsx"),
            route(":userId/edit", "routes/membersEdit.tsx"),
            route(":userId/delete", "routes/membersDelete.tsx"),
        ]),
        route("emails", "routes/emails.tsx"),
        route("emails/:id", "routes/emailDetail.tsx"),
    ]),
    route("login", "routes/login.tsx"),
    route("signup", "routes/signup.tsx"),
    route("logout", "routes/logout.tsx"),
    route("change-password", "routes/change-password.tsx"),

    route("api/clients", "routes/api/clients.ts"),
    route("api/clients/:id", "routes/api/client.ts"),

] satisfies RouteConfig;
