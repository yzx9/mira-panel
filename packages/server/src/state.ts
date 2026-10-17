// Derives the client-facing PanelState from the four raw data layers. This is
// the single contract point between server and web: SSR renders it, the page
// embeds it as JSON for hydration, and /api/state returns the same shape.
// The client never normalises anything itself — that is what keeps the SSR
// pass and the 60s poll display-identical.

import {
  type DeepSeekState,
  type GlmState,
  type PanelState,
  type TaskRow,
  type TavilyState,
  type VikunjaState,
} from "@mira-panel/shared";

import { getDeepSeekBalance, type DeepSeekData } from "./data/deepseek.ts";
import { getTavilyUsage, type TavilyData } from "./data/tavily.ts";
import { getUsage, type GlmData } from "./data/usage.ts";
import { getTasks, type TaskRaw, type VikunjaData } from "./data/vikunja.ts";

/** Map a raw task to its wire row (drops the fields only classification uses). */
function toRow(t: TaskRaw): TaskRow {
  return { id: t.id, title: t.title, project: t.project, when: t.when };
}

function glmState(d: GlmData): GlmState {
  return {
    ok: d.ok,
    stale: d.stale,
    error: d.error,
    fetchedAt: d.fetchedAt,
    fiveHour: d.fiveHour ? { pct: d.fiveHour.pct, resetMs: d.fiveHour.resetMs } : null,
    weekly: d.weekly ? { pct: d.weekly.pct, resetMs: d.weekly.resetMs } : null,
    mcp: d.mcp
      ? {
          used: d.mcp.used,
          total: d.mcp.total,
          remain: d.mcp.remain,
          pct: d.mcp.pct,
          resetMs: d.mcp.resetMs,
          details: d.mcp.details.map((x) => ({ name: x.name, usage: x.usage })),
        }
      : null,
    usage: d.usage
      ? {
          calls: d.usage.calls,
          tokens: d.usage.tokens,
          models: d.usage.models.map((m) => ({ name: m.name, tokens: m.tokens })),
          tools: d.usage.tools.map((t) => ({ name: t.name, count: t.count })),
        }
      : null,
  };
}

/** Build the /vikunja view-model: every bucket goes out in full — the
 *  client's task card pages locally. Exported for the write route, which
 *  answers with this same shape after a completion. */
export function vikunjaState(d: VikunjaData): VikunjaState {
  return {
    ok: d.ok,
    stale: d.stale,
    error: d.error,
    fetchedAt: d.fetchedAt,
    counts: d.counts,
    truncated: d.truncated,
    buckets: d.buckets
      ? {
          today: d.buckets.today.map(toRow),
          soon: d.buckets.soon.map(toRow),
          overdue: d.buckets.overdue.map(toRow),
          noDue: d.buckets.noDue.map(toRow),
          later: d.buckets.later.map(toRow),
        }
      : null,
  };
}

function deepSeekState(d: DeepSeekData): DeepSeekState {
  return {
    ok: d.ok,
    stale: d.stale,
    error: d.error,
    fetchedAt: d.fetchedAt,
    balance: d.balance, // raw already carries the shared payload shape
  };
}

function tavilyState(d: TavilyData): TavilyState {
  return {
    ok: d.ok,
    stale: d.stale,
    error: d.error,
    fetchedAt: d.fetchedAt,
    usage: d.usage, // raw already carries the shared payload shape
  };
}

/** Fetch all sources (the rail previews always need glm/vikunja) and assemble
 *  the whole-panel payload. `now` is stamped after the fetches so countdowns
 *  are pure functions of (resetMs, now) — hydration-exact by construction. */
export async function stateFor(build: string): Promise<PanelState> {
  const [glm, tasks, deepseek, tavily] = await Promise.all([
    getUsage(),
    getTasks(),
    getDeepSeekBalance(),
    getTavilyUsage(),
  ]);
  return {
    build,
    now: Date.now(),
    glm: glmState(glm),
    vikunja: vikunjaState(tasks),
    deepseek: deepSeekState(deepseek),
    tavily: tavilyState(tavily),
  };
}
