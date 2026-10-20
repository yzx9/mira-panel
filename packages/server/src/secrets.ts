// The panel's own secret store: a git-ignored `.env`, filled by whatever
// local key machinery the operator uses (gopass, manual edit, deploy
// script). This deliberately replaces the nix/agenix runtime chain — the
// panel owns its file, the file owns the keys, and the nix config no
// longer needs a rebuild to rotate one.
//
// Resolution, first hit wins:
//   1. process.env[NAME]   (12-factor, tests, one-off overrides)
//   2. PANEL_ENV_FILE      (explicit path — how restart-service.sh hands a
//                           worktree preview the main checkout's .env)
//   3. <repo root>/.env    (packages/server/src -> ../../../.env)
//
// Worktrees carry no .env of their own (it is git-ignored); pointing them
// at the real file is the deploy script's job, not this module's — the
// secret layer knows nothing about git layouts.
//
// The file is re-read per call on purpose: provisioning or rotating a key
// takes effect on the next use, with no server restart.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { keyFromText } from "./data/keys.ts";

// packages/server/src -> this checkout's repo root
const LOCAL_ENV_FILE = join(import.meta.dirname, "../../../.env");

/** Resolve one secret by name; null when no rung has it. `file` pins the
 *  file directly — the test seam. */
export async function panelSecret(name: string, file?: string): Promise<string | null> {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const path = file ?? process.env.PANEL_ENV_FILE ?? LOCAL_ENV_FILE;
  try {
    return keyFromText(await readFile(path, "utf8"), name);
  } catch {
    return null; // no .env (yet) — callers report their own honest error
  }
}
