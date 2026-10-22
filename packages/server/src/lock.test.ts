// Lock module tests: the pure ladder/prune helpers, the lease lifecycle
// (issue -> expire -> transition), persistence across module instances, PIN
// verification and the backoff ladder's wall-clock effect. Real timers with
// tiny injected constants, same style as hub.test.ts.

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { backoffDelayMs, createLock, pruneLeases, type LockModule } from "./lock.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  cond: () => boolean | Promise<boolean>,
  ms = 1000,
  what = "condition",
): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > ms) throw new Error(`waitFor timeout: ${what}`);
    await sleep(5);
  }
}

async function tmpFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mira-lock-"));
  return join(dir, "leases.json");
}

/** A lock bound to a temp file, tiny lease/backoff, controllable PIN and
 *  controller key. The arrays are the read sequences (one entry per read: warm +
 *  each attempt); null entries model "not configured yet". */
async function testLock(
  pins: (string | null)[] | null,
  leaseMs = 40,
  presence: { key: string | null; leaseMs?: number } = { key: null },
): Promise<{ lock: LockModule; file: string }> {
  const file = await tmpFile();
  let reads = 0;
  const lock = await createLock({
    file,
    leaseMs,
    presenceLeaseMs: presence.leaseMs ?? 30,
    backoffBaseMs: 5,
    backoffResetMs: 1000,
    readPin: async () => {
      reads += 1;
      return pins ? (pins[Math.min(reads - 1, pins.length - 1)] ?? null) : null;
    },
    readControllerKey: async () => presence.key,
  });
  return { lock, file };
}

test("backoffDelayMs doubles from the base and caps out", () => {
  assert.equal(backoffDelayMs(0), 0);
  assert.equal(backoffDelayMs(-3), 0);
  assert.equal(backoffDelayMs(1, 400, 600_000), 400);
  assert.equal(backoffDelayMs(2, 400, 600_000), 800);
  assert.equal(backoffDelayMs(3, 400, 600_000), 1600);
  assert.equal(backoffDelayMs(99, 400, 600_000), 600_000);
});

test("pruneLeases keeps the future and drops the past", () => {
  const now = 1000;
  assert.deepEqual(pruneLeases({ a: 999, b: 1000, c: 1001 }, now), { c: 1001 });
  assert.deepEqual(pruneLeases({}, now), {});
});

test("a fresh module is locked until a correct PIN unlocks it", async () => {
  const { lock } = await testLock(["1234"]);
  assert.equal(lock.isLocked(), true);
  assert.deepEqual(await lock.unlockWithPin("0000"), { ok: false, configured: true });
  assert.equal(lock.isLocked(), true);
  assert.deepEqual(await lock.unlockWithPin("1234"), { ok: true });
  assert.equal(lock.isLocked(), false);
});

test("an unconfigured PIN reports configured:false, never unlocks", async () => {
  const { lock } = await testLock(null);
  assert.deepEqual(await lock.unlockWithPin("1234"), { ok: false, configured: false });
  assert.equal(lock.isLocked(), true);
  assert.equal(lock.pinConfigured(), false);
});

test("lease expiry re-locks and notifies; lockAll does the same on demand", async () => {
  const { lock } = await testLock(["1234"], 40);
  const events: boolean[] = [];
  lock.onChange((v) => events.push(v));
  assert.deepEqual(await lock.unlockWithPin("1234"), { ok: true });
  // Generous budget: node --test runs files in parallel, so a 40ms lease
  // timer can land late on a loaded machine.
  await waitFor(() => lock.isLocked(), 3000, "lease expiry");
  assert.deepEqual(events, [false, true]);

  events.length = 0;
  assert.deepEqual(await lock.unlockWithPin("1234"), { ok: true });
  await lock.lockAll();
  assert.equal(lock.isLocked(), true);
  assert.deepEqual(events, [false, true]);
});

test("leases persist across restarts, expired ones do not", async () => {
  const { lock, file } = await testLock(["1234"], 60_000);
  await lock.unlockWithPin("1234");

  // Restart with the same file: still unlocked, lease intact.
  const second = await createLock({
    file,
    leaseMs: 60_000,
    backoffBaseMs: 5,
    readPin: async () => "1234",
  });
  assert.equal(second.isLocked(), false);

  // An expired lease on disk restores locked.
  await writeFile(file, JSON.stringify({ leases: { kiosk: Date.now() - 1 } }));
  const third = await createLock({ file, leaseMs: 60_000, readPin: async () => "1234" });
  assert.equal(third.isLocked(), true);
});

test("the backoff ladder makes bursts pay, success resets it", async () => {
  const { lock } = await testLock(["1234"]);
  // Warm nothing: three wrong PINs cost >= 5+10+20ms with base 5.
  const start = Date.now();
  await lock.unlockWithPin("0");
  await lock.unlockWithPin("0");
  await lock.unlockWithPin("0");
  const burst = Date.now() - start;
  assert.ok(burst >= 30, `burst should pay >=30ms, took ${burst}ms`);

  // Success clears the ladder: the next wrong PIN is cheap again.
  await lock.unlockWithPin("1234");
  const fresh = Date.now();
  await lock.unlockWithPin("0");
  const cheap = Date.now() - fresh;
  assert.ok(cheap < 30, `first failure after success should be cheap, took ${cheap}ms`);
});

