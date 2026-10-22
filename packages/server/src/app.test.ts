// Route-level tests for the lock API: header guard, PIN outcomes, the
// locked page redirect and the write-route 403. The hub is stubbed to the
// never-fetched shape (stateFor only reads it); the lock is the real module
// on a temp file with an injected PIN and a tiny backoff ladder.

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createApp } from "./app.ts";
import type { AnySourceState, Hub } from "./hub.ts";
import { createLock, type LockModule } from "./lock.ts";

const NEVER: AnySourceState = {
  ok: false,
  stale: false,
  error: null,
  fetchedAt: "—",
  fetchedDate: "",
  payload: null,
};

/** Just enough Hub for stateFor: every read is the never-fetched stub. */
const stubHub = {
  get: () => Promise.resolve(NEVER),
  peek: () => null,
  forceRefresh: () => Promise.resolve(NEVER),
  touch: () => undefined,
  dump: () => ({}),
  attach: () => ({ message: () => undefined, close: () => undefined }),
} as unknown as Hub;

async function testApp(
  pins: string[] | null,
  controllerKey: string | null = null,
): Promise<{
  app: ReturnType<typeof createApp>;
  lock: LockModule;
  rendered: () => { tab: string; locked: boolean; pinConfigured: boolean } | null;
}> {
  const dir = await mkdtemp(join(tmpdir(), "mira-app-"));
  const lock = await createLock({
    file: join(dir, "leases.json"),
    leaseMs: 60_000,
    backoffBaseMs: 1,
    readPin: async () => (pins ? (pins[0] ?? null) : null),
    readControllerKey: async () => controllerKey,
  });
  // Echo stub: the page handler's arguments are the assertion surface.
  let rendered: { tab: string; locked: boolean; pinConfigured: boolean } | null = null;
  const app = createApp({
    build: "t",
    hub: stubHub,
    lock,
    renderPage: async (tab, _state, locked, pinConfigured) => {
      rendered = { tab, locked, pinConfigured };
      return "<html>x</html>";
    },
    staticRoots: [],
    clientInfo: () => null,
  });
  return { app, lock, rendered: () => rendered };
}

const WRITE = { "X-Panel-Write": "1", "Content-Type": "application/json" };

test("lock/unlock routes enforce the write header and the PIN", async () => {
  const { app } = await testApp(["1234"]);

  // Header first: without it neither route does anything.
  assert.equal((await app.request("/api/lock", { method: "POST" })).status, 400);
  assert.equal(
    (await app.request("/api/unlock", { method: "POST", headers: WRITE, body: '{"pin":"1234"}' }))
      .status,
    200,
  );

  // Wrong PIN -> 403; malformed bodies -> 400.
  assert.equal(
    (await app.request("/api/unlock", { method: "POST", headers: WRITE, body: '{"pin":"0000"}' }))
      .status,
    403,
  );
  assert.equal(
    (await app.request("/api/unlock", { method: "POST", headers: WRITE, body: "nope" })).status,
    400,
  );
  assert.equal(
    (await app.request("/api/unlock", { method: "POST", headers: WRITE, body: '{"pin":42}' }))
      .status,
    400,
  );

  // Lock -> 200, and it actually locks (the redirect below proves it).
  assert.equal((await app.request("/api/lock", { method: "POST", headers: WRITE })).status, 200);
  const redirected = await app.request("/glm");
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.get("Location"), "/");

  // The write route is 403 while locked, live again after a correct PIN.
  assert.equal(
    (await app.request("/api/vikunja/tasks/7/done", { method: "POST", headers: WRITE })).status,
    403,
  );
  assert.equal(
    (await app.request("/api/unlock", { method: "POST", headers: WRITE, body: '{"pin":"1234"}' }))
      .status,
    200,
  );
  const page = await app.request("/glm");
  assert.equal(page.status, 200);
});

test("an unconfigured PIN makes unlock answer 503", async () => {
  const { app } = await testApp(null);
  assert.equal(
    (await app.request("/api/unlock", { method: "POST", headers: WRITE, body: '{"pin":"1234"}' }))
      .status,
    503,
  );
});

test("the page handler passes lock state and pinConfigured to SSR", async () => {
  const { app, rendered } = await testApp(["1234"]);
  await app.request("/api/lock", { method: "POST", headers: WRITE });

  assert.equal((await app.request("/clock")).status, 200);
  assert.deepEqual(rendered(), { tab: "clock", locked: true, pinConfigured: true });

  assert.equal(
    (await app.request("/api/unlock", { method: "POST", headers: WRITE, body: '{"pin":"1234"}' }))
      .status,
    200,
  );
  assert.equal((await app.request("/glm")).status, 200);
  assert.deepEqual(rendered(), { tab: "glm", locked: false, pinConfigured: true });
});

test("the presence route maps key outcomes to 400/403/503/200 and unlocks", async () => {
  const { app } = await testApp(["1234"], "sekret");
  const post = (body: string, withHeader = true) =>
    app.request("/api/presence", {
      method: "POST",
      headers: withHeader ? WRITE : { "Content-Type": "application/json" },
      body,
    });

  assert.equal((await post('{"key":"k","present":true}', false)).status, 400); // header first
  assert.equal((await post("nope")).status, 400); // bad JSON
  assert.equal((await post('{"key":"k"}')).status, 400); // missing present
  assert.equal((await post('{"key":"nope","present":true}')).status, 403); // wrong key

  const unconfigured = await testApp(["1234"], null);
  assert.equal(
    (
      await unconfigured.app.request("/api/presence", {
        method: "POST",
        headers: WRITE,
        body: '{"key":"k","present":true}',
      })
    ).status,
    503,
  );

  // Right key, present:true -> unlocked (the redirect proves it).
  assert.equal((await post('{"key":"sekret","present":true}')).status, 200);
  assert.equal((await app.request("/glm")).status, 200);

  // present:false is the goodbye: everything re-locks, PIN leases included.
  await app.request("/api/unlock", { method: "POST", headers: WRITE, body: '{"pin":"1234"}' });
  assert.equal((await post('{"key":"sekret","present":false}')).status, 200);
  assert.equal((await app.request("/glm")).status, 302);
});
