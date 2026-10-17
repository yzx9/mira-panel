<script setup vapor lang="ts">
// The full task list: five buckets flattened into one grouped, paged table.
// Paging is pure client state over the complete lists — a page turn costs no
// fetch and rewrites only the table. SSR always renders page 1 so hydration
// is exact; a poll that shrinks the data clamps the page via computed, and a
// button at its boundary hides rather than greying out (the two-colour rule
// has no disabled shade — a lit-but-dead button would be a lie anyway).
import { computed, ref } from "vue";
import { LIST_PAGE_ROWS, type TaskRow, type VikunjaState } from "@mira-panel/shared";

/** One rendered line: a bucket header or a task row. */
type Slot =
  | { kind: "header"; key: string; title: string; count: number }
  | { kind: "task"; key: string; task: TaskRow };

const props = defineProps<{
  buckets: NonNullable<VikunjaState["buckets"]>;
  locked: boolean;
  pendingDone: ReadonlySet<number>;
}>();
const emit = defineEmits<{ done: [task: TaskRow] }>();

// Most-urgent first — this order decides what page 1 shows.
const GROUPS = [
  { title: "逾期", bucket: "overdue" as const },
  { title: "今日到期", bucket: "today" as const },
  { title: "未来 7 天", bucket: "soon" as const },
  { title: "无截止日期", bucket: "noDue" as const },
  { title: "7 天以后", bucket: "later" as const },
];

const slots = computed<Slot[]>(() => {
  const out: Slot[] = [];
  for (const g of GROUPS) {
    const rows = props.buckets[g.bucket];
    if (rows.length === 0) continue;
    out.push({ kind: "header", key: `h:${g.bucket}`, title: g.title, count: rows.length });
    for (const t of rows) out.push({ kind: "task", key: `t:${t.id}`, task: t });
  }
  return out;
});

const total = computed(() => Math.max(1, Math.ceil(slots.value.length / LIST_PAGE_ROWS)));
const page = ref(1);
// Clamp instead of watch: a poll that shrinks the list lands here at once.
const current = computed(() => Math.min(page.value, total.value));
const pageSlots = computed(() =>
  slots.value.slice((current.value - 1) * LIST_PAGE_ROWS, current.value * LIST_PAGE_ROWS),
);

function turn(delta: number): void {
  // Deliberately silent while locked — the TabRail guard idiom.
  if (props.locked) return;
  page.value = Math.min(Math.max(current.value + delta, 1), total.value);
}
</script>

<template>
  <section class="card vk-list">
    <table class="rows">
      <!-- Explicit tbody: vapor's v-for anchors must stay inside a table
           section so hydration owns the right range (see McpCard). -->
      <tbody>
        <tr v-if="pageSlots.length === 0">
          <td class="empty" colspan="4">暂无任务</td>
        </tr>
        <template v-for="s in pageSlots" :key="s.key">
          <tr v-if="s.kind === 'header'" class="row-header">
            <td colspan="4">
              {{ s.title }} <span class="tag">{{ s.count }} 项</span>
            </td>
          </tr>
          <tr v-else>
            <td class="chk">
              <!-- Empty square = not done (a pre-rendered checkmark would
                   claim something that has not happened). Solid black while
                   its request is in flight: "registered". -->
              <button
                :disabled="pendingDone.has(s.task.id)"
                :aria-label="`完成 ${s.task.title}`"
                @click="emit('done', s.task)"
              ></button>
            </td>
            <td class="title">{{ s.task.title }}</td>
            <td class="proj">{{ s.task.project }}</td>
            <td class="num">{{ s.task.when }}</td>
          </tr>
        </template>
      </tbody>
    </table>
    <nav class="pager" aria-label="翻页">
      <!-- Boundary buttons hide but leave a same-size pad behind: the
           indicator stays pinned mid-column and the layout never shifts. -->
      <button v-if="current > 1" aria-label="上一页" @click="turn(-1)">▲</button>
      <span v-else class="pad" aria-hidden="true"></span>
      <span class="page-ind">{{ current }}/{{ total }}</span>
      <button v-if="current < total" aria-label="下一页" @click="turn(1)">▼</button>
      <span v-else class="pad" aria-hidden="true"></span>
    </nav>
  </section>
</template>
