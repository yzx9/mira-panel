// Golden cases for the shared formatters, captured from the previous
// string-rendering implementation so the Vue port stays display-identical.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fmtCountdown,
  fmtDate,
  fmtInt,
  fmtMonthDay,
  fmtTime,
  fmtTokens,
  fmtWeekday,
  healthText,
  resetAtText,
  resetInText,
} from "./format.ts";

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

test("fmtTokens uses the 亿/万 scales exactly like the old panel", () => {
  assert.equal(fmtTokens(1_000_479_997), "10.0亿"); // README example
  assert.equal(fmtTokens(100_000_000), "1.00亿"); // 1e8, < 1e9 -> 2 decimals
  assert.equal(fmtTokens(45_000), "4.5万");
  assert.equal(fmtTokens(999), "999");
  assert.equal(fmtTokens(Number.NaN), "—");
});

test("fmtCountdown renders 天/小时/分 with 0-clamping", () => {
  assert.equal(fmtCountdown(3 * DAY + 5 * HOUR), "3天 5小时");
  assert.equal(fmtCountdown(2 * HOUR + 3 * MIN), "2小时 3分");
  assert.equal(fmtCountdown(45 * 1000), "0分");
  assert.equal(fmtCountdown(-HOUR), "0分"); // already passed -> clamps
});

test("fmtInt groups with an explicitly pinned locale", () => {
  assert.equal(fmtInt(1_234_567), "1,234,567");
  assert.equal(fmtInt(0), "0");
  assert.equal(fmtInt(Number.NaN), "—");
});

test("fmtTime / fmtDate zero-pad the way the navbar expects", () => {
  const d = new Date(2026, 9, 4, 8, 5); // Oct 4 2026, 08:05 local
  assert.equal(fmtTime(d), "08:05");
  assert.equal(fmtDate(d), "10-04");
});

test("resetAtText switches to a date beyond 24h and says 未知 when absent", () => {
  const now = new Date(2026, 9, 14, 10, 0).getTime();
  assert.equal(resetAtText(null, now), "未知");
  assert.equal(resetAtText(now + 2 * HOUR, now), fmtTime(new Date(now + 2 * HOUR)));
  const far = now + 48 * HOUR;
  assert.equal(resetAtText(far, now), `${fmtDate(new Date(far))} ${fmtTime(new Date(far))}`);
});

test("resetInText appends the 后重置 suffix or reports unknown", () => {
  const now = Date.now();
  assert.equal(resetInText(null, now), "重置时间未知");
  assert.equal(resetInText(now + HOUR, now), "1小时 0分 后重置");
});

test("healthText mirrors the old navbar markers", () => {
  assert.equal(healthText(true), "正常");
  assert.equal(healthText(false), "⚠ 数据陈旧");
});

test("fmtMonthDay / fmtWeekday feed the clock date wall", () => {
  assert.equal(fmtMonthDay(new Date(2026, 9, 15)), "10月15日");
  assert.equal(fmtMonthDay(new Date(2026, 0, 4)), "1月4日");
  assert.equal(fmtWeekday(new Date(2026, 9, 15)), "星期四");
  assert.equal(fmtWeekday(new Date(2026, 9, 18)), "星期日");
});
