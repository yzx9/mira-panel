// Fixed design canvas of the BOOX Mira kiosk: 2200x1650, 1 CSS px = 1 physical
// px. The page scales itself to the real viewport around these numbers (the
// inline fit script in index.html uses them before first paint).
export const CANVAS_W = 2200;
export const CANVAS_H = 1650;

// WebSocket keepalive: the server sends an app-level JSON ping at this
// cadence (browser WS ping frames never wake JS, so the client could not
// watch them). Any message resets the client's watchdog.
export const PING_MS = 30_000;

// Client watchdog: no server message for this long means the connection is
// half-open — close it and reconnect. Two missed pings plus slack.
export const WATCHDOG_MS = 120_000;

// Reconnect backoff after a dropped connection: doubles per failed attempt,
// capped. A successful open resets the ladder; the browser "online" event
// triggers an immediate retry on top of the ladder.
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

// Row slots the /vikunja task card shows per page: one slot per task row or
// per bucket header. Tuned for the 2200x1650 canvas WITH the kiosk's airy
// 14px row padding (mis-taps on adjacent rows were real at a tighter
// rhythm); paging is client-side over the full bucket lists.
export const LIST_PAGE_ROWS = 14;

// Lock lease: unlocking issues a lease for this long, from the moment of
// unlock (it does not extend with activity; re-unlocking re-issues). When
// every lease has expired the panel re-locks itself and broadcasts the
// transition. Leases live in server memory + a runtime-dir file only.
export const LOCK_LEASE_MS = 30 * 60_000;

// Mac presence lease: while the Mac's screen is unlocked the companion
// renews the "mac" lease every PRESENCE_RENEW_MS; the screen locking (or the
// Mac vanishing) stops the renewals, so the panel re-locks within
// PRESENCE_LEASE_MS of the last renewal even if the explicit goodbye POST is
// lost. Two missed renewals drop the lease; one missed renewal survives.
export const PRESENCE_LEASE_MS = 5 * 60_000;
export const PRESENCE_RENEW_MS = 2 * 60_000;

// PIN throttle: a wrong PIN is answered after min(base * 2^(n-1), max)
// where n is the consecutive-failure count; success — or this long without
// an attempt — clears the ladder. With a 10^4 keyspace this ladder, not the
// comparison, is the real brute-force defence (see README's lock section).
export const PIN_BACKOFF_BASE_MS = 400;
export const PIN_BACKOFF_MAX_MS = 10 * 60_000;
export const PIN_BACKOFF_RESET_MS = 15 * 60_000;
