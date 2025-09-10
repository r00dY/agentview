import React from "react";
import {
  data,
  Link,
  Outlet,
  redirect,
  useFetcher,
  useLoaderData,
} from "react-router";

import { LogOut, ChevronUp, User, Edit, Lock, Users, Mail, MessageCircle, Database, Inbox } from "lucide-react"
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
import type { Route } from "./+types/sidebar_layout";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "~/components/ui/dropdown-menu";
import { EditProfileDialog } from "~/components/EditProfileDialog";
import { ChangePasswordDialog } from "~/components/ChangePasswordDialog";
import { authClient } from "~/lib/auth-client";
import { SessionContext } from "~/lib/session";
import { apiFetch } from "~/lib/apiFetch";
import type { Member, SessionList } from "~/lib/shared/apiTypes";
import { NotificationBadge } from "~/components/NotificationBadge";
import { createOrUpdateSchema } from "~/lib/schema";


export async function clientLoader({ request }: Route.ClientLoaderArgs) {
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

  const membersResponse = await apiFetch<Member[]>('/api/members');

  if (!membersResponse.ok) {
    throw data(membersResponse.error, { status: membersResponse.status });
  }

  const locale = request.headers.get('accept-language')?.split(',')[0] || 'en-US';

  const listsResponse = await apiFetch<SessionList[]>('/api/lists');

  if (!listsResponse.ok) {
    throw data(listsResponse.error, { status: listsResponse.status });
  }

  return {
    user: session.data.user,
    members: membersResponse.data,
    locale,
    isDeveloper: true,
    lists: listsResponse.data
  };
}

export default function Layout() {
  const { user, isDeveloper, members, locale, lists } = useLoaderData<typeof clientLoader>()
  const logoutFetcher = useFetcher()
  const [editProfileOpen, setEditProfileOpen] = React.useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = React.useState(false)

  const realList = lists.find((list) => list.name === "real")
  const simulatedPrivateList = lists.find((list) => list.name === "simulated_private")
  const simulatedSharedList = lists.find((list) => list.name === "simulated_shared")

  const realListUnseenCount = realList?.unseenCount ?? 0
  const simulatedPrivateListUnseenCount = simulatedPrivateList?.unseenCount ?? 0
  const simulatedSharedListUnseenCount = simulatedSharedList?.unseenCount ?? 0

  return (<SessionContext.Provider value={{ user, members, locale }}>
    <SidebarProvider>
      <div className="flex h-screen bg-background w-full">
        <Sidebar className="border-r">
          <SidebarHeader className="px-3 py-3">
            <img src="/logo.svg" alt="AgentView Logo" className="max-w-[100px]" />

            {/* <Button variant={"outline"} className="w-full justify-start gap-2 mt-5" asChild>

              <Link to="/users/create">
                <PlusCircle className="h-4 w-4" />
                <span>New Session</span>
              </Link>
            </Button> */}
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link to="/inbox">
                        <Inbox className="mr-2 h-4 w-4" />
                        <span>Inbox</span>
                      </Link>
                    </SidebarMenuButton>

                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {/* <SidebarGroup>
              <SidebarGroupLabel>pdp_chat</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton>Production </SidebarMenuButton>

                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild>
                          <Link to="/threads">
                            <MessageCircle className="mr-2 h-4 w-4" />
                            <span>All</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>


                  </SidebarMenuItem>



                  <SidebarMenuItem>
                    <SidebarMenuButton>Simulated</SidebarMenuButton>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild>
                          <Link to="/threads?list=simulated_private">
                            <User className="mr-2 h-4 w-4" />
                            <span> Private</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild>
                          <Link to="/threads?list=simulated_shared">
                            <Users className="mr-2 h-4 w-4" />
                            <span>Shared</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>


                  </SidebarMenuItem>

                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup> */}


            <SidebarGroup>
              <SidebarGroupLabel>Sessions</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton>pdp_chat</SidebarMenuButton>
                    <SidebarMenuSub className="mr-0">
                      <SidebarMenuSubItem className={realListUnseenCount > 0 ? "flex justify-between items-center" : ""}>
                        <SidebarMenuSubButton asChild>
                          <Link to="/threads">
                            <MessageCircle className="mr-2 h-4 w-4" />
                            <span>Production</span>
                          </Link>
                        </SidebarMenuSubButton>
                        { realListUnseenCount > 0 && <NotificationBadge>{realListUnseenCount}</NotificationBadge> }
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem className={simulatedPrivateListUnseenCount > 0 ? "flex justify-between items-center" : ""}>
                        <SidebarMenuSubButton asChild>
                          <Link to="/threads?list=simulated_private">
                            <User className="mr-2 h-4 w-4" />
                            <span>Simulated Private</span>
                          </Link>
                        </SidebarMenuSubButton>
                        
                        { simulatedPrivateListUnseenCount > 0 && <NotificationBadge>{simulatedPrivateListUnseenCount}</NotificationBadge> }
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem className={simulatedSharedListUnseenCount > 0 ? "flex justify-between items-center" : ""}>
                        <SidebarMenuSubButton asChild>
                          <Link to="/threads?list=simulated_shared">
                            <Users className="mr-2 h-4 w-4" />
                            <span>Simulated Shared</span>
                          </Link>
                        </SidebarMenuSubButton>
                        { simulatedSharedListUnseenCount > 0 && <NotificationBadge>{simulatedSharedListUnseenCount}</NotificationBadge> }

                      </SidebarMenuSubItem>
                    </SidebarMenuSub>


                  </SidebarMenuItem>

                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>



            {/* <SidebarGroup>
              <SidebarGroupLabel>Production</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link to="/threads">
                        <MessageCircle className="mr-2 h-4 w-4" />
                        <span>Sessions</span>
                      </Link>
                    </SidebarMenuButton>

                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Dev</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link to="/threads?list=simulated_private">
                        <User className="mr-2 h-4 w-4" />
                        <span>Private Sessions</span>
                      </Link>
                    </SidebarMenuButton>
                    <SidebarMenuButton asChild>
                      <Link to="/threads?list=simulated_shared">
                        <Users className="mr-2 h-4 w-4" />
                        <span>Shared Sessions</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup> */}

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
                      <Link to="/schemas">
                        <Database className="mr-2 h-4 w-4" />
                        <span>Schema</span>
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
                      <User />
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
                    <DropdownMenuItem onClick={() => {
                      logoutFetcher.submit(null, {
                        method: 'post',
                        action: '/logout'
                      })
                    }}>
                      <LogOut className="mr-2 h-4 w-4" />
                      Log out
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
