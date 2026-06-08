import dotenv from "dotenv";
import { expand } from "dotenv-expand";

// Vite/Next env loading: highest precedence first. `override: false` makes
// the first file (and any pre-existing shell env) win. `expand` resolves
// $VAR / ${VAR} references against process.env + merged file vars.
const mode = process.env.NODE_ENV ?? "development";
expand(dotenv.config({
  path: [`.env.${mode}.local`, `.env.${mode}`, ".env.local", ".env"],
  override: false,
  quiet: true,
}));
