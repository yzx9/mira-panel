// Parser tests for the codex source: duration-first window identification,
// seconds→ms normalization, clamping, and the honest-missing shapes. The
// main fixture is a captured live account/rateLimits/read result (account
// id already stripped) from codex-cli 0.156.1.

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRateLimits } from "./codex.ts";

const LIVE = {
  rateLimits: {
    primary: { usedPercent: 14, windowDurationMins: 300, resetsAt: 1793347633 },
    secondary: { usedPercent: 25, windowDurationMins: 10080, resetsAt: 1793778340 },
    planType: "plus",
    credits: { hasCredits: false, unlimited: false, balance: "0" },
  },
  rateLimitResetCredits: { availableCount: 1, credits: [] },
};

test("maps the live shape: duration slots, seconds to ms, plan and credits", () => {
  const p = parseRateLimits(LIVE);
  assert.deepEqual(p.primary, { usedPct: 14, windowMins: 300, resetMs: 1793347633000 });
  assert.deepEqual(p.secondary, { usedPct: 25, windowMins: 10080, resetMs: 1793778340000 });
  assert.equal(p.planType, "plus");
  assert.equal(p.creditsBalance, "0");
  assert.equal(p.resetCredits, 1);
});

test("identifies windows by duration even when the slots are swapped", () => {
  const p = parseRateLimits({
    rateLimits: {
      primary: { usedPercent: 25, windowDurationMins: 10080, resetsAt: 1793778340 },
      secondary: { usedPercent: 14, windowDurationMins: 300, resetsAt: 1793347633 },
    },
  });
  assert.equal(p.primary?.windowMins, 300);
  assert.equal(p.secondary?.windowMins, 10080);
});

test("a lone window renders once; unknown durations keep their real length", () => {
  const single = parseRateLimits({
    rateLimits: { primary: { usedPercent: 40, windowDurationMins: 300 } },
  });
  assert.equal(single.primary?.windowMins, 300);
  assert.equal(single.secondary, null);

  // No 300/10080 anywhere -> the labeled slots pass through with their real
  // length, so the card labels an odd window honestly instead of guessing.
  const odd = parseRateLimits({
    rateLimits: {
      primary: { usedPercent: 10, windowDurationMins: 1440 },
      secondary: { usedPercent: 20, windowDurationMins: 1440 },
    },
  });
  assert.equal(odd.primary?.windowMins, 1440);
  assert.equal(odd.secondary, null); // same length twice -> shown once
});

test("clamps junk percentages; already-ms reset stamps pass through", () => {
  const p = parseRateLimits({
    rateLimits: {
      primary: { usedPercent: 150, windowDurationMins: 300, resetsAt: 1793347633000 },
      secondary: { usedPercent: -5, windowDurationMins: 10080 },
    },
  });
  assert.equal(p.primary?.usedPct, 100);
  assert.equal(p.primary?.resetMs, 1793347633000);
  assert.equal(p.secondary?.usedPct, 0);
  assert.equal(p.secondary?.resetMs, null);
});

test("empty and garbage results report no windows — the fetcher throws on that", () => {
  assert.equal(parseRateLimits({}).primary, null);
  assert.equal(parseRateLimits(null).secondary, null);
  assert.equal(parseRateLimits({ rateLimits: { primary: { usedPercent: "x" } } }).primary, null);
});
