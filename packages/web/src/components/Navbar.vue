<script setup vapor lang="ts">
import { computed } from "vue";
import { healthText } from "@mira-panel/shared";
import type { GlmState, TabId, VikunjaState } from "@mira-panel/shared";

const props = defineProps<{
  tab: TabId;
  glm: GlmState;
  vikunja: VikunjaState;
  /** Transient client ack; null on the server and until the user acts. */
  flash: string | null;
}>();

const emit = defineEmits<{ "refresh-data": []; "reload-page": [] }>();

const active = computed(() => (props.tab === "vikunja" ? props.vikunja : props.glm));
const health = computed(() => props.flash ?? healthText(active.value.ok));
// The clock tab speaks for both sources at once.
const clockHealth = computed(() => props.flash ?? healthText(props.glm.ok && props.vikunja.ok));
const clockFetchedAt = computed(() => {
  if (props.glm.fetchedAt === "—") return props.vikunja.fetchedAt;
  if (props.vikunja.fetchedAt === "—") return props.glm.fetchedAt;
  return props.glm.fetchedAt >= props.vikunja.fetchedAt
    ? props.glm.fetchedAt
    : props.vikunja.fetchedAt;
});
const fetchedAt = computed(() =>
  props.tab === "clock" ? clockFetchedAt.value : active.value.fetchedAt,
);
</script>

<template>
  <header>
    <h1>Mira Monitor</h1>
    <div class="head-right">
      <template v-if="tab === 'clock'">
        <span
          >数据 <b>{{ clockHealth }}</b></span
        >
      </template>
      <template v-else-if="tab === 'vikunja'">
        <span
          >未完成 <b>{{ vikunja.counts?.open ?? "—" }}</b></span
        >
        <span
          >数据 <b>{{ health }}</b></span
        >
      </template>
      <template v-else>
        <span
          >数据 <b>{{ health }}</b></span
        >
      </template>
      <span
        >更新于 <b>{{ fetchedAt }}</b></span
      >
      <button @click="emit('refresh-data')">刷新数据</button>
      <button @click="emit('reload-page')">刷新页面</button>
    </div>
  </header>
</template>
