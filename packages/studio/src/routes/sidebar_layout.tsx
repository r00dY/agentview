import React from "react";
import {
  data,
  Link,
  Outlet,
  redirect,
  useFetcher,
  useLoaderData,
  type LoaderFunctionArgs,
  type RouteObject,
} from "react-router";

import { LogOut, ChevronUp, UserIcon, Edit, Lock, Users, Mail, MessageCircle, Database, Inbox } from "lucide-react"
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "../components/ui/sidebar"


// Removed Framework Mode type import
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "~/components/ui/dropdown-menu";
import { EditProfileDialog } from "~/components/EditProfileDialog";
import { ChangePasswordDialog } from "~/components/ChangePasswordDialog";
import { authClient } from "~/lib/auth-client";
import { SessionContext } from "~/lib/SessionContext";
import { apiFetch } from "~/lib/apiFetch";
import { NotificationBadge } from "~/components/NotificationBadge";
import { createOrUpdateSchema } from "~/lib/remoteConfig";
import { config } from "~/config";
import { type User, allowedSessionLists } from "~/lib/shared/apiTypes";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await authClient.getSession()

  const url = new URL(request.url);
  const relativeUrl = url.pathname + url.search + url.hash;

  if (!session.data) {
    if (relativeUrl !== '/') {
      return redirect('/login?redirect=' + encodeURIComponent(relativeUrl));
    }
    else {
      return redirect('/login');
    }
  }
  
  await createOrUpdateSchema(); // update schema on every page load

  const membersResponse = await apiFetch<User[]>('/api/users');

  if (!membersResponse.ok) {
    throw data(membersResponse.error, { status: membersResponse.status });
  }

  const locale = request.headers.get('accept-language')?.split(',')[0] || 'en-US';

  // Fetch session stats for each session type and list combination
  const listStats: { [sessionType: string]: { [list: string]: { unseenCount: number, hasMentions: boolean } } } = {};

  if (config.agents) {
    for (const agentConfig of config.agents) {
      listStats[agentConfig.name] = {};

      for (const list of allowedSessionLists) {
        const statsUrl = `/api/sessions/stats?agent=${agentConfig.name}&list=${list}`;
        const statsResponse = await apiFetch<{ unseenCount: number, hasMentions: boolean }>(statsUrl);

        if (!statsResponse.ok) {
          throw data(statsResponse.error, { status: statsResponse.status });
        }

        listStats[agentConfig.name][list] = statsResponse.data;
      }
    }
  }

  if (!session.data.user.role) {
    throw data("User not found", { status: 404 });
  }

  const user : User = {
    id: session.data.user.id,
    email: session.data.user.email,
    name: session.data.user.name,
    role: session.data.user.role,
    createdAt: session.data.user.createdAt.toISOString(),
  }
  
  return {
    user,
    members: membersResponse.data,
    locale,
    isDeveloper: true,
    listStats
  };
}

