import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
    layout("routes/sidebar_layout.tsx", [
        index("routes/home.tsx"),
        route("user", "routes/user.tsx"),
    ]),
    route("login", "routes/login.tsx"),
    route("logout", "routes/logout.tsx"),

] satisfies RouteConfig;
