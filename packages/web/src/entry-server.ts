// SSR entry: fresh app per request (no cross-request state), rendered with
// the same vapor-compiled components the client hydrates with.

import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { vaporInteropPlugin } from '@vue/runtime-vapor';
import type { PanelState, TabId } from '@mira-panel/shared';
import App from './App.vue';

export async function render(tab: TabId, state: PanelState): Promise<string> {
  const app = createSSRApp(App, { tab, initial: state });
  app.use(vaporInteropPlugin);
  return renderToString(app);
}
