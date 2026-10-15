<script setup vapor lang="ts">
// Root component, deliberately a TWO-ROOT fragment: .screen is a grid with
// rows `116px 1fr` and <header> / .body must be its DIRECT children — a
// wrapper element here would become the single grid child and break layout.
import { watch } from "vue";
import type { PanelState, TabId } from "@mira-panel/shared";
import Navbar from "./components/Navbar.vue";
import TabRail from "./components/TabRail.vue";
import ClockDetail from "./components/clock/ClockDetail.vue";
import GlmDetail from "./components/glm/GlmDetail.vue";
import VikunjaDetail from "./components/vikunja/VikunjaDetail.vue";
import { useClock } from "./composables/useClock";
import { useLock } from "./composables/useLock";
import { usePanelState } from "./composables/usePanelState";

const props = defineProps<{ tab: TabId; initial: PanelState; locked: boolean }>();

const { clockNow } = useClock(props.initial.now);
const { locked, lock, unlock } = useLock(props.locked);
const { state, flash, refresh } = usePanelState(props.initial, props.tab, locked);

// Unlocking should feel immediate: pull fresh data right away (the locked
// poll may be up to 10 minutes stale).
watch(locked, (v) => {
  if (!v) refresh(true);
});

// Honour-system lock: while locked these two are silently ignored — the
// navbar toggle is the only control that still does anything.
function onRefreshData(): void {
  if (locked.value) return;
  refresh(true);
}

function reloadPage(): void {
  if (locked.value) return;
  location.reload();
}

function onToggleLock(): void {
  if (locked.value) unlock();
  else lock(); // persists + navigates to the clock page
}
</script>

<template>
  <Navbar
    :tab="tab"
    :glm="state.glm"
    :vikunja="state.vikunja"
    :flash="flash"
    :locked="locked"
    @refresh-data="onRefreshData"
    @reload-page="reloadPage"
    @toggle-lock="onToggleLock"
  />
  <div class="body">
    <TabRail
      :tab="tab"
      :glm="state.glm"
      :vikunja="state.vikunja"
      :now="state.now"
      :clock-now="clockNow"
      :locked="locked"
    />
    <main>
      <ClockDetail v-if="tab === 'clock'" :clock-now="clockNow" />
      <GlmDetail v-else-if="tab === 'glm'" :glm="state.glm" :now="state.now" />
      <VikunjaDetail v-else :vikunja="state.vikunja" />
    </main>
  </div>
</template>
