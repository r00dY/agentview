import dotenv from "dotenv";
import { expand } from "dotenv-expand";

// Vite/Next env loading: highest precedence first. `override: false` makes
// the first file (and any pre-existing shell env) win. `expand` resolves
// $VAR / ${VAR} references against process.env + merged file vars.
//
// Exported so onboarding (onboard.ts) can re-read .env.local after writing
// freshly minted credentials into it. `override: false` keeps any value we've
// already set on process.env in-memory (e.g. the secret key) authoritative,
// while still picking up newly-written keys.
export function reloadEnv() {
  const mode = process.env.NODE_ENV ?? "development";
  expand(dotenv.config({
    path: [`.env.${mode}.local`, `.env.${mode}`, ".env.local", ".env"],
    override: false,
    quiet: true,
  }));
}

// Load on import — the CLI bin entrypoint relies on this side effect.
reloadEnv();
