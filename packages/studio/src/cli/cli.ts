#!/usr/bin/env node
import 'dotenv/config'

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { type AgentViewConfig } from "../types";
import { createStandardClient } from "agentview/clientStandard";
import { AgentViewError } from "agentview";
import { startDevServer } from "./devServer.js";
import { startProxyServer, PROXY_PORT, type ProxyServer } from "./proxyServer.js";
import { startCloudflareTunnel, type CloudflareTunnel } from "./tunnel.js";

const DEFAULT_CONFIG_FILES = [
  "agentview.config.ts",
  "agentview.config.tsx",
  "agentview.config.js"
];

const HELP_TEXT = `Usage: agentview <command> [options]

Commands:
  dev [--config <path>] [-p <port>]  Start Studio dev server (default port: 1989)
  config push [--config <path>]      Send the config file to the AgentView server once
  config watch [--config <path>]     Watch the config file and sync on every change
  help                               Show this message

Options:
  -c, --config <path>             Path to agentview config file (defaults to common filenames in the current directory)
  -p, --port <port>               Port for the dev server (default: 1989)`;

export async function runCli() {
  const [, , ...args] = process.argv;

  if (args.length === 0 || args[0] === "help" || args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const [command, subcommand, ...rest] = args;

  if (command === "dev") {
    const restArgs = [subcommand, ...rest].filter(Boolean);
    let configPath: string;
    try {
      configPath = resolveConfigPath(restArgs);
    } catch (error) {
      console.error((error as Error).message);
      process.exit(1);
      return;
    }

    const port = parsePort(restArgs);
    await runDev(configPath, port);
    return;
  }

  if (command !== "config") {
    console.error(`Unknown command "${command}".`);
    printHelp(1);
    return;
  }

  if (subcommand !== "push" && subcommand !== "watch") {
    console.error(`Unknown subcommand "${subcommand}".`);
    printHelp(1);
    return;
  }

  let configPath: string;
  try {
    configPath = resolveConfigPath(rest);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
    return;
  }

  try {
    if (subcommand === "push") {
      await pushConfig(configPath);
    } else {
      await watchConfig(configPath);
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

function printHelp(exitCode = 0) {
  console.log(HELP_TEXT);
  if (exitCode !== null) {
    process.exit(exitCode);
  }
}

function resolveConfigPath(args: string[]): string {
  const optionIndex = args.findIndex((arg) => arg === "--config" || arg === "-c");

  if (optionIndex !== -1) {
    const explicitPath = args[optionIndex + 1];
    if (!explicitPath) {
      throw new Error("Missing value for --config");
    }

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

async function loadConfig(configPath: string): Promise<AgentViewConfig> {
  const absolutePath = path.resolve(configPath);
  const fileUrl = pathToFileURL(absolutePath).href;
  const ext = path.extname(absolutePath).toLowerCase();

  let moduleExports: any;
  try {
    if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
      // Cache-bust for plain JS so watch mode picks up changes.
      moduleExports = await import(`${fileUrl}?t=${Date.now()}`);
    } else {
      // tsImport handles cache-busting internally via its namespace param.
      // Appending our own query string confuses its loader hook and falls
      // back to the default ESM loader (which can't parse TypeScript).
      const { tsImport } = await import("tsx/esm/api");
      moduleExports = await tsImport(fileUrl, { parentURL: import.meta.url });
    }
  } catch (error: any) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        `Cannot load ${configPath}. If it's a TypeScript file, ensure "tsx" is installed.`,
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

async function runDev(configPath: string, port: number | undefined) {
  let apiKey: string;
  try {
    apiKey = getAPIKey();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }

  const config = await loadConfig(configPath);
  const av = createStandardClient({ apiKey, env: config.env });

  let proxy: ProxyServer | null = null;
  let tunnel: CloudflareTunnel | null = null;
  let cleanedUp = false;

  const cleanup = async (exitCode: number) => {
    if (cleanedUp) return;
    cleanedUp = true;

    // Best-effort unregister tunnel URL on the backend
    try {
      await Promise.race([
        av.updateEnvironment({ tunnelUrl: null }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("tunnel-unregister timeout")), 5000),
        ),
      ]);
    } catch (error) {
      console.error(`Failed to unregister tunnel URL: ${(error as Error).message}`);
    }

    if (tunnel) {
      try {
        await tunnel.stop();
      } catch (error) {
        console.error(`Failed to stop tunnel: ${(error as Error).message}`);
      }
    }

    if (proxy) {
      try {
        await proxy.close();
      } catch (error) {
        console.error(`Failed to close proxy: ${(error as Error).message}`);
      }
    }

    process.exit(exitCode);
  };

  process.on("SIGINT", () => { void cleanup(0); });
  process.on("SIGTERM", () => { void cleanup(0); });

  // 1. Start local proxy server
  try {
    proxy = await startProxyServer(PROXY_PORT);
    console.log(`[agentview] proxy listening on http://127.0.0.1:${proxy.port}`);
  } catch (error) {
    console.error(`Failed to start proxy server on port ${PROXY_PORT}: ${(error as Error).message}`);
    process.exit(1);
  }

  // 2. Start Cloudflare tunnel pointing at the proxy
  try {
    tunnel = await startCloudflareTunnel(PROXY_PORT);
    console.log(`[agentview] tunnel URL: ${tunnel.url}`);
  } catch (error) {
    console.error(`Failed to start tunnel: ${(error as Error).message}`);
    await cleanup(1);
    return;
  }

  // 3. Register tunnel URL on backend
  try {
    await av.updateEnvironment({ tunnelUrl: tunnel.url });
    console.log(`[agentview] tunnel registered with AgentView backend`);
  } catch (error) {
    if (error instanceof AgentViewError) {
      console.error(`Failed to register tunnel (${error.statusCode}): ${error.message}`);
    } else {
      console.error(`Failed to register tunnel: ${(error as Error).message}`);
    }
    await cleanup(1);
    return;
  }

  // 4. Start Vite dev server (Studio UI)
  await startDevServer(configPath, { port });
}

async function pushConfig(configPath: string) {
  const config = await loadConfig(configPath);

  const apiKey = getAPIKey();

  const av = createStandardClient({
    apiKey,
  });

  try {
    await av.updateEnvironment({ config });
  } catch (error) {
    if (error instanceof AgentViewError) {
      console.error(`Error (${error.statusCode}): ${error.message}`);
      console.error(error.details);
    }
    else {
      console.error("Unknown error");
      console.log(error);
    }
    process.exit(1);
  }

  console.log(`Config pushed`);
}

async function watchConfig(configPath: string) {
  const relativePath = path.relative(process.cwd(), configPath) || configPath;
  console.log(`Watching ${relativePath} for changes...`);

  const pushAndReport = async () => {
    try {
      await pushConfig(configPath);
    } catch (error) {
      console.error((error as Error).message);
    }
  };

  await pushAndReport();

  let debounceTimer: NodeJS.Timeout | null = null;
  fs.watch(configPath, { persistent: true }, () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      pushAndReport();
    }, 100);
  });
}

function parsePort(args: string[]): number | undefined {
  const portIndex = args.findIndex((arg) => arg === "--port" || arg === "-p");
  if (portIndex === -1) return undefined;
  const portStr = args[portIndex + 1];
  if (!portStr) {
    console.error("Missing value for --port");
    process.exit(1);
  }
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${portStr}`);
    process.exit(1);
  }
  return port;
}
