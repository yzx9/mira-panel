// Mapper tests for the DeepSeek balance payload — fixtures use the live
// response shapes observed on 2026-10-17 (amounts are strings).
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseBalance } from "./deepseek.ts";

test("parseBalance maps the live CNY payload", () => {
  const out = parseBalance({
    is_available: true,
    balance_infos: [
      {
        currency: "CNY",
        total_balance: "20.28",
        granted_balance: "9.35",
        topped_up_balance: "10.92",
      },
    ],
  });
  assert.deepEqual(out.balance, {
    available: true,
    currency: "CNY",
    total: 20.28,
    granted: 9.35,
    toppedUp: 10.92,
  });
});

test("parseBalance prefers CNY when several currencies return, keeps USD alone", () => {
  const multi = parseBalance({
    is_available: true,
    balance_infos: [
      {
        currency: "USD",
        total_balance: "5.00",
        granted_balance: "0.00",
        topped_up_balance: "5.00",
      },
      {
        currency: "CNY",
        total_balance: "1.00",
        granted_balance: "1.00",
        topped_up_balance: "0.00",
      },
    ],
  });
  assert.equal(multi.balance?.currency, "CNY");
  const usdOnly = parseBalance({
    is_available: true,
    balance_infos: [
      {
        currency: "USD",
        total_balance: "5.00",
        granted_balance: "0.00",
        topped_up_balance: "5.00",
      },
    ],
  });
  assert.equal(usdOnly.balance?.currency, "USD");
});

test("parseBalance: empty or missing balance_infos -> null payload", () => {
  assert.equal(parseBalance({ is_available: true, balance_infos: [] }).balance, null);
  assert.equal(parseBalance({}).balance, null);
  assert.equal(parseBalance(null).balance, null);
});

test("parseBalance propagates is_available:false and never yields NaN", () => {
  const out = parseBalance({
    is_available: false,
    balance_infos: [
      { currency: "CNY", total_balance: "n/a", granted_balance: "", topped_up_balance: "1.5" },
    ],
  });
  assert.equal(out.balance?.available, false);
  assert.equal(out.balance?.total, 0);
  assert.equal(out.balance?.granted, 0);
  assert.equal(out.balance?.toppedUp, 1.5);
});
