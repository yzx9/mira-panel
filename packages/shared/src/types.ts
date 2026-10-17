// View-model types shared between the server (SSR + /api/state payload) and
// the web components. The server derives a PanelState from the raw data layers;
// the client never fetches or normalises anything itself — it only renders
// this shape, which is what keeps SSR output and 60s-poll patches identical.

export type TabId = "clock" | "glm" | "vikunja";

export interface PanelState {
  /** Server build id; the client reloads itself when it changes. */
  build: string;
  /** Server timestamp stamped right after all fetches resolved. All
   *  countdowns are pure functions of (resetMs, now) so hydration agrees. */
  now: number;
  glm: GlmState;
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

/** One visible task row. `when` is the server-formatted due label
 *  ("今天 14:30" / "明天 09:00" / "10-20 08:00", "" when no due date). */
export interface TaskRow {
  id: number;
  title: string;
  project: string;
  when: string;
}

/** Rows already capped server-side; `more` counts what was cut off. */
export interface Bucket {
  rows: TaskRow[];
  more: number;
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
  buckets: { today: Bucket; soon: Bucket; overdue: Bucket } | null;
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
