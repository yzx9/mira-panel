// Derives the client-facing PanelState from the hub. This is the single
// contract point between server and web: SSR renders it, the page embeds it
// as JSON for hydration, and the WS topics push the very same payload
// shapes — slices go through payloadFor() on both paths, which is what
// keeps the SSR pass and the update patches display-identical.
//
// Bootstrap is tab-aware since the subscription refactor: a page embeds
// exactly the slices its tab declares (TOPICS_FOR_TAB), so the clock page
// no longer waits for (or carries) the Vikunja buckets, the DeepSeek
// balance or the Tavily credits.

import type { GlmState, PanelState, TabId, VikunjaState } from "@mira-panel/shared";

import { payloadFor, type AnySourceState, type Hub, type SourceName } from "./hub.ts";

/** The never-fetched stub slices embed for topics the tab does not declare
 *  (deepseek/tavily off the GLM tab). Nothing renders them there; the shape
 *  only has to satisfy PanelState. */
const NEVER: AnySourceState = {
  ok: false,
  stale: false,
  error: null,
  fetchedAt: "—",
  fetchedDate: "",
  payload: null,
};

/** The /vikunja view-model, exported for the write route: it answers with
 *  this same shape after a completion. */
export function vikunjaState(s: AnySourceState): VikunjaState {
  return payloadFor("vikunja:full", s) as VikunjaState;
}

function glmSlice(tab: TabId, quota: AnySourceState, usage: AnySourceState): GlmState {
  if (tab !== "glm") {
    // Rail-only: the quota walk happened, the usage endpoints never ran.
    const rail = payloadFor("glm:rail", quota);
    return { ...rail, weekly: null, mcp: null, usage: null } as GlmState;
  }
  const pools = payloadFor("glm:quota", quota);
  const used = payloadFor("glm:usage", usage);
  return { ...pools, usage: used.usage } as GlmState;
}

/** Assemble a tab's bootstrap: the sources its topics need are read through
 *  the hub (fresh within the interval, fetched otherwise — deduped with any
 *  in-flight round); the rest embeds the last-known state when there is
 *  one. `now` is stamped after the reads so countdowns are pure functions
 *  of (resetMs, now) — hydration-exact by construction. */
export async function stateFor(hub: Hub, tab: TabId, build: string): Promise<PanelState> {
  const reads: Partial<Record<SourceName, Promise<AnySourceState>>> = {
    "glm-quota": hub.get("glm-quota"),
    vikunja: hub.get("vikunja"),
  };
  if (tab === "glm") {
    reads["glm-usage"] = hub.get("glm-usage");
    reads.deepseek = hub.get("deepseek");
    reads.tavily = hub.get("tavily");
  }
  const s: Partial<Record<SourceName, AnySourceState>> = {};
  await Promise.all(
    (Object.keys(reads) as SourceName[]).map(async (k) => {
      s[k] = await reads[k]!;
    }),
  );

  const vkTopic = tab === "vikunja" ? "vikunja:full" : "vikunja:counts";
  return {
    build,
    now: Date.now(),
    glm: glmSlice(tab, s["glm-quota"]!, s["glm-usage"] ?? NEVER),
    vikunja: payloadFor(vkTopic, s.vikunja!) as VikunjaState,
    deepseek: payloadFor(
      "deepseek",
      s.deepseek ?? hub.peek("deepseek") ?? NEVER,
    ) as PanelState["deepseek"],
    tavily: payloadFor("tavily", s.tavily ?? hub.peek("tavily") ?? NEVER) as PanelState["tavily"],
  };
}
