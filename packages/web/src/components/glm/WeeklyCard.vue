<script setup vapor lang="ts">
// Weekly pool — rendered ONLY when the account actually has the quota item
// (some accounts omit it; then nothing is shown, no placeholder card). The
// old status/套餐 fallback branch was dropped with the provider cards.
import { computed } from "vue";
import { resetInText } from "@mira-panel/shared";
import type { QuotaPool } from "@mira-panel/shared";
import Bar from "../Bar.vue";

const props = defineProps<{ weekly: QuotaPool; now: number }>();

const remain = computed(() => 100 - props.weekly.pct);
const resetIn = computed(() => resetInText(props.weekly.resetMs, props.now));
</script>

<template>
  <section class="card wide">
    <h2>周额度 <span class="tag">unit=6</span></h2>
    <div class="big">
      <span>{{ weekly.pct }}</span
      ><span class="small">% 已用</span>
    </div>
    <Bar :pct="weekly.pct" />
    <div class="kv">
      剩余 <b>{{ remain }}</b
      >% ・ <b>{{ resetIn }}</b>
    </div>
  </section>
</template>
