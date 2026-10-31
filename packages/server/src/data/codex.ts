// Codex subscription rate-limit layer.
//
// Runs `codex app-server --stdio` (the Codex CLI's JSON-RPC surface), does
// the initialize/initialized handshake and asks account/rateLimits/read —
// the same call the CLI's own /status uses, verified against codex-cli
// 0.156.1. One fresh process per fetch keeps this layer stateless: at the
// hub's 5-minute cadence the spawn cost is irrelevant and there is no daemon
// to supervise or leak.
//
// The Codex login (OAuth) stays in ~/.codex on whatever host runs the panel
// server — this layer never touches credentials itself; the CLI owns them.
// There is no key to configure; CODEX_BIN only overrides the executable.
//
// The exported fetcher is a pure upstream read that throws on failure —
// caching, cadence and the stale-on-error contract live in the hub.

import { spawn } from "node:child_process";

import type { CodexWindow } from "@mira-panel/shared";

import { panelSecret } from "../secrets.ts";

const REQUEST_TIMEOUT_MS = 15_000;
const FIVE_HOUR_MINS = 300;
const WEEK_MINS = 10_080;

/** Body of the codex source: the mapped windows plus a sanitized copy of
 *  the upstream result for /api/raw (account identifiers stripped — raw
 *  dumps carry data, never identity). */
export interface CodexBody {
  planType: string | null;
  /** 5-hour window; null when the response carried none. */
  primary: CodexWindow | null;
  /** Weekly (10080-minute) window; null when the response carried none. */
  secondary: CodexWindow | null;
  /** Prepaid credits balance, verbatim string as reported. */
  creditsBalance: string | null;
  /** Available rate-limit reset credits (free full resets). */
  resetCredits: number | null;
  api: unknown;
}

interface RawWindow {
  usedPercent?: unknown;
  windowDurationMins?: unknown;
  resetsAt?: unknown;
}

interface RawResult {
  rateLimits?: {
    primary?: RawWindow | null;
    secondary?: RawWindow | null;
    planType?: unknown;
    credits?: { balance?: unknown } | null;
  } | null;
  rateLimitResetCredits?: { availableCount?: unknown } | null;
}

function toWindow(raw: RawWindow | null | undefined): CodexWindow | null {
  if (!raw) return null;
  const used = Number(raw.usedPercent);
  if (!Number.isFinite(used)) return null;
  const mins = Number(raw.windowDurationMins);
  const resetRaw = Number(raw.resetsAt);
  // resetsAt is epoch SECONDS (verified live); a value already past 1e12 is
  // accepted as ms so a future unit change degrades instead of exploding.
  const resetMs = Number.isFinite(resetRaw) ? (resetRaw > 1e12 ? resetRaw : resetRaw * 1000) : null;
  return {
    usedPct: Math.max(0, Math.min(100, used)),
    windowMins: Number.isFinite(mins) ? mins : 0,
    resetMs,
  };
}

/** Map an account/rateLimits/read result. Windows are identified by DURATION
 *  (300 / 10080), not by slot name — the slots are presentation, the length
 *  is the identity. Unknown durations keep their real length and label
 *  themselves in the UI instead of being passed off as 5h or weekly. */
export function parseRateLimits(result: unknown): Omit<CodexBody, "api"> {
  const r = (result ?? {}) as RawResult;
  const limits = r.rateLimits ?? null;
  const primarySlot = toWindow(limits?.primary);
  const secondarySlot = toWindow(limits?.secondary);
  const both = [primarySlot, secondarySlot];
  let primary: CodexWindow | null =
    both.find((w): w is CodexWindow => w !== null && w.windowMins === FIVE_HOUR_MINS) ?? null;
  let secondary: CodexWindow | null =
    both.find((w): w is CodexWindow => w !== null && w.windowMins === WEEK_MINS) ?? null;
  // Fall back to the labeled slots only when no window matched by duration.
  if (!primary && !secondary) {
    primary = primarySlot;
    secondary = secondarySlot;
  }
  // A lone window must not render twice (both slots carrying the same length).
  if (primary && secondary && primary.windowMins === secondary.windowMins) secondary = null;

  const planTypeRaw = limits?.planType;
  const balanceRaw = limits?.credits?.balance;
  const resetsRaw = r.rateLimitResetCredits?.availableCount;
  return {
    planType: typeof planTypeRaw === "string" && planTypeRaw ? planTypeRaw : null,
    primary,
    secondary,
    creditsBalance: balanceRaw === undefined || balanceRaw === null ? null : String(balanceRaw),
    resetCredits: Number.isFinite(Number(resetsRaw)) ? Number(resetsRaw) : null,
  };
}

interface RpcMsg {
  id?: number;
  error?: { message?: string };
  result?: unknown;
}

/** One stdio JSON-RPC round: initialize -> initialized -> rateLimits read. */
async function rpcRead(): Promise<unknown> {
  const bin = (await panelSecret("CODEX_BIN")) || "codex";
  return await new Promise((resolve, reject) => {
    const child = spawn(bin, ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    let settled = false;
    let lastErrLine = "";
    let pending = "";
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      child.kill();
      settle();
    };
    const fail = (message: string) => finish(() => reject(new Error(message)));
    const deadline = setTimeout(
      () => fail(`codex app-server: no reply within ${REQUEST_TIMEOUT_MS / 1000}s`),
      REQUEST_TIMEOUT_MS,
    );

    const send = (msg: unknown) => {
      try {
        child.stdin!.write(JSON.stringify(msg) + "\n");
      } catch {
        // EPIPE after an exit — the exit handler owns the failure.
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      let nl: number;
      while ((nl = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        if (!line.trim()) continue;
        let msg: RpcMsg;
        try {
          msg = JSON.parse(line) as RpcMsg;
        } catch {
          continue; // non-JSON chatter never kills the round
        }
        if (msg.id === 1) {
          if (msg.error) fail(`codex initialize: ${msg.error.message ?? "?"}`);
          else {
            send({ method: "initialized" });
            send({ id: 2, method: "account/rateLimits/read", params: null });
          }
        } else if (msg.id === 2) {
          if (msg.error) fail(`codex rateLimits: ${msg.error.message ?? "?"}`);
          else finish(() => resolve(msg.result));
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      lastErrLine = chunk.toString("utf8").trim().split("\n").pop() ?? "";
    });
    child.on("error", (err) => fail(`codex spawn failed (${bin}): ${err.message}`));
    child.on("exit", (code) =>
      fail(
        `codex app-server exited early (${code ?? "?"})${lastErrLine ? `: ${lastErrLine.slice(0, 160)}` : ""}`,
      ),
    );

    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "mira-panel", version: "1" },
        capabilities: { experimentalApi: true },
      },
    });
  });
}

/** Subscription quota snapshot; throws when the round fails or answers
 *  without any window (the hub keeps the previous numbers and flags stale). */
export async function fetchCodexLimits(): Promise<CodexBody> {
  const result = await rpcRead();
  const parsed = parseRateLimits(result);
  if (!parsed.primary && !parsed.secondary)
    throw new Error("codex returned no rate-limit windows (check the CLI login)");
  // /api/raw keeps structure, drops identity: the account id never leaves
  // the process (same rationale as keys — raw dumps are for shapes).
  const safe = { ...(result ?? {}) } as Record<string, unknown>;
  delete safe.accountId;
  return { ...parsed, api: safe };
}
