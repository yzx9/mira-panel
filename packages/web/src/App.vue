<script setup vapor lang="ts">
// Root component, deliberately a TWO-ROOT fragment: .screen is a grid with
// rows `116px 1fr` and <header> / .body must be its DIRECT children — a
// wrapper element here would become the single grid child and break layout.
import { computed, ref, watch } from "vue";
import type { PanelState, TabId, TaskRow, VikunjaState } from "@mira-panel/shared";
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

// Header freshness stamp: the active tab's fetch time; the clock tab speaks
// for both sources, so it shows whichever fetched later ("—" = never).
const fetchedAt = computed(() => {
  const glm = state.value.glm.fetchedAt;
  const vk = state.value.vikunja.fetchedAt;
  if (props.tab === "clock") {
    if (glm === "—") return vk;
    if (vk === "—") return glm;
    return glm >= vk ? glm : vk;
  }
  return props.tab === "vikunja" ? vk : glm;
});

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

// Tasks being completed right now: copy-on-write so every mutation swaps the
// whole ref, and two concurrent completions on different rows never mask
// each other (a single pending id would — a lit-but-dead checkbox is a lie).
const pendingDone = ref(new Set<number>());

// Known accepted race: an update push whose server-side fetch started just
// before the write can land after this splice and resurrect the completed
// row — but the write route force-refreshes through the hub (draining that
// very fetch first), so the corrected push follows within the same burst
// and self-heals immediately.
async function onTaskDone(task: TaskRow): Promise<void> {
  // Defense in depth: the server already redirects /vikunja to the clock (and
  // 403s the write route) while locked — this guard covers the gap between
  // hydration and any navigation race.
  if (locked.value) return;
  pendingDone.value = new Set(pendingDone.value).add(task.id);
  try {
    const res = await fetch(`/api/vikunja/tasks/${task.id}/done`, {
      method: "POST",
      headers: { "X-Panel-Write": "1" },
    });
    if (!res.ok) {
      flash.value =
        res.status === 403
          ? "⚠ 面板已锁定"
          : res.status === 502
            ? "⚠ Token 无写权限"
            : "⚠ 完成失败";
      return;
    }
    state.value = { ...state.value, vikunja: (await res.json()) as VikunjaState };
    const title = task.title.length > 16 ? `${task.title.slice(0, 16)}…` : task.title;
    flash.value = `✓ 已完成 ${title}`;
  } catch {
    flash.value = "⚠ 请求失败";
  } finally {
    const next = new Set(pendingDone.value);
    next.delete(task.id);
    pendingDone.value = next;
  }
}
</script>

<template>
  <Navbar
    :flash="flash"
    :fetched-at="fetchedAt"
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
      <GlmDetail
        v-else-if="tab === 'glm'"
        :glm="state.glm"
        :now="state.now"
        :deepseek="state.deepseek"
        :tavily="state.tavily"
      />
      <VikunjaDetail
        v-else
        :vikunja="state.vikunja"
        :locked="locked"
        :pending-done="pendingDone"
        @done="onTaskDone"
      />
    </main>
  </div>
</template>
