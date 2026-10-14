// Boot-time build id for the running system. The page compares it on every 60s
// poll and reloads itself when it changes, so a deploy reaches the kiosk
// unattended. It is the ONLY remaining full-reload trigger — reactivity patches
// everything else, and the old signature mechanism is gone with the vanilla
// text patcher (never reintroduce a hash over per-fetch fields like fetchedAt:
// that degenerates into a reload loop every poll).
//
// Covers the source of all three packages plus the built web bundle when it
// exists, so both `npm run dev` and a prod `build + start` produce a new id
// after a code change; touching files without a restart changes nothing.

import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '../../..');

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p)));
    else files.push(p);
  }
  return files.sort();
}

export async function computeBuildId(): Promise<string> {
  const targets = [
    'packages/server/src',
    'packages/shared/src',
    'packages/web/src',
    'packages/web/index.html',
    'packages/web/dist',
  ];
  const parts: string[] = [];
  for (const rel of targets) {
    const abs = join(REPO_ROOT, rel);
    const info = await stat(abs).catch(() => null);
    if (!info) continue; // web dist does not exist until the first build
    if (info.isFile()) {
      parts.push(`${rel}:${info.size}:${Math.round(info.mtimeMs)}`);
      continue;
    }
    for (const f of await walk(abs)) {
      const st = await stat(f);
      parts.push(`${f.slice(REPO_ROOT.length + 1)}:${st.size}:${Math.round(st.mtimeMs)}`);
    }
  }
  return createHash('sha1')
    .update(parts.sort().join('|'))
    .digest('hex')
    .slice(0, 8);
}
