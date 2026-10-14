<script setup vapor lang="ts">
// Last GLM card: the weekly pool when the account has one, otherwise the
// status fallback card (old render did exactly this branch).
import { computed } from 'vue';
import { fmtCountdown, resetInText } from '@mira-panel/shared';
import type { GlmState } from '@mira-panel/shared';
import Bar from '../Bar.vue';

const props = defineProps<{ glm: GlmState; now: number }>();

const weeklyRemain = computed(() => (props.glm.weekly ? 100 - props.glm.weekly.pct : 0));
const weeklyResetIn = computed(() => resetInText(props.glm.weekly?.resetMs ?? null, props.now));
const statusLevel = computed(() => props.glm.level || '—');
const statusFetched = computed(() => props.glm.fetchedAt);
const statusReset = computed(() => {
  const pool = props.glm.fiveHour;
  if (!pool) return '—';
  if (pool.resetMs === null) return '未知';
  return fmtCountdown(pool.resetMs - props.now);
});
</script>

<template>
  <section v-if="glm.weekly" class="card">
    <h2>周额度 <span class="tag">unit=6</span></h2>
    <div class="big"><span>{{ glm.weekly.pct }}</span><span class="small">% 已用</span></div>
    <Bar :pct="glm.weekly.pct" />
    <div class="kv">剩余 <b>{{ weeklyRemain }}</b>% ・ <b>{{ weeklyResetIn }}</b></div>
  </section>

  <section v-else class="card">
    <h2>状态</h2>
    <table class="rows">
      <!-- Explicit tbody: bare static <tr>s get an implicit tbody from the
           HTML parser, which vapor hydration then mis-claims (the row texts
           leaked out of the card in testing). -->
      <tbody>
        <tr><td>套餐</td><td class="num">{{ statusLevel }}</td></tr>
        <tr><td>更新于</td><td class="num">{{ statusFetched }}</td></tr>
        <tr><td>5 小时重置</td><td class="num">{{ statusReset }}</td></tr>
      </tbody>
    </table>
  </section>
</template>
