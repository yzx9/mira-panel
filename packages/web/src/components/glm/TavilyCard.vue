<script setup vapor lang="ts">
// Tavily monthly credits: the ACCOUNT plan pool is the headline (used/limit
// + Bar + plan tag), this key's own counter is a row. The monthly reset is
// derived at render from state.now via nextMonthStart — hydration-exact and
// advancing with every poll (the payload carries no reset timestamp).
import { computed } from "vue";
import { fmtInt, nextMonthStart, resetInText } from "@mira-panel/shared";
import type { TavilyState } from "@mira-panel/shared";
import Bar from "../Bar.vue";

const props = defineProps<{ tv: TavilyState; now: number }>();

const usage = computed(() => props.tv.usage);
const remain = computed(() =>
  usage.value?.limit != null ? Math.max(0, usage.value.limit - usage.value.used) : null,
);
const resetIn = computed(() => resetInText(nextMonthStart(props.now), props.now));
</script>

<template>
  <section v-if="usage" class="card">
    <h2>
      Tavily 积分
      <span class="tag">{{ usage.plan || "本月" }}</span>
    </h2>
    <div class="big">
      <span>{{ fmtInt(usage.used) }}</span
      ><span v-if="usage.limit != null" class="small"> / {{ fmtInt(usage.limit) }}</span>
    </div>
    <Bar v-if="usage.pct != null" :pct="usage.pct" />
    <table class="rows">
      <!-- Explicit tbody: bare static <tr>s get an implicit tbody from the
           HTML parser, which vapor hydration then mis-claims. -->
      <tbody>
        <tr v-if="usage.limit != null">
          <td>剩余积分</td>
          <td class="num">{{ fmtInt(remain ?? 0) }}</td>
        </tr>
        <tr v-if="usage.keyUsed != null">
          <td>本 key 已用</td>
          <td class="num">{{ fmtInt(usage.keyUsed) }}</td>
        </tr>
      </tbody>
    </table>
    <div class="kv">
      <template v-if="usage.pct != null"
        >已用 <b>{{ usage.pct }}</b
        >% ・
      </template>
      <b>{{ resetIn }}</b>
    </div>
    <div v-if="tv.stale" class="kv dim">⚠ 数据陈旧 ・ 更新于 {{ tv.fetchedAt }}</div>
  </section>

  <section v-else class="card">
    <h2>Tavily 积分</h2>
    <div class="empty">
      {{ tv.ok ? "暂无用量数据" : `取数失败：${tv.error ?? "未知错误"}` }}
    </div>
  </section>
</template>
