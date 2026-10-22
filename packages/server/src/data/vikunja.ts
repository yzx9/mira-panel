// Vikunja data layer (ported from the previous vikunja.mjs).
//
// Auth: `Authorization: Bearer <token>`, resolved at runtime by the panel's
// own secret store (secrets.ts): process.env.VIKUNJA_API_KEY -> the repo
// root `.env`. The token never reaches argv or a log; see the panel README's
// security notes.
//
// Instance base URL: config, not code — process.env.VIKUNJA_API -> the repo
// root `.env` (same chain). No built-in default; a missing base is this
// source's own honest error.
//
// Query: the web app's own path — per project, its default LIST VIEW's task
// list (`done = false`, sorted by `position`, the manual drag order), paged
// 50 at a time and concatenated. Three upstream facts shape this: the
// instance clamps per_page to 50 silently (a single big ask drops tasks);
// position sorting is VIEW-scoped in 2.x (the plain project/global task
// endpoints reject it with "provide a project view ID"); and the web list
// view is exactly /projects/{id}/views/{viewId}/tasks. Bucketing happens
// locally over the full result, preserving (project, position) order.
//
// The exported functions are pure upstream reads/writes that throw on
// failure — data caching, cadence and the stale-on-error contract live in
// the hub. Only the credential/config caches (token, projects, view ids)
// stay here: they change on nix rebuild timescales, not panel cadences.

import type { VikunjaCounts } from "@mira-panel/shared";

import { panelSecret } from "../secrets.ts";

const PAGE_SIZE = 50; // == the instance's max_items_per_page
const MAX_PAGES = 10; // safety valve: 500 open tasks means we stop counting
const PROJECT_TTL_MS = 10 * 60 * 1000; // also covers the token cache
const TIMEOUT_MS = 12 * 1000;

export interface TaskRaw {
  id: number;
  title: string;
  project: string;
  dueMs: number | null;
  when: string;
  priority: number;
}

export interface VikunjaBuckets {
  today: TaskRaw[];
  soon: TaskRaw[];
  overdue: TaskRaw[];
  noDue: TaskRaw[];
  later: TaskRaw[];
}

/** Body of the vikunja source: everything /api/raw shows, minus presentation. */
export interface VikunjaBody {
  counts: VikunjaCounts | null;
  buckets: VikunjaBuckets | null;
  /** True when MAX_PAGES full pages came back — every count is a floor then. */
  truncated: boolean;
}

interface VikunjaTask {
  id: number;
  title?: string;
  project_id?: number;
  due_date?: string | null;
  priority?: number;
}

let tokenCache: { at: number; token: string | null } = { at: 0, token: null };
let projectCache: { at: number; list: { id: number; title: string }[] } = { at: 0, list: [] };
let baseCache: { at: number; base: string | null } = { at: 0, base: null };

/** The instance base (…/api/v1) through the panel's store — no hardcoded
 *  default, the honest error below fires until the knob exists. Trailing
 *  slashes are trimmed so the .env value may carry one; cached on the same
 *  TTL as the token (the panel re-reads .env per call, but not per page). */
