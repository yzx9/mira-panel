// Client entry: hydrate the server-rendered panel from the embedded
// bootstrap state. createSSRApp + vaporInteropPlugin is the safe RC setup for
// an all-vapor component tree (the interop plugin lets the VDOM-rooted
// hydrator host vapor components; every component here is compiled vapor).
// vaporInteropPlugin lives in @vue/runtime-vapor — the 'vue' entry points do
// not re-export it in rc.11.

import { createSSRApp } from "vue";
import { vaporInteropPlugin } from "@vue/runtime-vapor";
import type { PanelState, TabId } from "@mira-panel/shared";
import App from "./App.vue";

interface Bootstrap {
  tab: TabId;
  state: PanelState;
  /** Server-authoritative lock at SSR time; hydration starts from it. */
  locked: boolean;
  /** A PIN is configured; locking is refused client-side without one. */
  pinConfigured: boolean;
}

const raw = document.getElementById("panel-state")?.textContent ?? "";
const bootstrap = JSON.parse(raw) as Bootstrap | null;
if (!bootstrap || !bootstrap.state) {
  throw new Error("#panel-state bootstrap JSON missing — the server shell is broken");
}

createSSRApp(App, {
  tab: bootstrap.tab,
  initial: bootstrap.state,
  locked: bootstrap.locked,
  pinConfigured: bootstrap.pinConfigured,
})
  .use(vaporInteropPlugin)
  .mount("#app");
