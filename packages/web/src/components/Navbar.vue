<script setup vapor lang="ts">
// Standalone chrome: title, data-freshness stamp, controls — no source
// states. App resolves which fetchedAt to show (clock tab = the later of
// both sources), so the navbar stays tab-agnostic and renders the same
// shape on every tab. `flash` is the refresh button's own transient ack
// (or "⚠ 请求失败" while polls are failing) — not a data prop.
defineProps<{
  /** Transient client ack; null on the server and until the user acts. */
  flash: string | null;
  /** Server-formatted "HH:MM" of the tab's last successful fetch ("—" if none). */
  fetchedAt: string;
  /** Honour-system lock; the toggle is the only control that still works. */
  locked: boolean;
}>();

const emit = defineEmits<{ "refresh-data": []; "reload-page": []; "toggle-lock": [] }>();
</script>

<template>
  <header>
    <h1>Mira Monitor</h1>
    <div class="head-right">
      <span v-if="flash">{{ flash }}</span>
      <span
        >更新于 <b>{{ fetchedAt }}</b></span
      >
      <!-- While locked the two refresh buttons disappear entirely: a button
           that lights up on tap but does nothing is a lie — only the unlock
           toggle remains on screen. -->
      <template v-if="locked">
        <button @click="emit('toggle-lock')">解锁</button>
      </template>
      <template v-else>
        <button @click="emit('refresh-data')">刷新数据</button>
        <button @click="emit('reload-page')">刷新页面</button>
        <button @click="emit('toggle-lock')">锁定</button>
      </template>
    </div>
  </header>
</template>
