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
}

const raw = document.getElementById("panel-state")?.textContent ?? "";
const bootstrap = JSON.parse(raw) as Bootstrap | null;
if (!bootstrap || !bootstrap.state) {
  throw new Error("#panel-state bootstrap JSON missing — the server shell is broken");
}

createSSRApp(App, { tab: bootstrap.tab, initial: bootstrap.state })
  .use(vaporInteropPlugin)
  .mount("#app");
