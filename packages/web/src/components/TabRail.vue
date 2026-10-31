<script setup vapor lang="ts">
// Rail previews are a glance, not a second dashboard. The LLM entry keeps
// its two used percentages side by side; missing pools stay "—", never 0%.
import { computed } from "vue";
import { fmtMonthDay, fmtTime, fmtWeekday } from "@mira-panel/shared";
import type { CodexState, GlmState, TabId, VikunjaState } from "@mira-panel/shared";

const props = defineProps<{
  tab: TabId;
  glm: GlmState;
  codex: CodexState;
  vikunja: VikunjaState;
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

const glmUsed = computed(() => props.glm.fiveHour?.pct ?? null);
const openaiUsed = computed(() => props.codex.secondary?.usedPct ?? null);

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
      <span class="tab-label">LLM 用量</span>
      <span class="llm-preview">
        <span class="llm-preview-column">
          <span class="llm-preview-heading">
            <b class="llm-preview-name">GLM</b>
            <span class="llm-preview-window">5 小时窗口</span>
          </span>
          <span class="llm-preview-value"
            ><b>{{ glmUsed ?? "—" }}</b
            ><span>% 已用</span></span
          >
          <span v-if="glm.stale" class="llm-preview-status">数据过期</span>
        </span>
        <span class="llm-preview-column">
          <span class="llm-preview-heading">
            <b class="llm-preview-name">OpenAI</b>
            <span class="llm-preview-window">本周窗口</span>
          </span>
          <span class="llm-preview-value"
            ><b>{{ openaiUsed ?? "—" }}</b
            ><span>% 已用</span></span
          >
          <span v-if="codex.stale" class="llm-preview-status">数据过期</span>
        </span>
      </span>
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
