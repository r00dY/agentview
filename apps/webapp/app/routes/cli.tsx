import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/cli";
import { Card, CardContent, CardHeader, CardTitle } from "@agentview/studio/components/ui/card";
import { Alert, AlertDescription } from "@agentview/studio/components/ui/alert";
import { CardPageLayout } from "@agentview/studio/components/CardPageLayout";
import { AlertCircleIcon, Loader2 } from "lucide-react";
import { authClient } from "~/authClient";
import { parseCliCallback } from "~/cliConnect";

// Entry point the CLI opens (`/cli?origin=…&state=…`). It doesn't know the org
// yet, so this route stays a thin resolver: validate the callback, send
// logged-out users to signup, resolve the active org, then hand off to the
// embedded, sidebar-wrapped connect page at /orgs/:orgId/cli — so the user
// always lands inside the familiar admin shell, never on a detached screen.
type LoaderError = { ok: false; error: string };

export async function clientLoader({ request }: Route.LoaderArgs): Promise<LoaderError | Response> {
  const url = new URL(request.url);
  const parsed = parseCliCallback(request);
  if (!parsed.ok) return parsed;

  const sessionResponse = await authClient.getSession();
  if (!sessionResponse.data) {
    // New users land on signup first (login is one click away), returning here afterwards.
    const dest = url.pathname + url.search; // /cli?origin=…&state=…
    return redirect(`/signup?redirect=${encodeURIComponent(dest)}`);
  }

  const orgsResponse = await authClient.organization.list();
  if (orgsResponse.error || !orgsResponse.data || orgsResponse.data.length === 0) {
    return { ok: false, error: orgsResponse.error?.message ?? "You don't belong to any organization yet." };
  }
  const orgs = orgsResponse.data;

  // Resolve the active org the same way the dashboard does.
  const activeId = window.localStorage.getItem("activeOrganizationId");
  const active = orgs.find((o) => o.id === activeId) ?? orgs[0];
  const query = `?origin=${encodeURIComponent(parsed.origin)}&state=${encodeURIComponent(parsed.state)}`;
  return redirect(`/orgs/${active.id}/cli${query}`);
}

export default function CliResolverPage() {
  const loaderData = useLoaderData<typeof clientLoader>();

  return (
    <CardPageLayout variant="poweredBy">
      <Card>
        <CardHeader>
          <CardTitle className="text-center">Connect AgentView CLI</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center">
          {loaderData?.ok === false ? (
            <Alert variant="destructive">
              <AlertCircleIcon className="h-4 w-4" />
              <AlertDescription>{loaderData.error}</AlertDescription>
            </Alert>
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </CardContent>
      </Card>
    </CardPageLayout>
  );
}
