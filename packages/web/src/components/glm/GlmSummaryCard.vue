<script setup vapor lang="ts">
// Keep the glance values and reset times on the page; only the model/tool
// breakdowns need a dialog. usage.tokens is authoritative — the individual
// model rows are not guaranteed to sum to it.
import { resetAtText, resetInText, fmtInt, fmtTokens } from "@mira-panel/shared";
import type { GlmState } from "@mira-panel/shared";
import Bar from "../Bar.vue";
import type { UsageDetailKind } from "./usageDetails.ts";

defineProps<{ glm: GlmState; now: number }>();
const emit = defineEmits<{ details: [kind: UsageDetailKind] }>();
</script>

<template>
  <section class="card wide llm-card">
    <h2>GLM 用量<span v-if="glm.stale" class="tag">数据过期</span></h2>

    <div class="hero-row">
      <div v-if="glm.fiveHour" class="hero-num">
        <span>{{ glm.fiveHour.pct }}</span
        ><span class="pct">%</span>
        <span class="hero-cap">5 小时已用</span>
      </div>
      <div v-else class="empty">5 小时额度暂不可用</div>
      <div class="hero-side llm-reset">
        <div v-if="glm.fiveHour" class="kv strong">
          {{ resetInText(glm.fiveHour.resetMs, now) }}
        </div>
        <div v-if="glm.fiveHour?.resetMs != null" class="kv dim">
          重置于 {{ resetAtText(glm.fiveHour.resetMs, now) }}
        </div>
        <div v-if="glm.weekly" class="kv">
          本周已用 <b>{{ glm.weekly.pct }}%</b> ・ {{ resetInText(glm.weekly.resetMs, now) }}
        </div>
      </div>
    </div>
    <Bar v-if="glm.fiveHour" :pct="glm.fiveHour.pct" />

    <div class="duo-strip">
      <div class="duo-cell">
        <div class="duo-label">
          今日 Token
          <button
            v-if="glm.usage"
            type="button"
            class="detail-button"
            aria-label="查看今日用量明细"
            aria-haspopup="dialog"
            aria-controls="usage-details-dialog"
            @click="emit('details', 'today')"
          >
            明细
          </button>
        </div>
        <div class="duo-num">{{ glm.usage ? fmtTokens(glm.usage.tokens) : "—" }}</div>
      </div>
      <div class="duo-cell">
        <div class="duo-label">
          MCP 本月
          <button
            v-if="glm.mcp"
            type="button"
            class="detail-button"
            aria-label="查看 MCP 用量明细"
            aria-haspopup="dialog"
            aria-controls="usage-details-dialog"
            @click="emit('details', 'mcp')"
          >
            明细
          </button>
        </div>
        <div class="duo-num">
          <template v-if="glm.mcp">
            {{ fmtInt(glm.mcp.used) }}<span class="duo-sub"> / {{ fmtInt(glm.mcp.total) }}</span>
          </template>
          <template v-else>—</template>
        </div>
        <div v-if="glm.mcp" class="kv dim">{{ resetInText(glm.mcp.resetMs, now) }}</div>
      </div>
    </div>
  </section>
</template>
