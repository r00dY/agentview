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
import { listApiKeyPairs, type ApiKeyPair } from "~/apiKeyPairs";
import { apiRequest } from "~/apiClient";
import type { clientLoader as orgLayoutLoader } from "./layout";

// The logged-in user's local (dev) environment is the one whose `user` is them
// (production environments have a null user).
type EnvironmentRecord = { id: string; handle: string; user: { id: string } | null };

export async function clientLoader({ params }: Route.LoaderArgs) {
  const [pairs, environments] = await Promise.all([
    queryClient.fetchQuery({
      queryKey: queryKeys.apiKeys(),
      queryFn: () => listApiKeyPairs(params.orgId),
    }),
    queryClient.fetchQuery({
      queryKey: queryKeys.environments(params.orgId),
      queryFn: () => apiRequest<EnvironmentRecord[]>(params.orgId, "GET", "/api/environments"),
    }),
  ]);

  return {
    pairs: pairs.error ? [] : (pairs.data ?? []),
    environments,
  };
}

function KeyCell({ keyRecord }: { keyRecord: ApiKeyPair["secret"] }) {
  if (!keyRecord) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <code className="text-sm text-muted-foreground">{keyRecord.start}...</code>
  );
}

export default function ApiKeys() {
  const layoutData = useRouteLoaderData<typeof orgLayoutLoader>("routes/app/org/layout");
  const { pairs, environments } = useLoaderData<typeof clientLoader>();
  const { orgId } = useParams();

  const me = layoutData?.me;
  const userEnv = environments.find((e) => e.user?.id === me?.id);
  const envHandle = userEnv?.handle ?? "local-...";

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
{`# Example for Next.js + local environment
AGENTVIEW_API_KEY=sk_...
NEXT_PUBLIC_AGENTVIEW_API_KEY=pk_...
NEXT_PUBLIC_AGENTVIEW_ENV=${envHandle}`}
          </pre>
        </div>

        <div className="flex justify-end mb-3">
          <Button asChild size="sm">
            <Link to={`/orgs/${orgId}/api-keys/new`}>
              <Plus className="w-4 h-4" />
              Create API Key Pair
            </Link>
          </Button>
        </div>

        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>
                Public Key
                </TableHead>
                <TableHead>
                  Secret Key
                </TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pairs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No API key pairs yet. Create one to get started.
                  </TableCell>
                </TableRow>
              ) : (
                pairs.map((pair) => (
                  <TableRow key={pair.pairId}>
                    <TableCell>
                      <div className="font-medium">{pair.name || "Unnamed"}</div>
                    </TableCell>
                    <TableCell>
                      <KeyCell keyRecord={pair.publicKey} />
                    </TableCell>
                    <TableCell>
                      <KeyCell keyRecord={pair.secret} />
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {new Date(pair.createdAt).toLocaleDateString()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="xs">
                        <Link to={`/orgs/${orgId}/api-keys/${pair.pairId}/delete`}>
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
