<script setup vapor lang="ts">
import { fmtInt, fmtTokens } from "@mira-panel/shared";
import type { UsageSummary } from "@mira-panel/shared";

defineProps<{ usage: UsageSummary }>();
</script>

<template>
  <section class="card">
    <h2>今天模型用量</h2>
    <div class="big">
      <span>{{ fmtInt(usage.calls) }}</span
      ><span class="small">
        次调用 ・ <b>{{ fmtTokens(usage.tokens) }}</b> tokens</span
      >
    </div>
    <table class="rows">
      <!-- One explicit <tbody> per v-for: vapor's fragment anchors must each
           live inside their own table section or hydration mis-claims rows. -->
      <tbody>
        <tr v-for="m in usage.models" :key="m.name">
          <td>{{ m.name }}</td>
          <td class="num">{{ fmtTokens(m.tokens) }}</td>
        </tr>
      </tbody>
      <!-- Tool rows moved in from the deleted ToolsCard (联网搜索/网页读取/
           开源仓库) — same data source, one card fewer. -->
      <tbody>
        <tr v-for="t in usage.tools" :key="t.name">
          <td>{{ t.name }}</td>
          <td class="num">{{ fmtInt(t.count) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