function Component() {
  const { user, isDeveloper, members, locale, listStats } = useLoaderData<typeof loader>()
  const [editProfileOpen, setEditProfileOpen] = React.useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = React.useState(false)

  // Helper function to get unseen count for a specific session type and list name
  const getUnseenCount = (sessionType: string, listName: string) => {
    return listStats[sessionType]?.[listName]?.unseenCount ?? 0
  }

  return (<SessionContext.Provider value={{ user, members, locale }}>
    <SidebarProvider>
      <div className="flex h-screen bg-background w-full">
        <Sidebar className="border-r">
          <SidebarHeader className="px-3 py-3">
            <Link to="/">
              <img src="/logo.svg" alt="AgentView Logo" className="max-w-[100px]" />
            </Link>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Sessions</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>

                { (!config.agents || config.agents.length === 0) && (
                  <SidebarMenuItem>
                    <SidebarMenuButton className="text-muted-foreground">You don't have any agents yet</SidebarMenuButton>
                  </SidebarMenuItem>
                )}

                  {config.agents?.map((agent) => {
                    const realUnseenCount = getUnseenCount(agent.name, "real")
                    const simulatedPrivateUnseenCount = getUnseenCount(agent.name, "simulated_private")
                    const simulatedSharedUnseenCount = getUnseenCount(agent.name, "simulated_shared")
                    
                    return (
                      <SidebarMenuItem key={agent.name}>
                        <SidebarMenuButton>{agent.name}</SidebarMenuButton>
                        <SidebarMenuSub className="mr-0">
                          <SidebarMenuSubItem className={realUnseenCount > 0 ? "flex justify-between items-center" : ""}>
                            <SidebarMenuSubButton asChild>
                              <Link to={`/sessions?agent=${agent.name}`}>
                                <MessageCircle className="mr-2 h-4 w-4" />
                                <span>Production</span>
                              </Link>
                            </SidebarMenuSubButton>
                            { realUnseenCount > 0 && <NotificationBadge>{realUnseenCount}</NotificationBadge> }
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem className={simulatedPrivateUnseenCount > 0 ? "flex justify-between items-center" : ""}>
                            <SidebarMenuSubButton asChild>
                              <Link to={`/sessions?agent=${agent.name}&list=simulated_private`}>
                                <UserIcon className="mr-2 h-4 w-4" />
                                <span>Simulated Private</span>
                              </Link>
                            </SidebarMenuSubButton>
                            
                            { simulatedPrivateUnseenCount > 0 && <NotificationBadge>{simulatedPrivateUnseenCount}</NotificationBadge> }
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem className={simulatedSharedUnseenCount > 0 ? "flex justify-between items-center" : ""}>
                            <SidebarMenuSubButton asChild>
                              <Link to={`/sessions?agent=${agent.name}&list=simulated_shared`}>
                                <Users className="mr-2 h-4 w-4" />
                                <span>Simulated Shared</span>
                              </Link>
                            </SidebarMenuSubButton>
                            { simulatedSharedUnseenCount > 0 && <NotificationBadge>{simulatedSharedUnseenCount}</NotificationBadge> }

                          </SidebarMenuSubItem>
                        </SidebarMenuSub>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>



            {user.role === "admin" && <SidebarGroup>
              <SidebarGroupLabel>Organization</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>

                    <SidebarMenuButton asChild>
                      <Link to="/members">
                        <Users className="mr-2 h-4 w-4" />
                        <span>Members</span>
                      </Link>

                    </SidebarMenuButton>

                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>}

            {isDeveloper && <SidebarGroup>
              <SidebarGroupLabel>Developer</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link to="/emails">
                        <Mail className="mr-2 h-4 w-4" />
                        <span>Emails</span>
                      </Link>
                    </SidebarMenuButton>

                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link to="/configs">
                        <Database className="mr-2 h-4 w-4" />
                        <span>Config</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>}
          </SidebarContent>

          <SidebarFooter className="border-t p-3">
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton>
                      <UserIcon />
                      <div className="flex flex-col items-start text-left">
                        <span className="text-sm font-medium truncate">{user.name}</span>
                        <span className="text-xs text-muted-foreground truncate">{user.email}</span>
                      </div>
                      <ChevronUp className="ml-auto" />
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" className="w-[--radix-popper-anchor-width]">
                    <DropdownMenuItem onClick={() => { setEditProfileOpen(true) }}>
                      <Edit className="mr-2 h-4 w-4" />
                      Edit Account
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setChangePasswordOpen(true) }}>
                      <Lock className="mr-2 h-4 w-4" />
                      Change Password
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/logout">
                        <LogOut className="mr-2 h-4 w-4" />
                        Log out
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <EditProfileDialog
                  open={editProfileOpen}
                  onOpenChange={setEditProfileOpen}
                  user={user}
                />

                <ChangePasswordDialog
                  open={changePasswordOpen}
                  onOpenChange={setChangePasswordOpen}
                />


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