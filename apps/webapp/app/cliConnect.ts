// The AgentView CLI hands us a loopback callback URL to POST credentials to.
// Only ever hand freshly-minted credentials back to the local machine — never
// to an arbitrary origin (a crafted /cli?origin=… link must not exfiltrate keys).
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:") return false;
    const host = u.hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}
