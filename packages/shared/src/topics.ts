// WebSocket subscription contract between web and server.
//
// The data flow is pull-by-declaration: a page names the topics its tab
// actually renders, the hub fetches exactly the upstream sources behind
// those topics at each source's own cadence, and nothing else is fetched
// or sent. Topics are finer than sources on purpose — the clock tab's rail
// needs only the GLM 5-hour pool and the Vikunja counts, so the quota walk
// happens but the model/tool usage endpoints are never called, and the
// payload is a few dozen bytes instead of the full slices.

import type {
  DeepSeekState,
  Health,
  McpQuota,
  QuotaPool,
  TabId,
  TavilyState,
  UsageSummary,
  VikunjaCounts,
  VikunjaState,
} from "./types.ts";

export type TopicId =
  | "glm:quota" // 5-hour + weekly + MCP pools (one upstream quota call)
  | "glm:rail" // 5-hour pool only — the rail preview on other tabs
  | "glm:usage" // today's model/tool usage (GLM tab only)
  | "vikunja:full" // counts + every bucket row (Vikunja tab)
  | "vikunja:counts" // counts only — the rail preview on other tabs
  | "deepseek" // balance card (GLM tab)
  | "tavily"; // credits card (GLM tab)

/** What each tab declares on connect. Static for a page's lifetime — a tab
 *  switch is a full navigation, so the set never changes mid-connection. */
export const TOPICS_FOR_TAB: Record<TabId, readonly TopicId[]> = {
  clock: ["glm:rail", "vikunja:counts"],
  glm: ["glm:quota", "glm:usage", "vikunja:counts", "deepseek", "tavily"],
  vikunja: ["glm:rail", "vikunja:full"],
};

// ------------------------------------------------------------ payloads
// Every payload carries its slice's own Health fields so each topic reports
// its freshness independently (the navbar stamp reads the active tab's).

export interface GlmRailPayload extends Health {
  fiveHour: QuotaPool | null;
}

export interface GlmQuotaPayload extends Health {
  fiveHour: QuotaPool | null;
  weekly: QuotaPool | null;
  mcp: McpQuota | null;
}

export interface GlmUsagePayload extends Health {
  usage: UsageSummary | null;
}

export interface VikunjaCountsPayload extends Health {
  counts: VikunjaCounts | null;
  truncated: boolean;
  buckets: null;
}

export interface TopicPayloadMap {
  "glm:quota": GlmQuotaPayload;
  "glm:rail": GlmRailPayload;
  "glm:usage": GlmUsagePayload;
  "vikunja:full": VikunjaState;
  "vikunja:counts": VikunjaCountsPayload;
  deepseek: DeepSeekState;
  tavily: TavilyState;
}

// ------------------------------------------------------------ messages

export interface SubscribeMsg {
  type: "subscribe";
  tab: TabId;
  locked: boolean;
  vw?: number;
  vh?: number;
  dpr?: number;
}

export interface LockMsg {
  type: "lock";
  locked: boolean;
}

export interface RefreshMsg {
  type: "refresh";
}

export type ClientMsg = SubscribeMsg | LockMsg | RefreshMsg;

export interface HelloMsg {
  type: "hello";
  /** Server build id — a mismatch is the deploy signal, same contract the
   *  old 60s poll carried. */
  build: string;
  now: number;
}

export interface UpdateMsg<T extends TopicId = TopicId> {
  type: "update";
  topic: T;
  /** Server timestamp stamped right after the fetch resolved; countdowns
   *  advance with updates exactly the way they advanced with polls. */
  now: number;
  data: TopicPayloadMap[T];
}

/** The forced round behind a client "refresh" finished. */
export interface AckMsg {
  type: "ack";
}

/** App-level keepalive: browsers answer WS ping frames without waking JS,
 *  so the server speaks JSON pings the page can actually see. */
export interface PingMsg {
  type: "ping";
}

export type ServerMsg = HelloMsg | UpdateMsg | AckMsg | PingMsg;
