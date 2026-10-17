// Parser tests for the agenix KEY=VALUE helpers — pure string functions, no
// real secret files involved.
import assert from "node:assert/strict";
import { test } from "node:test";

import { keyFromText } from "./keys.ts";

test("keyFromText finds the exact NAME= line and strips quotes", () => {
  const text = [
    "# agenix runtime",
    'DEEPSEEK_API_KEY="sk-test-1234"',
    "TAVILY_API_KEY=tvly-abcd",
    "GLM_CODING_API_KEY='single-quoted-key'",
  ].join("\n");
  assert.equal(keyFromText(text, "DEEPSEEK_API_KEY"), "sk-test-1234");
  assert.equal(keyFromText(text, "TAVILY_API_KEY"), "tvly-abcd");
  assert.equal(keyFromText(text, "GLM_CODING_API_KEY"), "single-quoted-key");
});

test("keyFromText requires the exact name (no prefix collisions)", () => {
  const text = "DEEPSEEK_API_TOKEN=nope\nDEEPSEEK_API_KEY=yes-1234567890";
  assert.equal(keyFromText(text, "DEEPSEEK_API_KEY"), "yes-1234567890");
  assert.equal(keyFromText(text, "DEEPSEEK_API"), null);
});

test("keyFromText returns null for missing names and empty values", () => {
  assert.equal(keyFromText("OTHER=x", "DEEPSEEK_API_KEY"), null);
  assert.equal(keyFromText("DEEPSEEK_API_KEY=", "DEEPSEEK_API_KEY"), null);
  assert.equal(keyFromText('DEEPSEEK_API_KEY=""', "DEEPSEEK_API_KEY"), null);
  assert.equal(keyFromText("", "DEEPSEEK_API_KEY"), null);
});
