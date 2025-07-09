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
import { MoreHorizontal } from "lucide-react";
import React from "react";

enum Role {
  OWNER = "owner",
  ADMIN = "admin",
  MEMBER = "member"
}

interface Member {
  id: string;
  email: string;
  name: string;
  role: string;
  status: "active" | "pending";
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

  const rows: Member[] = [
    ...members.map((m: any) => ({
      id: m.id,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      status: "active" as const,
    })),
    ...invitations.map((i: any) => ({
      id: i.id,
      email: i.email,
      name: "-",
      role: i.role,
      status: i.status === "pending" ? ("pending" as const) : ("active" as const),
    })),
  ];

  return { rows };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return redirect("/login");

  const formData = await request.formData();
  const _action = formData.get("_action");

  try {
    switch (_action) {
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
  const { rows } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selectedMember, setSelectedMember] = React.useState<Member | null>(null);

  function openEdit(m: Member) {
    setSelectedMember(m);
    setDialogOpen(true);
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-6">Organization Members</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row: Member) => (
            <TableRow key={row.id}>
              <TableCell>{row.email}</TableCell>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.role}</TableCell>
              <TableCell className="capitalize">{row.status}</TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {row.status === "active" && (
                      <DropdownMenuItem onClick={() => openEdit(row)}>
                        Edit Role
                      </DropdownMenuItem>
                    )}
                    {row.status === "active" && (
                      <fetcher.Form method="post">
                        <input type="hidden" name="_action" value="removeMember" />
                        <input type="hidden" name="memberId" value={row.id} />
                        <DropdownMenuItem asChild variant="destructive">
                          <button type="submit" className="w-full text-left">Remove User</button>
                        </DropdownMenuItem>
                      </fetcher.Form>
                    )}
                    {row.status === "pending" && (
                      <fetcher.Form method="post">
                        <input type="hidden" name="_action" value="cancelInvite" />
                        <input type="hidden" name="invitationId" value={row.id} />
                        <DropdownMenuItem asChild variant="destructive">
                          <button type="submit" className="w-full text-left">Cancel Invite</button>
                        </DropdownMenuItem>
                      </fetcher.Form>
                    )}
                    {/* Resend invitation could be added here */}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <EditRoleDialog open={dialogOpen} onOpenChange={setDialogOpen} member={selectedMember} />
    </div>
  );
}
