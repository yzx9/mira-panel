import { fmtInt, fmtTokens, type GlmState } from "@mira-panel/shared";

export type UsageDetailKind = "today" | "mcp";
export const USAGE_DETAIL_PAGE_ROWS = 8;

export interface UsageDetailRow {
  name: string;
  category: string;
  value: string;
}

/** Breakdown rows are display-only: their sum must never replace the API's
 *  authoritative today-token total. Pagination avoids scrolling the kiosk. */
export function usageDetailRows(glm: GlmState, kind: UsageDetailKind): UsageDetailRow[] {
  if (kind === "mcp") {
    return (glm.mcp?.details ?? []).map((d) => ({
      name: d.name,
      category: "MCP",
      value: fmtInt(d.usage),
    }));
  }
  return [
    ...(glm.usage?.models ?? []).map((m) => ({
      name: m.name,
      category: "模型 Token",
      value: fmtTokens(m.tokens),
    })),
    ...(glm.usage?.tools ?? []).map((t) => ({
      name: t.name,
      category: "工具调用",
      value: `${fmtInt(t.count)} 次`,
    })),
  ];
}
