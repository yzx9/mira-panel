// WebSocket transport, ported from the 60s poll loop — the panel's only
// steady-state data path since the subscription refactor. On mount the page
// declares its tab's topics (TOPICS_FOR_TAB); the hub then fetches exactly
// the upstream sources behind them at each source's own cadence and pushes
// the projected slices. Vue reactivity walks the tree, so an update simply
// swaps the affected slice and the DOM (the e-paper) updates where the data
// changed.
//
// Contract kept from the polling version:
//   - build id change -> full reload (hello carries it; the only reload
//     trigger left)
//   - fetch failure keeps the last values and only flags the navbar slot
//     ("⚠ 连接断开" while disconnected; a reconnect self-heals)
//   - vw/vh/dpr ride along on the subscribe message for the server's
//     viewport diagnostics
//   - no timers beyond the transport: countdowns advance when updates carry
//     a fresher `now` (pings deliberately do not)

import { onMounted, onScopeDispose, ref, shallowRef } from "vue";
import {
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  type PanelState,
  type ServerMsg,
  type TabId,
  type TopicPayloadMap,
  type UpdateMsg,
  WATCHDOG_MS,
} from "@mira-panel/shared";

/** Merge one topic payload into the state, copy-on-write so every mutation
 *  swaps a slice reference — concurrent updates on different topics never
 *  mask each other. Partial topics (rail, counts) patch their fields and
 *  leave the rest of the slice exactly as the bootstrap embedded it. */
function applyUpdate(s: PanelState, msg: UpdateMsg): PanelState {
  const { topic, now } = msg;
  // Every payload re-report its slice's Health fields, so each merge stamps
  // them onto the destination slice alongside the data it carries.
  const health = (x: { ok: boolean; stale: boolean; error: string | null; fetchedAt: string }) => ({
    ok: x.ok,
    stale: x.stale,
    error: x.error,
    fetchedAt: x.fetchedAt,
  });
  switch (topic) {
    case "glm:rail": {
      const p = msg.data as TopicPayloadMap["glm:rail"];
      return { ...s, now, glm: { ...s.glm, ...health(p), fiveHour: p.fiveHour } };
    }
    case "glm:quota": {
      const p = msg.data as TopicPayloadMap["glm:quota"];
      return {
        ...s,
        now,
        glm: { ...s.glm, ...health(p), fiveHour: p.fiveHour, weekly: p.weekly, mcp: p.mcp },
      };
    }
    case "glm:usage": {
      const p = msg.data as TopicPayloadMap["glm:usage"];
      return { ...s, now, glm: { ...s.glm, ...health(p), usage: p.usage } };
    }
    case "vikunja:counts": {
      const p = msg.data as TopicPayloadMap["vikunja:counts"];
      return {
        ...s,
        now,
        vikunja: {
          ...s.vikunja,
          ...health(p),
          counts: p.counts,
          truncated: p.truncated,
          buckets: s.vikunja.buckets, // off the vikunja tab there is nothing to fill
        },
      };
    }
    case "vikunja:full": {
      const p = msg.data as TopicPayloadMap["vikunja:full"];
      return { ...s, now, vikunja: { ...p } };
    }
    case "deepseek": {
      const p = msg.data as TopicPayloadMap["deepseek"];
      return { ...s, now, deepseek: { ...p } };
    }
    case "tavily": {
      const p = msg.data as TopicPayloadMap["tavily"];
      return { ...s, now, tavily: { ...p } };
    }
  }
}

