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
  /** Server-authoritative lease lock; while locked the data refresh hides
   *  and the toggle becomes 解锁 — page reload stays available (it lands
   *  right back on the locked clock page, so it cannot leak or unlock). */
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
      <!-- While locked 刷新数据 disappears (its tabs redirect to the clock,
           and a button that lights up on tap but does nothing is a lie) —
           but 刷新页面 stays: a reload lands back on the locked clock page,
           the safe recovery for a wedged page without touching the lease. -->
      <button v-if="!locked" @click="emit('refresh-data')">刷新数据</button>
      <button @click="emit('reload-page')">刷新页面</button>
      <button @click="emit('toggle-lock')">{{ locked ? "解锁" : "锁定" }}</button>
    </div>
  </header>
</template>
