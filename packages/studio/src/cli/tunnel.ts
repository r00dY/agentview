export interface CloudflareTunnel {
  url: string;
  stop: () => Promise<void>;
}

const TUNNEL_URL_TIMEOUT_MS = 30_000;

export interface StartTunnelOptions {
  verbose?: boolean;
}

/**
 * Start a Cloudflare Quick Tunnel pointing at a local port.
 *
 * Uses `untun` (wraps the `cloudflared` binary, downloading it on first use).
 * `acceptCloudflareNotice: true` — we consider running `agentview dev` as
 * agreeing to auto-download the binary.
 */
export async function startCloudflareTunnel(
  localPort: number,
  options: StartTunnelOptions = {},
): Promise<CloudflareTunnel> {
  // untun pipes cloudflared's stdout/stderr to our process only when DEBUG
  // is set (see node_modules/untun/.../chunks/index.mjs). Flip it on for
  // verbose so users can see why a tunnel is wedged.
  if (options.verbose) process.env.DEBUG ||= "1";

  const { startTunnel } = await import("untun");

  const tunnel = await startTunnel({
    port: localPort,
    acceptCloudflareNotice: true,
  });

  if (!tunnel) {
    throw new Error(
      "Failed to start Cloudflare tunnel. You can retry or set UNTUN_ACCEPT_CLOUDFLARE_NOTICE=1.",
    );
  }

  // untun's getURL() resolves when cloudflared prints the tunnel URL to
  // stdout. If cloudflared hangs (rate-limited, network blocked, bad
  // binary) it never resolves. Bound it so we fail fast with a message
  // the user can act on instead of looking at a stuck "Starting..." line.
  let timer: NodeJS.Timeout | null = null;
  let url: string | undefined;
  try {
    url = await Promise.race([
      tunnel.getURL(),
      new Promise<string>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`cloudflared did not emit a tunnel URL within ${TUNNEL_URL_TIMEOUT_MS / 1000}s`)),
          TUNNEL_URL_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (e) {
    await tunnel.close().catch(() => {});
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!url) {
    await tunnel.close().catch(() => {});
    throw new Error("Cloudflare tunnel did not return a URL.");
  }

  return {
    url,
    stop: () => tunnel.close(),
  };
}
