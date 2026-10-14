<script setup vapor lang="ts">
// GLM tab body: hero + MCP + usage + tools + weekly/status, each with the old
// hide-missing-pool behavior (an absent quota item renders a labelled empty
// card, never a blank frame).
import type { GlmState } from "@mira-panel/shared";
import HeroCard from "./HeroCard.vue";
import McpCard from "./McpCard.vue";
import ModelUsageCard from "./ModelUsageCard.vue";
import ToolsCard from "./ToolsCard.vue";
import WeeklyOrStatusCard from "./WeeklyOrStatusCard.vue";

defineProps<{ glm: GlmState; now: number }>();
</script>

<template>
  <HeroCard v-if="glm.fiveHour" :pool="glm.fiveHour" :now="now" />
  <section v-else class="card wide hero">
    <h2>5 小时额度</h2>
    <div class="empty">接口本次没有返回该项 —— 按官方约定隐藏，而不是显示空卡</div>
  </section>

  <McpCard v-if="glm.mcp" :mcp="glm.mcp" :now="now" />
  <section v-else class="card">
    <h2>MCP 月额度</h2>
    <div class="empty">接口本次没有返回该项</div>
  </section>

  <ModelUsageCard v-if="glm.usage" :usage="glm.usage" />
  <section v-else class="card">
    <h2>今天模型用量</h2>
    <div class="empty">暂不可用</div>
  </section>

  <ToolsCard v-if="glm.usage" :usage="glm.usage" />
  <section v-else class="card">
    <h2>工具调用</h2>
    <div class="empty">暂不可用</div>
  </section>

  <WeeklyOrStatusCard :glm="glm" :now="now" />
</template>
