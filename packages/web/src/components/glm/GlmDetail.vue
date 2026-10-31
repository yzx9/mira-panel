<script setup vapor lang="ts">
// LLM tab body: GLM summary, Codex quotas and the two provider cards.
// Breakdown dialogs are owned by App so they overlay the fixed canvas.
import type { CodexState, DeepSeekState, GlmState, TavilyState } from "@mira-panel/shared";
import CodexCard from "./CodexCard.vue";
import DeepSeekCard from "./DeepSeekCard.vue";
import GlmSummaryCard from "./GlmSummaryCard.vue";
import TavilyCard from "./TavilyCard.vue";
import type { UsageDetailKind } from "./usageDetails.ts";

const emit = defineEmits<{ details: [kind: UsageDetailKind] }>();

defineProps<{
  glm: GlmState;
  codex: CodexState;
  now: number;
  deepseek: DeepSeekState;
  tavily: TavilyState;
}>();
</script>

<template>
  <GlmSummaryCard :glm="glm" :now="now" @details="emit('details', $event)" />
  <CodexCard :codex="codex" :now="now" />
  <DeepSeekCard :ds="deepseek" />
  <TavilyCard :tv="tavily" :now="now" />
</template>
