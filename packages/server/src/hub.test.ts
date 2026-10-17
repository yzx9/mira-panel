// Hub behaviour tests: fake connections and controllable fetchers, real
// timers with tiny intervals. These pin the subscription contract the panel
// now runs on — snapshot-on-subscribe, per-topic projections, zero upstream
// calls without subscribers, stale-on-error semantics and the write route's
// force-refresh path.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ServerMsg } from "@mira-panel/shared";

import { createHub, type SourceDef, type SourceName } from "./hub.ts";

interface FakeConn {
  sent: ServerMsg[];
  send: (msg: ServerMsg) => void;
}

function fakeConn(): FakeConn {
  const sent: ServerMsg[] = [];
  return { sent, send: (msg: ServerMsg) => sent.push(msg) };
}

interface Counter {
  fetches: number;
}

type Bodies = Partial<Record<SourceName, () => unknown>>;

/** All five sources with controllable bodies; every fetch bumps the counter. */
function defs(counter: Counter, bodies: Bodies = {}, intervalMs = 15, lockedIntervalMs?: number) {
  const def = (name: SourceName): SourceDef<unknown> => ({
    intervalMs,
    lockedIntervalMs: lockedIntervalMs ?? intervalMs,
    fetch: async () => {
      counter.fetches += 1;
      const make = bodies[name];
      return make ? make() : {};
    },
    empty: () => null,
  });
  return {
    "glm-quota": def("glm-quota"),
    "glm-usage": def("glm-usage"),
    vikunja: def("vikunja"),
    deepseek: def("deepseek"),
    tavily: def("tavily"),
  } satisfies Record<SourceName, SourceDef<unknown>>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, ms = 1000, what = "condition"): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`waitFor timeout: ${what}`);
    await sleep(5);
  }
}

function subscribe(conn: FakeConn, hub: ReturnType<typeof createHub>, tab: string, locked = false) {
  const handle = hub.attach(conn.send);
  handle.message(JSON.stringify({ type: "subscribe", tab, locked }));
  return handle;
}

const updatesOf = (conn: FakeConn) =>
  conn.sent.filter((m): m is Extract<ServerMsg, { type: "update" }> => m.type === "update");

test("subscribe answers hello, then pushes the declared topics only", async () => {
  const counter: Counter = { fetches: 0 };
  const hub = createHub(
    "b1",
    defs(counter, {
      "glm-quota": () => ({
        level: "MAX",
        fiveHour: { pct: 7, remainPct: 93, bar: 7, resetMs: 1234 },
        weekly: { pct: 40, remainPct: 60, bar: 40, resetMs: null },
        mcp: null,
      }),
    }),
  );
  const conn = fakeConn();
  const handle = subscribe(conn, hub, "clock");

  await waitFor(() => updatesOf(conn).length > 0, 1000, "first update");

  const hello = conn.sent.find((m) => m.type === "hello");
  assert.ok(hello && hello.type === "hello" && hello.build === "b1");

  // Clock declares glm:rail + vikunja:counts — never glm:usage, deepseek, tavily.
  assert.deepEqual([...new Set(updatesOf(conn).map((m) => m.topic))].sort(), [
    "glm:rail",
    "vikunja:counts",
  ]);

  // Rail payload is the slim slice: fiveHour mapped to {pct, resetMs}, no level.
  const rail = updatesOf(conn).find((m) => m.topic === "glm:rail");
  assert.ok(rail);
  assert.deepEqual(rail.data, {
    ok: true,
    stale: false,
    error: null,
    fetchedAt: rail.data.fetchedAt,
    fiveHour: { pct: 7, resetMs: 1234 },
  });
  assert.ok(rail.data.fetchedAt !== "—");

  // The usage endpoints never ran — clock does not declare them.
  handle.close();
});

test("glm tab payload carries the slim usage summary, not the hourly series", async () => {
  const counter: Counter = { fetches: 0 };
  const hub = createHub(
    "b1",
    defs(counter, {
      "glm-usage": () => ({
        calls: 3,
        tokens: 9000,
        models: [{ name: "glm-4.7", tokens: 9000 }],
        hours: 24,
        hourlyTokens: [1, 2, 3],
        hourlyLabels: ["00:00"],
        tools: [{ name: "联网搜索", count: 2 }],
      }),
    }),
  );
  const conn = fakeConn();
  const handle = subscribe(conn, hub, "glm");
  await waitFor(() => updatesOf(conn).some((m) => m.topic === "glm:usage"), 1000, "usage update");

  const usage = updatesOf(conn).find((m) => m.topic === "glm:usage");
  assert.ok(usage);
  assert.deepEqual(usage.data, {
    ok: true,
    stale: false,
    error: null,
    fetchedAt: usage.data.fetchedAt,
    usage: {
      calls: 3,
      tokens: 9000,
      models: [{ name: "glm-4.7", tokens: 9000 }],
      tools: [{ name: "联网搜索", count: 2 }],
    },
  });
  handle.close();
});

test("a source with zero subscribers stops calling upstream", async () => {
  const counter: Counter = { fetches: 0 };
  const hub = createHub("b1", defs(counter));
  const conn = fakeConn();
  const handle = subscribe(conn, hub, "clock");
  await waitFor(() => counter.fetches >= 2, 1000, "timer ticks");
  handle.close();

  const at = counter.fetches;
  await sleep(60); // several intervals pass with nobody listening
  assert.equal(counter.fetches, at);
});

