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
