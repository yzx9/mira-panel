// Fixed design canvas of the BOOX Mira kiosk: 2200x1650, 1 CSS px = 1 physical
// px. The page scales itself to the real viewport around these numbers (the
// inline fit script in index.html uses them before first paint).
export const CANVAS_W = 2200;
export const CANVAS_H = 1650;

// Panel refresh cadence: the client polls /api/state every minute. E-paper
// friendly — a poll only rewrites the digits that actually changed.
export const POLL_MS = 60_000;

// How many task rows each Vikunja bucket table shows before the "另有 N 项"
// note. Counts in the card headers always show the full numbers.
export const CAP_TODAY = 7;
export const CAP_SOON = 7;
export const CAP_OVERDUE = 5;
