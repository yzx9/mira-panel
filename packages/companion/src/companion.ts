// Mira panel companion: a receive-only macOS notifier. It keeps one
// WebSocket to the panel, hears the lock transitions the server broadcasts,
// and turns them into macOS notifications — 「面板已解锁」 rides along with a
// best-effort summary stashed from the last updates (the summary IS just a
// data update, never a blocker: the unlock notification fires the instant
// the transition arrives).
//
// Subscribes as the clock tab (glm:rail + vikunja:counts): exactly the
// slices a notification summary needs, nothing heavier.
//
// ZERO npm dependencies on purpose: the flake's darwin module runs this file
// straight from the flake store path, and flake sources exclude node_modules
// (only git-tracked files are copied). Node >= 22 ships a spec WebSocket
// client as a global, which is all a subscriber ever needs.
//
// It sends nothing but the subscribe frame — no lock, no unlock, no refresh;
// the remote-control directions stay server-gated POST routes for a later
// phase. Presence-aware auto-unlock leases are likewise deferred (see the
// README's lock section).

import { spawn } from "node:child_process";
import type { GlmRailPayload, ServerMsg, VikunjaCountsPayload } from "@mira-panel/shared";
import { RECONNECT_MAX_MS, RECONNECT_MIN_MS, WATCHDOG_MS } from "@mira-panel/shared";

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
