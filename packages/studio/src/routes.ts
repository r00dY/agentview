import { type NonIndexRouteObject, type RouteObject } from "react-router";
import { sidebarLayoutRoute } from "./routes/sidebar_layout";
import { homeRoute } from "./routes/home";
import { userUpdateRoute } from "./routes/userUpdate";
import { sessionsRoute } from "./routes/sessions";
import { sessionsIndexRoute } from "./routes/sessionsIndex";
import { sessionNewRoute } from "./routes/sessionNew";
import { sessionRoute } from "./routes/session";
import { commentsRoute } from "./routes/comments";
import { commentRoute } from "./routes/comment";
import { scoresRoute } from "./routes/scores";
import { envRoute } from "./routes/env";
import { logoutRoute } from "./routes/logout";
import { loginRoute } from "./routes/login";
import { rootRoute } from "./root";
import { sessionRunRoute } from "./routes/sessionRun";
import { settingsRoute } from "./routes/settings";
import type { AgentViewConfig } from "./types";
import { uiRoute } from "./routes/ui";

export function routes(customRoutes: AgentViewConfig["customRoutes"]): RouteObject[] {
  const customRouteObjects = (customRoutes ?? []).map(route => ({
    path: route.path,
    Component: route.Component,
  }));

  return [
    {
      path: "/",
      ...rootRoute,
      children: [
        {
          path: "/",
          ...sidebarLayoutRoute,
          children: [
            {
              ...homeRoute,
              index: true,
            },
            {
              path: "env",
              ...envRoute,
            },
            {
              path: "users/:userId/update",
              ...userUpdateRoute,
            },
            {
              path: "sessions",
              ...sessionsRoute,
              children: [
                {
                  ...sessionsIndexRoute,
                  index: true,
                },
                {
                  path: "new",
                  ...sessionNewRoute,
                },
                {
                  path: ":id",
                  ...sessionRoute,
                  children: [
                    {
                      path: "runs/:runId",
                      ...sessionRunRoute,
                    },
                  ],
                },
              ],
            },
            {
              path: "comments",
              ...commentsRoute,
            },
            {
              path: "comments/:commentId",
              ...commentRoute,
            },
            {
              path: "scores",
              ...scoresRoute,
            },
            {
              path: "logout",
              ...logoutRoute
            },
            ...customRouteObjects
          ],
        },
        {
          path: "login",
          ...loginRoute
        },
        {
          path: "ui",
          ...uiRoute
        },
      ],
    } as NonIndexRouteObject
  ]
}
