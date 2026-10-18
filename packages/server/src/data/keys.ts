// NAME=VALUE env-file parsing for the panel's own secret store (secrets.ts
// reads the repo-root `.env` with this). The string half is pure so tests
// cover the parsing without touching real secret files; key values never
// leave this module's callers (they go straight into an Authorization
// header or a comparison, nowhere else).

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
