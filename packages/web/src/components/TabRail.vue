<script setup vapor lang="ts">
import { computed } from 'vue';
import { fmtCountdown } from '@mira-panel/shared';
import type { GlmState, TabId, VikunjaState } from '@mira-panel/shared';

const props = defineProps<{ tab: TabId; glm: GlmState; vikunja: VikunjaState; now: number }>();

// Rail previews stay deliberately minimal: GLM shows only the 5-hour pool,
// Vikunja only today / overdue / open (README: the rail is a glance, not a
// second dashboard). '—' mirrors the old toDom defaults for missing pools.

const glmUsed = computed(() => (props.glm.fiveHour ? String(props.glm.fiveHour.pct) : '—'));
const glmRemain = computed(() => (props.glm.fiveHour ? String(100 - props.glm.fiveHour.pct) : '—'));
const glmReset = computed(() => {
  const pool = props.glm.fiveHour;
  if (!pool) return '—';
  if (pool.resetMs === null) return '未知';
  return fmtCountdown(pool.resetMs - props.now);
});

const vkToday = computed(() => String(props.vikunja.counts?.today ?? '—'));
const vkOverdue = computed(() => String(props.vikunja.counts?.overdue ?? '—'));
const vkOpen = computed(() => String(props.vikunja.counts?.open ?? '—'));
</script>

<template>
  <nav class="rail">
    <a class="tab" :class="{ active: tab === 'glm' }" href="/glm">
      <span class="tab-label">GLM 用量</span>
      <span class="tab-preview">{{ glmUsed }}<span class="unit">% 已用</span></span>
      <span class="tab-sub">5 小时额度 ・ 剩余 <b>{{ glmRemain }}</b>%<br>重置 <b>{{ glmReset }}</b></span>
    </a>
    <a class="tab" :class="{ active: tab === 'vikunja' }" href="/vikunja">
      <span class="tab-label">Vikunja</span>
      <span class="tab-preview">{{ vkToday }}<span class="unit">今日</span></span>
      <span class="tab-sub">逾期 <b>{{ vkOverdue }}</b> ・ 未完成 <b>{{ vkOpen }}</b></span>
    </a>
  </nav>
</template>
