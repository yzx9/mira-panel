<script setup vapor lang="ts">
import type { VikunjaCounts } from '@mira-panel/shared';

defineProps<{ counts: VikunjaCounts }>();
</script>

<template>
  <section class="card">
    <h2>汇总 <span class="tag">未完成 {{ counts.open }}</span></h2>
    <table class="rows big-rows">
      <tbody>
        <tr><td>今日到期</td><td class="num">{{ counts.today }}</td></tr>
        <tr><td>未来 7 天</td><td class="num">{{ counts.soon }}</td></tr>
        <tr><td>逾期</td><td class="num">{{ counts.overdue }}</td></tr>
        <tr><td>无截止日期</td><td class="num">{{ counts.noDue }}</td></tr>
        <tr><td>7 天以后</td><td class="num">{{ counts.later }}</td></tr>
      </tbody>
    </table>
  </section>
</template>
