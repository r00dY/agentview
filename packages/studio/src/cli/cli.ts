#!/usr/bin/env node
import 'dotenv/config'

// Silence untun's consola output before any module that pulls it in is loaded.
process.env.CONSOLA_LEVEL ??= "-999";

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";

import { type AgentViewConfig } from "../types";
import { createStandardClient, StandardAgentViewClient } from "agentview/clientStandard";
import { updateEnvironment } from "agentview/updateEnvironment";
import { AgentViewError } from "agentview";
import { startProxyServer, type ProxyServer } from "./proxyServer.js";
import { startCloudflareTunnel, type CloudflareTunnel } from "./tunnel.js";
import { toBaseConfig } from '../toBaseConfig.js';

const DEFAULT_CONFIG_FILES = [
  "agentview.config.ts",
  "agentview.config.tsx",
  "agentview.config.js",
  "agentview.config.jsx"
];

const useColor =
  !process.env.NO_COLOR &&
  (!!process.env.FORCE_COLOR || !!process.stdout.isTTY);
const ansi = {
  reset: useColor ? "\x1b[0m" : "",
  red: useColor ? "\x1b[31m" : "",
  green: useColor ? "\x1b[32m" : "",
  yellow: useColor ? "\x1b[33m" : "",
  dim: useColor ? "\x1b[2m" : "",
  bold: useColor ? "\x1b[1m" : "",
};

const marker = {
  info: `${ansi.dim}→${ansi.reset}`,
  success: `${ansi.green}✓${ansi.reset}`,
  warn: `${ansi.yellow}⚠${ansi.reset}`,
  error: `${ansi.red}✗${ansi.reset}`,
};

const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
    );
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

function printBanner(lines: Array<[label: string, value: string]>) {
  console.log();
  console.log(`   ${ansi.bold}AgentView${ansi.reset} ${ansi.dim}${VERSION}${ansi.reset}`);
  for (const [label, value] of lines) {
    console.log(`   ${ansi.dim}- ${label}:${ansi.reset} ${value}`);
  }
  console.log();
}

function log(message: string) {
  console.log(`${marker.info} ${message}`);
}

function logSuccess(message: string) {
  console.log(`${marker.success} ${message}`);
}

function logWarn(message: string) {
  console.log(`${marker.warn} ${message}`);
}

function logError(message: string) {
  console.error(`${marker.error} ${ansi.red}${message}${ansi.reset}`);
}

function timestamp(): string {
  const d = new Date();
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${ansi.dim}${h}:${m}:${s}${ansi.reset}`;
}

function handleError(error: unknown): never {
  if (error instanceof AgentViewError) {
    logError(`${error.message} (${error.statusCode})`);
    if (error.details) console.error(error.details);
  } else {
    logError((error as Error).message ?? String(error));
  }
  process.exit(1);
}

let client: StandardAgentViewClient;
let currentEnv: string | undefined;
let currentOrg: { name: string; slug: string | null } | undefined;
let verbose = false;
let configPathFromArg: string | undefined; // config path from command (usually undefined)

export async function runCli() {
  const program = new Command();

  program
    .name("agentview")
    .description("AgentView CLI")
    // .option("-c, --config <path>", "Path to agentview config file")
    .option("--api-key <key>", "AgentView API key (overrides AGENTVIEW_API_KEY env var)")
    .option("--env <env>", "Environment name (overrides env from config)")
    .option("-v, --verbose", "Show implementation details (proxy URL, tunnel URL)")
    .hook('preAction', async (thisCommand, actionCommand) => {
      const opts = thisCommand.opts();
      const apiKey = opts.apiKey ?? getAPIKey();
      const env = opts.env ?? (await loadConfig()).env;
      currentEnv = env;
      verbose = !!opts.verbose;

      // For now, no custom config paths.
      // configPathFromArg = opts.config; // required to resolve path later

      client = createStandardClient({ apiKey, env });
      currentOrg = await client.organization.get();

      // env command prints its own extended banner
      if (actionCommand.name() === 'env') return;

      printBanner([
        ["Organization", currentOrg.name],
        ["Environment", env],
      ]);
    });


  program
    .command("dev")
    .description("Start the proxy server and watch the config file")
    .action(async () => {
      await runProxyServer(client);
      await watchConfig();
    });

  const configCmd = program
    .command("config")
    .description("Manage config");

  configCmd
    .command("push")
    .description("Send the config file to the AgentView server once")
    .action(async () => {
      await pushConfig();
    });

  configCmd
    .command("watch")
    .description("Watch the config file and sync on every change")
    .action(async () => {
      await watchConfig();
    });

  const proxyCmd = program
    .command("proxy")
    .description("Manage proxy");

  proxyCmd
    .command("start")
    .description("Start the proxy server and Cloudflare tunnel")
    .action(async () => {
      await runProxyServer(client);
    });

  program
    .command("env")
    .description("Show current environment details")
    .action(async () => {
      const environment = await client.environments.getActive();
      const slug = currentOrg!.slug ?? "[org-slug]";
      printBanner([
        ["Organization", currentOrg!.name],
        ["Environment", currentEnv!],
        ["E-mail", `${slug}.${environment.handle}.[agent-name]@agent.agentview.app`],
        ["Tunnel URL", environment.tunnelUrl ?? `${ansi.dim}(not set)${ansi.reset}`],
      ]);
    });

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    handleError(error);
  }
}

function resolveConfigPath(explicitPath?: string): string {
  if (explicitPath) {
    const resolvedPath = path.resolve(process.cwd(), explicitPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Config file not found at ${explicitPath}`);
    }
    return resolvedPath;
  }

  for (const candidate of DEFAULT_CONFIG_FILES) {
    const candidatePath = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error(
    `Could not find config file. Looked for: ${DEFAULT_CONFIG_FILES.join(
      ", ",
    )}. Try --config <path>.`,
  );
}

