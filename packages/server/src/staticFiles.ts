// Static file serving, ported from the previous server.mjs: traversal refusal
// (400), explicit miss handling (404 by the caller), a small MIME table, no
// directory listing. Roots are searched in order — server public/ first (e.g.
// draft.html), then the built web assets.

import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export interface StaticResult {
  status: 200 | 400;
  body: Uint8Array | string;
  type: string;
}

/** Map a request path to a file inside root, refusing path traversal. */
function resolveUnder(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const abs = join(root, rel);
  return abs.startsWith(root) ? abs : null;
}

/** Try each root in order; null means no root had the file (caller 404s). */
export async function serveStatic(roots: string[], urlPath: string): Promise<StaticResult | null> {
  for (const root of roots) {
    const file = resolveUnder(root, urlPath);
    if (!file) return { status: 400, body: 'Bad Request', type: 'text/plain; charset=utf-8' };
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) continue;
    return {
      status: 200,
      body: await readFile(file),
      type: MIME[extname(file)] ?? 'application/octet-stream',
    };
  }
  return null;
}
