#!/usr/bin/env node
import 'dotenv/config'

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";

import { type AgentViewConfig } from "../types";
import { createStandardClient, StandardAgentViewClient } from "agentview/clientStandard";
import { updateEnvironment } from "agentview/updateEnvironment";
import { AgentViewError } from "agentview";
import { startStudioServer } from "./studioServer.js";
import { startProxyServer, PROXY_PORT, type ProxyServer } from "./proxyServer.js";
import { startCloudflareTunnel, type CloudflareTunnel } from "./tunnel.js";
import { toBaseConfig } from '../toBaseConfig.js';

const DEFAULT_CONFIG_FILES = [
  "agentview.config.ts",
  "agentview.config.tsx",
  "agentview.config.js",
  "agentview.config.jsx"
];

function handleError(error: unknown): never {
  if (error instanceof AgentViewError) {
    console.error(`Error (${error.statusCode}): ${error.message}`);
    if (error.details) console.error(error.details);
  } else {
    console.error((error as Error).message ?? error);
  }
  process.exit(1);
}

let client : StandardAgentViewClient;
let configPathFromArg : string | undefined; // config path from command (usually undefined)

export async function runCli() {
  const program = new Command();

  program
    .name("agentview")
    .description("AgentView CLI")
    // .option("-c, --config <path>", "Path to agentview config file")
    .option("--api-key <key>", "AgentView API key (overrides AGENTVIEW_API_KEY env var)")
    .option("--env <env>", "Environment name (overrides env from config)")
    .hook('preAction', async (thisCommand) => {
      const opts = thisCommand.opts();
      const apiKey = opts.apiKey ?? getAPIKey();
      const env = opts.env ?? (await loadConfig()).env;

      // For now, no custom config paths.
      // configPathFromArg = opts.config; // required to resolve path later

      client = createStandardClient({ apiKey, env });
    });


  program
    .command("dev")
    .description("Start Studio dev server")
    .option("-p, --port <port>", "Port for the dev server", parseInt)
    .option('--no-studio', 'disable colored output')
    .action(async (opts) => {
      await runProxyServer(client);
      await watchConfig();

      if (opts.studio) {
        const configPath = resolveConfigPath(configPathFromArg);
        await startStudioServer(configPath, { port: opts.port });
      }
    });

  const configCmd = program
    .command("config")
    .description("Manage config");

  configCmd
    .command("push")
    .description("Send the config file to the AgentView server once")
    .action(async (opts) => {
      await pushConfig();
    });

  configCmd
    .command("watch")
    .description("Watch the config file and sync on every change")
    .action(async (opts) => {
      await watchConfig();
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

  let moduleExports: any;
  try {
    const { tsImport } = await import("tsx/esm/api");
    moduleExports = await tsImport(fileUrl, { parentURL: import.meta.url });
  } catch (error: any) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        `Cannot load ${configPath}. Ensure "tsx" is installed.`,
      );
    }
    throw error;
  }

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

async function runProxyServer(client: StandardAgentViewClient) {
  let proxy: ProxyServer | null = null;
  let tunnel: CloudflareTunnel | null = null;
  let cleanedUp = false;

  const cleanup = async (exitCode: number) => {
    if (cleanedUp) return;
    cleanedUp = true;

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

  proxy = await startProxyServer(PROXY_PORT);
  console.log(`[agentview] proxy listening on http://127.0.0.1:${proxy.port}`);

  tunnel = await startCloudflareTunnel(PROXY_PORT);
  console.log(`[agentview] tunnel URL: ${tunnel.url}`);

  await updateEnvironment(client, { tunnelUrl: tunnel.url });
  console.log(`[agentview] tunnel registered with AgentView backend`);

}

async function pushConfig() {
  const config = await loadConfig();

  try {
    await updateEnvironment(client, { config: toBaseConfig(config) });
    console.log(`Config pushed`);
  } catch (e) {
    console.log('CONFIG ERROR');
    console.error((e as Error).message);
    console.error(JSON.stringify((e as any)?.details?.cause, null, 2));
    throw e;
  }
}

async function watchConfig() {
  console.log(`[agentview] watching for config changes...`);

  // Push once on startup
  try { await pushConfig(); } catch (e) { }

  let debounceTimer: NodeJS.Timeout | null = null;
  fs.watch(process.cwd(), { recursive: true }, (_event, filename) => {
    if (!filename) return;
    if (filename.includes("node_modules")) return;
    if (!/\.(ts|tsx|js|jsx)$/.test(filename)) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try { await pushConfig(); } catch (e) { console.error((e as Error).message); }
    }, 300);
  });
}
