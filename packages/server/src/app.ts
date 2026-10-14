// The Hono application: response headers, route table and error handling,
// ported from the previous server.mjs. Page rendering is injected via deps
// because it differs between dev (vite ssrLoadModule) and prod (the built
// entry-server bundle).

import { Hono } from "hono";
import type { Context } from "hono";

import type { PanelState, TabId } from "@mira-panel/shared";

import { getUsage } from "./data/usage.ts";
import { getTasks } from "./data/vikunja.ts";
import { serveStatic, type StaticResult } from "./staticFiles.ts";
import { stateFor } from "./state.ts";
import { noteClientViewport } from "./viewport.ts";

export type RenderPage = (tab: TabId, state: PanelState) => Promise<string>;

export interface AppDeps {
  build: string;
  /** Undefined when the web bundle is missing -> pages answer 503. */
  renderPage?: RenderPage;
  /** Searched in order for the static fallback. */
  staticRoots: string[];
  clientInfo: () => { stamp: string; at: string } | null;
}

function toArrayBuffer(body: Uint8Array | string): ArrayBuffer | string {
  if (typeof body === "string") return body;
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // Strip response bodies from HEAD: the old send() wrote the Content-Length
  // of the GET body but an empty payload, and curl -I / watchdogs rely on it.
  app.use("*", async (c, next) => {
    await next();
    if (c.req.method === "HEAD") {
      c.res = new Response(null, { status: c.res.status, headers: c.res.headers });
    }
  });

  // Every response carries the old send() headers — assets included.
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
  });

  // Old server answered GET/HEAD only.
  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      return c.text("Method Not Allowed", 405);
    }
    await next();
  });

  app.get("/healthz", (c) => c.text("ok\n"));

  // One tab = one URL = one SSR pass. No client-side routing, so a tab switch
  // is a normal navigation the e-paper repaints anyway.
  const page = (tab: TabId) => async (c: Context) => {
    if (!deps.renderPage) return c.text("web package not built — run `npm run build` first", 503);
    return c.html(await deps.renderPage(tab, await stateFor(deps.build)));
  };
  const glmPage = page("glm");
  app.get("/", glmPage);
  app.get("/glm", glmPage);
  app.get("/index.html", glmPage);
  app.get("/vikunja", page("vikunja"));

  // What the 60s client poll consumes: the whole panel state (the old texts/
  // bars id-maps are gone together with the vanilla patcher). /api/usage
  // stays as an alias so pre-reload bookmarks keep working.
  const apiState = async (c: Context) => {
    noteClientViewport({ get: (n) => c.req.query(n) });
    return c.json(await stateFor(deps.build));
  };
  app.get("/api/state", apiState);
  app.get("/api/usage", apiState);

  // Debug view: full raw payload for both sources + client viewport.
  app.get("/api/raw", async (c) => {
    const [glm, tasks] = await Promise.all([getUsage(), getTasks()]);
    return c.json({ glm, tasks, client: deps.clientInfo() });
  });

  // Static fallback, registered last so /index.html is never served raw.
  app.get("*", async (c) => {
    const result: StaticResult | null = await serveStatic(deps.staticRoots, c.req.path);
    if (!result) return c.text("Not Found", 404);
    if (result.status !== 200) return c.text(String(result.body), 400);
    return c.body(toArrayBuffer(result.body), 200, { "Content-Type": result.type });
  });

  app.onError((err, c) => {
    process.stderr.write(
      `[mira-panel] ${c.req.method} ${c.req.path} failed: ${(err as Error).stack ?? String(err)}\n`,
    );
    return c.text("Internal Server Error", 500);
  });

  return app;
}
