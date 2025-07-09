import { redirect, useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/members";
import { auth } from "../../lib/auth.server";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "~/components/ui/table";
import { Button } from "~/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "~/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { MoreHorizontal, Plus, AlertCircleIcon } from "lucide-react";
import React from "react";
import { APIError } from "better-auth/api";
import type { FormActionData } from "~/lib/FormActionData";
import { useFetcherSuccess } from "~/lib/useFetcherSuccess";

enum Role {
  OWNER = "owner",
  ADMIN = "admin",
  MEMBER = "member"
}

export async function loader({ request }: Route.LoaderArgs) {
  // Get current member info in default org to ensure they are owner
  // const { member: selfMember } = await auth.api.getActiveMember({
  //   headers: request.headers,
  // });

  // if (!selfMember || !selfMember.role.split(",").includes("owner")) {
  //   return redirect("/");
  // }


  // List members & invitations (using `any` to bypass strict typings)

  const fullOrganisation = await auth.api.getFullOrganization({ headers: request.headers, query: { organizationSlug: "default" } });

  if (!fullOrganisation) {
    throw new Error("Organization not found");
  }

  const members = fullOrganisation.members;
  const invitations = fullOrganisation.invitations;

  console.log("MEMBERS:");
  console.log(members);

  // console.log("INVITATIONS:");
  // console.log(invitations);

  // const rows: Member[] = [
  //   ...members.map((m: any) => ({
  //     id: m.id,
  //     email: m.user.email,
  //     name: m.user.name,
  //     role: m.role,
  //     status: "active" as const,
  //   })),
  //   ...invitations.map((i: any) => ({
  //     id: i.id,
  //     email: i.email,
  //     name: "-",
  //     role: i.role,
  //     status: i.status === "pending" ? ("pending" as const) : ("active" as const),
  //   })),
  // ];

  return { members, invitations };
}

function InviteMemberDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const fetcher = useFetcher<FormActionData>();
  const actionData = fetcher.data as FormActionData | undefined;

  useFetcherSuccess(fetcher, () => {
    onOpenChange(false);
  });
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Member</DialogTitle>
        </DialogHeader>
        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="_action" value="inviteMember" />
          
          {/* General error alert */}
          {actionData?.status === "error" && actionData.error && fetcher.state === 'idle' && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Invitation failed.</AlertTitle>
              <AlertDescription>{actionData.error}</AlertDescription>
            </Alert>
          )}
          
          <div className="space-y-2">
            <Label htmlFor="inviteMemberEmail">Email</Label>
            <Input
              id="inviteMemberEmail"
              name="email"
              type="email"
              placeholder="john@doe.com"
              required
            />
            {actionData?.status === "error" && actionData?.fieldErrors?.email && fetcher.state === 'idle' && (
              <p id="email-error" className="text-sm text-destructive">
                {actionData.fieldErrors.email}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="inviteMemberRole">Role</Label>
            <Select defaultValue={Role.MEMBER} name="role">
              <SelectTrigger>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={Role.MEMBER}>Member</SelectItem>
                <SelectItem value={Role.ADMIN}>Admin</SelectItem>
                <SelectItem value={Role.OWNER}>Owner</SelectItem>
              </SelectContent>
            </Select>
            {actionData?.status === "error" && actionData?.fieldErrors?.role && fetcher.state === 'idle' && (
              <p id="role-error" className="text-sm text-destructive">
                {actionData.fieldErrors.role}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={fetcher.state !== "idle"}>
              Send Invitation
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

export async function action({ request }: Route.ActionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return redirect("/login");

  const formData = await request.formData();
  const _action = formData.get("_action");

  const fullOrganisation = await auth.api.getFullOrganization({ headers: request.headers, query: { organizationSlug: "default" } });

  if (!fullOrganisation) {
    throw new Error("Organization not found");
  }


  try {
    switch (_action) {
      case "inviteMember": {
        const email = formData.get("email") as string;
        const role = formData.get("role") as Role;

        console.log(email, role);

        try {
          await auth.api.createInvitation({
            headers: request.headers,
            body: { email, role, organizationId: fullOrganisation.id },
          });

          console.log("Invitation created");
        }
        catch (error) {
          if (error instanceof APIError) {
            return {
              status: "error",
              error: error.message,
            }
          }
          return {
            status: "error",
            error: "Unexpected error",
          }
        }

        return {
          status: "success",
        }
      }

      case "updateRole": {
        const memberId = formData.get("memberId") as string;
        const role = formData.get("role") as string;
        await (auth.api as any).updateMemberRole({
          headers: request.headers,
          body: { memberId, role },
        });
        break;
      }
      case "removeMember": {
        const memberIdOrEmail = formData.get("memberId") as string;
        await (auth.api as any).removeMember({
          headers: request.headers,
          body: { memberIdOrEmail },
        });
        break;
      }
      case "cancelInvite": {
        const invitationId = formData.get("invitationId") as string;
        await (auth.api as any).cancelInvitation({
          headers: request.headers,
          body: { invitationId },
        });
        break;
      }
      // Resend invite not implemented yet
      default:
        break;
    }
    return redirect("/members");
  } catch (error: any) {
    return { error: (error as any)?.message ?? "Unexpected error" };
  }
}

function EditRoleDialog({ open, onOpenChange, member }: { open: boolean; onOpenChange: (v: boolean) => void; member: Member | null }) {
  const fetcher = useFetcher();
  const [role, setRole] = React.useState<string>(member?.role ?? Role.MEMBER);

  React.useEffect(() => {
    if (member) setRole(member.role);
  }, [member]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Role</DialogTitle>
        </DialogHeader>
        {member && (
          <fetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="_action" value="updateRole" />
            <input type="hidden" name="memberId" value={member.id} />
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={Role.OWNER}>Owner</SelectItem>
                  <SelectItem value={Role.ADMIN}>Admin</SelectItem>
                  <SelectItem value={Role.MEMBER}>Member</SelectItem>
                </SelectContent>
              </Select>
              <input type="hidden" name="role" value={role} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={fetcher.state !== "idle"}>Save</Button>
            </DialogFooter>
          </fetcher.Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function MembersPage() {
  const { members, invitations } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selectedMember, setSelectedMember] = React.useState<typeof members[number] | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = React.useState(false);

  function openEdit(m: typeof members[number]) {
    setSelectedMember(m);
    setDialogOpen(true);
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Organization Members</h1>
        <Button onClick={() => setInviteDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Invite Member
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
            {/* <TableHead>Status</TableHead> */}
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.user.email}</TableCell>
              <TableCell>{row.user.name}</TableCell>
              <TableCell>{row.role}</TableCell>
              {/* <TableCell className="capitalize">{row.status ?? "active"}</TableCell> */}
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(row)}>
                        Edit Role
                      </DropdownMenuItem>

                      <fetcher.Form method="post">
                        <input type="hidden" name="_action" value="removeMember" />
                        <input type="hidden" name="memberId" value={row.id} />
                        <DropdownMenuItem asChild variant="destructive">
                          <button type="submit" className="w-full text-left">Remove User</button>
                        </DropdownMenuItem>
                      </fetcher.Form>
{/*                       
                    {row.status === "pending" && (
                      <fetcher.Form method="post">
                        <input type="hidden" name="_action" value="cancelInvite" />
                        <input type="hidden" name="invitationId" value={row.id} />
                        <DropdownMenuItem asChild variant="destructive">
                          <button type="submit" className="w-full text-left">Cancel Invite</button>
                        </DropdownMenuItem>
                      </fetcher.Form>
                    )} */}
                    {/* Resend invitation could be added here */}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <EditRoleDialog open={dialogOpen} onOpenChange={setDialogOpen} member={selectedMember} />
      <InviteMemberDialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen} />
    </div>
  );
}
