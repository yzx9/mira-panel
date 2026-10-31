<script setup vapor lang="ts">
// All quota information stays on the page. Subscription-window percentages,
// prepaid credits and free resets are separate measures, never added up.
import { computed } from "vue";
import { codexWindowLabel, resetAtText, resetInText } from "@mira-panel/shared";
import type { CodexState } from "@mira-panel/shared";
import Bar from "../Bar.vue";

const props = defineProps<{ codex: CodexState; now: number }>();
const headline = computed(() => props.codex.secondary ?? props.codex.primary);
</script>

<template>
  <section class="card wide llm-card">
    <h2>OpenAI · Codex<span v-if="codex.stale" class="tag">数据过期</span></h2>

    <template v-if="headline">
      <div class="hero-row">
        <div class="hero-num">
          <span>{{ headline.usedPct }}</span
          ><span class="pct">%</span>
          <span class="hero-cap">{{ codexWindowLabel(headline.windowMins) }}已用</span>
        </div>
        <div class="hero-side">
          <div v-if="codex.secondary && codex.primary" class="kv strong">
            {{ codexWindowLabel(codex.primary.windowMins) }}已用
            <b>{{ codex.primary.usedPct }}%</b>
          </div>
          <div v-if="codex.planType" class="kv dim">{{ codex.planType }} 套餐</div>
        </div>
      </div>
      <Bar :pct="headline.usedPct" />
      <div class="quota-reset-row">
        <div v-if="codex.secondary" class="quota-reset-item">
          <div class="kv">
            {{ codexWindowLabel(codex.secondary.windowMins) }} ・
            <b>{{ resetInText(codex.secondary.resetMs, now) }}</b>
          </div>
          <div v-if="codex.secondary.resetMs != null" class="kv dim">
            重置于 {{ resetAtText(codex.secondary.resetMs, now) }}
          </div>
        </div>
        <div v-if="codex.primary" class="quota-reset-item">
          <div class="kv">
            {{ codexWindowLabel(codex.primary.windowMins) }} ・
            <b>{{ resetInText(codex.primary.resetMs, now) }}</b>
          </div>
          <div v-if="codex.primary.resetMs != null" class="kv dim">
            重置于 {{ resetAtText(codex.primary.resetMs, now) }}
          </div>
        </div>
      </div>
      <div class="quota-meta">
        <span v-if="codex.creditsBalance !== null">额外 credits {{ codex.creditsBalance }}</span>
        <span v-if="codex.resetCredits !== null">免费重置 {{ codex.resetCredits }} 次</span>
        <span class="quota-updated">更新于 {{ codex.fetchedAt }}</span>
      </div>
    </template>
    <div v-else class="empty">额度暂不可用</div>
  </section>
</template>
