<script setup vapor lang="ts">
// Two rows, per the kiosk's tight content budget: a horizontal summary strip
// on top, the full paged task card below. Both live in one wrapper so main's
// stretch gives the strip its content height and the list the rest.
// Purely presentational otherwise: completions bubble up to App.vue.
import type { TaskRow, VikunjaState } from "@mira-panel/shared";
import TaskListCard from "./TaskListCard.vue";
import VkSummaryStrip from "./VkSummaryStrip.vue";

defineProps<{ vikunja: VikunjaState; locked: boolean; pendingDone: ReadonlySet<number> }>();
const emit = defineEmits<{ done: [task: TaskRow] }>();
</script>

<template>
  <section v-if="!vikunja.buckets" class="card wide">
    <h2>Vikunja</h2>
    <div class="empty">取数失败：{{ vikunja.error ?? "未知错误" }}</div>
  </section>
  <!-- buckets non-null implies counts non-null (server invariant). -->
  <div v-else class="vk">
    <VkSummaryStrip :counts="vikunja.counts!" :truncated="vikunja.truncated" />
    <TaskListCard
      :buckets="vikunja.buckets"
      :locked="locked"
      :pending-done="pendingDone"
      @done="(t) => emit('done', t)"
    />
  </div>
</template>
