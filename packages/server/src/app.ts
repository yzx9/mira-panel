// The Hono application: response headers, route table and error handling,
// ported from the previous server.mjs. Page rendering is injected via deps
// because it differs between dev (vite ssrLoadModule) and prod (the built
// entry-server bundle). The hub likewise arrives via deps so each entry
// binds it to its own build id.

import { Hono } from "hono";
import type { Context } from "hono";

import type { PanelState, TabId, VikunjaState } from "@mira-panel/shared";

import { markTaskDone } from "./data/vikunja.ts";
import type { Hub } from "./hub.ts";
import type { LockModule } from "./lock.ts";
import { serveStatic, type StaticResult } from "./staticFiles.ts";
import { stateFor, vikunjaState } from "./state.ts";
import type { ClientViewport } from "./viewport.ts";

export type RenderPage = (
  tab: TabId,
  state: PanelState,
  locked: boolean,
  pinConfigured: boolean,
) => Promise<string>;

export interface AppDeps {
  build: string;
  hub: Hub;
  /** Server-authoritative lock: the single seam pages, the write route and
   *  the hub cadence all read. */
  lock: LockModule;
  /** Undefined when the web bundle is missing -> pages answer 503. */
  renderPage?: RenderPage;
  /** Searched in order for the static fallback. */
  staticRoots: string[];
  clientInfo: () => ClientViewport | null;
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

  // Per-task in-flight completions: a double tap shares one request (and
  // re-marking a done task done is idempotent upstream anyway).
  const marking = new Map<number, Promise<VikunjaState>>();

  // The single deliberate write path, registered BEFORE the method guard
  // below: Hono composes matching handlers in registration order and a route
  // handler that answers is terminal, so this POST never reaches the guard.
  // The X-Panel-Write header forces a CORS preflight for cross-site writers
  // — a preflight this server never answers, which is the CSRF story.
  app.post("/api/vikunja/tasks/:id/done", async (c) => {
    if (deps.lock.isLocked()) return c.text("Panel is locked", 403);
    if (c.req.header("X-Panel-Write") !== "1") return c.text("Missing X-Panel-Write header", 400);
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.text("Bad task id", 400);
    const run =
      marking.get(id) ??
      (async () => {
        await markTaskDone(id);
        // Force-refresh through the hub: the answer reflects the write AND
        // every subscriber's vikunja topic gets the same push.
        return vikunjaState(await deps.hub.forceRefresh("vikunja"));
      })();
    marking.set(id, run);
    try {
      return c.json(await run);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("HTTP 403"))
        return c.text("Vikunja rejected the write — token is likely read-only", 502);
      throw err; // -> onError -> 500 (the client flashes a generic failure)
    } finally {
      marking.delete(id);
    }
  });

  // Lock transitions, same registration position and CSRF story as the write
  // route above. lockAll is idempotent; unlockWithPin owns the failure
  // ladder, so bursts are throttled here rather than at the route.
  app.post("/api/lock", async (c) => {
    if (c.req.header("X-Panel-Write") !== "1") return c.text("Missing X-Panel-Write header", 400);
    await deps.lock.lockAll();
    return c.json({ ok: true });
  });

  app.post("/api/unlock", async (c) => {
    if (c.req.header("X-Panel-Write") !== "1") return c.text("Missing X-Panel-Write header", 400);
    let pin: unknown;
    try {
      pin = (await c.req.json()).pin;
    } catch {
      return c.text("Bad JSON body", 400);
    }
    if (typeof pin !== "string") return c.text("Bad pin", 400);
    const result = await deps.lock.unlockWithPin(pin);
    if (result.ok) return c.json({ ok: true });
    // 503 = no PIN configured (locking was refused client-side; this is the
    // belt to that braces) — 403 = wrong PIN, already ladder-delayed.
    return c.text(
      result.configured ? "Wrong PIN" : "PIN not configured",
      result.configured ? 403 : 503,
    );
  });

  // Mac presence: renew (present:true) or say goodbye (present:false — the
  // Mac's screen locked). Deliberately NOT gated by the locked-403: this IS
  // an unlock channel; the long random device key is the whole gate.
  app.post("/api/presence", async (c) => {
    if (c.req.header("X-Panel-Write") !== "1") return c.text("Missing X-Panel-Write header", 400);
    let body: { key?: unknown; present?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.text("Bad JSON body", 400);
    }
    if (typeof body.key !== "string" || typeof body.present !== "boolean")
      return c.text("Bad body", 400);
    const result = await deps.lock.setPresence(body.key, body.present);
    if (result.ok) return c.json({ ok: true });
    return c.text(
      result.reason === "wrong" ? "Wrong device key" : "Device key not configured",
      result.reason === "wrong" ? 403 : 503,
    );
  });

  // Old server answered GET/HEAD only — except the POST routes above.
  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      return c.text("Method Not Allowed", 405);
    }
    await next();
  });

  app.get("/healthz", (c) => c.text("ok\n"));

  // One tab = one URL = one SSR pass. No client-side routing, so a tab switch
  // is a normal navigation the e-paper repaints anyway. The bootstrap is
  // tab-aware: stateFor embeds exactly the slices the tab's WS topics carry.
  const page = (tab: TabId) => async (c: Context) => {
    if (!deps.renderPage) return c.text("web package not built — run `npm run build` first", 503);
    const locked = deps.lock.isLocked();
    // A locked panel only ever shows the clock: the data tabs redirect there,
    // so the lock holds at the URL level too, not just the rail's click guard.
    if (locked && tab !== "clock") return c.redirect("/");
    return c.html(
      await deps.renderPage(
        tab,
        await stateFor(deps.hub, tab, deps.build),
        locked,
        deps.lock.pinConfigured(),
      ),
    );
  };
  const clockPage = page("clock");
  app.get("/", clockPage);
  app.get("/clock", clockPage);
  app.get("/index.html", clockPage);
  app.get("/glm", page("glm"));
  app.get("/vikunja", page("vikunja"));

  // Debug view: every source's cached state + the client viewport. The old
  // /api/state poll is gone with the poll itself — the panel's steady-state
  // transport is the /ws socket (ws.ts).
  app.get("/api/raw", (c) => {
    return c.json({ sources: deps.hub.dump(), client: deps.clientInfo() });
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
