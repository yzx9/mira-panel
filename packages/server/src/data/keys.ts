// Candidate API-key resolution for the agenix KEY=VALUE env files — the same
// format vikunja.ts reads. The string half is pure so tests cover the parsing
// without touching real secret files; key values never leave this module's
// callers (they go straight into an Authorization header, nowhere else).

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Extract `NAME=value` from env-file text; strips matching quotes. */
export function keyFromText(text: string, name: string): string | null {
  const prefix = `${name}=`;
  const line = text.split("\n").find((l) => l.startsWith(prefix));
  if (!line) return null;
  const value = line
    .slice(prefix.length)
    .trim()
    .replace(/^["']|["']$/g, "");
  return value.length > 0 ? value : null;
}

/** Path of an agenix-decrypted file in the runtime dir. */
export function agenixFile(file: string): string {
  return join(process.env.XDG_RUNTIME_DIR ?? "/run/user/1000", "agenix", file);
}

/** Read one NAME= from a file; null when missing or not yet decrypted. */
export async function readKeyFile(path: string, name: string): Promise<string | null> {
  try {
    return keyFromText(await readFile(path, "utf8"), name);
  } catch {
    return null;
  }
}
