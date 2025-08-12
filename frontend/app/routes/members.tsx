import { redirect, useLoaderData, useFetcher, Outlet, Link, data } from "react-router";
import type { Route } from "./+types/members";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "~/components/ui/table";
import { Button } from "~/components/ui/button";
import { Plus } from "lucide-react";
import { cancelInvitation, getPendingInvitations } from "~/.server/invitations";
import { Badge } from "~/components/ui/badge";
import { Header, HeaderTitle } from "~/components/header";
import { authClient } from "~/lib/auth-client";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const response = await authClient.admin.listUsers({
    query: {
      limit: 100,
    },
  });

  if (response.error) {
    throw data(response.error.message, {
      status: 400,
    });
  }
  

  const invitations = await getPendingInvitations()

  return { users: response.data.users, invitations };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const session = await authClient.getSession();
  if (session.error || !session.data) return redirect("/login");

  const formData = await request.formData();
  const _action = formData.get("_action");

  if (session.data.user.role !== "admin") {
    return {
      status: "error",
      error: {
        message: "Not authorized.",
      }
    }
  }

  try {
    switch (_action) {
      // case "inviteMember": {
      //   const email = formData.get("email") as string;
      //   const role = formData.get("role") as Role;

      //   try {
      //     await createInvitation(email, role, session.user.id)
      //     return {
      //       status: "success"
      //     }
      //   } catch (error) {
      //     if (error instanceof Error) {
      //       return {
      //         status: "error",
      //         error: error.message,
      //       }
      //     }
      //   }
      // }

      // case "updateRole": {
      //   const userId = formData.get("userId") as string;
      //   const role = formData.get("role") as Role;

      //     try {
      //       await auth.api.setRole({
      //         headers: request.headers,
      //         body: { userId, role },
      //       });

      //       return {
      //         status: "success"
      //       }
            
      //     } catch (error) {
      //       if (error instanceof APIError) {
      //         return {
      //           status: "error",
      //           error: error.message,
      //         }
      //       }
      //       return {
      //         status: "error",
      //         error: "Unexpected error",
      //       }
      //     }
      // }



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
  const { users, invitations } = useLoaderData<typeof clientLoader>();
  const fetcher = useFetcher();

  return <div>

    <Header>
      <HeaderTitle title="Members" />
    </Header>

    <div className="p-6 max-w-6xl">
      
      {/* Members Table */}
      <div className="mb-8">
        <div className="flex justify-end mb-3">

        <Button asChild size="sm">
          <Link to="invite">
            <Plus className="w-4 h-4" />
            Invite Member
          </Link>
        </Button>
        </div>

        <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>

          {invitations.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell >
                  
                  <div className="flex flex-col min-h-[50px] justify-center">
                  <div className="font-medium">{invitation.email}</div>
                  </div>
                  
                </TableCell>
                <TableCell>{invitation.role}</TableCell>
                <TableCell>
                {(() => {
                      const isExpired = invitation.status === 'pending' && invitation.expires_at && new Date(invitation.expires_at) < new Date();

                      if (isExpired) {
                        return <Badge variant="destructive">Invite expired</Badge>
                      } else {
                        return <Badge variant="secondary">Invite pending</Badge>
                      }
                      
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
                        Cancel invite
                      </Button>
                    </fetcher.Form>
                </TableCell>
              </TableRow>
            ))}

            {users.map((row) => (
              <TableRow key={row.id}>
                <TableCell><div className="flex flex-col justify-center min-h-[50px] ">
                  <div className="font-medium">{row.name}</div>
                  <div className="text-sm text-muted-foreground">{row.email}</div>
                  </div></TableCell>
                <TableCell>{row.role}</TableCell>
                <TableCell><Badge>Active</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-2">

                  <Button asChild variant="outline" size="xs">
                      <Link to={`/members/${row.id}/delete`}>
                        Remove
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="xs">
                      <Link to={`/members/${row.id}/edit`}>
                        Edit
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      </div>

      
      <Outlet />
    </div>
  </div>
}
