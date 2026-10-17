// Vikunja data layer (ported from the previous vikunja.mjs).
//
// Auth: `Authorization: Bearer <token>`, resolved at runtime in this order:
//   1. process.env.VIKUNJA_API_KEY
//   2. ${XDG_RUNTIME_DIR}/agenix/vikunja-env  (agenix-decrypted KEY=VALUE file)
//   3. ~/.local/share/hermes/.hermes/.env
// The token never reaches argv or a log; see the panel README's security notes.
//
// Query: a filtered list (`done = false`, sorted by due date), paged 50 at a
// time — the instance reports max_items_per_page = 50 and silently clamps
// larger asks, so a single big request would quietly drop tasks (the no-due
// sentinel sorts first, i.e. exactly the bucket the panel used to miss).
// Bucketing still happens locally over the full result.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { fmtDate, fmtTime } from "@mira-panel/shared";
import type { VikunjaCounts } from "@mira-panel/shared";

const API = process.env.VIKUNJA_API ?? "https://todo.example.com/api/v1";
const PAGE_SIZE = 50; // == the instance's max_items_per_page
const MAX_PAGES = 10; // safety valve: 500 open tasks means we stop counting
const TASK_TTL_MS = 45 * 1000;
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

/** Raw Vikunja payload: everything /api/raw shows, minus any presentation. */
export interface VikunjaData {
  ok: boolean;
  stale: boolean;
  error: string | null;
  fetchedAt: string;
  fetchedDate: string;
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
let projectCache: { at: number; map: Record<string, string> } = { at: 0, map: {} };
let cache: { at: number; data: VikunjaData | null } = { at: 0, data: null };
let inflight: Promise<VikunjaData> | null = null;

async function readTokenFromFile(path: string): Promise<string | null> {
  try {
    const text = await readFile(path, "utf8");
    const line = text.split("\n").find((l) => l.startsWith("VIKUNJA_API_KEY="));
    if (!line) return null;
    return line
      .slice("VIKUNJA_API_KEY=".length)
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    return null;
  }
}

async function token(): Promise<string> {
  if (tokenCache.token && Date.now() - tokenCache.at < PROJECT_TTL_MS) return tokenCache.token;

  const candidates = [
    process.env.VIKUNJA_API_KEY,
    await readTokenFromFile(
      join(process.env.XDG_RUNTIME_DIR ?? "/run/user/1000", "agenix/vikunja-env"),
    ),
    await readTokenFromFile(join(homedir(), ".local/share/hermes/.hermes/.env")),
  ];
  const found = candidates.find((t) => t && t.length > 10);
  if (!found)
    throw new Error("no Vikunja token (env VIKUNJA_API_KEY / agenix vikunja-env / hermes .env)");
  tokenCache = { at: Date.now(), token: found };
  return found;
}

async function api(path: string, key: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 150)}`);
  return JSON.parse(text);
}

async function projectNames(key: string): Promise<Record<string, string>> {
  if (projectCache.map && Date.now() - projectCache.at < PROJECT_TTL_MS) return projectCache.map;
  const projects = (await api("/projects", key)) as { id: number; title?: string }[];
  const map: Record<string, string> = {};
  for (const p of Array.isArray(projects) ? projects : []) map[p.id] = p.title ?? "";
  projectCache = { at: Date.now(), map };
  return map;
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
  // Overdue: newest first is far more useful than the oldest backlog item.
  buckets.overdue.reverse();

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

/** Page through all undone tasks: PAGE_SIZE per request, stopping at the
 *  first short page. A non-array page counts as short (same leniency the
 *  single-request version had). MAX_PAGES full pages = truncated. */
async function fetchAllTasks(key: string): Promise<{ items: VikunjaTask[]; truncated: boolean }> {
  const out: VikunjaTask[] = [];
  const filter = encodeURIComponent("done = false");
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await api(
      `/tasks?filter=${filter}&sort_by=due_date&order_by=asc&per_page=${PAGE_SIZE}&page=${page}`,
      key,
    );
    const rows = Array.isArray(res) ? (res as VikunjaTask[]) : [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return { items: out, truncated: false };
  }
  return { items: out, truncated: true };
}

/** All undone tasks, cached for 45s with in-flight dedup. */
export async function getTasks(): Promise<VikunjaData> {
  if (cache.data && Date.now() - cache.at < TASK_TTL_MS) return cache.data;
  if (inflight) return inflight;

  inflight = (async (): Promise<VikunjaData> => {
    try {
      const key = await token();
      const [paged, projects] = await Promise.all([fetchAllTasks(key), projectNames(key)]);
      const items = paged.items
        .map((t) => normalise(t, projects))
        .filter((t) => !t.title.includes("__"));
      const data: VikunjaData = {
        ok: true,
        stale: false,
        error: null,
        fetchedAt: fmtTime(new Date()),
        fetchedDate: fmtDate(new Date()),
        truncated: paged.truncated,
        ...classify(items),
      };
      cache = { at: Date.now(), data };
      return data;
    } catch (err) {
      const previous = cache.data;
      const data: VikunjaData = {
        ...(previous ?? { counts: null, buckets: null, truncated: false }),
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
