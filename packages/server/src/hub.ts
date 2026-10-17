// The subscription hub: the panel's single scheduler and cache.
//
// Data flows by declaration — a page connects and names the topics its tab
// renders; the hub maps topics onto upstream fetch units ("sources"), keeps
// one ref-counted timer per source, and pushes each fetch result to the
// connections that declared a topic of that source, projected down to the
// slice that topic actually carries (the rail topics send a few dozen bytes,
// not the full state). A source with zero subscribers has no timer, so an
// unwatched panel makes zero upstream calls — this is where the old 60s
// whole-panel poll's waste went away.
//
// The hub also owns the health contract the data layers used to carry
// themselves: in-flight dedup, keep-last-good-numbers-on-error with the
// stale flag, and the fetchedAt/fetchedDate stamps. The layers themselves
// are now pure fetches that throw.

import {
  fmtDate,
  fmtTime,
  PING_MS,
  TOPICS_FOR_TAB,
  type ClientMsg,
  type Health,
  type QuotaPool,
  type ServerMsg,
  type TabId,
  type TopicId,
  type TopicPayloadMap,
} from "@mira-panel/shared";

import { fetchDeepSeekBalance } from "./data/deepseek.ts";
import { fetchTavilyUsage } from "./data/tavily.ts";
import { fetchGlmQuota, fetchGlmUsage, type GlmQuotaBody, type UsageRaw } from "./data/usage.ts";
import { fetchTasks, type TaskRaw, type VikunjaBody } from "./data/vikunja.ts";
import { noteClientViewportValues } from "./viewport.ts";

/** Upstream fetch unit. Several topics can share one source (glm:quota and
 *  glm:rail read the same quota endpoint; only the projection differs). */
export type SourceName = "glm-quota" | "glm-usage" | "vikunja" | "deepseek" | "tavily";

export interface SourceDef<T> {
  /** Refresh cadence while at least one unlocked subscriber listens. */
  intervalMs: number;
  /** Cadence while every subscriber is locked (e-paper and upstreams quiet). */
  lockedIntervalMs: number;
  /** Pure upstream read; throws on failure. */
  fetch: () => Promise<T>;
  /** Body to serve when no fetch ever succeeded (all-null slice). */
  empty: () => T;
}

/** A source's cached state: the body plus the Health fields the hub stamps. */
export interface SourceState<T> extends Health {
  fetchedDate: string;
  payload: T;
}

export type AnySourceState = SourceState<unknown>;

const TOPIC_SOURCE: Record<TopicId, SourceName> = {
  "glm:quota": "glm-quota",
  "glm:rail": "glm-quota",
  "glm:usage": "glm-usage",
  "vikunja:full": "vikunja",
  "vikunja:counts": "vikunja",
  deepseek: "deepseek",
  tavily: "tavily",
};

function sourcesOf(topics: Iterable<TopicId>): Set<SourceName> {
  return new Set([...topics].map((t) => TOPIC_SOURCE[t]));
}

/** Map a raw task to its wire row (drops the fields only classification uses). */
function toRow(t: TaskRaw) {
  return { id: t.id, title: t.title, project: t.project, when: t.when };
}

/** Project a source state down to the payload a topic carries — the wire
 *  contract's single authority, used by the periodic push, the
 *  subscribe-time snapshot AND the SSR bootstrap (state.ts), which is what
 *  keeps SSR output and update patches display-identical. Field-exact on
 *  purpose: raw-only fields (level, api, the hourly series, dueMs) never
 *  reach a payload. */
