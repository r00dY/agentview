import { redirect, useLoaderData, useFetcher, Outlet, Link } from "react-router";
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
import { Plus, Trash2 } from "lucide-react";
import { APIError } from "better-auth/api";
import { cancelInvitation, createInvitation, getPendingInvitations } from "../../lib/invitations";

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

  const invitations = await getPendingInvitations()

  return { users: users.users, invitations };
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

        try {
          await createInvitation(email, role, session.user.id)
          return {
            status: "success"
          }
        } catch (error) {
          if (error instanceof Error) {
            return {
              status: "error",
              error: error.message,
            }
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



      case "cancelInvite": {
        const invitationId = formData.get("invitationId") as string;

        try {
          await cancelInvitation(invitationId)
        }
        catch (error) {
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



export default function MembersPage() {
  const { users, invitations } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Organization Members</h1>

        
        <Button asChild>
          <Link to="invite">
            <Plus className="w-4 h-4" />
            Invite Member
          </Link>
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
                  <div className="flex gap-2">
                    <Button asChild variant="outline" size="xs">
                      <Link to={`/members/${row.id}/edit`}>
                        Edit
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="xs">
                      <Link to={`/members/${row.id}/delete`}>
                        Remove
                      </Link>
                    </Button>
                  </div>
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
                        variant="outline" 
                        size="xs"
                        disabled={fetcher.state !== "idle"}
                      >
                        Remove
                      </Button>
                    </fetcher.Form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      
      <Outlet />
    </div>
  );
}
