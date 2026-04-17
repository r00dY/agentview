import { useLoaderData, useParams, Link, Outlet, useRouteLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/channels";
import type { Channel } from "agentview";
import { Header, HeaderTitle } from "@agentview/studio/components/header";
import { Button } from "@agentview/studio/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@agentview/studio/components/ui/alert";
import { AlertCircleIcon, Plus, MailIcon, CheckCircleIcon } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@agentview/studio/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agentview/studio/components/ui/dropdown-menu";
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
  const [searchParams, setSearchParams] = useSearchParams();

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
        {searchParams.get('gmail') === 'success' && (
          <Alert className="mb-4">
            <CheckCircleIcon className="h-4 w-4" />
            <AlertTitle>Gmail Connected</AlertTitle>
            <AlertDescription>
              Your Gmail account has been connected successfully.{' '}
              <button className="underline" onClick={() => { const sp = new URLSearchParams(searchParams); sp.delete('gmail'); setSearchParams(sp); }}>
                Dismiss
              </button>
            </AlertDescription>
          </Alert>
        )}

        {searchParams.get('gmail') === 'error' && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircleIcon className="h-4 w-4" />
            <AlertTitle>Gmail Connection Failed</AlertTitle>
            <AlertDescription>
              {searchParams.get('message') || 'Something went wrong.'}{' '}
              <button className="underline" onClick={() => { const sp = new URLSearchParams(searchParams); sp.delete('gmail'); sp.delete('message'); setSearchParams(sp); }}>
                Dismiss
              </button>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end mb-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Plus className="w-4 h-4" />
                Add Channel
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/orgs/${orgId}/channels/gmail/new`}>
                  <MailIcon className="w-4 h-4 mr-2" />
                  Gmail
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Environment</TableHead>
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
                          {channel.environment.user ? `local:${channel.environment.user.email}` : 'prod'}
                        </span>
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
