<script setup vapor lang="ts">
// Clock page body: one wide card — the giant minute-hand time is the page,
// the date sits underneath in small print ("2026年10月15日 星期四").
// Everything derives from clockNow, so the midnight tick flips the date too.
import { computed } from "vue";
import { fmtMonthDay, fmtTime, fmtWeekday } from "@mira-panel/shared";

const props = defineProps<{ clockNow: number }>();

const time = computed(() => fmtTime(new Date(props.clockNow)));
const dateLine = computed(() => {
  const d = new Date(props.clockNow);
  return `${d.getFullYear()}年${fmtMonthDay(d)} ${fmtWeekday(d)}`;
});
</script>

<template>
  <section class="card wide clock">
    <div class="clock-time">{{ time }}</div>
    <div class="clock-date">{{ dateLine }}</div>
  </section>
</template>
