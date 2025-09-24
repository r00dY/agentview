import { createBrowserRouter, type IndexRouteObject, type NonIndexRouteObject } from "react-router";
import { sidebarLayoutRoute} from "./routes/sidebar_layout";
import { homeRoute } from "./routes/home";
import { userRoute } from "./routes/user";
import { membersRoute } from "./routes/members";
import { membersInviteRoute } from "./routes/membersInvite";
import { membersInviteCancelRoute } from "./routes/membersInviteCancel";
import { membersEditRoute } from "./routes/membersEdit";
import { membersDeleteRoute } from "./routes/membersDelete";
import { emailsRoute } from "./routes/emails";
import { emailDetailRoute } from "./routes/emailDetail";
import { clientShareRoute } from "./routes/clientShare";
import { sessionsRoute } from "./routes/sessions";
import { sessionsIndexRoute } from "./routes/sessionsIndex";
import { sessionNewRoute } from "./routes/sessionNew";
import { sessionRoute } from "./routes/session";
import { sessionItemRoute } from "./routes/sessionItem";
import { sessionItemCommentsRoute } from "./routes/sessionItemComments";
import { sessionItemCommentRoute } from "./routes/sessionItemComment";
import { configsRoute } from "./routes/configs";
import { logoutRoute } from "./routes/logout";
import { changePasswordRoute } from "./routes/change-password";
import { loginRoute} from "./routes/login";
import { signupRoute } from "./routes/signup";
import { rootRoute } from "./root";

export const router = createBrowserRouter([
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
            path: "user",
            ...userRoute,
          },
          {
            path: "members",
            ...membersRoute,
            children: [
              {
                path: "invitations/new",
                ...membersInviteRoute,
              },
              {
                path: "invitations/:invitationId/cancel",
                ...membersInviteCancelRoute,
              },
              {
                path: ":userId/edit",
                ...membersEditRoute,
              },
              {
                path: ":userId/delete",
                ...membersDeleteRoute,
              },
            ],
          },
          {
            path: "emails",
            ...emailsRoute,
          },
          {
            path: "emails/:id",
            ...emailDetailRoute,
          },
          {
            path: "clients/:clientId/share",
            ...clientShareRoute,
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
                    path: "items/:itemId",
                    ...sessionItemRoute,
                  },
                  {
                    path: "items/:itemId/comments",
                    ...sessionItemCommentsRoute,
                  },
                  {
                    path: "items/:itemId/comments/:commentId",
                    ...sessionItemCommentRoute,
                  },
                ],
              },
            ],
          },
          {
            path: "configs",
            ...configsRoute,
          },
          {
            path: "change-password",
            ...changePasswordRoute,
          },
        ],
      },
      {
        path: "logout",
        ...logoutRoute
      },
      {
        path: "login",
        ...loginRoute
      },
      {
        path: "signup",
        ...signupRoute
      },
    ],
  } as NonIndexRouteObject
]);