test("a late PIN provisioning unlocks without a restart", async () => {
  // readPin sequence: warm() -> null, attempt 1 -> null, attempt 2 -> the PIN.
  const { lock } = await testLock([null, null, "9999"]);
  assert.deepEqual(await lock.unlockWithPin("9999"), { ok: false, configured: false });
  assert.equal(lock.pinConfigured(), false);
  assert.deepEqual(await lock.unlockWithPin("9999"), { ok: true });
  assert.equal(lock.pinConfigured(), true);
});

test("persistence failure degrades to memory without crashing", async () => {
  // The parent "directory" is a regular file: every persist hits ENOTDIR.
  const dir = await mkdtemp(join(tmpdir(), "mira-lock-ro-"));
  const blocker = join(dir, "blocker");
  await writeFile(blocker, "x");
  const lock = await createLock({
    file: join(blocker, "leases.json"),
    leaseMs: 60_000,
    backoffBaseMs: 1,
    readPin: async () => "1234",
  });
  assert.deepEqual(await lock.unlockWithPin("1234"), { ok: true });
  assert.equal(lock.isLocked(), false);
});

test("persisted file shape stays {leases}", async () => {
  const { lock, file } = await testLock(["1234"], 60_000);
  await lock.unlockWithPin("1234");
  const parsed = JSON.parse(await readFile(file, "utf8")) as { leases: Record<string, number> };
  assert.ok(parsed.leases.kiosk > Date.now());
});

// ------------------------------------------------------------ presence

test("setPresence verifies the device key: unconfigured and wrong never unlock", async () => {
  const unconfigured = await testLock(["1234"], 60_000, { key: null });
  assert.deepEqual(await unconfigured.lock.setPresence("k", true), {
    ok: false,
    reason: "unconfigured",
  });
  assert.equal(unconfigured.lock.isLocked(), true);

  const locked = await testLock(["1234"], 60_000, { key: "sekret" });
  assert.deepEqual(await locked.lock.setPresence("nope", true), { ok: false, reason: "wrong" });
  assert.equal(locked.lock.isLocked(), true);
  assert.deepEqual(await locked.lock.setPresence("sekret", true), { ok: true });
  assert.equal(locked.lock.isLocked(), false);
});

test("the controller lease renews silently, expires loudly, on its own short clock", async () => {
  const { lock } = await testLock(["1234"], 60_000, { key: "sekret", leaseMs: 30 });
  const events: boolean[] = [];
  lock.onChange((v) => events.push(v));
  assert.deepEqual(await lock.setPresence("sekret", true), { ok: true });
  // Wait on the EVENT, not isLocked(): timestamps go stale a tick before
  // the timer prunes + broadcasts (the timer owns transitions).
  await waitFor(() => events.length >= 2, 2000, "a controller lease expiry");
  assert.deepEqual(events, [false, true]);
});

test("a lapsed controller lease re-locks EVERYTHING, the kiosk PIN lease included", async () => {
  const { lock, file } = await testLock(["1234"], 60_000, { key: "sekret", leaseMs: 30 });
  await lock.unlockWithPin("1234"); // kiosk: 60s
  await lock.setPresence("sekret", true); // controller: 30ms
  const events: boolean[] = [];
  lock.onChange((v) => events.push(v));
  await waitFor(() => events.length >= 1, 2000, "controller expiry clearing all");
  assert.deepEqual(events, [true]);
  assert.equal(lock.isLocked(), true);
  // persist() is fire-and-forget in the timer — poll the file, don't race it.
  await waitFor(
    async () => {
      const parsed = JSON.parse(await readFile(file, "utf8")) as { leases: Record<string, number> };
      return Object.keys(parsed.leases).length === 0;
    },
    1000,
    "cleared table persisted",
  );
});

test("a lapsed kiosk lease alone leaves the controller presence untouched", async () => {
  const { lock } = await testLock(["1234"], 30, { key: "sekret", leaseMs: 60_000 });
  await lock.unlockWithPin("1234"); // kiosk: 30ms
  await lock.setPresence("sekret", true); // controller: an hour
  await sleep(80); // the kiosk expiry fires; the controller lease must survive it
  assert.equal(lock.isLocked(), false);
});

test("present:false is the goodbye: every lease clears, even a fresh PIN's", async () => {
  const { lock } = await testLock(["1234"], 60_000, { key: "sekret" });
  await lock.unlockWithPin("1234");
  const events: boolean[] = [];
  lock.onChange((v) => events.push(v));
  assert.deepEqual(await lock.setPresence("sekret", false), { ok: true });
  assert.equal(lock.isLocked(), true);
  assert.deepEqual(events, [true]);
});
