import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
    layout("routes/sidebar_layout.tsx", [
        index("routes/home.tsx"),
        route("user", "routes/user.tsx"),
        route("members", "routes/members.tsx", [
            route("invitation-new", "routes/invitation-new.tsx"),
        ]),
    ]),
    route("login", "routes/login.tsx"),
    route("signup", "routes/signup.tsx"),
    route("logout", "routes/logout.tsx"),
    route("change-password", "routes/change-password.tsx"),

] satisfies RouteConfig;
