// Derives the client-facing PanelState from the two raw data layers. This is
// the single contract point between server and web: SSR renders it, the page
// embeds it as JSON for hydration, and /api/state returns the same shape.
// The client never normalises anything itself — that is what keeps the SSR
// pass and the 60s poll display-identical.

import {
  CAP_OVERDUE,
  CAP_SOON,
  CAP_TODAY,
  type Bucket,
  type GlmState,
  type PanelState,
  type TaskRow,
  type VikunjaState,
} from '@mira-panel/shared';

import { getUsage, type GlmData } from './data/usage.ts';
import { getTasks, type TaskRaw, type VikunjaData } from './data/vikunja.ts';

/** Cap a bucket to its visible rows; `more` counts what was cut off. */
function capRows(rows: TaskRaw[], cap: number): Bucket {
  return {
    rows: rows.slice(0, cap).map((t): TaskRow => ({ id: t.id, title: t.title, project: t.project, when: t.when })),
    more: Math.max(0, rows.length - cap),
  };
}

function glmState(d: GlmData): GlmState {
  return {
    ok: d.ok,
    stale: d.stale,
    error: d.error,
    fetchedAt: d.fetchedAt,
    level: d.level,
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

function vikunjaState(d: VikunjaData): VikunjaState {
  return {
    ok: d.ok,
    stale: d.stale,
    error: d.error,
    fetchedAt: d.fetchedAt,
    counts: d.counts,
    buckets: d.buckets
      ? {
          today: capRows(d.buckets.today, CAP_TODAY),
          soon: capRows(d.buckets.soon, CAP_SOON),
          overdue: capRows(d.buckets.overdue, CAP_OVERDUE),
        }
      : null,
  };
}

/** Fetch both sources (the rail previews always need both) and assemble the
 *  whole-panel payload. `now` is stamped after the fetches so countdowns are
 *  pure functions of (resetMs, now) — hydration-exact by construction. */
export async function stateFor(build: string): Promise<PanelState> {
  const [glm, tasks] = await Promise.all([getUsage(), getTasks()]);
  return {
    build,
    now: Date.now(),
    glm: glmState(glm),
    vikunja: vikunjaState(tasks),
  };
}