function projectImpl(topic: TopicId, s: AnySourceState): TopicPayloadMap[TopicId] {
  const health = { ok: s.ok, stale: s.stale, error: s.error, fetchedAt: s.fetchedAt };
  // Bodies can legitimately be null (glm-usage's never-fetched shape); the
  // per-case casts must tolerate that instead of crashing the broadcast.
  const q = (s.payload ?? {}) as Partial<GlmQuotaBody>;
  const pool = (p: { pct: number; resetMs: number | null } | null | undefined): QuotaPool | null =>
    p ? { pct: p.pct, resetMs: p.resetMs } : null;
  switch (topic) {
    case "glm:rail":
      return { ...health, fiveHour: pool(q.fiveHour) };
    case "glm:quota":
      return {
        ...health,
        fiveHour: pool(q.fiveHour),
        weekly: pool(q.weekly),
        mcp: q.mcp
          ? {
              used: q.mcp.used,
              total: q.mcp.total,
              remain: q.mcp.remain,
              pct: q.mcp.pct,
              resetMs: q.mcp.resetMs,
              details: q.mcp.details.map((x) => ({ name: x.name, usage: x.usage })),
            }
          : null,
      };
    case "glm:usage": {
      const u = s.payload as UsageRaw | null; // null = never fetched
      return {
        ...health,
        usage: u ? { calls: u.calls, tokens: u.tokens, models: u.models, tools: u.tools } : null,
      };
    }
    case "vikunja:counts": {
      const v = (s.payload ?? {}) as Partial<VikunjaBody>;
      return {
        ...health,
        counts: v.counts ?? null,
        truncated: v.truncated ?? false,
        buckets: null,
      };
    }
    case "vikunja:full": {
      const v = (s.payload ?? {}) as Partial<VikunjaBody>;
      return {
        ...health,
        counts: v.counts ?? null,
        truncated: v.truncated ?? false,
        buckets: v.buckets
          ? {
              today: v.buckets.today.map(toRow),
              soon: v.buckets.soon.map(toRow),
              overdue: v.buckets.overdue.map(toRow),
              noDue: v.buckets.noDue.map(toRow),
              later: v.buckets.later.map(toRow),
            }
          : null,
      };
    }
    case "deepseek": {
      const d = (s.payload ?? {}) as { balance?: unknown };
      return { ...health, balance: d.balance ?? null } as TopicPayloadMap[TopicId];
    }
    case "tavily": {
      const t = (s.payload ?? {}) as { usage?: unknown };
      return { ...health, usage: t.usage ?? null } as TopicPayloadMap[TopicId];
    }
  }
}

/** Typed projection entry for call sites that know their topic. */
export function payloadFor<T extends TopicId>(topic: T, s: AnySourceState): TopicPayloadMap[T] {
  return projectImpl(topic, s) as TopicPayloadMap[T];
}

export interface Hub {
  /** SSR read: cached state when fresher than the interval, else a fetch
   *  (deduped with anything in flight). Never rejects. */
  get(source: SourceName): Promise<AnySourceState>;
  /** Last cached state without fetching, whatever its age (tab-aware SSR
   *  embeds last-known deepseek/tavily on tabs that do not declare them). */
  peek(source: SourceName): AnySourceState | null;
  /** Clear the cache, then fetch now — the write route's completion answer.
   *  Subscribers receive the same push. */
  forceRefresh(source: SourceName): Promise<AnySourceState>;
  /** Fire-and-forget fetch (boot warm-up of the slow sources). */
  touch(source: SourceName): void;
  /** Every source's cached state, for /api/raw. */
  dump(): Record<string, AnySourceState>;
  /** Register a connection; returns its message/close handles. */
  attach(send: (msg: ServerMsg) => void): { message: (raw: string) => void; close: () => void };
}

