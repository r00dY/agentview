import { useRouteLoaderData, useLoaderData, useParams, Link, Outlet } from "react-router";
import type { Route } from "./+types/api-keys";
import { Header, HeaderTitle } from "@agentview/studio/components/header";
import { Button } from "@agentview/studio/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@agentview/studio/components/ui/alert";
import { AlertCircleIcon, Plus } from "lucide-react";
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
import { authClient } from "~/authClient";
import type { clientLoader as orgLayoutLoader } from "./layout";

export async function clientLoader({ params }: Route.LoaderArgs) {
  const response = await queryClient.fetchQuery({
    queryKey: queryKeys.apiKeys(),
    queryFn: () => authClient.apiKey.list(),
  });

  if (response.error) {
    return { apiKeys: [] };
  }

  const apiKeys = response.data.filter(
    (apiKey) => apiKey.metadata?.organizationId === params.orgId
  );

  return { apiKeys };
}

export default function ApiKeys() {
  const layoutData = useRouteLoaderData<typeof orgLayoutLoader>("routes/app/org/layout");
  const { apiKeys } = useLoaderData<typeof clientLoader>();
  const { orgId } = useParams();

  const me = layoutData?.me;

  // Only admin/owner can access this page
  if (me && me.role !== "admin" && me.role !== "owner") {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircleIcon className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>You don't have permission to manage API keys.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <Header>
        <HeaderTitle title="API Keys" />
      </Header>

      <div className="p-6 max-w-6xl">
        <h3 className="text-sm font-medium mb-2">.env</h3>
        <div className="mb-6 p-4 border rounded-md bg-muted/50">
          <pre className="text-sm text-foreground font-mono">
{`VITE_AGENTVIEW_ORGANIZATION_ID=${orgId}
AGENTVIEW_API_KEY=sk_...`}
          </pre>
        </div>

        <div className="flex justify-end mb-3">
          <Button asChild size="sm">
            <Link to={`/orgs/${orgId}/api-keys/new`}>
              <Plus className="w-4 h-4" />
              Create API Key
            </Link>
          </Button>
        </div>

        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No API keys yet. Create one to get started.
                  </TableCell>
                </TableRow>
              ) : (
                apiKeys.map((apiKey) => (
                  <TableRow key={apiKey.id}>
                    <TableCell>
                      <div className="font-medium">{apiKey.name || "Unnamed"}</div>
                    </TableCell>
                    <TableCell>
                      {apiKey.start?.startsWith("sk_") ? (
                        <Badge>Secret</Badge>
                      ) : (
                        <Badge variant="secondary">Public</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <code className="text-sm text-muted-foreground">
                        {apiKey.start}...
                      </code>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {new Date(apiKey.createdAt).toLocaleDateString()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="xs">
                        <Link to={`/orgs/${orgId}/api-keys/${apiKey.id}/delete`}>
                          Delete
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
