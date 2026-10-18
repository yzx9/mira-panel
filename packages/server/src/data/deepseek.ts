// DeepSeek balance layer.
//
// GET https://api.deepseek.com/user/balance, Authorization: Bearer <key>,
// DIRECT connection (no proxy — verified reachable from this host). Amounts
// arrive as STRINGS; there is no usage/token endpoint, so this is purely a
// balance snapshot. Refreshed every 30 minutes — a balance changes slowly.
//
// Key resolution: process.env.DEEPSEEK_API_KEY -> the repo root `.env`
// (secrets.ts — the panel's own store). An HTTP 401/403 clears the cached
// winner so the next fetch re-resolves (a rotated key takes effect without
// a restart). Key values exist only in server memory — never in error
// strings, never in the data objects (hence never in /api/raw).
//
// The exported fetcher is a pure upstream read that throws on failure —
// caching, cadence and the stale-on-error contract live in the hub.

import type { DeepSeekBalance } from "@mira-panel/shared";

import { panelSecret } from "../secrets.ts";

const API = "https://api.deepseek.com/user/balance";
const REQUEST_TIMEOUT_MS = 12 * 1000;

/** Body of the deepseek source: the mapped balance plus the verbatim
 *  upstream JSON for /api/raw (balances only, no secrets). */
export interface DeepSeekBody {
  /** null when balance_infos came back empty (carries `available` too). */
  balance: DeepSeekBalance | null;
  api: unknown;
}

interface BalanceInfoRaw {
  currency?: string;
  total_balance?: string;
  granted_balance?: string;
  topped_up_balance?: string;
}

export interface DeepSeekResponse {
  is_available?: boolean;
  balance_infos?: BalanceInfoRaw[];
}

/** Auth failure that rotating to the next candidate key might fix. */
class AuthError extends Error {}

const toAmount = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0; // "" / junk -> 0, never NaN
};

/** Map the payload; prefers the CNY entry when several currencies return. */
export function parseBalance(json: DeepSeekResponse | null): { balance: DeepSeekBalance | null } {
  const infos = Array.isArray(json?.balance_infos) ? json!.balance_infos! : [];
  const info = infos.find((b) => b.currency === "CNY") ?? infos[0] ?? null;
  return {
    balance: info
      ? {
          available: json?.is_available !== false,
          currency: info.currency ?? "CNY",
          total: toAmount(info.total_balance),
          granted: toAmount(info.granted_balance),
          toppedUp: toAmount(info.topped_up_balance),
        }
      : null, // balance_infos: [] -> the card shows its empty state
  };
}

/** Last key the API accepted; tried first while it keeps working. */
let keyCache: { key: string } | null = null;

/** The single configured key (env -> .env); a list only because the 401
 *  rotation machinery below consumes lists. */
async function candidates(): Promise<string[]> {
  const key = await panelSecret("DEEPSEEK_API_KEY");
  return key && key.length > 10 ? [key] : [];
}

async function fetchBalance(key: string): Promise<unknown> {
  const res = await fetch(API, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    // no dispatcher: DeepSeek is reached directly
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403)
    throw new AuthError(`HTTP ${res.status} ${text.slice(0, 120)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);
  return JSON.parse(text);
}

/** Balance snapshot through the rotating key chain; throws when every
 *  candidate key failed (the hub marks the previous numbers stale). */
export async function fetchDeepSeekBalance(): Promise<DeepSeekBody> {
  const list = await candidates();
  if (list.length === 0)
    throw new Error("no DeepSeek key (env DEEPSEEK_API_KEY / agenix hermes-env / llm-api-keys)");
  // Cached winner first, then the rest of the chain in declared order.
  const ordered = keyCache ? [keyCache.key, ...list.filter((k) => k !== keyCache!.key)] : list;
  let api: unknown = null;
  let lastAuth: AuthError | null = null;
  for (const key of ordered) {
    try {
      api = await fetchBalance(key);
      keyCache = { key };
      break;
    } catch (err) {
      if (err instanceof AuthError) {
        lastAuth = err;
        continue; // rotate key
      }
      throw err; // network / 5xx: rotating cannot help
    }
  }
  if (api === null) {
    keyCache = null; // every candidate 401ed — start over next time
    throw new Error(
      `DeepSeek auth failed for all ${ordered.length} candidate keys: ${lastAuth?.message ?? "?"}`,
    );
  }
  return { ...parseBalance(api as DeepSeekResponse), api };
}
