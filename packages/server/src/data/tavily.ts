// Tavily monthly-credits layer.
//
// GET https://api.tavily.com/usage, Authorization: Bearer <key>. Direct
// connections time out on this host, so the single request goes through the
// local HTTP proxy via a per-request undici ProxyAgent (Node's native fetch
// honors init.dispatcher — verified on Node 24). Proxy URL resolution order:
//   TAVILY_PROXY -> HTTPS_PROXY -> ALL_PROXY   (process env)
//   -> ALL_PROXY / HTTPS_PROXY from agenix/hermes-env   (the panel process may
//      not inherit the desktop session env)
//   -> direct (last resort; expected to time out here)
//
// The endpoint is rate-limited to 10 requests / 10 minutes, so DATA_TTL_MS is
// exactly 10 minutes — the 60s panel poll always hits the cache. A 429 falls
// into the generic error path (stale card); if other Tavily consumers on the
// same key collide, bump the TTL past the window.
//
// The monthly reset is NOT in the payload; the card derives it at render time
// from state.now via the shared nextMonthStart(). Key values exist only in
// server memory — never in error strings, never in the data objects.

import { readFile } from "node:fs/promises";
import { ProxyAgent } from "undici";

import { fmtDate, fmtTime } from "@mira-panel/shared";
import type { TavilyUsage } from "@mira-panel/shared";

import { agenixFile, keyFromText, readKeyFile } from "./keys.ts";

const API = "https://api.tavily.com/usage";
const DATA_TTL_MS = 10 * 60 * 1000; // = the endpoint's rate-limit window
const REQUEST_TIMEOUT_MS = 12 * 1000;

/** Raw Tavily payload: everything /api/raw shows (no secrets — `api` is the
 *  verbatim upstream JSON, which contains usage counters only). */
export interface TavilyData {
  ok: boolean;
  stale: boolean;
  error: string | null;
  fetchedAt: string;
  fetchedDate: string;
  /** null when the payload had no account block. */
  usage: TavilyUsage | null;
  api: unknown;
}

export interface TavilyResponse {
  key?: {
    usage?: number;
    limit?: number | null;
    search_usage?: number;
    crawl_usage?: number;
    extract_usage?: number;
    map_usage?: number;
    research_usage?: number;
  };
  account?: {
    current_plan?: string;
    plan_usage?: number;
    plan_limit?: number | null;
    search_usage?: number;
    crawl_usage?: number;
    extract_usage?: number;
    map_usage?: number;
    research_usage?: number;
    paygo_usage?: number;
    paygo_limit?: number;
  };
}

/** Auth failure that rotating to the next candidate key might fix. */
class AuthError extends Error {}

const toCount = (v: unknown): number | null => {
  // Explicit null stays null (e.g. plan_limit:null = unlimited): Number(null)
  // would silently coerce it to 0.
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Map the account pool (headline) plus this key's own counter. */
export function parseUsage(json: TavilyResponse | null): Pick<TavilyData, "usage"> {
  const acc = json?.account;
  if (!acc) return { usage: null };
  const used = toCount(acc.plan_usage) ?? 0;
  const limit = toCount(acc.plan_limit); // null = unlimited/unknown -> no bar
  return {
    usage: {
      plan: acc.current_plan ?? "",
      used,
      limit,
      pct: limit !== null && limit > 0 ? Math.round((used / limit) * 100) : null,
      keyUsed: toCount(json?.key?.usage),
    },
  };
}

let cache: { at: number; data: TavilyData | null } = { at: 0, data: null };
let inflight: Promise<TavilyData> | null = null;
/** Last key the API accepted; tried first while it keeps working. */
let keyCache: { key: string } | null = null;

async function candidates(): Promise<string[]> {
  const list = [
    process.env.TAVILY_API_KEY ?? null,
    ...(await Promise.all(
      ["hermes-env", "llm-api-keys"].map((f) => readKeyFile(agenixFile(f), "TAVILY_API_KEY")),
    )),
  ];
  const seen = new Set<string>();
  return list.filter((k): k is string => {
    if (!k || k.length <= 10 || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ------------------------------------------------------------------- proxy

/** ProxyAgent needs a scheme; the env may carry a bare host:port. */
function normaliseProxy(url: string): string {
  return /^https?:\/\//.test(url) ? url : `http://${url}`;
}

async function proxyUrl(): Promise<string | null> {
  const fromEnv = process.env.TAVILY_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY;
  if (fromEnv) return normaliseProxy(fromEnv);
  try {
    const text = await readFile(agenixFile("hermes-env"), "utf8");
    const fromFile = keyFromText(text, "ALL_PROXY") ?? keyFromText(text, "HTTPS_PROXY");
    return fromFile ? normaliseProxy(fromFile) : null;
  } catch {
    return null; // direct — will likely time out, but it is the honest fallback
  }
}

let agentCache: { url: string; agent: ProxyAgent } | null = null;

function dispatcherFor(url: string): ProxyAgent {
  if (!agentCache || agentCache.url !== url) agentCache = { url, agent: new ProxyAgent(url) };
  return agentCache.agent;
}

// ----------------------------------------------------------------- fetching

async function fetchUsage(key: string, dispatcher: ProxyAgent | null): Promise<unknown> {
  const res = await fetch(API, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(dispatcher ? { dispatcher } : {}),
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403)
    throw new AuthError(`HTTP ${res.status} ${text.slice(0, 120)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);
  return JSON.parse(text);
}

/** Usage snapshot, cached 10 min (= rate-limit window) with in-flight dedup
 *  and stale-on-error. */
export async function getTavilyUsage(): Promise<TavilyData> {
  if (cache.data && Date.now() - cache.at < DATA_TTL_MS) return cache.data;
  if (inflight) return inflight;

  inflight = (async (): Promise<TavilyData> => {
    try {
      const list = await candidates();
      if (list.length === 0)
        throw new Error("no Tavily key (env TAVILY_API_KEY / agenix hermes-env / llm-api-keys)");
      const proxy = await proxyUrl();
      const dispatcher = proxy ? dispatcherFor(proxy) : null;
      // Cached winner first, then the rest of the chain in declared order.
      const ordered = keyCache ? [keyCache.key, ...list.filter((k) => k !== keyCache!.key)] : list;
      let api: unknown = null;
      let lastAuth: AuthError | null = null;
      for (const key of ordered) {
        try {
          api = await fetchUsage(key, dispatcher);
          keyCache = { key };
          break;
        } catch (err) {
          if (err instanceof AuthError) {
            lastAuth = err;
            continue; // rotate key
          }
          throw err; // network / 5xx / 429: rotating cannot help
        }
      }
      if (api === null) {
        keyCache = null; // every candidate 401ed — start over next time
        throw new Error(
          `Tavily auth failed for all ${ordered.length} candidate keys: ${lastAuth?.message ?? "?"}`,
        );
      }
      const data: TavilyData = {
        ok: true,
        stale: false,
        error: null,
        fetchedAt: fmtTime(new Date()),
        fetchedDate: fmtDate(new Date()),
        ...parseUsage(api as TavilyResponse),
        api,
      };
      cache = { at: Date.now(), data };
      return data;
    } catch (err) {
      // Same stale-on-error contract as the other layers: keep last numbers.
      const previous = cache.data;
      const data: TavilyData = {
        ...(previous ?? { usage: null, api: null }),
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
