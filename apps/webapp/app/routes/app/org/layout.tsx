import {
  data,
  Link,
  Outlet,
  useLoaderData,
  useLocation,
  useNavigate,
  useParams,
  type LoaderFunctionArgs
} from "react-router";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
} from "@agentview/studio/components/ui/sidebar";
import { Building2, ChevronDown, ChevronsUpDownIcon, ChevronUp, HomeIcon, KeyRound, LockKeyhole, LogOut, MessageSquare, Settings, UserIcon, UsersIcon } from "lucide-react";

import { UserAvatar } from "@agentview/studio/components/internal/UserAvatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@agentview/studio/components/ui/dropdown-menu";
import { betterAuthErrorToBaseError } from "@agentview/studio/lib/errors";
import { matchPath } from "react-router";
import { authClient } from "~/authClient";
import { queryClient } from "~/queryClient";
import { queryKeys } from "~/queryKeys";
import { requireOrganization } from "~/requireOrganization";
import { requireMemberByUserId } from "~/requireMember";
import { Button } from "@agentview/studio/components/ui/button";

export async function clientLoader({ request, params }: LoaderFunctionArgs) {
  // Fetch session and organizations list in parallel (they don't depend on each other)
  const [session, orgsResponse] = await Promise.all([
    queryClient.fetchQuery({
      queryKey: queryKeys.session,
      queryFn: () => authClient.getSession(),
    }),
    queryClient.fetchQuery({
      queryKey: queryKeys.organizations,
      queryFn: () => authClient.organization.list(),
    }),
  ]);

  if (session.error) {
    throw data(betterAuthErrorToBaseError(session.error));
  }
  const user = session.data!.user;

  if (orgsResponse.error) {
    throw data(betterAuthErrorToBaseError(orgsResponse.error));
  }
  const organizations = orgsResponse.data;

  // Get full details of current organization (depends on orgId param)
  const organization = await queryClient.fetchQuery({
    queryKey: queryKeys.organization(params.orgId!),
    queryFn: () => requireOrganization(params.orgId!),
  });
  const member = await requireMemberByUserId(organization, user.id);

  const me = {
    ...user,
    role: member!.role
  }

  const locale = request.headers.get('accept-language')?.split(',')[0] || 'en-US';

  return {
    organization,
    organizations,
    me,
    locale
  };
}

export default function OrgLayout() {
  const { organization, organizations, me } = useLoaderData<typeof clientLoader>()
  const { orgId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const basePath = `/orgs/${orgId}`;

  const isMenuLinkActive = (linkPath: string) => {
    const fullPath = `${basePath}${linkPath}`;
    const linkUrl = new URL(fullPath, window.location.origin)
    const pathMatches = matchPath({ path: linkUrl.pathname, end: linkPath === "" }, location.pathname)
    if (!pathMatches) return false
    return true
  }

  const handleOrgChange = (newOrgId: string) => {
    navigate(`/orgs/${newOrgId}`);
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen bg-background w-full">
        <Sidebar className="border-r">

          <SidebarHeader className="p-4 space-y-3">
            {/* Logo */}
            <div className="flex flex-row items-center">
              <img src="/symbol_light.svg" className="size-4 flex-none" alt="AgentView Logo" />

              <div className="text-gray-300 text-xl font-extralight ml-2 mr-1 flex-none">/</div>

              <div className="flex-1 min-w-0">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="xs" className="max-w-full">
                      <span className="truncate">{organization.name}</span>
                      <ChevronsUpDownIcon className="size-3 shrink-0 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[--radix-popper-anchor-width]" align="start">
                    {organizations.map((org) => (
                      <DropdownMenuItem
                        key={org.id}
                        onClick={() => handleOrgChange(org.id)}
                        className={org.id === orgId ? "bg-accent" : ""}
                      >
                        {org.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>



              </div>

            </div>

            {/* Organization Picker */}
            {/* <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton className="w-full justify-between">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        <span className="truncate">{organization.name}</span>
                      </div>
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[--radix-popper-anchor-width]" align="start">
                    {organizations.map((org) => (
                      <DropdownMenuItem
                        key={org.id}
                        onClick={() => handleOrgChange(org.id)}
                        className={org.id === orgId ? "bg-accent" : ""}
                      >
                        <Building2 className="h-4 w-4" />
                        <span>{org.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu> */}
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isMenuLinkActive("")}>
                    <Link to={`${basePath}`}>
                      <HomeIcon className="h-4 w-4" />
                      <span>Home</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Account</SidebarGroupLabel>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isMenuLinkActive("/profile")}>
                    <Link to={`${basePath}/profile`}>
                      <UserIcon className="h-4 w-4" />
                      <span>Profile</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isMenuLinkActive("/password")}>
                    <Link to={`${basePath}/password`}>
                      <LockKeyhole className="h-4 w-4" />
                      <span>Password</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>

            {(me.role === "admin" || me.role === "owner") && <SidebarGroup>
              <SidebarGroupLabel>Organisation</SidebarGroupLabel>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isMenuLinkActive("/details")}>
                    <Link to={`${basePath}/details`}>
                      <Building2 className="h-4 w-4" />
                      <span>Details</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isMenuLinkActive("/members")}>
                    <Link to={`${basePath}/members`}>
                      <UsersIcon className="h-4 w-4" />
                      <span>Members</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isMenuLinkActive("/api-keys")}>
                    <Link to={`${basePath}/api-keys`}>
                      <KeyRound className="h-4 w-4" />
                      <span>API Keys</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {/* <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isMenuLinkActive("/channels")}>
                    <Link to={`${basePath}/channels`}>
                      <MessageSquare className="h-4 w-4" />
                      <span>Channels</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem> */}
              </SidebarMenu>
            </SidebarGroup>}

          </SidebarContent>

          <SidebarFooter className="border-t p-3">
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton>
                      <UserAvatar image={me.image} />
                      <div className="flex flex-col items-start text-left">
                        <span className="text-sm font-medium truncate">{me.name}</span>
                        <span className="text-xs text-muted-foreground truncate">{me.email}</span>
                      </div>
                      <ChevronUp className="ml-auto" />
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" className="min-w-[200px]">
                    <DropdownMenuItem asChild>
                      <Link to={`${basePath}/profile`}>
                        <UserIcon className="h-4 w-4" />
                        <span>Profile</span>
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
  );
}
