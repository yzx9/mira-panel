// Data layer for the GLM Coding Plan usage panel.
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

import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CLAUDE_WRAPPER = '/etc/profiles/per-user/yzx9/bin/claude';
const SETTINGS_RE = /\/nix\/store\/[^"'\s]*claude-code-glm-settings\.json/;

const CRED_TTL_MS = 10 * 60 * 1000; // key/host rarely change
const DATA_TTL_MS = 25 * 1000; // panel polls every 60s -> always fresh
const REQUEST_TIMEOUT_MS = 12 * 1000;

let cred = { at: 0, host: null, base: null, key: null };
let cache = { at: 0, data: null };
let inflight = null;

/** Resolve { host, key } from the nix-generated claude wrapper. */
async function credentials() {
  if (cred.key && Date.now() - cred.at < CRED_TTL_MS) return cred;

  const wrapper = await realpath(CLAUDE_WRAPPER);
  const wrapperText = await readFile(wrapper, 'utf8');
  const settingsPath = wrapperText.match(SETTINGS_RE)?.[0];
  if (!settingsPath) throw new Error(`no claude-code-glm-settings.json referenced by ${wrapper}`);

  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  const env = settings.env ?? {};
  const helper = settings.apiKeyHelper;
  if (!helper) throw new Error(`settings ${settingsPath} has no apiKeyHelper`);

  const base = env.ANTHROPIC_BASE_URL;
  if (!base) throw new Error(`settings ${settingsPath} has no ANTHROPIC_BASE_URL`);

  const { stdout } = await execFileAsync(helper, [], { timeout: 10000 });
  const key = stdout.trim();
  if (!key) throw new Error(`apiKeyHelper ${helper} returned an empty key`);

  cred = { at: Date.now(), base, host: new URL(base).origin, key };
  return cred;
}

async function getJson(url, key) {
  const res = await fetch(url, {
    headers: {
      Authorization: key, // raw key: no Bearer prefix
      'Accept-Language': 'zh-CN,zh',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  if (json.success === false || (json.code && json.code !== 200)) {
    throw new Error(`API code ${json.code}: ${json.msg ?? text.slice(0, 200)}`);
  }
  return json.data ?? json;
}

// ---------------------------------------------------------------- formatting

const two = (n) => String(n).padStart(2, '0');

const fmtTime = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;
const fmtDate = (d) => `${d.getMonth() + 1}-${two(d.getDate())}`;

function fmtCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d}天 ${h}小时`;
  if (h > 0) return `${h}小时 ${m}分`;
  return `${m}分`;
}

/** 1_000_479_997 -> "10.0亿"; keeps the panel narrow and stable-width. */
function fmtTokens(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e8) return `${(n / 1e8).toFixed(n >= 1e9 ? 1 : 2)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return String(n);
}

const fmtInt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '—');

function resetInfo(ms) {
  if (!Number.isFinite(ms)) return { at: '未知', in: '' };
  const d = new Date(ms);
  const hoursAway = (ms - Date.now()) / 3_600_000;
  return {
    at: hoursAway > 24 ? `${fmtDate(d)} ${fmtTime(d)}` : fmtTime(d),
    in: fmtCountdown(ms - Date.now()),
  };
}

// ------------------------------------------------------------------ fetching

function windowParams() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, now.getHours(), 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 59, 59, 999);
  const stamp = (d) =>
    `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  return `?startTime=${encodeURIComponent(stamp(start))}&endTime=${encodeURIComponent(stamp(end))}`;
}

function normaliseQuota(data) {
  const limits = data?.limits ?? [];
  const find = (type, unit, number) =>
    limits.find((l) => l.type === type && (unit === undefined || l.unit === unit) && (number === undefined || l.number === number));

  const out = { level: (data?.level ?? '').toUpperCase(), fiveHour: null, weekly: null, mcp: null };

  const five = find('TOKENS_LIMIT', 3, 5) ?? find('TOKENS_LIMIT', 3);
  if (five) {
    const pct = Math.round(five.percentage ?? 0);
    const r = resetInfo(five.nextResetTime);
    out.fiveHour = { pct, remainPct: 100 - pct, bar: pct, resetAt: r.at, resetIn: r.in };
  }

  const week = find('TOKENS_LIMIT', 6);
  if (week) {
    const pct = Math.round(week.percentage ?? 0);
    const r = resetInfo(week.nextResetTime);
    out.weekly = { pct, remainPct: 100 - pct, bar: pct, resetAt: r.at, resetIn: r.in };
  }

  const mcp = find('TIME_LIMIT', 5, 1) ?? find('TIME_LIMIT', 5);
  if (mcp) {
    const used = mcp.currentValue ?? 0;
    const total = mcp.usage ?? 100;
    const pct = Math.round(mcp.percentage ?? 0);
    const r = resetInfo(mcp.nextResetTime);
    out.mcp = {
      used,
      total,
      remain: mcp.remaining ?? total - used,
      pct,
      bar: pct,
      resetAt: r.at,
      resetIn: r.in,
      details: (mcp.usageDetails ?? []).map((d) => ({ name: d.modelCode, usage: d.usage ?? 0 })),
    };
  }
  return out;
}

function normaliseUsage(modelData, toolData) {
  const totals = modelData?.totalUsage ?? {};
  const summary = totals.modelSummaryList ?? modelData?.modelSummaryList ?? [];
  const hourTokens = modelData?.tokensUsage ?? [];
  const hourCalls = modelData?.modelCallCount ?? [];

  const tools = [
    { name: '联网搜索', count: (toolData?.networkSearchCount ?? []).reduce((a, b) => a + b, 0) },
    { name: '网页读取', count: (toolData?.webReadMcpCount ?? []).reduce((a, b) => a + b, 0) },
    { name: '开源仓库', count: (toolData?.zreadMcpCount ?? []).reduce((a, b) => a + b, 0) },
  ];

  return {
    calls: totals.totalModelCallCount ?? hourCalls.reduce((a, b) => a + b, 0),
    tokens: totals.totalTokensUsage ?? hourTokens.reduce((a, b) => a + b, 0),
    models: summary.slice(0, 3).map((m) => ({ name: m.modelName, tokens: m.totalTokens })),
    hours: hourTokens.length,
    // Per-hour series for the sparkline card ("HH:00" labels).
    hourlyTokens: hourTokens,
    hourlyLabels: (modelData?.x_time ?? []).map((s) => String(s).slice(11, 16)),
    tools,
  };
}

/** Everything the panel needs, with all formatting already applied. */
export async function getUsage() {
  if (cache.data && Date.now() - cache.at < DATA_TTL_MS) return cache.data;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { host, key } = await credentials();
      const params = windowParams();
      const [quota, models, tools] = await Promise.all([
        getJson(`${host}/api/monitor/usage/quota/limit`, key),
        getJson(`${host}/api/monitor/usage/model-usage${params}`, key),
        getJson(`${host}/api/monitor/usage/tool-usage${params}`, key),
      ]);

      const data = {
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
      // Never hand the panel an empty screen: keep serving the last good numbers
      // and mark them stale so the kiosk shows a visible warning instead.
      const previous = cache.data;
      const data = {
        ...(previous ?? { level: '', fiveHour: null, weekly: null, mcp: null, usage: null }),
        ok: false,
        stale: true,
        error: err.message,
        fetchedAt: previous?.fetchedAt ?? '—',
        fetchedDate: previous?.fetchedDate ?? '',
      };
      if (previous) cache = { at: Date.now(), data };
      return data;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** id -> text pairs consumed by the client-side 60s updater. */
export function toDom(data) {
  const texts = {
    'fetched-at': data.fetchedAt,
    level: data.level || '—',
    'health-mark': data.ok ? '正常' : '⚠ 数据陈旧',
    // Tab-rail preview: 5-hour quota only, nothing else belongs in the rail.
    'p-glm-used': '—',
    'p-glm-remain': '—',
    'p-glm-reset': '—',
  };
  const bars = {};

  if (data.fiveHour) {
    texts['fh-pct'] = String(data.fiveHour.pct);
    texts['fh-remain'] = String(data.fiveHour.remainPct);
    texts['fh-reset-in'] = data.fiveHour.resetIn ? `${data.fiveHour.resetIn} 后重置` : '重置时间未知';
    texts['fh-reset-at'] = data.fiveHour.resetAt;
    bars['fh-bar'] = data.fiveHour.bar;
    texts['p-glm-used'] = String(data.fiveHour.pct);
    texts['p-glm-remain'] = String(data.fiveHour.remainPct);
    texts['p-glm-reset'] = data.fiveHour.resetIn || data.fiveHour.resetAt;
  }
  if (data.weekly) {
    texts['wk-pct'] = String(data.weekly.pct);
    texts['wk-remain'] = String(data.weekly.remainPct);
    texts['wk-reset-in'] = data.weekly.resetIn ? `${data.weekly.resetIn} 后重置` : '重置时间未知';
    bars['wk-bar'] = data.weekly.bar;
  }
  if (data.mcp) {
    texts['mcp-used'] = fmtInt(data.mcp.used);
    texts['mcp-total'] = fmtInt(data.mcp.total);
    texts['mcp-remain'] = fmtInt(data.mcp.remain);
    texts['mcp-pct'] = String(data.mcp.pct);
    texts['mcp-reset-at'] = data.mcp.resetAt;
    texts['mcp-reset-in'] = data.mcp.resetIn;
    bars['mcp-bar'] = data.mcp.bar;
    data.mcp.details.forEach((d, i) => {
      texts[`mcp-d${i}-name`] = d.name;
      texts[`mcp-d${i}-usage`] = fmtInt(d.usage);
    });
  }
  if (data.usage) {
    texts['us-calls'] = fmtInt(data.usage.calls);
    texts['us-tokens'] = fmtTokens(data.usage.tokens);
    data.usage.models.forEach((m, i) => {
      texts[`us-m${i}-name`] = m.name;
      texts[`us-m${i}-tokens`] = fmtTokens(m.tokens);
    });
    data.usage.tools.forEach((t, i) => {
      texts[`us-t${i}-name`] = t.name;
      texts[`us-t${i}-count`] = fmtInt(t.count);
    });
  }
  return { texts, bars, stale: Boolean(data.stale), error: data.error };
}
