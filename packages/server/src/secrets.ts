// The panel's own secret store: a git-ignored `.env` at the repo root,
// filled by whatever local key machinery the operator uses (gopass, manual
// edit, deploy script). This deliberately replaces the nix/agenix runtime
// chain — the panel owns its file, the file owns the keys, and the nix
// config no longer needs a rebuild to rotate one.
//
// Precedence: process.env (12-factor deploys and tests) -> .env file.
// Read per call on purpose: provisioning or rotating a key takes effect on
// the next use, with no server restart — same freshness the PIN needs.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { keyFromText } from "./data/keys.ts";

// packages/server/src -> repo root; absolute so the service finds the file
// no matter which cwd restart-service.sh or npm hands it.
const ENV_FILE = join(import.meta.dirname, "../../../.env");

/** Resolve one secret by name; null when neither env nor .env has it. */
export async function panelSecret(name: string, file: string = ENV_FILE): Promise<string | null> {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  try {
    return keyFromText(await readFile(file, "utf8"), name);
  } catch {
    return null; // no .env (yet) — callers report their own honest error
  }
}
