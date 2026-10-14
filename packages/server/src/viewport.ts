// The viewport the kiosk last reported (the 60s poll carries vw/vh/dpr). A
// viewport smaller than the 2200x1650 design canvas is the usual reason "the
// layout does not fit", so record it instead of guessing — the page scales
// itself to fit and tells us the numbers. Surfaced via /api/raw's client key;
// when a layout looks wrong, check this first instead of eyeballing.

import { CANVAS_H, CANVAS_W } from "@mira-panel/shared";

export interface ClientViewport {
  stamp: string;
  at: string;
}

let lastClient: ClientViewport | null = null;

/** Accepts anything with a URLSearchParams-style .get() so Hono's query
 *  proxy can be passed straight through. */
export function noteClientViewport(params: { get(name: string): string | null | undefined }): void {
  const vw = Number(params.get("vw"));
  const vh = Number(params.get("vh"));
  if (!vw || !vh) return;
  const dpr = Number(params.get("dpr")) || 1;
  const stamp = `${vw}x${vh} @${dpr}x`;
  if (lastClient?.stamp === stamp) return;
  lastClient = { stamp, at: new Date().toISOString().slice(11, 19) };
  const fit = Math.min(vw / CANVAS_W, vh / CANVAS_H).toFixed(3);
  process.stderr.write(`[mira-panel] kiosk viewport ${stamp}  ->  canvas scaled ${fit}\n`);
}

export const lastViewport = (): ClientViewport | null => lastClient;
