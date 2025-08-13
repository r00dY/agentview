import React from "react";
import {
    Link,
    Outlet,
    redirect,
    useFetcher,
    useLoaderData,
  } from "react-router";
  
  import { LogOut, ChevronUp, User, Edit, Lock, Users, Mail, MessageCircle } from "lucide-react"
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
  } from "../components/ui/sidebar"
import type { Route } from "./+types/sidebar_layout";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "~/components/ui/dropdown-menu";
import { EditProfileDialog } from "~/components/EditProfileDialog";
import { ChangePasswordDialog } from "~/components/ChangePasswordDialog";
import { authClient } from "~/lib/auth-client";


export async function clientLoader({request}: Route.ClientLoaderArgs) {
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

  return {
    session: session.data,
    showEmails: true
  };
}


export default function Layout() {
  const { session, showEmails } = useLoaderData<typeof clientLoader>()
  const logoutFetcher = useFetcher()

  const [editProfileOpen, setEditProfileOpen] = React.useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = React.useState(false)
  
  const user = session.user

  return (
    <SidebarProvider>
      <div className="flex h-screen bg-background w-full">
        <Sidebar className="border-r">
          <SidebarHeader className="px-3 py-3">
            <img src="/public/logo.svg" alt="AgentView Logo" className="max-w-[100px]" />

            {/* <Button variant={"outline"} className="w-full justify-start gap-2 mt-5" asChild>

              <Link to="/users/create">
                <PlusCircle className="h-4 w-4" />
                <span>New Session</span>
              </Link>
            </Button> */}
          </SidebarHeader>


          <SidebarContent>
            <SidebarGroup>
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
                        <span>My Sessions</span>
                      </Link>
                    </SidebarMenuButton>
                    <SidebarMenuButton asChild>
                      <Link to="/threads?list=simulated_shared">
                        <Users className="mr-2 h-4 w-4" />
                        <span>Shared Sessions</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  
                  

                  {/* <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link to="/evals">
                        <Gauge className="mr-2 h-4 w-4" />
                        <span>Evaluations</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem> */}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            { user.role === "admin" && <SidebarGroup>
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

            { showEmails && <SidebarGroup>
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
          <Outlet/>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