export function createHub(build: string, defs: Record<SourceName, SourceDef<unknown>>): Hub {
  interface Run {
    name: SourceName;
    def: SourceDef<unknown>;
    subs: Set<Conn>;
    timer: ReturnType<typeof setInterval> | undefined;
    inflight: Promise<AnySourceState> | undefined;
    last: AnySourceState | undefined;
    /** When the cache was last (re)filled — success or error-with-previous;
     *  hard failures with nothing ever served leave it 0 so reads retry. */
    at: number;
  }

  interface Conn {
    send: (msg: ServerMsg) => void;
    topics: Set<TopicId>;
    locked: boolean;
    ping: ReturnType<typeof setInterval> | undefined;
  }

  const runs = {} as Record<SourceName, Run>;
  for (const name of Object.keys(defs) as SourceName[])
    runs[name] = {
      name,
      def: defs[name],
      subs: new Set(),
      timer: undefined,
      inflight: undefined,
      last: undefined,
      at: 0,
    };

  const conns = new Set<Conn>();

  // ------------------------------------------------------------- fetching

  /** Push a resolved state to every subscriber of the source — including
   *  error states from a first-ever failure: a source that never succeeded
   *  must flag itself stale on the wire, not stay silent (the panel would
   *  show "—" forever with no health warning). */
  function broadcastState(source: SourceName, state: AnySourceState): void {
    const now = Date.now();
    for (const conn of runs[source].subs) {
      for (const topic of conn.topics) {
        if (TOPIC_SOURCE[topic] !== source) continue;
        conn.send({ type: "update", topic, now, data: payloadFor(topic, state) });
      }
    }
  }

  function tick(run: Run): Promise<AnySourceState> {
    if (run.inflight) return run.inflight;
    run.inflight = (async (): Promise<AnySourceState> => {
      try {
        const payload = await run.def.fetch();
        const state: AnySourceState = {
          ok: true,
          stale: false,
          error: null,
          fetchedAt: fmtTime(new Date()),
          fetchedDate: fmtDate(new Date()),
          payload,
        };
        run.last = state;
        run.at = Date.now();
        return state;
      } catch (err) {
        // Never hand the panel an empty screen: keep serving the last good
        // numbers and mark them stale so the kiosk shows a visible warning.
        const previous = run.last;
        const state: AnySourceState = {
          ok: false,
          stale: true,
          error: err instanceof Error ? err.message : String(err),
          fetchedAt: previous?.fetchedAt ?? "—",
          fetchedDate: previous?.fetchedDate ?? "",
          payload: previous?.payload ?? run.def.empty(),
        };
        // Cache the stale shape only when there were numbers to keep — a
        // source that never succeeded stays uncached so reads keep retrying
        // (same TTL semantics the data layers had).
        if (previous) {
          run.last = state;
          run.at = Date.now();
        }
        return state;
      } finally {
        run.inflight = undefined;
      }
    })();
    void run.inflight.then(
      (state) => broadcastState(run.name, state),
      () => undefined, // tick never rejects; belt-and-braces for broadcast
    );
    return run.inflight;
  }

  // -------------------------------------------------------------- timers

  /** Fastest cadence any subscriber justifies: one unlocked listener is
   *  enough to run a source at full speed. */
  function effectiveInterval(run: Run): number {
    let ms = Infinity;
    for (const conn of run.subs)
      ms = Math.min(ms, conn.locked ? run.def.lockedIntervalMs : run.def.intervalMs);
    return ms === Infinity ? run.def.intervalMs : ms;
  }

  function arm(run: Run): void {
    clearInterval(run.timer);
    run.timer = undefined;
    if (run.subs.size === 0) return; // nobody listens -> no timer, no upstream
    run.timer = setInterval(() => void tick(run), effectiveInterval(run));
  }

  function reschedule(sources: Iterable<SourceName>): void {
    for (const s of sources) arm(runs[s]);
  }

  function setTopics(conn: Conn, topics: readonly TopicId[]): void {
    const before = sourcesOf(conn.topics);
    conn.topics = new Set(topics);
    const after = sourcesOf(conn.topics);
    for (const s of after) {
      if (before.has(s)) continue;
      runs[s].subs.add(conn);
    }
    // Reschedule every touched source once, after the membership settled.
    for (const s of new Set([...before, ...after])) {
      if (!after.has(s)) runs[s].subs.delete(conn);
    }
    reschedule([...new Set([...before, ...after])]);
  }

  function detach(conn: Conn): void {
    if (!conns.delete(conn)) return;
    clearInterval(conn.ping);
    const sources = sourcesOf(conn.topics);
    for (const s of sources) runs[s].subs.delete(conn);
    reschedule(sources);
  }

  // ---------------------------------------------------------- connections

  return {
    get(source) {
      const run = runs[source];
      if (run.last && Date.now() - run.at < run.def.intervalMs) return Promise.resolve(run.last);
      return tick(run);
    },
    peek(source) {
      return runs[source].last ?? null;
    },
    async forceRefresh(source) {
      const run = runs[source];
      // Drain any fetch that started before the write landed: handing the
      // in-flight promise back would answer with the change not yet visible.
      if (run.inflight) await run.inflight.catch(() => undefined);
      // Full clear, not just expiry: a failing refetch must answer with the
      // error shape (client flashes failure), never resurrect the old rows.
      run.last = undefined;
      run.at = 0;
      return tick(run);
    },
    touch(source) {
      void tick(runs[source]);
    },
    dump() {
      const out: Record<string, AnySourceState> = {};
      for (const name of Object.keys(runs) as SourceName[])
        if (runs[name].last) out[name] = runs[name].last;
      return out;
    },
    attach(send) {
      const conn: Conn = { send, topics: new Set(), locked: false, ping: undefined };
      conns.add(conn);
      // App-level keepalive: browser WS ping frames never wake JS, so the
      // client's watchdog can only see JSON pings. Never carries `now` —
      // countdown text must not advance on keepalives (e-paper quietness in
      // locked mode depends on updates being the only state changers).
      conn.ping = setInterval(() => send({ type: "ping" }), PING_MS);

      return {
        message(raw) {
          let msg: ClientMsg;
          try {
            msg = JSON.parse(raw) as ClientMsg;
          } catch {
            return; // a malformed frame never kills the connection
          }
          switch (msg?.type) {
            case "subscribe": {
              noteClientViewportValues(msg.vw, msg.vh, msg.dpr);
              conn.locked = msg.locked;
              setTopics(conn, TOPICS_FOR_TAB[msg.tab as TabId] ?? []);
              send({ type: "hello", build, now: Date.now() });
              // Snapshot whatever is cached right now (even stale — the
              // display contract is keep-serving), then let the timer (or a
              // first-ever fetch kicked below) deliver the fresh round.
              for (const topic of conn.topics) {
                const run = runs[TOPIC_SOURCE[topic]];
                if (run.last)
                  send({
                    type: "update",
                    topic,
                    now: Date.now(),
                    data: payloadFor(topic, run.last),
                  });
              }
              for (const source of sourcesOf(conn.topics)) {
                const run = runs[source];
                if (!run.last || Date.now() - run.at >= run.def.intervalMs) void tick(run);
              }
              break;
            }
            case "lock": {
              conn.locked = msg.locked;
              reschedule(sourcesOf(conn.topics));
              break;
            }
            case "refresh": {
              void (async () => {
                await Promise.all([...sourcesOf(conn.topics)].map((s) => tick(runs[s])));
                send({ type: "ack" });
              })();
              break;
            }
            // No default: unknown messages are ignored, not fatal.
          }
        },
        close() {
          detach(conn);
        },
      };
    },
  };
}

