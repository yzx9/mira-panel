<script setup vapor lang="ts">
// Rail previews stay deliberately minimal: clock shows the live time, GLM
// only the 5-hour pool, Vikunja only today / overdue / open (README: the
// rail is a glance, not a second dashboard). "—" mirrors the old toDom
// defaults for missing pools.
import { computed } from "vue";
import { fmtCountdown, fmtMonthDay, fmtTime, fmtWeekday } from "@mira-panel/shared";
import type { GlmState, TabId, VikunjaState } from "@mira-panel/shared";

const props = defineProps<{
  tab: TabId;
  glm: GlmState;
  vikunja: VikunjaState;
  now: number;
  /** Client clock (starts at the server timestamp, ticks per minute). */
  clockNow: number;
  /** Honour-system lock: data tabs render but their taps are ignored. */
  locked: boolean;
}>();

function guard(e: MouseEvent, target: TabId): void {
  // Deliberately silent: a locked panel ignores taps on the data tabs — no
  // hint, no toast. The lock only ever speaks through the navbar toggle.
  if (props.locked && target !== "clock") e.preventDefault();
}

const clockPreview = computed(() => fmtTime(new Date(props.clockNow)));
const clockSub = computed(
  () => `${fmtMonthDay(new Date(props.clockNow))} ・ ${fmtWeekday(new Date(props.clockNow))}`,
);

const glmUsed = computed(() => (props.glm.fiveHour ? String(props.glm.fiveHour.pct) : "—"));
const glmRemain = computed(() => (props.glm.fiveHour ? String(100 - props.glm.fiveHour.pct) : "—"));
const glmReset = computed(() => {
  const pool = props.glm.fiveHour;
  if (!pool) return "—";
  if (pool.resetMs === null) return "未知";
  return fmtCountdown(pool.resetMs - props.now);
});

const vkToday = computed(() => String(props.vikunja.counts?.today ?? "—"));
const vkOverdue = computed(() => String(props.vikunja.counts?.overdue ?? "—"));
const vkOpen = computed(() => String(props.vikunja.counts?.open ?? "—"));
</script>

<template>
  <nav class="rail">
    <a class="tab" :class="{ active: tab === 'clock' }" href="/">
      <span class="tab-label">时钟</span>
      <span class="tab-preview">{{ clockPreview }}</span>
      <span class="tab-sub">{{ clockSub }}</span>
    </a>
    <a class="tab" :class="{ active: tab === 'glm' }" href="/glm" @click="guard($event, 'glm')">
      <span class="tab-label">GLM 用量</span>
      <span class="tab-preview">{{ glmUsed }}<span class="unit">% 已用</span></span>
      <span class="tab-sub"
        >5 小时额度 ・ 剩余 <b>{{ glmRemain }}</b
        >%<br />重置 <b>{{ glmReset }}</b></span
      >
    </a>
    <a
      class="tab"
      :class="{ active: tab === 'vikunja' }"
      href="/vikunja"
      @click="guard($event, 'vikunja')"
    >
      <span class="tab-label">Vikunja</span>
      <span class="tab-preview">{{ vkToday }}<span class="unit">今日</span></span>
      <span class="tab-sub"
        >逾期 <b>{{ vkOverdue }}</b> ・ 未完成 <b>{{ vkOpen }}</b></span
      >
    </a>
  </nav>
</template>
