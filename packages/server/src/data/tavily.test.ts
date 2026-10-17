// Mapper tests for the Tavily usage payload — fixtures use the live response
// shapes observed on 2026-10-17.
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseUsage } from "./tavily.ts";

test("parseUsage maps the live Researcher payload", () => {
  const out = parseUsage({
    key: {
      usage: 198,
      limit: null,
      search_usage: 178,
      crawl_usage: 0,
      extract_usage: 12,
      map_usage: 8,
    },
    account: {
      current_plan: "Researcher",
      plan_usage: 284,
      plan_limit: 1000,
      search_usage: 247,
      extract_usage: 29,
      paygo_usage: 0,
    },
  });
  assert.deepEqual(out.usage, {
    plan: "Researcher",
    used: 284,
    limit: 1000,
    pct: 28,
    keyUsed: 198,
  });
});

test("parseUsage: null plan_limit -> null pct (no bar)", () => {
  const out = parseUsage({
    key: { usage: 3 },
    account: { current_plan: "Paygo", plan_usage: 3, plan_limit: null },
  });
  assert.deepEqual(out.usage, { plan: "Paygo", used: 3, limit: null, pct: null, keyUsed: 3 });
});

test("parseUsage: missing key block -> keyUsed null; missing account -> usage null", () => {
  const noKey = parseUsage({ account: { current_plan: "Free", plan_usage: 10, plan_limit: 1000 } });
  assert.equal(noKey.usage?.keyUsed, null);
  assert.equal(parseUsage({ key: { usage: 5 } }).usage, null);
  assert.equal(parseUsage(null).usage, null);
});

test("parseUsage defaults a missing plan_usage to 0 and rounds pct", () => {
  const out = parseUsage({ account: { current_plan: "Researcher", plan_limit: 300 } });
  assert.equal(out.usage?.used, 0);
  const rounded = parseUsage({ account: { plan_usage: 151, plan_limit: 300 } });
  assert.equal(rounded.usage?.pct, 50); // 50.33 -> 50
});