export function usePanelState(initial: PanelState, tab: TabId, onLocked?: (v: boolean) => void) {
  const state = shallowRef<PanelState>(initial);
  // Transient navbar acknowledgement ("已刷新 …" / "⚠ 连接断开"). Null on the
  // server and on the first client render, so hydration always agrees.
  const flash = ref<string | null>(null);
  // Set by refresh(true), consumed by the ack that ends the forced round.
  let pendingManual = false;

  let ws: WebSocket | undefined;
  let attempts = 0; // reconnect ladder position, reset on a successful open
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let lastMessageAt = 0;
  let disposed = false;

  function activeStale(s: PanelState): boolean {
    if (tab === "clock") return s.glm.stale || s.vikunja.stale;
    return tab === "vikunja" ? s.vikunja.stale : s.glm.stale;
  }

  function send(msg: unknown): void {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function onMessage(raw: MessageEvent): void {
    lastMessageAt = Date.now();
    let msg: ServerMsg;
    try {
      msg = JSON.parse(String(raw.data)) as ServerMsg;
    } catch {
      return;
    }
    switch (msg.type) {
      case "hello":
        if (msg.build && msg.build !== state.value.build) {
          location.reload();
          return;
        }
        // Level sync: transitions missed while offline self-correct here.
        onLocked?.(msg.locked);
        break;
      case "update":
        state.value = applyUpdate(state.value, msg);
        break;
      case "ack":
        if (pendingManual) {
          pendingManual = false;
          if (!activeStale(state.value))
            flash.value = "已刷新 " + new Date().toLocaleTimeString("zh-CN", { hour12: false });
        }
        break;
      case "locked":
        // Edge-triggered remote transition (another client, or the lease
        // expiring) — the caller routes it into the same reactive flag the
        // local buttons use, so every side effect lives in one watch.
        onLocked?.(msg.locked);
        break;
      case "ping":
        break; // keepalive only — receiving it already fed the watchdog
    }
  }

  function scheduleReconnect(): void {
    if (disposed || retryTimer) return;
    const delay = Math.min(RECONNECT_MIN_MS * 2 ** attempts, RECONNECT_MAX_MS);
    attempts += 1;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      connect();
    }, delay);
  }

  function connect(): void {
    if (disposed) return;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    ws = new WebSocket(url);
    ws.onopen = () => {
      attempts = 0;
      flash.value = null; // clear the disconnect notice once healthy again
      send({
        type: "subscribe",
        tab,
        vw: window.innerWidth,
        vh: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      });
    };
    ws.onmessage = onMessage;
    ws.onclose = () => {
      if (disposed) return;
      // Keep serving the last good numbers; only the health slot complains.
      // No HTTP fallback by design — the socket is the panel's single
      // transport, and the ladder above keeps trying until it comes back.
      flash.value = "⚠ 连接断开";
      scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws?.close();
      } catch {
        // close() already ran — onclose owns the reconnect
      }
    };
  }

  function refresh(manual: boolean): void {
    if (manual) pendingManual = true;
    send({ type: "refresh" });
  }

  // The browser knows better than any ladder when the network returns.
  const onOnline = (): void => {
    if (!retryTimer && ws && ws.readyState !== WebSocket.OPEN) connect();
  };

  onMounted(() => {
    connect();
    // Half-open detection: pings stop arriving -> close -> reconnect ladder.
    lastMessageAt = Date.now();
    watchdog = setInterval(() => {
      if (ws && Date.now() - lastMessageAt > WATCHDOG_MS) {
        try {
          ws.close();
        } catch {
          // already closing — onclose schedules the retry
        }
      }
    }, 15_000);
    window.addEventListener("online", onOnline);
  });

  // Unlock cadence is server-side now: the hub stretches every source the
  // moment the global lock flips (it subscribes to the lock module), so the
  // client neither declares nor polls the lock — it only RECEIVES the
  // hello/locked messages above.

  onScopeDispose(() => {
    disposed = true;
    clearInterval(watchdog);
    clearTimeout(retryTimer);
    // The scope also disposes after the SSR pass, where there is no window —
    // only the transport teardown below is safe there.
    if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
    try {
      ws?.close();
    } catch {
      // dev HMR unmounts mid-connect; the kiosk never does
    }
  });

  return { state, flash, refresh };
}
