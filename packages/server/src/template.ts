// HTML shell assembly shared by dev and prod: index.html (source in dev, the
// built dist/client/index.html in prod) carries three markers replaced per
// request — the tab title, the SSR markup, and the serialized bootstrap state.
// Marker presence is asserted at boot so a vite upgrade that strips HTML
// comments fails loudly instead of shipping pages without state.

import type { PanelState, TabId } from "@mira-panel/shared";

export const MARKER_TITLE = "<!--title-->";
export const MARKER_APP_HTML = "<!--app-html-->";
export const MARKER_STATE = "<!--state-->";

export function assertMarkers(shell: string): void {
  for (const marker of [MARKER_TITLE, MARKER_APP_HTML, MARKER_STATE]) {
    if (!shell.includes(marker)) throw new Error(`shell template is missing marker ${marker}`);
  }
}

export interface PageSlots {
  title: string;
  appHtml: string;
  bootstrap: { tab: TabId; state: PanelState; locked: boolean };
}

export function tabTitle(tab: TabId): string {
  if (tab === "vikunja") return "Mira Monitor · Vikunja";
  if (tab === "glm") return "Mira Monitor · GLM 用量";
  return "Mira Monitor · 时钟";
}

/** Replace the markers. Each replacement goes through a function so `$`
 *  sequences in the content can never be read as replace patterns. The
 *  bootstrap JSON escapes `<` so a state value can never close the script
 *  tag from inside the application/json block. */
export function assemble(shell: string, slots: PageSlots): string {
  const json = JSON.stringify(slots.bootstrap).replace(/</g, "\\u003c");
  return shell
    .replace(MARKER_TITLE, () => slots.title)
    .replace(MARKER_APP_HTML, () => slots.appHtml)
    .replace(MARKER_STATE, () => json);
}
