// Dev entry: same data + API surface as prod, with the Vite dev server
// (SSR + HMR) mounted as middleware in front of Hono. Vite serves the web
// sources; Hono answers the pages (via vite.ssrLoadModule), /api and static.

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { createServer as createViteServer } from 'vite';

import { createApp, type RenderPage } from './app.ts';
import { computeBuildId } from './buildId.ts';
import { assemble, assertMarkers, tabTitle } from './template.ts';
import { lastViewport } from './viewport.ts';

const REPO_ROOT = join(import.meta.dirname, '../../..');
const WEB_ROOT = join(REPO_ROOT, 'packages/web');
const SHELL_PATH = join(WEB_ROOT, 'index.html');

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? 15932);

const build = await computeBuildId();
const shell = await readFile(SHELL_PATH, 'utf8');
assertMarkers(shell);

// The http server must exist before vite does: the HMR websocket attaches to
// it (hmr.server), otherwise the browser cannot reach the dev socket.
let handler: import('node:http').RequestListener = (_req, res) => {
  res.writeHead(503, { 'Content-Type': 'text/plain' });
  res.end('starting\n');
};
const httpServer = createServer((req, res) => handler(req, res));

const vite = await createViteServer({
  root: WEB_ROOT,
  appType: 'custom', // no SPA fallback — Hono owns every non-asset route
  server: { middlewareMode: true, hmr: { server: httpServer } },
});

const app = createApp({
  build,
  staticRoots: [join(import.meta.dirname, '../public')],
  clientInfo: lastViewport,
  renderPage: async (tab, state) => {
    // ssrLoadModule runs the web sources through vite (aliases + vapor SFC
    // compile included) and caches with HMR-aware invalidation.
    const { render } = (await vite.ssrLoadModule('/src/entry-server.ts')) as { render: RenderPage };
    const appHtml = await render(tab, state);
    const html = assemble(shell, { title: tabTitle(tab), appHtml, bootstrap: { tab, state } });
    // Lets vite rewrite /src/* imports and inject its HMR client.
    return vite.transformIndexHtml(tab === 'vikunja' ? '/vikunja' : '/glm', html);
  },
});

const honoListener = getRequestListener(app.fetch);
handler = (req, res) => vite.middlewares(req, res, () => honoListener(req, res));

httpServer.listen(PORT, HOST, () => {
  process.stdout.write(`[mira-panel] dev server on http://${HOST}:${PORT}/ (build ${build})\n`);
});
