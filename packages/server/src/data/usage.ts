// GLM Coding Plan data layer (ported from the previous usage.mjs).
//
// Credentials: the Coding Plan API key is resolved at runtime through the same
// nix-managed chain the `claude` wrapper and cc-keepalive use — wrapper binary
// -> generated settings JSON -> `apiKeyHelper`. Nothing is hardcoded, so the
// panel survives every nix rebuild / GC.
//
// Endpoints (documented in zai-org/ZCode, docs/bigmodel-coding-plan-usage-quota.md):
//   GET <host>/api/monitor/usage/quota/limit      no query params, API-key auth
//   GET <host>/api/monitor/usage/model-usage      ?startTime=&endTime=
//   GET <host>/api/monitor/usage/tool-usage       ?startTime=&endTime=
// The `Authorization` header carries the raw key — a `Bearer` prefix fails auth.
//
// Quota item semantics (field combos, not array order):
//   TOKENS_LIMIT unit=3 number=5 -> 5-hour prompt pool
//   TOKENS_LIMIT unit=6 number=1 -> weekly pool (some accounts omit it entirely)
//   TIME_LIMIT   unit=5 number=1 -> MCP / tool monthly pool
// Missing items must be hidden, never rendered as empty cards.
//
// Port note: quota items carry `resetMs` (epoch ms or null) instead of the old
// precomputed resetAt/resetIn strings — display strings are derived at
// render/poll time from (resetMs, state.now) via the shared formatters, which
// keeps hydration exact and countdowns no older than the last fetch.

import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { promisify } from "node:util";

import { fmtDate, fmtTime } from "@mira-panel/shared";
import type { McpDetail, ModelUsage, ToolCall } from "@mira-panel/shared";

const execFileAsync = promisify(execFile);

const CLAUDE_WRAPPER = "/etc/profiles/per-user/yzx9/bin/claude";
const SETTINGS_RE = /\/nix\/store\/[^"'\s]*claude-code-glm-settings\.json/;

const CRED_TTL_MS = 10 * 60 * 1000; // key/host rarely change
const DATA_TTL_MS = 25 * 1000; // panel polls every 60s -> always fresh
const REQUEST_TIMEOUT_MS = 12 * 1000;

// -------------------------------------------------------------- raw shapes

export interface QuotaRaw {
  pct: number;
  remainPct: number;
  bar: number;
  resetMs: number | null;
}

export interface McpRaw {
  used: number;
  total: number;
  remain: number;
  pct: number;
  bar: number;
  resetMs: number | null;
  details: McpDetail[];
}

export interface UsageRaw {
  calls: number;
  tokens: number;
  models: ModelUsage[];
  hours: number;
  /** Per-hour series kept for /api/raw (future trend charts). */
  hourlyTokens: unknown[];
  hourlyLabels: string[];
  tools: ToolCall[];
}

/** Raw GLM payload: everything /api/raw shows, minus any presentation. */
export interface GlmData {
  ok: boolean;
  stale: boolean;
  error: string | null;
  fetchedAt: string;
  fetchedDate: string;
  level: string;
  fiveHour: QuotaRaw | null;
  weekly: QuotaRaw | null;
  mcp: McpRaw | null;
  usage: UsageRaw | null;
}

interface QuotaItem {
  type: string;
  unit: number;
  number?: number;
  percentage?: number;
  nextResetTime?: number;
  currentValue?: number;
  usage?: number;
  remaining?: number;
  usageDetails?: { modelCode: string; usage?: number }[];
}

interface QuotaResponse {
  level?: string;
  limits?: QuotaItem[];
}

interface ModelSummary {
  modelName: string;
  totalTokens: number;
}

interface ModelUsageResponse {
  totalUsage?: {
    totalModelCallCount?: number;
    totalTokensUsage?: number;
    modelSummaryList?: ModelSummary[];
  };
  modelSummaryList?: ModelSummary[];
  tokensUsage?: unknown[];
  modelCallCount?: number[];
  x_time?: unknown[];
}

interface ToolUsageResponse {
  networkSearchCount?: number[];
  webReadMcpCount?: number[];
  zreadMcpCount?: number[];
}

// -------------------------------------------------------------- credentials

interface Credentials {
  at: number;
  host: string;
  base: string;
  key: string;
}

let cred: Credentials | null = null;
let cache: { at: number; data: GlmData | null } = { at: 0, data: null };
let inflight: Promise<GlmData> | null = null;

/** Resolve { host, key } from the nix-generated claude wrapper. */
async function credentials(): Promise<Credentials> {
  if (cred && Date.now() - cred.at < CRED_TTL_MS) return cred;

  const wrapper = await realpath(CLAUDE_WRAPPER);
  const wrapperText = await readFile(wrapper, "utf8");
  const settingsPath = wrapperText.match(SETTINGS_RE)?.[0];
  if (!settingsPath) throw new Error(`no claude-code-glm-settings.json referenced by ${wrapper}`);

  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
    env?: { ANTHROPIC_BASE_URL?: string };
    apiKeyHelper?: string;
  };
  const helper = settings.apiKeyHelper;
  if (!helper) throw new Error(`settings ${settingsPath} has no apiKeyHelper`);
  const base = settings.env?.ANTHROPIC_BASE_URL;
  if (!base) throw new Error(`settings ${settingsPath} has no ANTHROPIC_BASE_URL`);

  const { stdout } = await execFileAsync(helper, [], { timeout: 10_000 });
  const key = stdout.trim();
  if (!key) throw new Error(`apiKeyHelper ${helper} returned an empty key`);

  cred = { at: Date.now(), base, host: new URL(base).origin, key };
  return cred;
}

