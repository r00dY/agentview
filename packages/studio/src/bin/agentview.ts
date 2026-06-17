#!/usr/bin/env node
import { register } from "tsx/esm/api";

// Register tsx before loading the CLI. This lets the CLI import the user's
// TypeScript/JSX config (agentview.config.tsx) at runtime, and resolves the
// compiled module graph regardless of import extension. Works both compiled
// (the published bin runs this file directly) and in dev (agentview.mjs).
register();

const { runCli } = await import("../cli/cli.js");
await runCli();
