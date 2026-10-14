<script setup vapor lang="ts">
import { computed } from 'vue';
import { fmtCountdown, fmtInt, resetAtText } from '@mira-panel/shared';
import type { McpQuota } from '@mira-panel/shared';
import Bar from '../Bar.vue';

const props = defineProps<{ mcp: McpQuota; now: number }>();

// The tag shows the bare countdown (the suffix lives in the template), and an
// absent reset time rendered as empty there too — kept for parity.
const resetIn = computed(() => (props.mcp.resetMs === null ? '' : fmtCountdown(props.mcp.resetMs - props.now)));
const resetAt = computed(() => resetAtText(props.mcp.resetMs, props.now));
</script>

<template>
  <section class="card">
    <h2>MCP 月额度 <span class="tag">unit=5 ・ <span>{{ resetIn }}</span> 后重置</span></h2>
    <div class="big">
      <span>{{ fmtInt(mcp.used) }}</span><span class="small"> / <span>{{ fmtInt(mcp.total) }}</span></span>
    </div>
    <Bar :pct="mcp.pct" />
    <div class="kv">
      已用 <b>{{ mcp.pct }}</b>% ・ 剩余 <b>{{ fmtInt(mcp.remain) }}</b> ・ <span>{{ resetAt }}</span> 重置
    </div>
    <table class="rows">
      <!-- Explicit tbody: vapor's v-for fragment anchors must live inside a
           table section, or the parser's implicit tbody breaks hydration. -->
      <tbody>
        <tr v-for="d in mcp.details" :key="d.name">
          <td>{{ d.name }}</td>
          <td class="num">{{ fmtInt(d.usage) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
