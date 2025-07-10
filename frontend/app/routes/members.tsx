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
import { MoreHorizontal, Plus, AlertCircleIcon, Trash2 } from "lucide-react";
import React from "react";
import { APIError } from "better-auth/api";
import type { FormActionData } from "~/lib/FormActionData";
import { useFetcherSuccess } from "~/lib/useFetcherSuccess";
import { invitations as invitationsTable } from "../../db/schema";
import { db } from "../../lib/db.server";
import { eq } from "drizzle-orm";

enum Role {
  ADMIN = "admin",
  USER = "user"
}

export async function loader({ request }: Route.LoaderArgs) {
  const users = await auth.api.listUsers({
    headers: request.headers,
    query: {
      limit: 100,
    },
  });

  const invitations = await db.select().from(invitationsTable);

  return { users: users.users, invitations };
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
            <Select defaultValue={Role.USER} name="role">
              <SelectTrigger>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={Role.USER}>User</SelectItem>
                <SelectItem value={Role.ADMIN}>Admin</SelectItem>
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

  if (session.user.role !== "admin") {
    return {
      status: "error",
      error: "Not authorized.",
    }
  }

  try {
    switch (_action) {
      case "inviteMember": {
        const email = formData.get("email") as string;
        const role = formData.get("role") as Role;

        // Validate email correctness
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
          return {
            status: "error",
            fieldErrors: { email: "Please enter a valid email address." }
          };
        }

        // Validate role
        if (role !== "admin" && role !== "user") {
          return {
            status: "error",
            fieldErrors: { role: "Incorrect role." }
          };
        }

        try {
          // Check if user already exists
          const existingUser = await db.query.user.findFirst({
            where: (u, { eq }) => eq(u.email, email),
          });

          if (existingUser) {
            return {
              status: "error",
              fieldErrors: { email: "A user with this email already exists." }
            };
          }

          // Check if invitation already exists
          const existingInvitation = await db.query.invitations.findFirst({
            where: (i, { eq }) => eq(i.email, email),
          });
          
          if (existingInvitation) {
            return {
              status: "error",
              fieldErrors: { email: "An invitation with this email already exists." }
            };
          }

          await db.insert(invitationsTable).values({
            id: crypto.randomUUID(),
            email,
            role,
            invited_by: session.user.id,
            status: "pending",
            created_at: new Date(),
            expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days
          });

          return {
            status: "success"
          }
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
      }

      case "updateRole": {
        const userId = formData.get("userId") as string;
        const role = formData.get("role") as Role;

          try {
            await auth.api.setRole({
              headers: request.headers,
              body: { userId, role },
            });

            return {
              status: "success"
            }
            
          } catch (error) {
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

        try {
          await db.delete(invitationsTable).where(eq(invitationsTable.id, invitationId));
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

function EditRoleDialog({ open, onOpenChange, user }: { open: boolean; onOpenChange: (v: boolean) => void; user: any }) {
  const fetcher = useFetcher();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Role</DialogTitle>
        </DialogHeader>
        {user && (
          <fetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="_action" value="updateRole" />
            <input type="hidden" name="userId" value={user.id} />
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select defaultValue={user.role} name="role">
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={Role.ADMIN}>Admin</SelectItem>
                  <SelectItem value={Role.USER}>User</SelectItem>
                </SelectContent>
              </Select>
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
  const { users, invitations } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selectedUser, setSelectedUser] = React.useState<any | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = React.useState(false);

  function openEdit(m: any) {
    setSelectedUser(m);
    setDialogOpen(true);
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Organization Members</h1>
        <Button onClick={() => setInviteDialogOpen(true)}>
          <Plus className="w-4 h-4" />
          Invite Member
        </Button>
      </div>
      
      {/* Members Table */}
      <div className="mb-8">
        <h2 className="text-lg font-medium mb-4">Active Members</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.email}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.role}</TableCell>
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
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Invitations Table */}
      {invitations && invitations.length > 0 && (
        <div>
          <h2 className="text-lg font-medium mb-4">Pending Invitations</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell>{invitation.email}</TableCell>
                  <TableCell>{invitation.role}</TableCell>
                  <TableCell className="capitalize">
                    {(() => {
                      const isExpired = invitation.status === 'pending' && invitation.expires_at && new Date(invitation.expires_at) < new Date();
                      const displayStatus = isExpired ? 'expired' : invitation.status;
                      
                      return (
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          displayStatus === 'pending' 
                            ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {displayStatus}
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <fetcher.Form method="post">
                      <input type="hidden" name="_action" value="cancelInvite" />
                      <input type="hidden" name="invitationId" value={invitation.id} />
                      <Button 
                        type="submit" 
                        variant="ghost" 
                        size="icon"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        disabled={fetcher.state !== "idle"}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </fetcher.Form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      
      <EditRoleDialog open={dialogOpen} onOpenChange={setDialogOpen} user={selectedUser!} />
      <InviteMemberDialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen} />
    </div>
  );
}
