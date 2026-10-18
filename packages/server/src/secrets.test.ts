// Panel-secret store tests: precedence (env wins), .env fallback parsing,
// and the honest nulls (missing file, missing name). Real temp files, no
// real secrets — the fixture values are dummies.

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { panelSecret } from "./secrets.ts";

async function envFile(lines: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mira-env-"));
  const file = join(dir, ".env");
  await writeFile(file, lines.join("\n"));
  return file;
}

test("process.env outranks the .env file", async () => {
  const prev = process.env.MIRA_TEST_SECRET;
  try {
    process.env.MIRA_TEST_SECRET = "from-env";
    const file = await envFile(["MIRA_TEST_SECRET=from-file"]);
    assert.equal(await panelSecret("MIRA_TEST_SECRET", file), "from-env");
  } finally {
    if (prev === undefined) delete process.env.MIRA_TEST_SECRET;
    else process.env.MIRA_TEST_SECRET = prev;
  }
});

test("falls back to the .env file, quotes stripped, comments ignored", async () => {
  const file = await envFile([
    "# panel secrets",
    'PANEL_PIN="1234"',
    "VIKUNJA_API_KEY=tk-from-file",
  ]);
  assert.equal(await panelSecret("PANEL_PIN", file), "1234");
  assert.equal(await panelSecret("VIKUNJA_API_KEY", file), "tk-from-file");
});

test("missing file and missing names resolve null, never throw", async () => {
  assert.equal(await panelSecret("PANEL_PIN", join(tmpdir(), "mira-no-such.env")), null);
  const file = await envFile(["OTHER=x"]);
  assert.equal(await panelSecret("PANEL_PIN", file), null);
  assert.equal(await panelSecret("PANEL_PIN", await envFile(["PANEL_PIN="])), null);
});

test("a re-written .env is re-read on the next call (rotation without restart)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mira-env-rot-"));
  const file = join(dir, ".env");
  await writeFile(file, "PANEL_PIN=1111\n");
  assert.equal(await panelSecret("PANEL_PIN", file), "1111");
  await writeFile(file, "PANEL_PIN=2222\n");
  assert.equal(await panelSecret("PANEL_PIN", file), "2222");
});
