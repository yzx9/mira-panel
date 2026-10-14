<script setup vapor lang="ts">
import type { VikunjaState } from '@mira-panel/shared';
import TaskBucketCard from './TaskBucketCard.vue';
import VkSummaryCard from './VkSummaryCard.vue';

defineProps<{ vikunja: VikunjaState }>();
</script>

<template>
  <section v-if="!vikunja.buckets" class="card wide">
    <h2>Vikunja</h2>
    <div class="empty">取数失败：{{ vikunja.error ?? '未知错误' }}</div>
  </section>

  <!-- buckets non-null implies counts non-null (server invariant). -->
  <template v-else>
    <TaskBucketCard title="今日到期" :count="vikunja.counts!.today" :bucket="vikunja.buckets.today" />
    <TaskBucketCard title="未来 7 天" :count="vikunja.counts!.soon" :bucket="vikunja.buckets.soon" />
    <TaskBucketCard title="逾期" :count="vikunja.counts!.overdue" :bucket="vikunja.buckets.overdue" />
    <VkSummaryCard :counts="vikunja.counts!" />
  </template>
</template>
