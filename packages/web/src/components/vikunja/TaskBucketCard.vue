<script setup vapor lang="ts">
// One Vikunja bucket: the header count is the FULL count, the table shows the
// server-capped rows, `more` notes what was cut off (old taskRows behavior).
import type { Bucket } from "@mira-panel/shared";

defineProps<{ title: string; count: number; bucket: Bucket }>();
</script>

<template>
  <section class="card">
    <h2>
      {{ title }} <span class="tag">{{ count }} 项</span>
    </h2>
    <div v-if="bucket.rows.length === 0" class="empty">暂无</div>
    <template v-else>
      <table class="rows">
        <!-- Explicit tbody: see McpCard — keeps vapor's v-for anchors inside
             a table section so hydration owns the right range. -->
        <tbody>
          <tr v-for="t in bucket.rows" :key="t.id">
            <td class="title">{{ t.title }}</td>
            <td class="proj">{{ t.project }}</td>
            <td class="num">{{ t.when }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="bucket.more > 0" class="more">另有 {{ bucket.more }} 项</div>
    </template>
  </section>
</template>
