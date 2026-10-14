<script setup vapor lang="ts">
import { computed } from 'vue';

const props = defineProps<{ pct: number }>();

// Same 0-100 clamp as the previous bar()/setBar helpers.
const clamped = computed(() => Math.max(0, Math.min(100, Number(props.pct) || 0)));
</script>

<template>
  <div class="bar"><i :style="{ width: `${clamped}%` }"></i></div>
</template>
