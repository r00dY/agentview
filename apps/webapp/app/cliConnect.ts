// Shared helpers for the CLI connect flow (the /cli resolver, the embedded
// /orgs/:orgId/cli page, and the signup/login banners).

// The AgentView CLI hands us a loopback callback URL to POST credentials to.
// Only ever hand freshly-minted credentials back to the local machine — never
// to an arbitrary origin (a crafted /cli?origin=… link must not exfiltrate keys).
function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:") return false;
    const host = u.hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

export type CliCallback =
  | { ok: true; origin: string; state: string }
  | { ok: false; error: string };

/**
 * Parse and validate the loopback callback params the CLI passes to /cli
 * (`?origin=…&state=…`). Returns the validated origin + state, or an error
 * message to render.
 */
export function parseCliCallback(request: Request): CliCallback {
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

/** True when a post-auth `redirect` target points at the CLI connect flow. */
export function isCliConnectRedirect(redirect: string | null | undefined): boolean {
  return (redirect ?? "").startsWith("/cli");
}
