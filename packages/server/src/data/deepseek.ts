// DeepSeek balance layer.
//
// GET https://api.deepseek.com/user/balance, Authorization: Bearer <key>,
// DIRECT connection (no proxy — verified reachable from this host). Amounts
// arrive as STRINGS; there is no usage/token endpoint, so this is purely a
// balance snapshot. Refreshed every 5 minutes — a balance changes slowly.
//
// Key chain (live-verified): the DEEPSEEK_API_KEY in agenix/llm-api-keys is
// STALE (authentication_error); the one in agenix/hermes-env is valid. Keys
// are therefore tried as env -> hermes-env -> llm-api-keys: an HTTP 401/403
// rotates to the next candidate and the winner is cached and tried first
// until it 401s again. Key values exist only in server memory — never in
// error strings, never in the data objects (hence never in /api/raw).

import { fmtDate, fmtTime } from "@mira-panel/shared";
import type { DeepSeekBalance } from "@mira-panel/shared";

import { agenixFile, readKeyFile } from "./keys.ts";

const API = "https://api.deepseek.com/user/balance";
const DATA_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12 * 1000;

/** Raw DeepSeek payload: everything /api/raw shows (no secrets — `api` is the
 *  verbatim upstream JSON, which contains balances only). */
export interface DeepSeekData {
  ok: boolean;
  stale: boolean;
  error: string | null;
  fetchedAt: string;
  fetchedDate: string;
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
export function parseBalance(json: DeepSeekResponse | null): Pick<DeepSeekData, "balance"> {
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

let cache: { at: number; data: DeepSeekData | null } = { at: 0, data: null };
let inflight: Promise<DeepSeekData> | null = null;
/** Last key the API accepted; tried first while it keeps working. */
let keyCache: { key: string } | null = null;

async function candidates(): Promise<string[]> {
  const list = [
    process.env.DEEPSEEK_API_KEY ?? null,
    ...(await Promise.all(
      ["hermes-env", "llm-api-keys"].map((f) => readKeyFile(agenixFile(f), "DEEPSEEK_API_KEY")),
    )),
  ];
  const seen = new Set<string>();
  return list.filter((k): k is string => {
    if (!k || k.length <= 10 || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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

/** Balance snapshot, cached 5 min with in-flight dedup and stale-on-error. */
export async function getDeepSeekBalance(): Promise<DeepSeekData> {
  if (cache.data && Date.now() - cache.at < DATA_TTL_MS) return cache.data;
  if (inflight) return inflight;

  inflight = (async (): Promise<DeepSeekData> => {
    try {
      const list = await candidates();
      if (list.length === 0)
        throw new Error(
          "no DeepSeek key (env DEEPSEEK_API_KEY / agenix hermes-env / llm-api-keys)",
        );
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
      const data: DeepSeekData = {
        ok: true,
        stale: false,
        error: null,
        fetchedAt: fmtTime(new Date()),
        fetchedDate: fmtDate(new Date()),
        ...parseBalance(api as DeepSeekResponse),
        api,
      };
      cache = { at: Date.now(), data };
      return data;
    } catch (err) {
      // Same stale-on-error contract as the other layers: keep last numbers.
      const previous = cache.data;
      const data: DeepSeekData = {
        ...(previous ?? { balance: null, api: null }),
        ok: false,
        stale: true,
        error: err instanceof Error ? err.message : String(err),
        fetchedAt: previous?.fetchedAt ?? "—",
        fetchedDate: previous?.fetchedDate ?? "",
      };
      if (previous) cache = { at: Date.now(), data };
      return data;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
