import { useState } from "react";
import { useLoaderData, useLocation, useNavigate, useParams, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/cli";
import { Header, HeaderTitle } from "@agentview/studio/components/header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@agentview/studio/components/ui/card";
import { Button } from "@agentview/studio/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@agentview/studio/components/ui/alert";
import { Label } from "@agentview/studio/components/ui/label";
import { AlertCircleIcon, CheckCircle2, Loader2, Terminal } from "lucide-react";
import { createApiKeyPair } from "~/apiKeyPairs";
import { apiRequest } from "~/apiClient";
import { isLoopbackOrigin } from "~/cliConnect";
import type { clientLoader as orgLayoutLoader } from "./layout";

// The logged-in user's local (dev) environment is the one whose `user` is them
// (production environments have a null user) — same rule as the API Keys page.
type EnvironmentRecord = { id: string; handle: string; user: { id: string } | null };

type LoaderResult =
  | { ok: true; origin: string; state: string }
  | { ok: false; error: string };

export async function clientLoader({ request }: Route.LoaderArgs): Promise<LoaderResult> {
  const url = new URL(request.url);
  const origin = url.searchParams.get("origin");
  const state = url.searchParams.get("state");

  if (!origin || !state) {
    return { ok: false, error: "This link is missing required parameters. Re-run the AgentView CLI to get a fresh link." };
  }
  if (!isLoopbackOrigin(origin)) {
    return { ok: false, error: "Invalid callback target. The AgentView CLI must run on your local machine." };
  }
  return { ok: true, origin, state };
}

export default function OrgCliConnect() {
  const loaderData = useLoaderData<typeof clientLoader>();
  const layoutData = useRouteLoaderData<typeof orgLayoutLoader>("routes/app/org/layout");
  const { orgId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const me = layoutData?.me;
  const organizations = layoutData?.organizations ?? [];

  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [connectedEnv, setConnectedEnv] = useState("");

  // Switching org navigates to that org's connect page (preserving origin/state),
  // so the panel and the sidebar always agree on which org is active.
  function handleOrgChange(newOrgId: string) {
    navigate(`/orgs/${newOrgId}/cli${location.search}`);
  }

  async function handleConnect() {
    if (!loaderData.ok || !orgId) return;
    setStatus("connecting");
    setErrorMsg(null);

    // 1. Create the API key pair under the user's session.
    const pair = await createApiKeyPair(orgId, "AgentView CLI");
    if (pair.error || !pair.data) {
      setErrorMsg(pair.error?.message ?? "Failed to create API keys. Creating keys requires an admin or owner role.");
      setStatus("error");
      return;
    }

    // 2. Resolve the user's local environment handle.
    let envHandle = "";
    try {
      const environments = await apiRequest<EnvironmentRecord[]>(orgId, "GET", "/api/environments");
      envHandle = environments.find((e) => e.user?.id === me?.id)?.handle ?? "";
    } catch {
      // Non-fatal — proceed without an env handle.
    }

    // 3. Hand the credentials back to the waiting CLI over loopback.
    try {
      const res = await fetch(loaderData.origin, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: loaderData.state,
          publicKey: pair.data.publicKey.key,
          secretKey: pair.data.secret.key,
          env: envHandle,
          orgName: layoutData?.organization.name ?? "",
        }),
      });
      if (!res.ok) throw new Error("callback rejected");
    } catch {
      setErrorMsg("Couldn't reach the AgentView CLI. Make sure it's still running in your terminal, then try again.");
      setStatus("error");
      return;
    }

    setConnectedEnv(envHandle);
    setStatus("connected");
  }

  return (
    <div>
      <Header>
        <HeaderTitle title="Connect CLI" />
      </Header>

      <div className="p-6 max-w-2xl">
        {!loaderData.ok ? (
          <Alert variant="destructive">
            <AlertCircleIcon className="h-4 w-4" />
            <AlertDescription>{loaderData.error}</AlertDescription>
          </Alert>
        ) : status === "connected" ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                You're all set
              </CardTitle>
              <CardDescription>
                Return to your terminal — the AgentView CLI is now connected
                {connectedEnv ? <> to <span className="font-medium text-foreground">{connectedEnv}</span></> : null}. You can close this tab.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                Connect AgentView CLI
              </CardTitle>
              <CardDescription>
                This creates an API key pair so the CLI running in your terminal can access this organization's environment.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {status === "error" && errorMsg && (
                <Alert variant="destructive">
                  <AlertCircleIcon className="h-4 w-4" />
                  <AlertTitle>Connection failed</AlertTitle>
                  <AlertDescription>{errorMsg}</AlertDescription>
                </Alert>
              )}

              {organizations.length > 1 && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="org" className="text-sm font-medium">Organization</Label>
                  <select
                    id="org"
                    className="border rounded-md h-9 px-3 text-sm bg-background"
                    value={orgId}
                    onChange={(e) => handleOrgChange(e.target.value)}
                  >
                    {organizations.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <Button onClick={handleConnect} disabled={status === "connecting"}>
                  {status === "connecting" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Connecting…
                    </>
                  ) : (
                    "Connect"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
