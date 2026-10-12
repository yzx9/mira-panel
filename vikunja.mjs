// Vikunja data layer for the Mira Monitor panel.
//
// Auth: `Authorization: Bearer <token>`, resolved at runtime in this order:
//   1. process.env.VIKUNJA_API_KEY
//   2. ${XDG_RUNTIME_DIR}/agenix/vikunja-env  (agenix-decrypted KEY=VALUE file)
//   3. ~/.local/share/hermes/.hermes/.env
// The token never reaches argv or a log; see the panel README's security notes.
//
// Query: one filtered list request (`done = false`, sorted by due date) is enough
// for a glance panel — bucketing happens locally so a single round trip covers
// today / next 7 days / overdue / no due date.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const API = process.env.VIKUNJA_API ?? 'https://todo.example.com/api/v1';
const PER_PAGE = 200;
const TASK_TTL_MS = 45 * 1000;
const PROJECT_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 12 * 1000;

let tokenCache = { at: 0, token: null };
let projectCache = { at: 0, map: null };
let cache = { at: 0, data: null };
let inflight = null;

async function readTokenFromFile(path) {
  try {
    const text = await readFile(path, 'utf8');
    const line = text.split('\n').find((l) => l.startsWith('VIKUNJA_API_KEY='));
    if (!line) return null;
    return line.slice('VIKUNJA_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  } catch {
    return null;
  }
}

async function token() {
  if (tokenCache.token && Date.now() - tokenCache.at < PROJECT_TTL_MS) return tokenCache.token;

  const candidates = [
    process.env.VIKUNJA_API_KEY,
    await readTokenFromFile(join(process.env.XDG_RUNTIME_DIR ?? '/run/user/1000', 'agenix/vikunja-env')),
    await readTokenFromFile(join(homedir(), '.local/share/hermes/.hermes/.env')),
  ];
  const found = candidates.find((t) => t && t.length > 10);
  if (!found) throw new Error('no Vikunja token (env VIKUNJA_API_KEY / agenix vikunja-env / hermes .env)');
  tokenCache = { at: Date.now(), token: found };
  return found;
}

async function api(path, key) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 150)}`);
  return JSON.parse(text);
}

async function projectNames(key) {
  if (projectCache.map && Date.now() - projectCache.at < PROJECT_TTL_MS) return projectCache.map;
  const projects = await api('/projects', key);
  const map = {};
  for (const p of Array.isArray(projects) ? projects : []) map[p.id] = p.title;
  projectCache = { at: Date.now(), map };
  return map;
}

const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDate = (d) => `${d.getMonth() + 1}-${pad(d.getDate())}`;

/** Vikunja sends "0001-01-01..." for "no due date". */
function parseDue(value) {
  if (!value || !value.startsWith('2')) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalise(task, projects) {
  const due = parseDue(task.due_date);
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  let when = '';
  if (due) {
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    if (sameDay(due, now)) when = `今天 ${fmtTime(due)}`;
    else if (sameDay(due, tomorrow)) when = `明天 ${fmtTime(due)}`;
    else when = `${fmtDate(due)} ${fmtTime(due)}`;
  }
  return {
    id: task.id,
    title: (task.title ?? '').trim(),
    project: projects[task.project_id] ?? `#${task.project_id}`,
    dueMs: due ? due.getTime() : null,
    when,
    priority: task.priority ?? 0,
  };
}

/** Group undone tasks into the four buckets the panel shows. */
function classify(items) {
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const horizon = new Date(endOfToday.getTime() + 7 * 86400000);

  const buckets = { today: [], soon: [], overdue: [], noDue: [], later: [] };
  for (const t of items) {
    if (t.dueMs === null) buckets.noDue.push(t);
    else if (t.dueMs < now.getTime()) buckets.overdue.push(t);
    else if (t.dueMs <= endOfToday.getTime()) buckets.today.push(t);
    else if (t.dueMs <= horizon.getTime()) buckets.soon.push(t);
    else buckets.later.push(t);
  }
  // Overdue: newest first is far more useful than the oldest backlog item.
  buckets.overdue.reverse();

  const counts = {
    today: buckets.today.length,
    soon: buckets.soon.length,
    overdue: buckets.overdue.length,
    noDue: buckets.noDue.length,
    later: buckets.later.length,
    open: items.length,
  };
  return { counts, buckets };
}

export function tasksSignature(data) {
  if (!data) return 'none';
  // What the panel cannot patch as text: which tasks are in the visible lists.
  // Deliberately excludes fetchedAt / formatted times — including anything that
  // changes every fetch would make the client reload itself on every poll.
  const body = [
    data.counts?.open ?? 0,
    ...(data.buckets?.today ?? []).map((t) => `${t.id}:${t.dueMs}`),
    ...(data.buckets?.soon ?? []).map((t) => `${t.id}:${t.dueMs}`),
    ...(data.buckets?.overdue ?? []).slice(0, 8).map((t) => `${t.id}:${t.dueMs}`),
    ...(data.buckets?.noDue ?? []).slice(0, 5).map((t) => t.id),
  ].join('|');
  return createHash('sha1').update(body).digest('hex').slice(0, 8);
}

export async function getTasks() {
  if (cache.data && Date.now() - cache.at < TASK_TTL_MS) return cache.data;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const key = await token();
      const [tasks, projects] = await Promise.all([
        api(`/tasks?filter=${encodeURIComponent('done = false')}&sort_by=due_date&order_by=asc&per_page=${PER_PAGE}`, key),
        projectNames(key),
      ]);
      const items = (Array.isArray(tasks) ? tasks : []).map((t) => normalise(t, projects)).filter((t) => !t.title.includes('__'));
      const data = {
        ok: true,
        stale: false,
        error: null,
        fetchedAt: fmtTime(new Date()),
        fetchedDate: fmtDate(new Date()),
        ...classify(items),
      };
      cache = { at: Date.now(), data };
      return data;
    } catch (err) {
      const previous = cache.data;
      const data = {
        ...(previous ?? { counts: null, buckets: null }),
        ok: false,
        stale: true,
        error: String(err.message),
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

/** Patchable text ids for the sidebar preview and the Vikunja tab. */
export function tasksTexts(data) {
  const texts = {
    'p-vk-today': String(data.counts?.today ?? '—'),
    'p-vk-overdue': String(data.counts?.overdue ?? '—'),
    'p-vk-open': String(data.counts?.open ?? '—'),
    'vk-open': String(data.counts?.open ?? '—'),
    'vk-today': String(data.counts?.today ?? '—'),
    'vk-soon': String(data.counts?.soon ?? '—'),
    'vk-overdue': String(data.counts?.overdue ?? '—'),
    'vk-nodue': String(data.counts?.noDue ?? '—'),
    'vk-later': String(data.counts?.later ?? '—'),
    'vk-health': data.ok ? '正常' : '⚠ 数据陈旧',
    'vk-fetched-at': data.fetchedAt,
  };
  return texts;
}
