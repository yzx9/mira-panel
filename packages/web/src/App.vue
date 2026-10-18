<script setup vapor lang="ts">
// Root component, deliberately a TWO-ROOT fragment: .screen is a grid with
// rows `116px 1fr` and <header> / .body must be its DIRECT children — a
// wrapper element here would become the single grid child and break layout.
import { computed, ref, watch } from "vue";
import type { PanelState, TabId, TaskRow, VikunjaState } from "@mira-panel/shared";
import Navbar from "./components/Navbar.vue";
import PinPad from "./components/PinPad.vue";
import TabRail from "./components/TabRail.vue";
import ClockDetail from "./components/clock/ClockDetail.vue";
import GlmDetail from "./components/glm/GlmDetail.vue";
import VikunjaDetail from "./components/vikunja/VikunjaDetail.vue";
import { useClock } from "./composables/useClock";
import { useLock } from "./composables/useLock";
import { usePanelState } from "./composables/usePanelState";

const props = defineProps<{
  tab: TabId;
  initial: PanelState;
  locked: boolean;
  /** SSR flag: locking is refused (flash, not lock) without a configured PIN. */
  pinConfigured: boolean;
}>();

const { clockNow } = useClock(props.initial.now);
const { locked, lock, unlock, rememberTab, consumeTab } = useLock(props.locked);
// Remote transitions (another client, lease expiry, reconnect hello) land in
// the same reactive flag the local buttons flip — one watch owns the effects.
const { state, flash, refresh } = usePanelState(props.initial, props.tab, (v) => {
  locked.value = v;
});

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

// Every lock transition, whatever its origin, funnels through here: locking
// remembers the data tab we leave and collapses to the clock page; unlocking
// pulls fresh data immediately (upstream floors make that cheap) and returns
// to the remembered tab when there is one.
watch(locked, (v) => {
  if (v) {
    rememberTab();
    if (props.tab !== "clock") location.assign("/");
  } else {
    refresh(true);
    const back = consumeTab();
    if (back && back !== location.pathname) location.assign(back);
  }
});

// While locked these two are silently ignored — the unlock pad is the only
// control that still does anything.
function onRefreshData(): void {
  if (locked.value) return;
  refresh(true);
}

function reloadPage(): void {
  if (locked.value) return;
  location.reload();
}

const pinPad = ref(false);

function onToggleLock(): void {
  if (locked.value) {
    pinPad.value = true;
    return;
  }
  // Locking without a configured PIN would lock the panel out of reach —
  // refuse with a flash instead (the server's /api/unlock 503 is the belt).
  if (!props.pinConfigured) {
    flash.value = "未配置解锁 PIN";
    return;
  }
  void lock(); // POST first, then the watch navigates to the clock page
}

async function onPinSubmit(pin: string): Promise<void> {
  const outcome = await unlock(pin);
  if (outcome === "ok") {
    pinPad.value = false; // success also navigates/refreshes via the watch
  } else if (outcome === "unconfigured") {
    pinPad.value = false;
    flash.value = "未配置解锁 PIN";
  } else if (outcome === "wrong") {
    flash.value = "密码错误"; // pad stays open, digits already cleared
  } else {
    flash.value = "⚠ 请求失败";
  }
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
  <PinPad v-if="pinPad" @submit="onPinSubmit" @cancel="pinPad = false" />
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
