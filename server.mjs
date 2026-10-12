#!/usr/bin/env node
// Static file server + server-rendered GLM usage panel for the BOOX Mira
// e-paper kiosk (host yzx9-pie loads http://192.0.2.10:15932).
//
// Routes:
//   GET /            -> SSR panel page (real numbers, no JS needed to read it)
//   GET /api/usage   -> {texts, bars, ...} consumed by the 60s client updater
//   GET /healthz     -> "ok" for watchdogs
//   GET /<file>      -> static files from ./public (draft mockups, assets)
//
// Design constraints (why this file is deliberately boring):
//   - Zero dependencies: Node built-ins only, so nothing to install or bundle.
//   - Only GET/HEAD are answered; everything else is 405. No directory listing.
//   - Cache-Control: no-store, so a browser reload always picks up page edits.
//   - No state beyond the 25s usage cache; ~0% CPU idle. The cost sits on this
//     machine, not on the Pi's Firefox, which only ever receives one document.
//
// Usage:  node server.mjs            (binds 0.0.0.0:15932)
//         PORT=8080 node server.mjs  (override)

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize, resolve } from 'node:path';

import { getUsage, toDom } from './usage.mjs';
import { renderPage } from './render.mjs';

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? 15932);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'public');

// Build id for the running code. The panel compares it on every 60s poll and
// reloads itself when it changes, so a deploy reaches the kiosk unattended.
const BUILD = await computeBuild();

async function computeBuild() {
  const here = dirname(fileURLToPath(import.meta.url));
  const parts = await Promise.all(
    ['server.mjs', 'usage.mjs', 'render.mjs'].map(async (name) => {
      const info = await stat(join(here, name));
      return `${name}:${info.size}:${Math.round(info.mtimeMs)}`;
    }),
  );
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 8);
}

const MIME = {
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

/** Map a request path to a file inside ROOT, refusing path traversal. */
function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const abs = join(ROOT, rel);
  return abs.startsWith(ROOT) ? abs : null;
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function sendJson(res, req, payload) {
  const body = JSON.stringify(payload);
  return send(res, 200, req.method === 'HEAD' ? '' : body, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];

  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'Method Not Allowed', { 'Content-Type': 'text/plain' });
    }

    // Tiny health probe for curl / watchdogs — no filesystem or API access.
    if (path === '/healthz') {
      return send(res, 200, 'ok\n', { 'Content-Type': 'text/plain' });
    }

    // The panel: fetch usage (25s cache), render the whole page server-side.
    if (path === '/' || path === '/index.html') {
      const data = await getUsage();
      const html = renderPage(data, toDom(data), BUILD);
      return send(res, 200, req.method === 'HEAD' ? '' : html, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html),
      });
    }

    // What the 60s client updater patches text nodes from.
    if (path === '/api/usage') {
      const data = await getUsage();
      return sendJson(res, req, { ...toDom(data), build: BUILD, data });
    }

    const file = resolvePath(path);
    if (!file) return send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain' });

    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) {
      return send(res, 404, 'Not Found', { 'Content-Type': 'text/plain' });
    }

    const body = await readFile(file);
    return send(res, 200, req.method === 'HEAD' ? '' : body, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.length,
    });
  } catch (err) {
    process.stderr.write(`[mira-panel] ${req.method} ${req.url} failed: ${err.stack ?? err.message}\n`);
    return send(res, 500, 'Internal Server Error', { 'Content-Type': 'text/plain' });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`[mira-panel] panel + static (${ROOT}) on http://${HOST}:${PORT}/\n`);
});
