import { useLoaderData, useParams, Link, Outlet, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/channels";
import type { Channel } from "agentview";
import { Header, HeaderTitle } from "@agentview/studio/components/header";
import { Button } from "@agentview/studio/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@agentview/studio/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@agentview/studio/components/ui/table";
import { Badge } from "@agentview/studio/components/ui/badge";
import { queryClient } from "~/queryClient";
import { queryKeys } from "~/queryKeys";
import { apiRequest } from "~/apiClient";
import type { clientLoader as orgLayoutLoader } from "./layout";

export async function clientLoader({ params }: Route.LoaderArgs) {
  const channels = await queryClient.fetchQuery({
    queryKey: queryKeys.channels(params.orgId),
    queryFn: () => apiRequest<Channel[]>(params.orgId, 'GET', '/api/channels'),
  });

  return { channels };
}

export default function Channels() {
  const layoutData = useRouteLoaderData<typeof orgLayoutLoader>("routes/app/org/layout");
  const { channels } = useLoaderData<typeof clientLoader>();
  const { orgId } = useParams();

  const me = layoutData?.me;

  if (me && me.role !== "admin" && me.role !== "owner") {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircleIcon className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>You don't have permission to manage channels.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <Header>
        <HeaderTitle title="Channels" />
      </Header>

      <div className="p-6 max-w-6xl">
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No channels yet. Connect a channel (e.g. Gmail) to get started.
                  </TableCell>
                </TableRow>
              ) : (
                channels.map((channel) => (
                  <TableRow key={channel.id}>
                    <TableCell>
                      <div className="flex flex-col justify-center min-h-[40px]">
                        <div className="font-medium">{channel.name || channel.address}</div>
                        {channel.name && (
                          <div className="text-sm text-muted-foreground">{channel.address}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{channel.type}</Badge>
                    </TableCell>
                    <TableCell>
                      {channel.environment ? (
                        <span className="text-sm">
                          {channel.environment.user ? `dev:${channel.environment.user.email}` : 'prod'}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">Not configured</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {channel.agent ? (
                        <span className="text-sm">{channel.agent}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">Not configured</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {new Date(channel.createdAt).toLocaleDateString()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="xs">
                        <Link to={`/orgs/${orgId}/channels/${channel.id}/edit`}>
                          Edit
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Outlet />
    </div>
  );
}
