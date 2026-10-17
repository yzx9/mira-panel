// The Hono application: response headers, route table and error handling,
// ported from the previous server.mjs. Page rendering is injected via deps
// because it differs between dev (vite ssrLoadModule) and prod (the built
// entry-server bundle).

import { Hono } from "hono";
import type { Context } from "hono";

import type { PanelState, TabId } from "@mira-panel/shared";

import { getDeepSeekBalance } from "./data/deepseek.ts";
import { getTavilyUsage } from "./data/tavily.ts";
import { getUsage } from "./data/usage.ts";
import { getTasks, markDone } from "./data/vikunja.ts";
import { serveStatic, type StaticResult } from "./staticFiles.ts";
import { stateFor, vikunjaState } from "./state.ts";
import { noteClientViewport } from "./viewport.ts";

export type RenderPage = (tab: TabId, state: PanelState, locked: boolean) => Promise<string>;

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

  // The single deliberate write path, registered BEFORE the method guard
  // below: Hono composes matching handlers in registration order and a route
  // handler that answers is terminal, so this POST never reaches the guard.
  // The X-Panel-Write header forces a CORS preflight for cross-site writers
  // — a preflight this server never answers, which is the CSRF story.
  app.post("/api/vikunja/tasks/:id/done", async (c) => {
    if (lockCookie(c.req.header("Cookie"))) return c.text("Panel is locked", 403);
    if (c.req.header("X-Panel-Write") !== "1") return c.text("Missing X-Panel-Write header", 400);
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.text("Bad task id", 400);
    try {
      return c.json(vikunjaState(await markDone(id)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("HTTP 403"))
        return c.text("Vikunja rejected the write — token is likely read-only", 502);
      throw err; // -> onError -> 500 (the client flashes a generic failure)
    }
  });

  // Old server answered GET/HEAD only — except the write route above.
  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      return c.text("Method Not Allowed", 405);
    }
    await next();
  });

  app.get("/healthz", (c) => c.text("ok\n"));

  // The lock lives in a cookie so SSR renders the locked navbar from the
  // first paint — a locked panel never repaints its buttons after hydration.
  function lockCookie(header: string | undefined): boolean {
    return (header ?? "").split(";").some((p) => p.trim() === "mira-panel-lock=1");
  }

  // One tab = one URL = one SSR pass. No client-side routing, so a tab switch
  // is a normal navigation the e-paper repaints anyway.
  const page = (tab: TabId) => async (c: Context) => {
    if (!deps.renderPage) return c.text("web package not built — run `npm run build` first", 503);
    const locked = lockCookie(c.req.header("Cookie"));
    // A locked panel only ever shows the clock: the data tabs redirect there,
    // so the lock holds at the URL level too, not just the rail's click guard.
    if (locked && tab !== "clock") return c.redirect("/");
    return c.html(await deps.renderPage(tab, await stateFor(deps.build), locked));
  };
  const clockPage = page("clock");
  app.get("/", clockPage);
  app.get("/clock", clockPage);
  app.get("/index.html", clockPage);
  app.get("/glm", page("glm"));
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

  // Debug view: full raw payload for all four sources + client viewport.
  app.get("/api/raw", async (c) => {
    const [glm, tasks, deepseek, tavily] = await Promise.all([
      getUsage(),
      getTasks(),
      getDeepSeekBalance(),
      getTavilyUsage(),
    ]);
    return c.json({ glm, tasks, deepseek, tavily, client: deps.clientInfo() });
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
