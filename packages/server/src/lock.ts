// Server-authoritative lock: the panel's global state is a LEASE TABLE,
// not a client declaration and not a cookie. "Unlocked" means at least one
// unexpired lease exists; when the last one lapses (or someone hits the
// lock button) the panel re-locks itself and every subscriber hears the
// transition. This module is the single seam the page redirects, the write
// route, SSR bootstraps and the hub's cadence all read from.
//
// Persistence: leases live in memory plus a JSON file under XDG_RUNTIME_DIR
// so `just deploy` restarts keep the unlock; a machine reboot clears the
// runtime dir, which re-locks the panel — that is the deliberate cold-boot
// safety property (and the last-resort escape hatch when a PIN is lost).
//
// Crypto: none beyond a plain comparison. The PIN is a 4-digit home-panel
// secret resolved at runtime from the agenix chain (never in code); the
// real brute-force defence is the exponential failure ladder below, since
// the keyspace is 10^4. See README's lock section for the trust level.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  LOCK_LEASE_MS,
  PIN_BACKOFF_BASE_MS,
  PIN_BACKOFF_MAX_MS,
  PIN_BACKOFF_RESET_MS,
} from "@mira-panel/shared";

import { agenixFile, readKeyFile } from "./data/keys.ts";

/** Pure: the delay owed for the n-th consecutive failure (1-based). */
export function backoffDelayMs(
  failures: number,
  base = PIN_BACKOFF_BASE_MS,
  max = PIN_BACKOFF_MAX_MS,
): number {
  if (failures <= 0) return 0;
  return Math.min(base * 2 ** (failures - 1), max);
}

/** Pure: which leases survive at `now` — empty table means locked. */
export function pruneLeases(leases: Record<string, number>, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [device, until] of Object.entries(leases)) if (until > now) out[device] = until;
  return out;
}

export type UnlockResult = { ok: true } | { ok: false; configured: boolean };

/** The surface the hub consumes (cadence + transition broadcast). */
export interface LockView {
  isLocked(): boolean;
  onChange(cb: (locked: boolean) => void): () => void;
}

export interface LockModule extends LockView {
  /** Sync cached flag for SSR bootstrap: a PIN is configured. */
  pinConfigured(): boolean;
  /** Drop every lease — the lock button. Persists + notifies. */
  lockAll(): Promise<void>;
  /** Throttled PIN verification; issues the standard lease on success. */
  unlockWithPin(pin: string): Promise<UnlockResult>;
  /** Re-read the PIN file once; boot awaits it to warm the cache. */
  warm(): Promise<void>;
}

export interface LockOptions {
  /** Lease table file. Persistence is best-effort: failures degrade to
   *  memory-only with a single stderr note, never a crash. */
  file: string;
  /** Lease duration; defaults to LOCK_LEASE_MS (injectable for tests). */
  leaseMs?: number;
  /** Resolves the configured PIN; null = not configured. */
  readPin?: () => Promise<string | null>;
  /** Backoff ladder overrides for tests. */
  backoffBaseMs?: number;
  backoffResetMs?: number;
  /** Clock override for tests. */
  now?: () => number;
}

interface PersistedShape {
  leases: Record<string, number>;
}

/** The only lease issuer this phase: a human PIN typed at the kiosk. The
 *  device key stays a dimension of the table so a future companion's
 *  renewable 5-minute lease drops in without a reshape. */
const KIOSK_DEVICE = "kiosk";

export async function createLock(opts: LockOptions): Promise<LockModule> {
  const file = opts.file;
  const leaseMs = opts.leaseMs ?? LOCK_LEASE_MS;
  const now = opts.now ?? Date.now;
  const readPin =
    opts.readPin ??
    (async () =>
      process.env.PANEL_PIN ?? (await readKeyFile(agenixFile("mira-panel-env"), "PANEL_PIN")));
  const backoffBase = opts.backoffBaseMs ?? PIN_BACKOFF_BASE_MS;
  const backoffReset = opts.backoffResetMs ?? PIN_BACKOFF_RESET_MS;

  let leases: Record<string, number> = {};
  let pinCache: string | null = null;
  let failures = 0;
  let lastAttempt = 0;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(locked: boolean) => void>();

  // ------------------------------------------------------------ persistence

  let persistBroken = false;

  async function persist(): Promise<void> {
    try {
      await mkdir(dirname(file), { recursive: true });
      const tmp = join(dirname(file), `.${Math.random().toString(36).slice(2)}.tmp`);
      await writeFile(tmp, JSON.stringify({ leases } satisfies PersistedShape));
      await rename(tmp, file);
    } catch (err) {
      if (!persistBroken) {
        persistBroken = true;
        process.stderr.write(`[mira-panel] lock persistence degraded to memory (${err})\n`);
      }
    }
  }

  async function restore(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<PersistedShape>;
      if (parsed && typeof parsed.leases === "object") leases = pruneLeases(parsed.leases, now());
    } catch {
      // missing/corrupt file -> locked; the next transition rewrites it
    }
  }

  // ------------------------------------------------------------ transitions

  function isLocked(): boolean {
    const alive = pruneLeases(leases, now());
    if (Object.keys(alive).length !== Object.keys(leases).length) {
      // Lazy pruning covers timer drift; the timer below does the broadcast.
      leases = alive;
    }
    return Object.keys(leases).length === 0;
  }

  function armExpiry(): void {
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = undefined;
    const untils = Object.values(pruneLeases(leases, now()));
    if (untils.length === 0) return;
    const wait = Math.max(0, Math.min(...untils) - now());
    expiryTimer = setTimeout(() => {
      expiryTimer = undefined;
      const wasUnlocked = Object.keys(leases).length > 0;
      leases = pruneLeases(leases, now());
      if (wasUnlocked && Object.keys(leases).length === 0) {
        void persist();
        for (const cb of listeners) cb(true);
      } else {
        armExpiry(); // other leases still running
      }
    }, wait);
    expiryTimer.unref?.();
  }

  function issueLease(device: string): void {
    leases = { ...leases, [device]: now() + leaseMs };
    armExpiry();
  }

  function lockAll(): Promise<void> {
    const wasUnlocked = Object.keys(leases).length > 0;
    leases = {};
    const done = persist();
    if (wasUnlocked) for (const cb of listeners) cb(true);
    return done;
  }

  async function unlockWithPin(pin: string): Promise<UnlockResult> {
    // Fresh read per attempt: a late agenix provisioning unlocks without a
    // restart, and the cache behind sync pinConfigured() stays truthful.
    pinCache = await readPin();
    // A quiet stretch forgives old failures — the ladder punishes bursts.
    if (failures > 0 && now() - lastAttempt > backoffReset) failures = 0;
    lastAttempt = now();
    const configured = pinCache !== null;
    const ok = configured && pin === pinCache;
    if (!ok) {
      failures += 1;
      const delay = backoffDelayMs(failures, backoffBase);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      return { ok: false, configured };
    }
    failures = 0;
    const wasLocked = isLocked();
    issueLease(KIOSK_DEVICE);
    await persist();
    if (wasLocked) for (const cb of listeners) cb(false);
    return { ok: true };
  }

  async function warm(): Promise<void> {
    pinCache = await readPin();
  }

  await restore();
  await warm();
  armExpiry();

  return {
    isLocked,
    pinConfigured: () => pinCache !== null,
    lockAll,
    unlockWithPin,
    warm,
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/** Default lease file: XDG_RUNTIME_DIR dies on reboot — that is the point. */
export function defaultLeasesFile(): string {
  return join(process.env.XDG_RUNTIME_DIR ?? "/run/user/1000", "mira-panel", "leases.json");
}
