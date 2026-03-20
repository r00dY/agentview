import {
  data,
  Form,
  Link,
  Outlet,
  redirect,
  useLoaderData,
  useLocation,
  useRevalidator,
  useSubmit,
  type LoaderFunctionArgs,
  type RouteObject
} from "react-router";
import { use, Suspense } from "react";

import { ArrowLeft, Building2Icon, ChevronDown, ChevronUp, Database, LogOut, MessageCircle, PlusIcon, UserIcon, WrenchIcon } from "lucide-react";
import { NotificationBadge } from "../components/internal/NotificationBadge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
} from "../components/ui/sidebar";

// Removed Framework Mode type import
import { spaceAllowedValues, type Space } from "agentview/apiTypes";
import type { ApiChannelConfig } from "agentview/baseConfigTypes";
import type { AgentCustomRoute } from "agentview/types";
import { getWebAppUrl } from "agentview/urls";
import { matchPath } from "react-router";
import { UserAvatar } from "../components/internal/UserAvatar";
import { Button } from "../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { config } from "../config";
import { agentview } from "../lib/agentview";
import { getSessionCached, getOrganizationCached, type User, type Member, type Organization } from "../lib/auth-client";
import { getCurrentAgent } from "../lib/currentAgent";
import { SessionContext } from "../lib/SessionContext";


export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSessionCached();

  const url = new URL(request.url);
  const relativeUrl = url.pathname + url.search + url.hash;

  if (!session) {
    if (relativeUrl !== '/') {
      return redirect('/login?redirect=' + encodeURIComponent(relativeUrl));
    }
    else {
      return redirect('/login');
    }
  }

  const agent = getCurrentAgent(request);
  const envUpdate = agentview.updateEnvironment({ config });

  const organization = await getOrganizationCached();
  const member = organization.members.find(m => m.userId === session.user.id);

  if (!member) {
    throw new Error("Member not found");
  }


  // Fetch session stats for each session type and list combination (in parallel)
  const listStats: { [list: string]: { unseenCount: number } } = {};

  if (config.agents) {
    const statsPromises = config.agents.flatMap(agentConfig =>
      spaceAllowedValues.map(space =>
        agentview.getSessionsStats({ space })
          .then(stats => ({ space, data: stats }))
      )
    );

    const statsResults = await Promise.all(statsPromises);

    for (const result of statsResults) {
      listStats[result.space] = result.data;
      // if (!listStats[result.agent]) {
      //   listStats[result.agent] = {};
      // }
      // listStats[result.agent][result.space] = result.data;
    }
  }

  const locale = request.headers.get('accept-language')?.split(',')[0] || 'en-US';

  return {
    me: {
      ...session.user,
      role: member.role
    },
    locale,
    listStats,
    agent,
    organization,
    envUpdate
  };
}

function EnvUpdateWatcher({ promise }: { promise: Promise<unknown> }) {
  use(promise);
  return null;
}