async function loadConfig(): Promise<AgentViewConfig> {
  const configPath = resolveConfigPath(configPathFromArg);
  const absolutePath = path.resolve(configPath);
  const fileUrl = pathToFileURL(absolutePath).href;

  // Append ?t=<timestamp> to bust Node's ESM module cache on re-imports.
  // This works because tsx's global loaders (registered in agentview.mjs)
  // match .tsx?... via regex, so the file is still transformed correctly.
  const moduleExports: any = await import(fileUrl + '?t=' + Date.now());

  const config =
    moduleExports?.default ??
    moduleExports?.config ??
    moduleExports?.agentviewConfig ??
    moduleExports;

  if (!config || typeof config !== "object") {
    throw new Error(`No config export found in ${configPath}`);
  }

  return config as AgentViewConfig;
}

function getAPIKey(): string {
  const apiKey = process.env.AGENTVIEW_API_KEY;
  if (!apiKey) {
    throw new Error("You must set AGENTVIEW_API_KEY env var.");
  }
  return apiKey;
}

const TUNNEL_HEALTH_CHECK_INTERVAL_MS = 30_000;
const TUNNEL_HEALTH_CHECK_TIMEOUT_MS = 5_000;

async function checkTunnelHealth(tunnelUrl: string): Promise<boolean> {
  // The proxy responds with 400 (missing X-Target-Url) for any direct GET.
  // If the tunnel is dead, Cloudflare returns a 5xx error page or the
  // request fails entirely (DNS / network error / timeout).
  try {
    const res = await fetch(tunnelUrl, {
      method: "GET",
      signal: AbortSignal.timeout(TUNNEL_HEALTH_CHECK_TIMEOUT_MS),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function runProxyServer(client: StandardAgentViewClient) {
  let proxy: ProxyServer | null = null;
  let tunnel: CloudflareTunnel | null = null;
  let healthTimer: NodeJS.Timeout | null = null;
  let regenerating = false;
  let cleanedUp = false;

  const cleanup = async (exitCode: number) => {
    if (cleanedUp) return;
    cleanedUp = true;

    if (healthTimer) clearInterval(healthTimer);

    try {
      await Promise.race([
        updateEnvironment(client, { tunnelUrl: null }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("tunnel-unregister timeout")), 5000),
        ),
      ]);
    } catch {
      // best-effort
    }

    if (tunnel) {
      try { await tunnel.stop(); } catch { /* best-effort */ }
    }

    if (proxy) {
      try { await proxy.close(); } catch { /* best-effort */ }
    }

    process.exit(exitCode);
  };

  process.on("SIGINT", () => { void cleanup(0); });
  process.on("SIGTERM", () => { void cleanup(0); });

  log(`Starting...`);

  proxy = await startProxyServer();
  if (verbose) log(`Proxy URL: ${ansi.dim}http://127.0.0.1:${proxy.port}${ansi.reset}`);

  tunnel = await startCloudflareTunnel(proxy.port);
  await updateEnvironment(client, { tunnelUrl: tunnel.url });
  if (verbose) log(`Tunnel URL: ${ansi.dim}${tunnel.url}${ansi.reset}`);
  logSuccess(`Ready`);

  healthTimer = setInterval(() => {
    void regenerateIfUnhealthy();
  }, TUNNEL_HEALTH_CHECK_INTERVAL_MS);

  async function regenerateIfUnhealthy() {
    if (regenerating || cleanedUp || !tunnel) return;

    const healthy = await checkTunnelHealth(tunnel.url);
    if (healthy) return;

    regenerating = true;
    logWarn(`Connection lost, reconnecting... ${timestamp()}`);
    const oldTunnel = tunnel;
    tunnel = null;
    try { await oldTunnel.stop(); } catch { /* best-effort */ }

    try {
      tunnel = await startCloudflareTunnel(proxy!.port);
      await updateEnvironment(client, { tunnelUrl: tunnel.url });
      if (verbose) log(`Tunnel URL: ${ansi.dim}${tunnel.url}${ansi.reset}`);
      logSuccess(`Reconnected ${timestamp()}`);
    } catch (e) {
      logError(`Reconnect failed: ${(e as Error).message} ${timestamp()}`);
    } finally {
      regenerating = false;
    }
  }
}

async function pushConfig() {
  const config = await loadConfig();

  try {
    await updateEnvironment(client, { config: toBaseConfig(config) });
    logSuccess(`Config updated ${timestamp()}`);
  } catch (e) {
    logError(`Config update failed: ${(e as Error).message} ${timestamp()}`);
    const cause = (e as any)?.details?.cause;
    if (cause) console.error(JSON.stringify(cause, null, 2));
    throw e;
  }
}

async function watchConfig() {
  // Push once on startup
  try { await pushConfig(); } catch { /* logged inside pushConfig */ }

  let debounceTimer: NodeJS.Timeout | null = null;
  fs.watch(process.cwd(), { recursive: true }, (_event, filename) => {
    if (!filename) return;
    if (filename.includes("node_modules")) return;
    if (!/\.(ts|tsx|js|jsx)$/.test(filename)) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try { await pushConfig(); } catch { /* logged inside pushConfig */ }
    }, 300);
  });
}
