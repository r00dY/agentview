export interface CloudflareTunnel {
  url: string;
  stop: () => Promise<void>;
}

/**
 * Start a Cloudflare Quick Tunnel pointing at a local port.
 *
 * Uses `untun` (wraps the `cloudflared` binary, downloading it on first use).
 * `acceptCloudflareNotice: true` — we consider running `agentview dev` as
 * agreeing to auto-download the binary.
 */
export async function startCloudflareTunnel(localPort: number): Promise<CloudflareTunnel> {
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

  const url = await tunnel.getURL();
  if (!url) {
    await tunnel.close();
    throw new Error("Cloudflare tunnel did not return a URL.");
  }

  return {
    url,
    stop: () => tunnel.close(),
  };
}
