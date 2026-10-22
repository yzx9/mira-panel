# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

mira-panel is a glance panel for an e-paper kiosk (BOOX Mira screen driven by a Raspberry Pi Firefox kiosk; the panel runs on any browser). Vue 3.6 RC (Vapor) + Vite 8 + Hono 4 + TypeScript, npm-workspaces monorepo, deployed on a home LAN at port 15932. The README (Chinese) is the authoritative deep documentation — the section names below are where to look before changing things.

## Commands

```bash
npm run typecheck        # THE type gate (runtime does none): tsc/vue-tsc across shared/server/web/companion
npm test                 # node:test for shared + server only (web has none, companion typecheck only)
cd packages/server && node --test src/lock.test.ts            # single test file
cd packages/server && node --test --test-name-pattern 'backoff' 'src/**/*.test.ts'   # single case
npm run dev              # dev: node:http + Vite middleware (SSR/HMR) + Hono
npm run build            # double Vite build → packages/web/dist/{client,server}
npm start                # production Hono server (needs build first)
npm run fmt / fmt:check  # oxfmt, default config; the only formatter
```

Nix flake devShell via direnv (`direnv allow`, `use flake`): nodejs_24 (native type-stripping — server runs `.ts` directly, imports carry `.ts` extensions via `allowImportingTsExtensions`) and chromium for screenshot acceptance.

Service lifecycle via `justfile`: `just status` / `just restart` / `just deploy` (build + restart — the post-merge recipe) / `just logs`. `scripts/restart-service.sh` refuses worktrees unless `--force`; a preview started from a worktree (`just restart force`) inherits the main checkout's `.env` via `PANEL_ENV_FILE`. Never delete a worktree while its preview server runs (ghost-process incident, 2026-10-15). The kiosk only full-reloads when the build id changes — build without restart changes nothing on screen.

Acceptance for web changes (README「验收工作流」): typecheck + tests + build, headless-chromium screenshot diff at 2200×1650, zero hydration warnings, `curl -s /glm` readable without JS.

## Architecture

- `packages/shared` — the single contract: `PanelState` view model, WS topic map (`topics.ts`), formatters, constants. Every displayed string comes from a shared formatter (explicit `'en-US'` locale); SSR bootstrap and WS push use the same projection, the client never normalizes data.
- `packages/server` — Hono app (`app.ts`) + subscription hub (`hub.ts`) + pure data fetchers (`data/`). Clients subscribe on `/ws` with topics; the hub maps topics to sources and owns timers, cache, in-flight dedup, and stale-on-error. **Data layers are pure fetchers that throw** — cadence/caching contract lives entirely in the hub. Only subscribed sources get timers; locked mode gear-shifts all cadences globally. Every fetch path honors an upstream floor (max(cadence, floor)) — repeated unlock/refresh cannot punch through rate limits (only exception: force-refresh after marking a task done).
- `packages/web` — all-Vapor SFCs, SSR + hydrate. Tabs are plain links (no router). Styles are a global `<link>` (`epaper.css`), never JS-imported: the page must be readable with styles and without JS.
- `packages/companion` — zero-dependency Node daemon on the controller device (a role, currently a Mac): WS notifier + presence sensor. Presence: screen-unlock events (via `screen-watch.swift`, compiled by the flake with swiftc) hold a 5-minute renewable lease; `present:false` clears ALL leases. Key: `PANEL_CONTROLLER_KEY`, plaintext compare, re-read per request.
- Locking (`server/src/lock.ts`): server-authoritative lease table — "unlocked" means an unexpired lease exists. 4-digit PIN (`PANEL_PIN`) + exponential backoff ladder; leases persist to `${XDG_RUNTIME_DIR}/mira-panel/leases.json` (machine reboot = everything relocks, the last escape hatch).
- Secrets/config (`server/src/secrets.ts`): repo-root `.env` (git-ignored, see `.env.example`), resolved per call as env var → `PANEL_ENV_FILE` → repo `.env`. Rotating a key needs no restart.

## Hard rules

- Never print, echo, or inline `.env` values — not into commands, logs, or prompts (tool-call args are logged verbatim by the harness's state db). Secret values live only in server memory.
- No hardcoded instance URLs, IPs, hostnames, or user paths in code or docs — config only (`VIKUNJA_API` has no default by design; a missing knob must produce the source's own honest error). Git history was scrubbed of real endpoints on 2026-10-22; docs use placeholders (`<panel-host>`, `192.0.2.0/24` doc range). Never reintroduce real ones.
- The four write routes (task-done, lock, unlock, presence) require the `X-Panel-Write: 1` header; presence is deliberately NOT blocked while locked (it is the unlock channel).
- Upstream auth quirks (verified, load-bearing): GLM wants the raw key — a `Bearer` prefix fails auth; Vikunja v1 updates must be POST with `Content-Type: application/json` (PUT/PATCH → 405); Vikunja silently clamps `per_page` to 50.
- E-paper design constraints (README「电子纸约束」): pure `#000`/`#fff`, zero animation/transitions, `tabular-nums`, fixed 2200×1650 canvas scaled with `transform`, single-rule principle (one separator line, never double frames), inverted colors only for interaction states. Vapor pitfalls (README「Vue/Vapor 侧的坑」): explicit `<tbody>` in tables, `App.vue` must stay a two-root fragment, never add per-fetch fields to the build-id reload check.
- Comments and commit messages in English; README and UI copy stay Chinese.
- Pushing to origin (github.com/yzx9/mira-panel) is the user's manual decision — never push on your own.