// ----------------------------------------------------------- production hub

const MIN = 60_000;

/** Production cadences (see README's 数据流 section):
 *   glm-quota / glm-usage / vikunja — 60s, 10min while locked
 *   deepseek / tavily — 30min (a balance and a monthly credit pool are slow) */
export function createPanelHub(build: string): Hub {
  return createHub(build, {
    "glm-quota": {
      intervalMs: MIN,
      lockedIntervalMs: 10 * MIN,
      fetch: fetchGlmQuota,
      empty: () => ({ level: "", fiveHour: null, weekly: null, mcp: null }),
    },
    "glm-usage": {
      intervalMs: MIN,
      lockedIntervalMs: 10 * MIN,
      // null body = never fetched: the usage card hides, never zeroes.
      fetch: fetchGlmUsage,
      empty: () => null,
    },
    vikunja: {
      intervalMs: MIN,
      lockedIntervalMs: 10 * MIN,
      fetch: fetchTasks,
      empty: () => ({ counts: null, buckets: null, truncated: false }),
    },
    deepseek: {
      intervalMs: 30 * MIN,
      lockedIntervalMs: 30 * MIN,
      fetch: fetchDeepSeekBalance,
      empty: () => ({ balance: null, api: null }),
    },
    tavily: {
      intervalMs: 30 * MIN,
      lockedIntervalMs: 30 * MIN,
      fetch: fetchTavilyUsage,
      empty: () => ({ usage: null, api: null }),
    },
  });
}
