// View-model types shared between the server (SSR + topic payloads) and the
// web components. The server derives a PanelState from the data sources; the
// client never fetches or normalises anything itself — it only renders this
// shape, which is what keeps SSR output and WS-update patches identical.

export type TabId = "clock" | "glm" | "vikunja";

export interface PanelState {
  /** Server build id; the client reloads itself when it changes. */
  build: string;
  /** Server timestamp stamped right after all fetches resolved. All
   *  countdowns are pure functions of (resetMs, now) so hydration agrees. */
  now: number;
  glm: GlmState;
  codex: CodexState;
  vikunja: VikunjaState;
  deepseek: DeepSeekState;
  tavily: TavilyState;
}

/** Fields every data source reports about its own health. */
export interface Health {
  ok: boolean;
  stale: boolean;
  error: string | null;
  /** Server-formatted "HH:MM" of the last successful fetch ("—" if none yet). */
  fetchedAt: string;
}

export interface QuotaPool {
  /** Percentage USED (the API reports usage; the UI shows remaining too). */
  pct: number;
  /** Epoch ms of the next reset, or null when the API did not say. */
  resetMs: number | null;
}

export interface McpDetail {
  name: string;
  usage: number;
}

export interface McpQuota {
  used: number;
  total: number;
  remain: number;
  pct: number;
  resetMs: number | null;
  details: McpDetail[];
}

export interface ModelUsage {
  name: string;
  tokens: number;
}

export interface ToolCall {
  name: string;
  count: number;
}

export interface UsageSummary {
  calls: number;
  tokens: number;
  /** Top models by token usage (server already capped the list). */
  models: ModelUsage[];
  tools: ToolCall[];
}

export interface GlmState extends Health {
  fiveHour: QuotaPool | null;
  weekly: QuotaPool | null;
  mcp: McpQuota | null;
  usage: UsageSummary | null;
}

/** One Codex (ChatGPT subscription) rate-limit window. The API reports
 *  usage; the UI derives remaining = 100 - usedPct. */
export interface CodexWindow {
  /** Percentage USED inside the window, clamped to 0-100. */
  usedPct: number;
  /** Window length in minutes: 300 = 5-hour, 10080 = weekly. Carried so an
   *  unexpected window labels itself instead of being passed off as 5h. */
  windowMins: number;
  /** Epoch ms of the next reset, null when the API did not say. */
  resetMs: number | null;
}

/** Codex subscription quota snapshot (server-normalized). This is the
 *  subscription's rate-limit surface, NOT the OpenAI platform USD balance —
 *  the two never mix on this panel. */
export interface CodexState extends Health {
  /** Plan slug as reported ("plus" / "pro" / …); null when absent. */
  planType: string | null;
  /** 5-hour window; null when the response carried none. */
  primary: CodexWindow | null;
  /** Weekly (10080-minute) window; null when the response carried none. */
  secondary: CodexWindow | null;
  /** Prepaid Codex credits balance, verbatim string as reported. */
  creditsBalance: string | null;
  /** Available rate-limit reset credits (free full resets). Display-only —
   *  the panel never consumes them. */
  resetCredits: number | null;
}

/** One visible task row. `when` is the server-formatted due label
 *  ("今天 14:30" / "明天 09:00" / "10-20 08:00", "" when no due date). */
export interface TaskRow {
  id: number;
  title: string;
  project: string;
  when: string;
}

export interface VikunjaCounts {
  today: number;
  soon: number;
  overdue: number;
  noDue: number;
  later: number;
  open: number;
}

export interface VikunjaState extends Health {
  /** null when no fetch ever succeeded (panel shows the failure card). */
  counts: VikunjaCounts | null;
  /** Full row list per bucket — nothing is truncated server-side; the
   *  client's task card pages through them locally. */
  buckets: {
    today: TaskRow[];
    soon: TaskRow[];
    overdue: TaskRow[];
    noDue: TaskRow[];
    later: TaskRow[];
  } | null;
  /** True when the upstream paged fetch hit MAX_PAGES: every count and
   *  bucket below is a floor, not the whole truth. */
  truncated: boolean;
}

export interface DeepSeekBalance {
  /** The account can still serve API calls (is_available upstream). */
  available: boolean;
  /** "CNY" | "USD" as reported; drives the currency symbol. */
  currency: string;
  /** Amounts arrive as strings and are parsed once, server-side. Shown as
   *  reported — granted + toppedUp is not validated against total. */
  total: number;
  granted: number;
  toppedUp: number;
}

export interface DeepSeekState extends Health {
  /** null when balance_infos came back empty (card shows its empty state). */
  balance: DeepSeekBalance | null;
}

export interface TavilyUsage {
  /** Account plan name ("Researcher"). */
  plan: string;
  /** Account-level monthly pool; null limit = unlimited/unknown (no bar). */
  used: number;
  limit: number | null;
  /** Percentage used, computed server-side like QuotaPool.pct; null when
   *  limit is null. */
  pct: number | null;
  /** Usage billed to this API key (period per Tavily's own reporting). */
  keyUsed: number | null;
}

export interface TavilyState extends Health {
  /** null when the payload had neither account nor key numbers. */
  usage: TavilyUsage | null;
}