test("failure keeps the previous numbers and flags stale; a first-ever failure stays uncached", async () => {
  const counter: Counter = { fetches: 0 };
  let fail = false;
  const hub = createHub("b1", {
    ...defs(counter),
    "glm-quota": {
      intervalMs: 15, // short window so the next get refetches deterministically
      lockedIntervalMs: 15,
      fetch: async () => {
        counter.fetches += 1;
        if (fail) throw new Error("upstream down");
        return {
          level: "",
          fiveHour: { pct: 42, remainPct: 58, bar: 42, resetMs: 99 },
          weekly: null,
          mcp: null,
        };
      },
      empty: () => ({ level: "", fiveHour: null, weekly: null, mcp: null }),
    },
    tavily: {
      intervalMs: 10_000,
      lockedIntervalMs: 10_000,
      fetch: async () => {
        counter.fetches += 1;
        throw new Error("never worked");
      },
      empty: () => null,
    },
  });

  const good = await hub.get("glm-quota");
  assert.equal(good.ok, true);
  fail = true;
  await sleep(30); // cache window lapses -> the next get refetches

  // Stale shape on the regular cadence path: same numbers, flagged, error
  // recorded. (forceRefresh's full-clear is the write path's own semantic.)
  const stale = await hub.get("glm-quota");
  assert.equal(stale.ok, false);
  assert.equal(stale.stale, true);
  assert.match(stale.error ?? "", /upstream down/);
  assert.deepEqual((stale.payload as { fiveHour: unknown }).fiveHour, {
    pct: 42,
    remainPct: 58,
    bar: 42,
    resetMs: 99,
  });

  // A source that never succeeded serves the empty body and retries on the
  // next read instead of caching the failure.
  const first = await hub.get("tavily");
  assert.equal(first.ok, false);
  assert.equal(first.payload, null); // empty() body
  const before = counter.fetches;
  await hub.get("tavily");
  assert.ok(counter.fetches > before);
});

test("forceRefresh drains the in-flight read and answers with post-write data", async () => {
  const counter: Counter = { fetches: 0 };
  let generation = 0;
  let gate: { promise: Promise<void>; open: () => void } | null = null;
  const makeGate = () => {
    let open!: () => void;
    const promise = new Promise<void>((r) => {
      open = r;
    });
    return { promise, open };
  };
  const hub = createHub("b1", {
    ...defs(counter),
    vikunja: {
      intervalMs: 10_000, // no timer interference
      lockedIntervalMs: 10_000,
      fetch: async () => {
        counter.fetches += 1;
        if (gate) {
          // Hold exactly the gated round; later rounds run free.
          const g = gate;
          gate = null;
          await g.promise;
        }
        generation += 1;
        return {
          counts: { today: generation, soon: 0, overdue: 0, noDue: 0, later: 0, open: generation },
          buckets: null,
          truncated: false,
        };
      },
      empty: () => ({ counts: null, buckets: null, truncated: false }),
    },
  });

  // A read is in flight (held at the gate) when the write lands.
  const g = makeGate();
  gate = g;
  const held = hub.get("vikunja");
  await waitFor(() => counter.fetches >= 1, 1000, "held round started");
  const forced = hub.forceRefresh("vikunja"); // parks on the drain
  g.open();
  const [heldState, forcedState] = await Promise.all([held, forced]);

  // Two upstream rounds ran, and the forced answer reflects the second one.
  assert.ok(counter.fetches >= 2);
  assert.equal((heldState.payload as { counts: { today: number } }).counts.today, 1);
  assert.ok((forcedState.payload as { counts: { today: number } }).counts.today >= 2);
});

test("a first-ever failure still reaches subscribers, flagged stale — not silence", async () => {
  const counter: Counter = { fetches: 0 };
  const hub = createHub("b1", {
    ...defs(counter),
    vikunja: {
      intervalMs: 10_000,
      lockedIntervalMs: 10_000,
      fetch: async () => {
        counter.fetches += 1;
        throw new Error("down from the start");
      },
      empty: () => ({ counts: null, buckets: null, truncated: false }),
    },
  });
  const conn = fakeConn();
  const handle = subscribe(conn, hub, "vikunja"); // declares glm:rail + vikunja:full
  await waitFor(
    () => updatesOf(conn).some((m) => m.topic === "vikunja:full"),
    1000,
    "failure update",
  );

  const full = updatesOf(conn).find((m) => m.topic === "vikunja:full");
  assert.ok(full);
  assert.equal(full.data.ok, false);
  assert.equal(full.data.stale, true);
  assert.deepEqual((full.data as { buckets: unknown }).buckets, null); // empty body, never zeros
  handle.close();
});

test("refresh answers ack once the forced round settles; lock stretches the cadence", async () => {
  const counter: Counter = { fetches: 0 };
  const hub = createHub("b1", defs(counter, {}, 15, 5000));
  const conn = fakeConn();
  const handle = hub.attach(conn.send);

  // Subscribe unlocked, then go locked: the cadence must collapse to the
  // locked interval (effectively quiet within this test's window).
  handle.message(JSON.stringify({ type: "subscribe", tab: "clock", locked: false }));
  await waitFor(() => counter.fetches >= 2, 1000, "unlocked ticks");
  handle.message(JSON.stringify({ type: "lock", locked: true }));
  const at = counter.fetches;
  await sleep(80);
  assert.equal(counter.fetches, at); // 5s locked interval -> nothing fired

  // A manual refresh forces a round even while locked, then acks.
  handle.message(JSON.stringify({ type: "refresh" }));
  await waitFor(() => conn.sent.some((m) => m.type === "ack"), 1000, "ack");
  assert.ok(counter.fetches > at);
  handle.close();
});
