// Production entry: boot-time build id, the built web bundle (shell + SSR
// render), static assets, then listen. Run `npm run build` first — without a
// web bundle the API still works and pages answer 503.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";

import { createApp, type RenderPage } from "./app.ts";
import { computeBuildId } from "./buildId.ts";
import { assemble, assertMarkers, tabTitle } from "./template.ts";
import { lastViewport } from "./viewport.ts";

const REPO_ROOT = join(import.meta.dirname, "../../..");
const PUBLIC_DIR = join(import.meta.dirname, "../public");
const WEB_CLIENT_DIR = join(REPO_ROOT, "packages/web/dist/client");
const SHELL_PATH = join(WEB_CLIENT_DIR, "index.html");
// Dynamic-import specifier goes through a variable on purpose: neither tsc nor
// any build step should require packages/web/dist to exist at check time.
const SSR_PATH = join(REPO_ROOT, "packages/web/dist/server/entry-server.js");

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 15932);

const build = await computeBuildId();

// Wire the built web bundle. The client build's index.html IS the prod shell —
// vite already inlined the hashed <script>/<link> tags into it — and the SSR
// build exports render(tab, state) -> html.
let renderPage: RenderPage | undefined;
const staticRoots = [PUBLIC_DIR];
try {
  const shell = await readFile(SHELL_PATH, "utf8");
  assertMarkers(shell);
  const ssrUrl = pathToFileURL(SSR_PATH).href;
  const { render } = (await import(ssrUrl)) as { render: RenderPage };
  renderPage = async (tab, state, locked) =>
    assemble(shell, {
      title: tabTitle(tab),
      appHtml: await render(tab, state, locked),
      bootstrap: { tab, state, locked },
    });
  staticRoots.push(WEB_CLIENT_DIR);
  process.stdout.write(`[mira-panel] web bundle loaded (build ${build})\n`);
} catch (err) {
  process.stderr.write(
    `[mira-panel] no web bundle (${(err as Error).message}); pages will 503 until \`npm run build\`\n`,
  );
}

const app = createApp({ build, renderPage, staticRoots, clientInfo: lastViewport });

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  process.stdout.write(`[mira-panel] panel on http://${HOST}:${PORT}/ (build ${build})\n`);
});
