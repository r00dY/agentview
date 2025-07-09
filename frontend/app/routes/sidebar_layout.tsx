import {
    Link,
    Outlet,
    redirect,
    useLoaderData,
    useNavigate
  } from "react-router";
  
  import { LogOut, PlusCircle, ShoppingBag, User2, ShoppingBasket, Gauge } from "lucide-react"
  import { Button } from "../components/ui/button"
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
import { auth } from "../../lib/auth";



export async function loader({request}: Route.LoaderArgs) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    console.log("[home] not logged in, redirecting to login")
    return redirect('/login');
  }

  console.log("[home] logged in")
  return session;
}



export default function Layout() {
  const session = useLoaderData<typeof loader>()

  console.log(session)

  const navigate = useNavigate()
  // const email = getAuthForce().email

  // return <div><Outlet /></div>

  return (
    <SidebarProvider>
      <div className="flex h-screen bg-background w-full">
        <Sidebar className="border-r">
          <SidebarHeader className="px-3 py-2">

            <div className="text-md font-medium">agentview.</div>

            {/* <Button variant={"outline"} className="w-full justify-start gap-2 mt-5" asChild>

              <Link to="/users/create">
                <PlusCircle className="h-4 w-4" />
                <span>New Session</span>
              </Link>
            </Button> */}
          </SidebarHeader>


          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Navigation</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link to="/users">
                        <ShoppingBasket className="mr-2 h-4 w-4" />
                        <span>Sessions</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {/* <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link to="/users">
                        <User2 className="mr-2 h-4 w-4" />
                        <span>User Profiles</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem> */}
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link to="/products">
                        <ShoppingBag className="mr-2 h-4 w-4" />
                        <span>Products</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link to="/evals">
                        <Gauge className="mr-2 h-4 w-4" />
                        <span>Evaluations</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

          </SidebarContent>

          <SidebarFooter className="border-t p-3">
            <div className="flex items-center gap-3">
              {/* <Avatar>
                    <AvatarImage alt="User" />
                    <AvatarFallback>U</AvatarFallback>
                  </Avatar> */}
              <div className="flex flex-col">
                <div className="text-sm font-medium">User</div>
                {/* <div className="text-sm mb-2 text-muted-foreground">{email}</div>
                <Button variant={"outline"} size="tiny" onClick={() => navigate('/logout')}>Log out <LogOut className="h-4 w-4" /></Button> */}
              </div>
            </div>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <Outlet/>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
