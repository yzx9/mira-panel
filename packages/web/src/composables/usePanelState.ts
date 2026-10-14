// 60s poll loop, ported from the previous inline patcher script — except the
// patching itself: Vue reactivity now walks the tree, so a poll simply swaps
// the whole state ref and the DOM updates where the data changed.
//
// Contract kept from the vanilla version:
//   - build id change -> full reload (the only reload trigger left; the old
//     signature mechanism existed only because the patcher couldn't do
//     structure — never reintroduce it)
//   - fetch failure keeps the last values and only flags the navbar slot
//   - vw/vh/dpr ride along for the server's viewport diagnostics
//   - no timers beyond the poll: countdowns advance when the state advances

import { onMounted, onScopeDispose, ref, shallowRef } from "vue";
import { POLL_MS, type PanelState, type TabId } from "@mira-panel/shared";

export function usePanelState(initial: PanelState, tab: TabId) {
  const state = shallowRef<PanelState>(initial);
  // Transient navbar acknowledgement ("已刷新 …" / "⚠ 请求失败"). Null on the
  // server and on the first client render, so hydration always agrees.
  const flash = ref<string | null>(null);
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  function activeStale(s: PanelState): boolean {
    return tab === "vikunja" ? s.vikunja.stale : s.glm.stale;
  }

  async function poll(manual: boolean): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      const qs = `?vw=${window.innerWidth}&vh=${window.innerHeight}&dpr=${window.devicePixelRatio || 1}`;
      const res = await fetch(`/api/state${qs}`, { cache: "no-store" });
      const payload = (await res.json()) as PanelState;
      if (payload.build && payload.build !== state.value.build) {
        location.reload();
        return;
      }
      state.value = payload;
      flash.value = null; // the previous ack is one poll old now
      if (manual && !activeStale(payload)) {
        flash.value = "已刷新 " + new Date().toLocaleTimeString("zh-CN", { hour12: false });
      }
    } catch {
      // Keep serving the last good numbers; only the health slot complains.
      flash.value = "⚠ 请求失败";
    } finally {
      inFlight = false;
    }
  }

  onMounted(() => {
    timer = setInterval(() => {
      void poll(false);
    }, POLL_MS);
  });
  onScopeDispose(() => clearInterval(timer)); // dev HMR unmounts; the kiosk never does

  return { state, flash, refresh: (manual: boolean) => void poll(manual) };
}
