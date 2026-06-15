import http from "node:http";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { getWebAppUrl } from "agentview/urls";

// ---------------------------------------------------------------------------
// Browser-based onboarding for a missing AGENTVIEW_API_KEY.
//
// Mirrors the standard CLI auth handshake (vercel/wrangler/supabase login):
//   1. start a loopback HTTP server + random `state` nonce
//   2. open the browser to the webapp's /cli page, passing the loopback URL
//   3. the user signs in / signs up, generates an API key pair, and the page
//      POSTs the credentials back to our loopback server
//   4. we verify the `state` and either persist the credentials to .env.local
//      (when we can) or print them for the user to add manually
//
// The credentials travel over loopback only (127.0.0.1), never over the
// network. The `state` nonce is the shared secret that authorizes the POST.
//
// This module never mutates process.env — the caller reloads env after a
// successful .env.local write (see the CLI `preAction` hook).
// ---------------------------------------------------------------------------

const useColor =
  !process.env.NO_COLOR &&
  (!!process.env.FORCE_COLOR || !!process.stdout.isTTY);
const ansi = {
  reset: useColor ? "\x1b[0m" : "",
  green: useColor ? "\x1b[32m" : "",
  cyan: useColor ? "\x1b[36m" : "",
  dim: useColor ? "\x1b[2m" : "",
  bold: useColor ? "\x1b[1m" : "",
};

const ONBOARDING_TIMEOUT_MS = 5 * 60 * 1000;

interface RawCredentials {
  publicKey: string;
  secretKey: string;
  env: string;
  orgName: string;
}

export type ProjectType = "nextjs" | "vite";

export interface DetectedProject {
  type: ProjectType;
  /** Env-var prefix that exposes a value to the browser bundle. */
  publicPrefix: string;
}

interface CallbackServer {
  port: number;
  waitForCredentials: (timeoutMs: number) => Promise<RawCredentials>;
  close: () => Promise<void>;
}

/**
 * Start an ephemeral HTTP server on 127.0.0.1 that waits for the webapp to
 * POST credentials to `/callback`. Only a body carrying the expected `state`
 * nonce is accepted.
 */
function startCallbackServer(expectedState: string): Promise<CallbackServer> {
  return new Promise((resolveServer, rejectServer) => {
    let resolveCreds!: (c: RawCredentials) => void;
    const credsPromise = new Promise<RawCredentials>((res) => {
      resolveCreds = res;
    });

    const server = http.createServer((req, res) => {
      // The webapp (a different origin) fetches this loopback URL. No cookies
      // are involved, so a wildcard is safe — the state nonce is the secret.
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.method === "POST" && url.pathname === "/callback") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
          if (body.length > 1_000_000) req.destroy();
        });
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (data.state !== expectedState) {
              res.statusCode = 403;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: "state mismatch" }));
              return;
            }
            const creds: RawCredentials = {
              publicKey: data.publicKey,
              secretKey: data.secretKey,
              env: data.env,
              orgName: data.orgName,
            };
            if (!creds.secretKey || !creds.publicKey) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: "missing credentials" }));
              return;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
            resolveCreds(creds);
          } catch {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "invalid body" }));
          }
        });
        return;
      }

      res.statusCode = 404;
      res.end();
    });

    server.on("error", rejectServer);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        rejectServer(new Error("Failed to determine callback server port"));
        return;
      }
      const port = address.port;

      resolveServer({
        port,
        waitForCredentials(timeoutMs: number) {
          let timer: NodeJS.Timeout;
          const timeout = new Promise<RawCredentials>((_, reject) => {
            timer = setTimeout(() => reject(new Error("onboarding-timeout")), timeoutMs);
            timer.unref?.();
          });
          return Promise.race([credsPromise, timeout]).finally(() => clearTimeout(timer));
        },
        close() {
          return new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
  });
}

/** Best-effort browser launch; the URL is always printed as a fallback. */
function openBrowser(url: string): void {
  let command: string;
  let args: string[];
  if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      /* best-effort — the printed URL is the fallback */
    });
    child.unref();
  } catch {
    /* best-effort */
  }
}

/**
 * Detect whether the current project is Next.js or Vite, to pick the correct
 * public env-var prefix. Returns null when neither is recognized.
 */
export function detectProjectType(cwd: string): DetectedProject | null {
  const has = (file: string) => fs.existsSync(path.join(cwd, file));

  let deps: Record<string, string> = {};
  try {
    const pkgPath = path.join(cwd, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      deps = { ...pkg.dependencies, ...pkg.devDependencies };
    }
  } catch {
    /* unreadable package.json — fall back to config-file detection */
  }

  const nextConfig = ["next.config.js", "next.config.mjs", "next.config.ts", "next.config.cjs"].some(has);
  const viteConfig = ["vite.config.js", "vite.config.ts", "vite.config.mjs", "vite.config.cjs"].some(has);

  if (deps.next || nextConfig) return { type: "nextjs", publicPrefix: "NEXT_PUBLIC_" };
  if (deps.vite || viteConfig) return { type: "vite", publicPrefix: "VITE_" };
  return null;
}

