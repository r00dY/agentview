import { createBrowserRouter } from "react-router";
import SidebarLayout, { loader as sidebarLayoutLoader } from "./routes/sidebar_layout";
import Home from "./routes/home";
import User from "./routes/user";
import Members from "./routes/members";
import MembersInvite from "./routes/membersInvite";
import MembersInviteCancel from "./routes/membersInviteCancel";
import MembersEdit from "./routes/membersEdit";
import MembersDelete from "./routes/membersDelete";
import Emails from "./routes/emails";
import EmailDetail from "./routes/emailDetail";
import ClientShare from "./routes/clientShare";
import Sessions from "./routes/sessions";
import SessionsIndex from "./routes/sessionsIndex";
import SessionNew from "./routes/sessionNew";
import Session from "./routes/session";
import SessionItem from "./routes/sessionItem";
import SessionItemComments from "./routes/sessionItemComments";
import SessionItemComment from "./routes/sessionItemComment";
import Schemas from "./routes/schemas";
import { logoutRoute } from "./routes/logout";
import ChangePassword from "./routes/change-password";
import { loginRoute} from "./routes/login";
import Signup from "./routes/signup";
import { RootComponent } from "./RootComponent";
import { ErrorBoundary } from "./ErrorBoundary";
import { HydrateFallback } from "./HydrateFallback";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootComponent,
    ErrorBoundary,
    HydrateFallback,
    children: [
      {
        path: "/",
        Component: SidebarLayout,
        loader: sidebarLayoutLoader,
        children: [
          {
            index: true,
            Component: Home,
          },
          {
            path: "user",
            Component: User,
          },
          {
            path: "members",
            Component: Members,
            children: [
              {
                path: "invitations/new",
                Component: MembersInvite,
              },
              {
                path: "invitations/:invitationId/cancel",
                Component: MembersInviteCancel,
              },
              {
                path: ":userId/edit",
                Component: MembersEdit,
              },
              {
                path: ":userId/delete",
                Component: MembersDelete,
              },
            ],
          },
          {
            path: "emails",
            Component: Emails,
          },
          {
            path: "emails/:id",
            Component: EmailDetail,
          },
          {
            path: "clients/:clientId/share",
            Component: ClientShare,
          },
          {
            path: "sessions",
            Component: Sessions,
            children: [
              {
                index: true,
                Component: SessionsIndex,
              },
              {
                path: "new",
                Component: SessionNew,
              },
              {
                path: ":id",
                Component: Session,
                children: [
                  {
                    path: "items/:itemId",
                    Component: SessionItem,
                  },
                  {
                    path: "items/:itemId/comments",
                    Component: SessionItemComments,
                  },
                  {
                    path: "items/:itemId/comments/:commentId",
                    Component: SessionItemComment,
                  },
                ],
              },
            ],
          },
          {
            path: "schemas",
            Component: Schemas,
          },
          {
            path: "change-password",
            Component: ChangePassword,
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
        Component: Signup,
      },
    ],
  },
]);