function Component() {
  const { me, organization, locale, listStats, agent, envUpdate } = useLoaderData<typeof loader>()
  const location = useLocation();
  const submitForm = useSubmit();

  const apiChannels = (config.channels ?? []).filter(
    (c): c is ApiChannelConfig => c.type === 'api'
  );

  // Helper function to get unseen count for a specific session type and list name
  const getUnseenCount = (space: Space) => {
    return listStats[space]?.unseenCount ?? 0
  }

  const isMenuLinkActive = (linkPath: string) => {
    const linkUrl = new URL(linkPath, window.location.origin)
    const pathMatches = matchPath({ path: linkUrl.pathname, end: false }, location.pathname)

    if (!pathMatches) return false

    if (linkPath.startsWith("/sessions")) {
      const pathParams = new URLSearchParams(linkUrl.search)
      const currentParams = new URLSearchParams(location.search)
      const spaceMatch = pathParams.get('space') === currentParams.get('space')
      const agentMatch = pathParams.get('agent') === currentParams.get('agent')
      return spaceMatch && agentMatch
    }

    return true
  }

  const isSettings = isMenuLinkActive("/settings")

  // Get unseen counts for badges
  const prodUnseenCount = getUnseenCount("production")
  const playgroundUnseenCount = getUnseenCount("playground")
  const sharedPlaygroundUnseenCount = getUnseenCount("shared-playground")

  const agentCustomRoutes: AgentCustomRoute[] = [];
  for (const route of config.customRoutes ?? []) {
    if (route.type === "agent" && route.agent === agent) {
      agentCustomRoutes.push(route);
    }
  }

  return (<SessionContext.Provider value={{ me, organization, locale }}>
    <Suspense fallback={null}>
      <EnvUpdateWatcher promise={envUpdate} />
    </Suspense>

    <SidebarProvider>
      <div className="flex h-screen bg-background w-full">
        <Sidebar className="border-r">

          {!isSettings && <><SidebarHeader >
            <SidebarMenu>
              {/* <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton className="font-medium">
                      <img src="/symbol_light.svg" className="size-4" alt="AgentView Logo" />
                      {agent}
                      <ChevronDown className="ml-auto" />
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[--radix-popper-anchor-width]">

                    {config.agents?.map((agent) => {
                      return <DropdownMenuItem asChild key={agent.name}>
                        <Link to={`/sessions?agent=${agent.name}`}>
                          <span>{agent.name}</span>
                        </Link>
                      </DropdownMenuItem>
                    })}

                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem> */}

              <SidebarMenuItem>
                {apiChannels.length === 1 ? (
                  <Form action={`/sessions/new?agent=${apiChannels[0].name}&space=playground`} method="post" className="flex flex-col items-stretch relative mt-1 px-1">
                    <Button variant="outline" size="sm" type="submit">
                      <PlusIcon className="h-4 w-4" />
                      New Session
                    </Button>
                  </Form>
                ) : apiChannels.length > 1 ? (
                  <div className="flex flex-col items-stretch relative mt-1 px-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm">
                          <PlusIcon className="h-4 w-4" />
                          New Session
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-[--radix-popper-anchor-width]">
                        {apiChannels.map(channel => (
                          <DropdownMenuItem key={channel.name} onClick={() => {
                            submitForm(null, { method: 'post', action: `/sessions/new?agent=${channel.name}&space=playground` });
                          }}>
                            {channel.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : null}
              </SidebarMenuItem>
            </SidebarMenu>

          </SidebarHeader>

            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>Sessions</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={isMenuLinkActive(`/sessions?agent=${agent}&space=production`)} className={"justify-between"}>
                        <Link to={`/sessions?agent=${agent}&space=production`}>
                          <div className="flex flex-row items-center gap-2"><MessageCircle className="h-4 w-4" /> Production</div>
                          {prodUnseenCount > 0 && <NotificationBadge>{prodUnseenCount}</NotificationBadge>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton><WrenchIcon className="h-4 w-4" />Playground</SidebarMenuButton>
                      <SidebarMenuSub className="mr-0 pr-0">
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild isActive={isMenuLinkActive(`/sessions?agent=${agent}&space=playground`)} className={"justify-between"}>
                            <Link to={`/sessions?agent=${agent}&space=playground`}>
                              <div>Private</div>
                              {playgroundUnseenCount > 0 && <NotificationBadge>{playgroundUnseenCount}</NotificationBadge>}
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem >
                          <SidebarMenuSubButton asChild isActive={isMenuLinkActive(`/sessions?agent=${agent}&space=shared-playground`)} className={"justify-between"}>
                            <Link to={`/sessions?agent=${agent}&space=shared-playground`}>
                              <div>Shared</div>
                              {sharedPlaygroundUnseenCount > 0 && <NotificationBadge>{sharedPlaygroundUnseenCount}</NotificationBadge>}
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>

                        {/* <SidebarMenuSubItem>
                        <SidebarMenuSubButton>Starred</SidebarMenuSubButton>
                      </SidebarMenuSubItem> */}
                      </SidebarMenuSub>
                    </SidebarMenuItem>

                    {/* <SidebarMenuItem>
                    <SidebarMenuButton><StarIcon className="h-4 w-4" /> Starred</SidebarMenuButton>
                  </SidebarMenuItem> */}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>

              {agentCustomRoutes.length > 0 && <SidebarGroup>
                <SidebarGroupLabel>Pages</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {agentCustomRoutes.map((route) => {
                      if (!route.route.path) {
                        throw new Error("Custom route path is required")
                      }

                      return <SidebarMenuItem key={route.route.path}>
                        <SidebarMenuButton asChild isActive={isMenuLinkActive(route.route.path)}>
                          <Link to={route.route.path}>
                            {route.title}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>}
            </SidebarContent>
          </>}

          {isSettings && <>
            <SidebarHeader>
              <Button variant="ghost" size="sm" className="justify-start" asChild>
                <Link to="/">
                  <ArrowLeft className="h-4 w-4" />
                  Back to app
                </Link>
              </Button>
            </SidebarHeader>
            <SidebarContent>
              {/* <SidebarGroup>
                <SidebarGroupLabel>Account</SidebarGroupLabel>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isMenuLinkActive("/settings/profile")}>
                      <Link to="/settings/profile">
                        <UserIcon className="h-4 w-4" />
                        <span>Profile</span>
                      </Link>
                    </SidebarMenuButton>
                    <SidebarMenuButton asChild isActive={isMenuLinkActive("/settings/password")}>
                      <Link to="/settings/password">
                        <LockKeyhole className="h-4 w-4" />
                        <span>Password</span>
                      </Link>
                    </SidebarMenuButton>
                    <SidebarMenuButton asChild isActive={isMenuLinkActive("/settings/api-keys")}>
                      <Link to="/settings/api-keys">
                        <UserIcon className="h-4 w-4" />
                        <span>API Keys</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroup>

              { (me.role === "admin" || me.role === "owner") && <SidebarGroup>
                <SidebarGroupLabel>Organisation</SidebarGroupLabel>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isMenuLinkActive("/settings/members")}>
                      <Link to="/settings/members">
                        <UsersIcon className="h-4 w-4" />
                        <span>Members</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroup>} */}

              {(me.role === "admin" || me.role === "owner") && <SidebarGroup>
                <SidebarGroupLabel>Dev</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={isMenuLinkActive("/settings/config")}>
                        <Link to="/settings/config">
                          <Database className="h-4 w-4" />
                          <span>Config</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>}


              {/* {import.meta.env.DEV && <SidebarGroup>
                <SidebarGroupLabel>Internal</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={isMenuLinkActive("/settings/emails")}>
                        <Link to="/settings/emails">
                          <Mail className="h-4 w-4" />
                          <span>Emails</span>
                        </Link>
                      </SidebarMenuButton>

                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>} */}

            </SidebarContent>
          </>}


          <SidebarFooter className="border-t p-3">
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton>
                      <UserAvatar image={me.image} />
                      {/* <UserIcon /> */}
                      <div className="flex flex-col items-start text-left">
                        <span className="text-sm font-medium truncate">{me.name}</span>
                        <span className="text-xs text-muted-foreground truncate">{me.email}</span>
                      </div>
                      <ChevronUp className="ml-auto" />
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" className="min-w-[200px]">
                    <DropdownMenuItem asChild>
                      <Link to={getWebAppUrl() + "/orgs/" + organization.id + "/profile"} target="_blank">
                        <UserIcon className="h-4 w-4" />
                        <span>Profile</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to={getWebAppUrl() + "/orgs/" + organization.id + "/details"} target="_blank">
                        <Building2Icon className="h-4 w-4" />
                        <span>Organization</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />

                    <DropdownMenuItem asChild>
                      <Link to="/logout">
                        <LogOut className="h-4 w-4" />
                        Log out
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>


              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>

        </Sidebar>

        <SidebarInset>
          <Outlet />
        </SidebarInset>
      </div>
    </SidebarProvider>
  </SessionContext.Provider>
  );
}

export const sidebarLayoutRoute: RouteObject = {
  Component,
  loader,
}