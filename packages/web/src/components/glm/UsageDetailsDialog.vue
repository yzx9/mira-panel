<script setup vapor lang="ts">
// Rendered beside header/body in App, inside the scaled design canvas.
// An opaque paper backdrop, focus trap and inert background make this a
// modal without moving it to an unscaled browser top layer. Pages, not
// scrollbars, handle long breakdowns.
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { fmtInt, fmtTokens, resetAtText } from "@mira-panel/shared";
import type { GlmState } from "@mira-panel/shared";
import { usageDetailRows, USAGE_DETAIL_PAGE_ROWS, type UsageDetailKind } from "./usageDetails.ts";

const props = defineProps<{ kind: UsageDetailKind; glm: GlmState; now: number }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const page = ref(0);
const rows = computed(() => usageDetailRows(props.glm, props.kind));
const pages = computed(() => Math.max(1, Math.ceil(rows.value.length / USAGE_DETAIL_PAGE_ROWS)));
const visibleRows = computed(() =>
  rows.value.slice(page.value * USAGE_DETAIL_PAGE_ROWS, (page.value + 1) * USAGE_DETAIL_PAGE_ROWS),
);
const title = computed(() => (props.kind === "today" ? "今日用量明细" : "MCP 本月明细"));
watch(pages, (n) => {
  page.value = Math.min(page.value, n - 1);
});

let previousFocus: HTMLElement | null = null;
let background: { element: HTMLElement; inert: boolean }[] = [];
onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const screen = dialog.value?.closest(".screen");
  background = [...(screen?.children ?? [])]
    .filter((el): el is HTMLElement => el instanceof HTMLElement && el.matches("header, .body"))
    .map((element) => ({ element, inert: element.inert }));
  for (const { element } of background) element.inert = true;
  closeButton.value?.focus({ preventScroll: true });
});
onUnmounted(() => {
  for (const { element, inert } of background) element.inert = inert;
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
});

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("close");
  } else if (event.key === "Tab") {
    const buttons = [
      ...(dialog.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
    ];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
}
function turnPage(delta: number): void {
  page.value = Math.max(0, Math.min(pages.value - 1, page.value + delta));
  // The clicked boundary button may disappear after a page turn.
  closeButton.value?.focus({ preventScroll: true });
}
function onBackdrop(event: MouseEvent): void {
  if (event.target === event.currentTarget) emit("close");
}
</script>

<template>
  <div class="usage-overlay" @click="onBackdrop">
    <section
      id="usage-details-dialog"
      ref="dialog"
      class="usage-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="usage-details-title"
      @keydown="onKeydown"
    >
      <div class="usage-dialog-heading">
        <h2 id="usage-details-title">
          {{ title }}<span v-if="glm.stale" class="tag">数据过期</span>
        </h2>
        <button ref="closeButton" type="button" aria-label="关闭用量明细" @click="emit('close')">
          关闭
        </button>
      </div>
      <div v-if="kind === 'today'" class="usage-dialog-summary">
        <span
          >今日 Token <b>{{ glm.usage ? fmtTokens(glm.usage.tokens) : "—" }}</b></span
        >
        <span>{{ glm.usage ? fmtInt(glm.usage.calls) : "—" }} 次调用</span>
      </div>
      <div v-else class="usage-dialog-summary">
        <span
          >本月已用 <b>{{ glm.mcp ? fmtInt(glm.mcp.used) : "—" }}</b> /
          {{ glm.mcp ? fmtInt(glm.mcp.total) : "—" }}</span
        >
        <span>重置于 {{ resetAtText(glm.mcp?.resetMs ?? null, now) }}</span>
      </div>
      <div class="usage-dialog-content">
        <table v-if="visibleRows.length" class="rows usage-dialog-table">
          <thead>
            <tr>
              <th scope="col">名称</th>
              <th scope="col">类别</th>
              <th scope="col" class="num">用量</th>
            </tr>
          </thead>
          <!-- Explicit tbody keeps Vapor's row anchors hydration-safe. -->
          <tbody>
            <tr v-for="(row, i) in visibleRows" :key="i">
              <td>
                <span class="usage-row-name" :title="row.name">{{ row.name }}</span>
              </td>
              <td>{{ row.category }}</td>
              <td class="num">{{ row.value }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">暂无明细</div>
      </div>
      <div class="usage-dialog-footer">
        <span class="kv dim">更新于 {{ glm.fetchedAt }}</span>
        <div v-if="pages > 1" class="usage-dialog-pager" aria-label="明细分页">
          <button v-if="page > 0" type="button" @click="turnPage(-1)">上一页</button>
          <span v-else class="usage-page-pad"></span>
          <span aria-live="polite">{{ page + 1 }} / {{ pages }}</span>
          <button v-if="page < pages - 1" type="button" @click="turnPage(1)">下一页</button>
          <span v-else class="usage-page-pad"></span>
        </div>
      </div>
    </section>
  </div>
</template>
