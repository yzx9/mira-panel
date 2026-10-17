// Fixed design canvas of the BOOX Mira kiosk: 2200x1650, 1 CSS px = 1 physical
// px. The page scales itself to the real viewport around these numbers (the
// inline fit script in index.html uses them before first paint).
export const CANVAS_W = 2200;
export const CANVAS_H = 1650;

// Panel refresh cadence: the client polls /api/state every minute. E-paper
// friendly — a poll only rewrites the digits that actually changed.
export const POLL_MS = 60_000;

// Locked-mode cadence: the data tabs are decorative while locked, so the poll
// slows down to keep the e-paper and the upstreams quiet. The clock itself
// still ticks every minute (client-side, no fetch).
export const LOCK_POLL_MS = 10 * 60_000;

// Row slots the /vikunja task card shows per page: one slot per task row or
// per bucket header. Tuned for the 2200x1650 canvas WITH the kiosk's airy
// 14px row padding (mis-taps on adjacent rows were real at a tighter
// rhythm); paging is client-side over the full bucket lists.
export const LIST_PAGE_ROWS = 14;
