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

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize, resolve } from "node:path";

import { getUsage, toDom } from "./usage.mjs";
import { getTasks, tasksSignature, tasksTexts } from "./vikunja.mjs";
import { renderPage } from "./render.mjs";

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 15932);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "public");

// Build id for the running code. The panel compares it on every 60s poll and
// reloads itself when it changes, so a deploy reaches the kiosk unattended.
const BUILD = await computeBuild();

async function computeBuild() {
  const here = dirname(fileURLToPath(import.meta.url));
  const parts = await Promise.all(
    ["server.mjs", "usage.mjs", "render.mjs", "vikunja.mjs"].map(async (name) => {
      const info = await stat(join(here, name));
      return `${name}:${info.size}:${Math.round(info.mtimeMs)}`;
    }),
  );
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 8);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

/** Map a request path to a file inside ROOT, refusing path traversal. */
function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const abs = join(ROOT, rel);
  return abs.startsWith(ROOT) ? abs : null;
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

function sendJson(res, req, payload) {
  const body = JSON.stringify(payload);
  return send(res, 200, req.method === "HEAD" ? "" : body, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
}

// The viewport the kiosk last reported. A viewport smaller than the 2200x1650
// design canvas is the usual reason "the layout does not fit", so record it
// instead of guessing — the page scales itself to fit and tells us the numbers.
let lastClient = null;

function noteClientViewport(q) {
  const vw = Number(q.get("vw"));
  const vh = Number(q.get("vh"));
  if (!vw || !vh) return;
  const dpr = Number(q.get("dpr")) || 1;
  const stamp = `${vw}x${vh} @${dpr}x`;
  if (lastClient?.stamp === stamp) return;
  lastClient = { stamp, at: new Date().toISOString().slice(11, 19) };
  const fit = Math.min(vw / 2200, vh / 1650).toFixed(3);
  process.stderr.write(`[mira-panel] kiosk viewport ${stamp}  ->  canvas scaled ${fit}\n`);
}

/** Structural GLM bits that cannot be patched as text -> part of the page signature. */
function glmSignature(glm) {
  return createHash("sha1")
    .update(
      JSON.stringify({
        level: glm.level,
        fiveHour: Boolean(glm.fiveHour),
        weekly: Boolean(glm.weekly),
        mcp: glm.mcp?.details?.map((d) => d.name) ?? null,
        models: glm.usage?.models?.map((m) => m.name) ?? null,
        hours: glm.usage?.hourlyTokens?.length ?? 0,
      }),
    )
    .digest("hex")
    .slice(0, 8);
}

/** Everything the page (and its 60s poll) needs, for one tab. */
async function stateFor(tab) {
  const [glm, tasks] = await Promise.all([getUsage(), getTasks()]);
  const glmDom = toDom(glm);
  const tasksDom = { texts: tasksTexts(tasks) };
  const vikunja = tab === "vikunja";

  const texts = { ...glmDom.texts, ...tasksDom.texts };
  texts["fetched-at"] = vikunja ? tasks.fetchedAt : glm.fetchedAt;
  texts["health-mark"] = vikunja ? (tasks.ok ? "正常" : "⚠ 数据陈旧") : glmDom.texts["health-mark"];
  texts["head-count"] = String(tasks.counts?.open ?? "—");

  const active = vikunja ? tasks : glm;
  return {
    tab,
    build: BUILD,
    signature: vikunja ? `${BUILD}:v:${tasksSignature(tasks)}` : `${BUILD}:g:${glmSignature(glm)}`,
    texts,
    bars: glmDom.bars,
    stale: Boolean(active.stale),
    error: active.error ?? null,
    glm,
    tasks,
    glmDom,
    tasksDom,
  };
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];

  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, "Method Not Allowed", { "Content-Type": "text/plain" });
    }

    // Tiny health probe for curl / watchdogs — no filesystem or API access.
    if (path === "/healthz") {
      return send(res, 200, "ok\n", { "Content-Type": "text/plain" });
    }

    // Panel pages: one tab = one URL = one SSR pass. No client-side routing,
    // so a tab switch is a normal navigation the e-paper repaints anyway.
    if (path === "/" || path === "/glm" || path === "/index.html" || path === "/vikunja") {
      const state = await stateFor(path === "/vikunja" ? "vikunja" : "glm");
      const html = renderPage(state);
      return send(res, 200, req.method === "HEAD" ? "" : html, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(html),
      });
    }

    // What the 60s client poll patches text nodes from (kept lean on purpose).
    if (path === "/api/state" || path === "/api/usage") {
      const q = new URL(req.url, "http://localhost").searchParams;
      const tab = q.get("tab") === "vikunja" ? "vikunja" : "glm";
      noteClientViewport(q);
      const state = await stateFor(tab);
      return sendJson(res, req, {
        build: state.build,
        signature: state.signature,
        texts: state.texts,
        bars: state.bars,
        stale: state.stale,
        error: state.error,
      });
    }

    // Debug view: full normalised payload for both sources + client viewport.
    if (path === "/api/raw") {
      const state = await stateFor("glm");
      return sendJson(res, req, { glm: state.glm, tasks: state.tasks, client: lastClient });
    }

    const file = resolvePath(path);
    if (!file) return send(res, 400, "Bad Request", { "Content-Type": "text/plain" });

    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) {
      return send(res, 404, "Not Found", { "Content-Type": "text/plain" });
    }

    const body = await readFile(file);
    return send(res, 200, req.method === "HEAD" ? "" : body, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Content-Length": body.length,
    });
  } catch (err) {
    process.stderr.write(
      `[mira-panel] ${req.method} ${req.url} failed: ${err.stack ?? err.message}\n`,
    );
    return send(res, 500, "Internal Server Error", { "Content-Type": "text/plain" });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`[mira-panel] panel + static (${ROOT}) on http://${HOST}:${PORT}/\n`);
});
