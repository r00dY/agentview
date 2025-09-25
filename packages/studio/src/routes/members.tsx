import { useLoaderData, useFetcher, Outlet, Link, data } from "react-router";
import type { RouteObject } from "react-router";
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
import { Badge } from "~/components/ui/badge";
import { Header, HeaderTitle } from "~/components/header";
import { authClient } from "~/lib/auth-client";
import { apiFetch } from "~/lib/apiFetch";


async function loader() {
  const usersResponse = await authClient.admin.listUsers({
    query: {
      limit: 100,
    },
  });

  if (usersResponse.error) {
    throw data(usersResponse.error.message, {
      status: 400,
    });
  }
  
  const invitationsResponse = await apiFetch(`/api/invitations`);

  if (!invitationsResponse.ok) {
    throw data({
      message: 'Failed to fetch invitations',
    }, {
      status: invitationsResponse.status,
    });
  }

  return { users: usersResponse.data.users, invitations: invitationsResponse.data as any[] };
}


function Component() {
  const { users, invitations } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  return <div>

    <Header>
      <HeaderTitle title="Members" />
    </Header>

    <div className="p-6 max-w-6xl">
      
      <div className="mb-8">
        <div className="flex justify-end mb-3">

        <Button asChild size="sm">
          <Link to="invitations/new">
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
                      const isExpired = invitation.status === 'pending' && invitation.expiresAt && new Date(invitation.expiresAt) < new Date();

                      if (isExpired) {
                        return <Badge variant="destructive">Invite expired</Badge>
                      } else {
                        return <Badge variant="secondary">Invite pending</Badge>
                      }
                      
                    })()}

                </TableCell>
                <TableCell>
                    <fetcher.Form method="delete" action={`/members/invitations/${invitation.id}/cancel`}>
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

export const membersRoute: RouteObject = {
  Component,
  loader,
}
