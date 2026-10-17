<script setup vapor lang="ts">
// DeepSeek balance card: big total, granted/topped-up split, availability
// tag. A balance is a point-in-time snapshot — no reset semantics.
import { fmtMoney } from "@mira-panel/shared";
import type { DeepSeekState } from "@mira-panel/shared";

defineProps<{ ds: DeepSeekState }>();
</script>

<template>
  <section v-if="ds.balance" class="card">
    <h2>
      DeepSeek 余额
      <span v-if="!ds.balance.available" class="tag">不可用</span>
    </h2>
    <div class="big">
      <span>{{ fmtMoney(ds.balance.total, ds.balance.currency) }}</span
      ><span class="small"> 总余额</span>
    </div>
    <table class="rows">
      <!-- Explicit tbody: bare static <tr>s get an implicit tbody from the
           HTML parser, which vapor hydration then mis-claims. -->
      <tbody>
        <tr>
          <td>赠送余额</td>
          <td class="num">{{ fmtMoney(ds.balance.granted, ds.balance.currency) }}</td>
        </tr>
        <tr>
          <td>充值余额</td>
          <td class="num">{{ fmtMoney(ds.balance.toppedUp, ds.balance.currency) }}</td>
        </tr>
      </tbody>
    </table>
    <div v-if="ds.stale" class="kv dim">⚠ 数据陈旧 ・ 更新于 {{ ds.fetchedAt }}</div>
  </section>

  <section v-else class="card">
    <h2>DeepSeek 余额</h2>
    <div class="empty">
      {{ ds.ok ? "暂无余额数据" : `取数失败：${ds.error ?? "未知错误"}` }}
    </div>
  </section>
</template>
