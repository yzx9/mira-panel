<script setup vapor lang="ts">
// Root component, deliberately a TWO-ROOT fragment: .screen is a grid with
// rows `116px 1fr` and <header> / .body must be its DIRECT children — a
// wrapper element here would become the single grid child and break layout.
import type { PanelState, TabId } from "@mira-panel/shared";
import Navbar from "./components/Navbar.vue";
import TabRail from "./components/TabRail.vue";
import ClockDetail from "./components/clock/ClockDetail.vue";
import GlmDetail from "./components/glm/GlmDetail.vue";
import VikunjaDetail from "./components/vikunja/VikunjaDetail.vue";
import { useClock } from "./composables/useClock";
import { usePanelState } from "./composables/usePanelState";

const props = defineProps<{ tab: TabId; initial: PanelState }>();

const { clockNow } = useClock(props.initial.now);
const { state, flash, refresh } = usePanelState(props.initial, props.tab);

function reloadPage(): void {
  location.reload();
}
</script>

<template>
  <Navbar
    :tab="tab"
    :glm="state.glm"
    :vikunja="state.vikunja"
    :flash="flash"
    @refresh-data="refresh(true)"
    @reload-page="reloadPage"
  />
  <div class="body">
    <TabRail
      :tab="tab"
      :glm="state.glm"
      :vikunja="state.vikunja"
      :now="state.now"
      :clock-now="clockNow"
    />
    <main>
      <ClockDetail v-if="tab === 'clock'" :clock-now="clockNow" />
      <GlmDetail v-else-if="tab === 'glm'" :glm="state.glm" :now="state.now" />
      <VikunjaDetail v-else :vikunja="state.vikunja" />
    </main>
  </div>
</template>
