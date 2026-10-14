<script setup vapor lang="ts">
import { computed } from 'vue';
import { fmtCountdown, resetAtText } from '@mira-panel/shared';
import type { QuotaPool } from '@mira-panel/shared';
import Bar from '../Bar.vue';

const props = defineProps<{ pool: QuotaPool; now: number }>();

const remain = computed(() => 100 - props.pool.pct);
const resetIn = computed(() =>
  props.pool.resetMs === null ? '重置时间未知' : `${fmtCountdown(props.pool.resetMs - props.now)} 后重置`,
);
const resetAt = computed(() => resetAtText(props.pool.resetMs, props.now));
</script>

<template>
  <section class="card wide hero">
    <h2>5 小时额度 <span class="tag">TOKENS_LIMIT · unit=3 · number=5</span></h2>
    <div class="hero-row">
      <div class="hero-num">
        <span>{{ pool.pct }}</span><span class="pct">%</span>
        <span class="hero-cap">已用</span>
      </div>
      <div class="hero-side">
        <div class="kv strong">剩余 <b>{{ remain }}</b>%</div>
        <div class="kv"><b>{{ resetIn }}</b></div>
        <div class="kv dim">重置时刻 <span>{{ resetAt }}</span></div>
      </div>
    </div>
    <Bar :pct="pool.pct" />
  </section>
</template>