async function apiBase(): Promise<string> {
  if (baseCache.base && Date.now() - baseCache.at < PROJECT_TTL_MS) return baseCache.base;
  const base = (await panelSecret("VIKUNJA_API"))?.replace(/\/+$/, "");
  if (!base || !/^https?:\/\//.test(base))
    throw new Error("no Vikunja API base (env VIKUNJA_API or .env)");
  baseCache = { at: Date.now(), base };
  return base;
}

async function token(): Promise<string> {
  if (tokenCache.token && Date.now() - tokenCache.at < PROJECT_TTL_MS) return tokenCache.token;

  const found = await panelSecret("VIKUNJA_API_KEY");
  if (!found || found.length <= 10)
    throw new Error("no Vikunja token (env VIKUNJA_API_KEY or .env)");
  tokenCache = { at: Date.now(), token: found };
  return found;
}

/** Write calls the panel makes: POST with a JSON body. Both details are
 *  load-bearing on Vikunja 2.x v1 — PUT/PATCH answer 405 (that is the
 *  pre-2.0 verb), and without the Content-Type header the body is silently
 *  ignored. Verified against this instance; see README. */
interface ApiInit {
  method: "POST";
  json: unknown;
}

async function api(path: string, key: string, init?: ApiInit): Promise<unknown> {
  const res = await fetch(`${await apiBase()}${path}`, {
    method: init?.method,
    body: init ? JSON.stringify(init.json) : undefined,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(init ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 150)}`);
  return JSON.parse(text);
}

/** Projects (id + title), cached alongside the token. The list also drives
 *  the per-project task walk — order defines the within-bucket grouping. */
async function fetchProjects(key: string): Promise<{ id: number; title: string }[]> {
  if (projectCache.list.length > 0 && Date.now() - projectCache.at < PROJECT_TTL_MS)
    return projectCache.list;
  const projects = (await api("/projects", key)) as { id: number; title?: string }[];
  const list = (Array.isArray(projects) ? projects : []).map((p) => ({
    id: p.id,
    title: (p.title ?? "").trim(),
  }));
  projectCache = { at: Date.now(), list };
  return list;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Vikunja sends "0001-01-01..." for "no due date". */
function parseDue(value: string | null | undefined): Date | null {
  if (!value || !value.startsWith("2")) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalise(task: VikunjaTask, projects: Record<string, string>): TaskRaw {
  const due = parseDue(task.due_date);
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  let when = "";
  if (due) {
    const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    if (sameDay(due, now)) when = `今天 ${pad(due.getHours())}:${pad(due.getMinutes())}`;
    else if (sameDay(due, tomorrow)) when = `明天 ${pad(due.getHours())}:${pad(due.getMinutes())}`;
    else
      when = `${due.getMonth() + 1}-${pad(due.getDate())} ${pad(due.getHours())}:${pad(due.getMinutes())}`;
  }
  return {
    id: task.id,
    title: (task.title ?? "").trim(),
    project: projects[task.project_id ?? -1] ?? `#${task.project_id}`,
    dueMs: due ? due.getTime() : null,
    when,
    priority: task.priority ?? 0,
  };
}

/** Group undone tasks into the buckets the panel shows. */
function classify(items: TaskRaw[]): { counts: VikunjaCounts; buckets: VikunjaBuckets } {
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const horizon = new Date(endOfToday.getTime() + 7 * 86400000);

  const buckets: VikunjaBuckets = { today: [], soon: [], overdue: [], noDue: [], later: [] };
  for (const t of items) {
    if (t.dueMs === null) buckets.noDue.push(t);
    else if (t.dueMs < now.getTime()) buckets.overdue.push(t);
    else if (t.dueMs <= endOfToday.getTime()) buckets.today.push(t);
    else if (t.dueMs <= horizon.getTime()) buckets.soon.push(t);
    else buckets.later.push(t);
  }

  const counts: VikunjaCounts = {
    today: buckets.today.length,
    soon: buckets.soon.length,
    overdue: buckets.overdue.length,
    noDue: buckets.noDue.length,
    later: buckets.later.length,
    open: items.length,
  };
  return { counts, buckets };
}

/** Grand-total safety valve across the per-project walk. */
const MAX_TASKS = MAX_PAGES * PAGE_SIZE;

/** Default list view per project (position sorting is view-scoped in 2.x).
 * Cached alongside the projects; null = no usable view, that project falls
 * back to its plain tasks endpoint sorted by due date. */
let viewCache: { at: number; map: Map<number, number | null> } = { at: 0, map: new Map() };

async function defaultViewIds(
  key: string,
  projects: { id: number }[],
): Promise<Map<number, number | null>> {
  if (viewCache.map.size > 0 && Date.now() - viewCache.at < PROJECT_TTL_MS) return viewCache.map;
  const map = new Map<number, number | null>();
  await Promise.all(
    projects.map(async (p) => {
      try {
        const views = (await api(`/projects/${p.id}/views`, key)) as {
          id?: number;
          view_kind?: string;
        }[];
        const list = Array.isArray(views) ? views : [];
        const pick = list.find((v) => v.view_kind === "list") ?? list[0];
        map.set(p.id, pick?.id ?? null);
      } catch {
        map.set(p.id, null);
      }
    }),
  );
  viewCache = { at: Date.now(), map };
  return map;
}

/** Walk every project's default list view and page through its undone
 *  tasks, `position` first (the web app's manual drag order). A non-array
 *  page counts as short (same leniency the single-request version had).
 *  Hitting MAX_TASKS, or one view alone filling MAX_PAGES, flags truncated. */
async function fetchAllTasks(
  key: string,
  projects: { id: number; title: string }[],
): Promise<{ items: VikunjaTask[]; truncated: boolean }> {
  const views = await defaultViewIds(key, projects);
  const out: VikunjaTask[] = [];
  const filter = encodeURIComponent("done = false");
  for (const project of projects) {
    // Pseudo projects (Favorites and friends) carry negative ids and no
    // tasks of their own — their content is other projects', already walked.
    if (project.id < 0) continue;
    const view = views.get(project.id) ?? null;
    const base = view
      ? `/projects/${project.id}/views/${view}/tasks`
      : `/projects/${project.id}/tasks`;
    const sort = view ? "position" : "due_date";
    for (let page = 1; page <= MAX_PAGES; page++) {
      let res: unknown;
      try {
        res = await api(
          `${base}?filter=${filter}&sort_by=${sort}&order_by=asc&per_page=${PAGE_SIZE}&page=${page}`,
          key,
        );
      } catch (err) {
        // Some Vikunja builds answer a beyond-last-page read with 404 (others
        // return []) — for page > 1 that means "no more rows", not a failure.
        if (page > 1 && err instanceof Error && err.message.startsWith("HTTP 404")) break;
        throw err;
      }
      const rows = Array.isArray(res) ? (res as VikunjaTask[]) : [];
      out.push(...rows);
      if (out.length >= MAX_TASKS) return { items: out, truncated: true };
      if (rows.length < PAGE_SIZE) break; // view exhausted
      if (page === MAX_PAGES) return { items: out, truncated: true };
    }
  }
  return { items: out, truncated: false };
}

/** All undone tasks, bucketed and counted; throws on failure (the hub marks
 *  the previous numbers stale). */
export async function fetchTasks(): Promise<VikunjaBody> {
  const key = await token();
  const projects = await fetchProjects(key);
  const paged = await fetchAllTasks(key, projects);
  const names: Record<string, string> = {};
  for (const p of projects) names[p.id] = p.title;
  const items = paged.items.map((t) => normalise(t, names)).filter((t) => !t.title.includes("__"));
  return { truncated: paged.truncated, ...classify(items) };
}

/** Complete a task upstream (pure write — re-marking a done task done is
 *  idempotent). The write route pairs this with a hub force-refresh so the
 *  answer reflects the change. */
export async function markTaskDone(id: number): Promise<void> {
  const key = await token();
  await api(`/tasks/${id}`, key, { method: "POST", json: { done: true } });
}