async function getJson<T>(url: string, key: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: key, // raw key: no Bearer prefix
      "Accept-Language": "zh-CN,zh",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
  const json = JSON.parse(text) as {
    success?: boolean;
    code?: unknown;
    msg?: string;
    data?: T;
  };
  if (
    json.success === false ||
    (json.code !== undefined && json.code !== null && json.code !== 200)
  ) {
    throw new Error(`API code ${String(json.code)}: ${String(json.msg ?? text.slice(0, 200))}`);
  }
  return (json.data ?? (json as unknown)) as T;
}

// ---------------------------------------------------------------- fetching

const two = (n: number): string => String(n).padStart(2, "0");

function windowParams(): string {
  const now = new Date();
  // Today only — the panel shows a day's usage, not a rolling 24h window
  // (verified: totalUsage is computed over exactly the requested window).
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const stamp = (d: Date) =>
    `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  return `?startTime=${encodeURIComponent(stamp(start))}&endTime=${encodeURIComponent(stamp(end))}`;
}

/** Epoch ms of the next reset, or null when the API did not give one. */
function toResetMs(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normaliseQuota(
  data: QuotaResponse | null,
): Pick<GlmData, "level" | "fiveHour" | "weekly" | "mcp"> {
  const limits = data?.limits ?? [];
  const find = (type: string, unit?: number, num?: number) =>
    limits.find(
      (l) =>
        l.type === type &&
        (unit === undefined || l.unit === unit) &&
        (num === undefined || l.number === num),
    );

  const out: Pick<GlmData, "level" | "fiveHour" | "weekly" | "mcp"> = {
    level: (data?.level ?? "").toUpperCase(),
    fiveHour: null,
    weekly: null,
    mcp: null,
  };

  const five = find("TOKENS_LIMIT", 3, 5) ?? find("TOKENS_LIMIT", 3);
  if (five) {
    const pct = Math.round(five.percentage ?? 0);
    out.fiveHour = { pct, remainPct: 100 - pct, bar: pct, resetMs: toResetMs(five.nextResetTime) };
  }

  const week = find("TOKENS_LIMIT", 6);
  if (week) {
    const pct = Math.round(week.percentage ?? 0);
    out.weekly = { pct, remainPct: 100 - pct, bar: pct, resetMs: toResetMs(week.nextResetTime) };
  }

  const mcp = find("TIME_LIMIT", 5, 1) ?? find("TIME_LIMIT", 5);
  if (mcp) {
    const used = mcp.currentValue ?? 0;
    const total = mcp.usage ?? 100;
    const pct = Math.round(mcp.percentage ?? 0);
    out.mcp = {
      used,
      total,
      remain: mcp.remaining ?? total - used,
      pct,
      bar: pct,
      resetMs: toResetMs(mcp.nextResetTime),
      details: (mcp.usageDetails ?? []).map((d) => ({ name: d.modelCode, usage: d.usage ?? 0 })),
    };
  }
  return out;
}

function normaliseUsage(
  modelData: ModelUsageResponse | null,
  toolData: ToolUsageResponse | null,
): UsageRaw {
  const totals = modelData?.totalUsage ?? {};
  const summary = totals.modelSummaryList ?? modelData?.modelSummaryList ?? [];
  const hourTokens = modelData?.tokensUsage ?? [];
  const hourCalls = modelData?.modelCallCount ?? [];

  const tools: ToolCall[] = [
    { name: "联网搜索", count: (toolData?.networkSearchCount ?? []).reduce((a, b) => a + b, 0) },
    { name: "网页读取", count: (toolData?.webReadMcpCount ?? []).reduce((a, b) => a + b, 0) },
    { name: "开源仓库", count: (toolData?.zreadMcpCount ?? []).reduce((a, b) => a + b, 0) },
  ];

  return {
    calls: totals.totalModelCallCount ?? hourCalls.reduce((a, b) => a + b, 0),
    tokens: totals.totalTokensUsage ?? hourTokens.reduce((a: number, b) => a + Number(b), 0),
    models: summary.slice(0, 3).map((m) => ({ name: m.modelName, tokens: m.totalTokens })),
    hours: hourTokens.length,
    hourlyTokens: hourTokens,
    hourlyLabels: (modelData?.x_time ?? []).map((s) => String(s).slice(11, 16)),
    tools,
  };
}

/** Everything the panel needs, cached for 25s with in-flight dedup. */
export async function getUsage(): Promise<GlmData> {
  if (cache.data && Date.now() - cache.at < DATA_TTL_MS) return cache.data;
  if (inflight) return inflight;

  inflight = (async (): Promise<GlmData> => {
    try {
      const { host, key } = await credentials();
      const params = windowParams();
      const [quota, models, tools] = await Promise.all([
        getJson<QuotaResponse>(`${host}/api/monitor/usage/quota/limit`, key),
        getJson<ModelUsageResponse>(`${host}/api/monitor/usage/model-usage${params}`, key),
        getJson<ToolUsageResponse>(`${host}/api/monitor/usage/tool-usage${params}`, key),
      ]);

      const data: GlmData = {
        ok: true,
        stale: false,
        error: null,
        fetchedAt: fmtTime(new Date()),
        fetchedDate: fmtDate(new Date()),
        ...normaliseQuota(quota),
        usage: normaliseUsage(models, tools),
      };
      cache = { at: Date.now(), data };
      return data;
    } catch (err) {
      // Never hand the panel an empty screen: keep serving the last good
      // numbers and mark them stale so the kiosk shows a visible warning.
      const previous = cache.data;
      const data: GlmData = {
        ...(previous ?? { level: "", fiveHour: null, weekly: null, mcp: null, usage: null }),
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
