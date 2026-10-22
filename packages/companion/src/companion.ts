// Mira panel companion: macOS notifier + presence sensor. It keeps one
// WebSocket to the panel, hears the lock transitions the server broadcasts,
// and turns them into macOS notifications — 「面板已解锁」 rides along with a
// best-effort summary stashed from the last updates (the summary IS just a
// data update, never a blocker: the unlock notification fires the instant
// the transition arrives).
//
// Subscribes as the clock tab (glm:rail + vikunja:counts): exactly the
// slices a notification summary needs, nothing heavier.
//
// PRESENCE: when PANEL_SCREEN_HELPER (the compiled screen-watch.swift) and
// PANEL_CONTROLLER_KEY_FILE are configured, the companion also drives the panel's
// "controller" lease — screen unlocked -> POST /api/presence {present:true} now
// and every PRESENCE_RENEW_MS; screen locked -> {present:false} once, which
// re-locks the panel immediately (the 5-minute lease TTL is only the
// fallback for a goodbye lost to sleep/network). Manual kiosk locks are
// honoured: a locked:true broadcast sets a hold that stops renewals until
// the screen cycles unlocked again — otherwise the next renewal tick would
// silently undo the lock button.
//
// ZERO npm dependencies on purpose: the flake's darwin module runs this file
// straight from the flake store path, and flake sources exclude node_modules
// (only git-tracked files are copied). Node >= 22 ships a spec WebSocket
// client as a global, which is all a subscriber ever needs. Without the two
// presence env vars the script is exactly the notifier it always was.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { GlmRailPayload, ServerMsg, VikunjaCountsPayload } from "@mira-panel/shared";
import {
  PRESENCE_RENEW_MS,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  WATCHDOG_MS,
} from "@mira-panel/shared";

// Minimal ambient surface of the global WebSocket — the companion never
// leaves the client half of the spec.
interface PanelSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open", cb: () => void): void;
  addEventListener(type: "close", cb: () => void): void;
  addEventListener(type: "error", cb: () => void): void;
  addEventListener(type: "message", cb: (ev: { data: string }) => void): void;
}
declare const WebSocket: new (url: string) => PanelSocket;

// ?? "" fixes the type as string: control-flow narrowing would not follow
// url into the connect() closure below.
const url = process.env.PANEL_URL ?? "";
if (!url) {
  process.stderr.write("[companion] PANEL_URL is required, e.g. ws://panel-host:15932/ws\n");
  process.exit(2);
}
// Same origin, HTTP side: ws://host:port/ws -> http://host:port
const httpBase = url.replace(/^ws/, "http").replace(/\/ws$/, "");

const keyFile = process.env.PANEL_CONTROLLER_KEY_FILE;
const helperPath = process.env.PANEL_SCREEN_HELPER;
const presenceConfigured = keyFile !== undefined && helperPath !== undefined;

// Best-effort summary stash; null until the first updates arrive.
let fiveHourPct: number | null = null;
let todayCount: number | null = null;

/** macOS notification via osascript; strings are escaped, never shell-joined. */
function notify(body: string): void {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const child = spawn(
    "osascript",
    ["-e", `display notification "${esc(body)}" with title "Mira Monitor"`],
    {
      stdio: "ignore",
    },
  );
  child.on("error", () => {
    process.stderr.write("[companion] osascript failed — run this on macOS\n");
  });
}

function summary(): string {
  const parts: string[] = [];
  if (fiveHourPct !== null) parts.push(`GLM 5h 池 ${fiveHourPct}%`);
  if (todayCount !== null) parts.push(`今日待办 ${todayCount} 项`);
  return parts.length > 0 ? `（${parts.join(" · ")}）` : "";
}

// ------------------------------------------------------------------ presence

let screenUnlocked: boolean | null = null; // null = unknown -> never renew
let presenceHold = false; // a live locked:true broadcast; cleared by unlock
let warnedKey = false;
let warnedRejected = false;
let warnedPresenceFail = false;

/** Read the device key fresh per POST: rotating the key file takes effect
 *  on the next transition, no agent restart. launchd does not expand `~`. */
