// Lock = a server-side lease (packages/server/src/lock.ts). The client holds
// NO state of its own — no cookie, no token, nothing to clear or steal: it
// asks the server, the server decides. lock() remembers the current tab for
// the return trip; unlock(pin) is verified server-side (a 4-digit PIN with a
// failure ladder — see shared constants) and only flips the reactive flag on
// a 200. Transitions may also arrive over the WS socket (remote lock, lease
// expiry): usePanelState feeds those into the same ref, and App's watch owns
// every side effect in one place.

import { ref } from "vue";

const RETURN_TAB_KEY = "mira-panel-return-tab";

export type UnlockOutcome = "ok" | "wrong" | "unconfigured" | "offline";

export function useLock(initial: boolean) {
  const locked = ref(initial);

  /** A data tab is worth remembering; the clock page is where lock lands. */
  function rememberTab(): void {
    try {
      const path = location.pathname;
      if (path !== "/" && path !== "/clock" && path !== "/index.html")
        localStorage.setItem(RETURN_TAB_KEY, path);
    } catch {
      // private mode &c. — staying on the clock page after unlock is fine
    }
  }

  /** One-shot: read and clear the remembered tab (null = none/clock). */
  function consumeTab(): string | null {
    try {
      const path = localStorage.getItem(RETURN_TAB_KEY);
      localStorage.removeItem(RETURN_TAB_KEY);
      return path;
    } catch {
      return null;
    }
  }

  async function lock(): Promise<void> {
    try {
      await fetch("/api/lock", { method: "POST", headers: { "X-Panel-Write": "1" } });
    } catch {
      // A failed lock POST still navigates below — the server may simply be
      // restarting; the locked clock page is the safe place to land.
    }
    // App's watch owns the navigation; setting the flag fires it once.
    locked.value = true;
  }

  async function unlock(pin: string): Promise<UnlockOutcome> {
    let res: Response;
    try {
      res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "X-Panel-Write": "1", "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
    } catch {
      return "offline";
    }
    if (res.ok) {
      locked.value = false; // App's watch: refresh (+ return-trip navigation)
      return "ok";
    }
    return res.status === 503 ? "unconfigured" : "wrong";
  }

  return { locked, lock, unlock, rememberTab, consumeTab };
}
