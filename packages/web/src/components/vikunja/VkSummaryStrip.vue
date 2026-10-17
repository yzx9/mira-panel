<script setup vapor lang="ts">
import type { VikunjaCounts } from "@mira-panel/shared";

defineProps<{ counts: VikunjaCounts; truncated: boolean }>();
</script>

<template>
  <section class="card">
    <div class="vk-strip">
      <div class="stat">
        <span>未完成</span><b>{{ counts.open }}</b>
      </div>
      <div class="stat">
        <span>今日到期</span><b>{{ counts.today }}</b>
      </div>
      <div class="stat">
        <span>未来 7 天</span><b>{{ counts.soon }}</b>
      </div>
      <div class="stat">
        <span>逾期</span><b>{{ counts.overdue }}</b>
      </div>
      <div class="stat">
        <span>无截止日期</span><b>{{ counts.noDue }}</b>
      </div>
      <div class="stat">
        <span>7 天以后</span><b>{{ counts.later }}</b>
      </div>
    </div>
    <!-- Upstream pagination ceiling hit: the numbers above are floors. -->
    <div v-if="truncated" class="more">已达分页上限，各计数可能偏少</div>
  </section>
</template>