/** Ask a yes/no question. Non-interactive (no TTY) defaults to `false`. */
async function promptYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question(`   ${question} ${ansi.dim}[Y/n]${ansi.reset} `)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

/**
 * Upsert the given vars into an env file: replace an existing `KEY=` line in
 * place, otherwise append it. All other content is preserved.
 */
export function upsertEnvFile(filePath: string, vars: Record<string, string>): void {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  const lines = existing.length > 0 ? existing.replace(/\n+$/, "").split("\n") : [];

  const appended: string[] = [];
  for (const [key, value] of Object.entries(vars)) {
    const line = `${key}=${value}`;
    const idx = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
    if (idx >= 0) lines[idx] = line;
    else appended.push(line);
  }

  if (appended.length > 0) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== "") lines.push("");
    lines.push("# AgentView");
    lines.push(...appended);
  }

  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
}

/** Print the env vars + guidance for the user to set manually and re-run. */
function printManualInstructions(creds: RawCredentials, project: DetectedProject | null): void {
  const prefix = project?.publicPrefix ?? "NEXT_PUBLIC_";
  const note = project ? "" : `   ${ansi.dim}# or VITE_… for Vite${ansi.reset}`;
  console.log(`   ${ansi.dim}Add these to your environment, then re-run this command:${ansi.reset}`);
  console.log();
  console.log(`     AGENTVIEW_API_KEY=${creds.secretKey}`);
  console.log(`     ${prefix}AGENTVIEW_API_KEY=${creds.publicKey}${note}`);
  console.log(`     ${prefix}AGENTVIEW_ENV=${creds.env}${note}`);
  console.log();
  console.log(`   ${ansi.dim}Make sure the public key and env are exposed to the browser (NEXT_PUBLIC_ in Next.js, VITE_ in Vite).${ansi.reset}`);
}

/**
 * Run the browser onboarding flow when AGENTVIEW_API_KEY is missing.
 *
 * Returns `true` when credentials were written to .env.local (the caller can
 * reload env and continue), or `false` when the user must add them manually and
 * re-run — in which case the values and instructions have already been printed.
 *
 * Never mutates process.env; persistence happens only via the .env.local write.
 */
export async function runOnboarding(): Promise<boolean> {
  const webAppUrl = getWebAppUrl();
  const state = crypto.randomBytes(32).toString("hex");

  const server = await startCallbackServer(state);
  const origin = `http://127.0.0.1:${server.port}/callback`;
  const connectUrl = `${webAppUrl}/cli?origin=${encodeURIComponent(origin)}&state=${state}`;

  console.log();
  console.log(`   ${ansi.bold}Welcome to AgentView${ansi.reset}`);
  console.log(`   ${ansi.dim}No AGENTVIEW_API_KEY found — let's connect your project.${ansi.reset}`);
  console.log();
  console.log(`   Opening your browser to sign in. If it doesn't open, visit:`);
  console.log(`   ${ansi.cyan}${connectUrl}${ansi.reset}`);
  console.log();
  console.log(`   ${ansi.dim}Waiting for you to finish in the browser…${ansi.reset}`);

  // Only auto-open in an interactive terminal; in CI / piped contexts the
  // printed URL above is the fallback.
  if (process.stdout.isTTY) openBrowser(connectUrl);

  let creds: RawCredentials;
  try {
    creds = await server.waitForCredentials(ONBOARDING_TIMEOUT_MS);
  } finally {
    await server.close();
  }

  console.log();
  console.log(`   ${ansi.green}✓${ansi.reset} Connected to ${ansi.bold}${creds.orgName}${ansi.reset} ${ansi.dim}(${creds.env})${ansi.reset}`);
  console.log();

  const project = detectProjectType(process.cwd());
  if (project) {
    const prefix = project.publicPrefix;
    const vars: Record<string, string> = {
      AGENTVIEW_API_KEY: creds.secretKey,
      [`${prefix}AGENTVIEW_API_KEY`]: creds.publicKey,
      [`${prefix}AGENTVIEW_ENV`]: creds.env,
    };
    const write = await promptYesNo(
      `Detected a ${ansi.bold}${project.type}${ansi.reset} project. Save credentials to .env.local?`,
    );
    if (write) {
      upsertEnvFile(path.join(process.cwd(), ".env.local"), vars);
      console.log(`   ${ansi.green}✓${ansi.reset} Saved to .env.local ${ansi.dim}(${Object.keys(vars).join(", ")})${ansi.reset}`);
      console.log();
      return true;
    }
  }

  // Not persisted (declined, or unrecognized project): print the values and
  // instructions so the user can set them and re-run.
  console.log();
  printManualInstructions(creds, project);
  console.log();
  return false;
}
