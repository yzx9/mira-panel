<script setup vapor lang="ts">
import { fmtInt } from '@mira-panel/shared';
import type { UsageSummary } from '@mira-panel/shared';

defineProps<{ usage: UsageSummary }>();
</script>

<template>
  <section class="card">
    <h2>工具调用 <span class="tag">今天</span></h2>
    <table class="rows big-rows">
      <tbody>
        <tr v-for="t in usage.tools" :key="t.name">
          <td>{{ t.name }}</td>
          <td class="num">{{ fmtInt(t.count) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