async function readKey(): Promise<string | null> {
  if (keyFile === undefined) return null;
  const path = keyFile.startsWith("~/") ? join(homedir(), keyFile.slice(2)) : keyFile;
  try {
    const key = (await readFile(path, "utf8")).trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

async function presencePost(present: boolean): Promise<void> {
  const key = await readKey();
  if (key === null) {
    if (!warnedKey) {
      warnedKey = true;
      process.stderr.write(`[companion] device key unreadable (${keyFile}) — presence idle\n`);
    }
    return;
  }
  warnedKey = false;
  try {
    const res = await fetch(`${httpBase}/api/presence`, {
      method: "POST",
      headers: { "X-Panel-Write": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ key, present }),
    });
    if (res.ok) {
      warnedPresenceFail = false;
      warnedRejected = false;
      return;
    }
    if (res.status === 403) {
      // Wrong key: the server knows a different secret — say it once, not
      // once per renewal tick.
      if (!warnedRejected) {
        warnedRejected = true;
        process.stderr.write(
          "[companion] PANEL_CONTROLLER_KEY mismatch — presence rejected (403)\n",
        );
      }
      return;
    }
    if (!warnedPresenceFail) {
      warnedPresenceFail = true;
      process.stderr.write(`[companion] presence POST failed: HTTP ${res.status}\n`);
    }
  } catch {
    // Best effort by design: an unreachable panel is the reconnect ladder's
    // problem; a lost present:false is bounded by the lease TTL.
    if (!warnedPresenceFail) {
      warnedPresenceFail = true;
      process.stderr.write("[companion] presence POST unreachable (will retry on next tick)\n");
    }
  }
}

function presenceTick(): void {
  if (screenUnlocked === true && !presenceHold) void presencePost(true);
}

/** One screen line, initial or event — the single presence decision point. */
function onScreen(state: "locked" | "unlocked"): void {
  if (!presenceConfigured) return;
  if (state === "unlocked") {
    screenUnlocked = true;
    presenceHold = false; // the screen cycling clears a manual-lock hold
    void presencePost(true); // immediate: unlock reaches the panel in ~1s
  } else {
    screenUnlocked = false;
    // Best effort: sleep/close can eat this POST; the lease TTL re-locks.
    void presencePost(false);
  }
}

if (presenceConfigured) {
  // Screen events from the compiled screen-watch.swift, line-delimited.
  let helperAttempts = 0;
  let helperTimer: ReturnType<typeof setTimeout> | undefined;

  function spawnHelper(): void {
    if (helperPath === undefined) return;
    const child = spawn(helperPath, [], { stdio: ["ignore", "pipe", "ignore"] });
    let buffer = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line === "locked" || line === "unlocked") onScreen(line);
      }
    });
    child.on("error", (err) => {
      // ENOENT/ENOEXEC: not a build problem a respawn can fix — presence
      // off, notifications unaffected, one honest stderr line.
      process.stderr.write(`[companion] screen helper unusable (${err}) — presence disabled\n`);
      screenUnlocked = null;
    });
    child.on("exit", () => {
      // Crash/OOM: pessimistic state (stop renewing) and a doubling respawn
      // ladder, 1s -> 60s cap.
      screenUnlocked = null;
      if (helperTimer) return;
      const delay = Math.min(1000 * 2 ** helperAttempts, 60_000);
      helperAttempts += 1;
      helperTimer = setTimeout(() => {
        helperTimer = undefined;
        spawnHelper();
      }, delay);
    });
    // A successful spawn resets the ladder once it has said anything.
    child.stdout!.once("data", () => {
      helperAttempts = 0;
    });
  }
  spawnHelper();

  setInterval(presenceTick, PRESENCE_RENEW_MS);
}

// ------------------------------------------------------------------ notifier

let ws: PanelSocket | undefined;
let attempts = 0; // reconnect ladder position, reset on a successful open
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let lastMessageAt = Date.now();

function scheduleReconnect(): void {
  if (retryTimer) return;
  const delay = Math.min(RECONNECT_MIN_MS * 2 ** attempts, RECONNECT_MAX_MS);
  attempts += 1;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    connect();
  }, delay);
}

function connect(): void {
  ws = new WebSocket(url);
  ws.addEventListener("open", () => {
    attempts = 0;
    ws!.send(JSON.stringify({ type: "subscribe", tab: "clock" }));
  });
  ws.addEventListener("message", (ev) => {
    lastMessageAt = Date.now();
    let msg: ServerMsg;
    try {
      msg = JSON.parse(ev.data) as ServerMsg;
    } catch {
      return; // a malformed frame never kills the connection
    }
    switch (msg.type) {
      case "locked":
        // The transitions the companion exists for. Unlock never waits for
        // data: fresh numbers land as ordinary updates a beat later.
        notify(msg.locked ? "面板已锁定" : `面板已解锁${summary()}`);
        // Presence hold: a LIVE locked broadcast is a manual kiosk lock —
        // stop renewing until the screen cycles, or the next tick would
        // undo the lock button. hello.locked (reconnect level) deliberately
        // does not set this: that may be our own lease lapsing offline.
        if (presenceConfigured && msg.locked) presenceHold = true;
        break;
      case "update":
        if (msg.topic === "glm:rail")
          fiveHourPct = (msg.data as GlmRailPayload).fiveHour?.pct ?? null;
        if (msg.topic === "vikunja:counts")
          todayCount = (msg.data as VikunjaCountsPayload).counts?.today ?? null;
        break;
      default:
        break; // hello/ping/ack feed the watchdog by arriving at all
    }
  });
  ws.addEventListener("close", () => scheduleReconnect());
  ws.addEventListener("error", () => {
    try {
      ws?.close();
    } catch {
      // already closing — the close listener owns the reconnect
    }
  });
}

connect();

// Half-open detection, same contract as the panel page: the server speaks
// JSON pings; silence past the watchdog window means reconnect.
setInterval(() => {
  if (Date.now() - lastMessageAt > WATCHDOG_MS) {
    lastMessageAt = Date.now();
    try {
      ws?.close();
    } catch {
      // already gone — the close listener schedules the retry
    }
  }
}, 15_000);
