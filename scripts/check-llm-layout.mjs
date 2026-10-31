// Offline browser acceptance for the fixed-canvas LLM page. Build first;
// provide PLAYWRIGHT_MODULE / CHROMIUM_BIN when using Nix's browser tooling.
// No application server, provider login or upstream requests are involved.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assemble, tabTitle } from "../packages/server/src/template.ts";
import { render } from "../packages/web/dist/server/entry-server.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const client = join(root, "packages/web/dist/client");
const shell = await readFile(join(client, "index.html"), "utf8");
const artifacts = process.env.ARTIFACT_DIR;
if (artifacts) await mkdir(artifacts, { recursive: true });
const now = Date.UTC(2026, 9, 31, 10, 0);
const health = { ok: true, stale: false, error: null, fetchedAt: "18:00" };
const state = {
  build: "llm-layout-test",
  now,
  glm: {
    ...health,
    fiveHour: { pct: 44, resetMs: now + 2 * 3600000 },
    weekly: { pct: 62, resetMs: now + 4 * 86400000 },
    mcp: {
      used: 298,
      total: 1000,
      remain: 702,
      pct: 29.8,
      resetMs: now + 86400000,
      details: Array.from({ length: 18 }, (_, i) => ({ name: `MCP tool ${i + 1}`, usage: i + 10 })),
    },
    usage: {
      calls: 1234,
      tokens: 318000000,
      models: Array.from({ length: 19 }, (_, i) => ({ name: `model-${i + 1}`, tokens: 80000 + i })),
      tools: [
        { name: "联网搜索", count: 227 },
        { name: "网页读取", count: 71 },
      ],
    },
  },
  codex: {
    ...health,
    primary: { usedPct: 14, windowMins: 300, resetMs: now + 3 * 3600000 },
    secondary: { usedPct: 33, windowMins: 10080, resetMs: now + 4 * 86400000 },
    planType: "plus",
    creditsBalance: "0",
    resetCredits: 1,
  },
  vikunja: {
    ...health,
    counts: { today: 0, soon: 0, overdue: 0, noDue: 0, later: 0, open: 0 },
    buckets: { today: [], soon: [], overdue: [], noDue: [], later: [] },
    truncated: false,
  },
  deepseek: {
    ...health,
    balance: { available: true, currency: "CNY", total: 13.91, granted: 2.98, toppedUp: 10.92 },
  },
  tavily: {
    ...health,
    usage: { plan: "Researcher", used: 645, limit: 1000, pct: 64.5, keyUsed: 480 },
  },
};
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_BIN,
  headless: true,
  args: ["--no-sandbox"],
});
let checks = 0;
async function openFixture(fixture, { width = 2200, height = 1650, tab = "glm", js = true } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    timezoneId: "Asia/Shanghai",
    javaScriptEnabled: js,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error" || /hydration|mismatch/i.test(msg.text())) errors.push(msg.text());
  });
  await page.clock.setFixedTime(now);
  let acceptSubscription;
  let connection;
  const subscribed = new Promise((r) => {
    acceptSubscription = r;
  });
  await page.routeWebSocket("**/ws", (socket) => {
    connection = socket;
    socket.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "subscribe") {
        socket.send(JSON.stringify({ type: "hello", build: fixture.build, now, locked: false }));
        acceptSubscription();
      }
    });
  });
  const html = assemble(shell, {
    title: tabTitle(tab),
    appHtml: await render(tab, fixture, false, true),
    bootstrap: { tab, state: fixture, locked: false, pinConfigured: true },
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/assets/")) {
      await route.fulfill({ path: join(client, url.pathname) });
    } else {
      await route.fulfill({ contentType: "text/html", body: html });
    }
  });
  await page.goto("http://mira-panel.invalid/" + (tab === "clock" ? "" : tab));
  let timeout;
  try {
    if (js)
      await Promise.race([
        subscribed,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("hydration did not subscribe")), 10000);
        }),
      ]);
  } finally {
    clearTimeout(timeout);
  }
  await page.evaluate(() => document.fonts.ready);
  return { context, page, errors, send: (msg) => connection.send(JSON.stringify(msg)) };
}
async function assertFits(page) {
  const result = await page.evaluate(() => {
    const main = document.querySelector("main");
    const dialog = document.querySelector('[role="dialog"]');
    const rect = dialog?.getBoundingClientRect();
    const overflow = [
      ...document.querySelectorAll(
        ".llm-card, .usage-dialog, .usage-dialog-content, .llm-preview-column",
      ),
    ]
      .filter((el) => el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)
      .map((el) => ({
        name: el.className,
        width: el.clientWidth,
        scrollWidth: el.scrollWidth,
        height: el.clientHeight,
        scrollHeight: el.scrollHeight,
      }));
    return {
      mainScroll: main.scrollTop,
      mainOverflow: main.scrollHeight > main.clientHeight + 2,
      documentOverflow: document.documentElement.scrollHeight > innerHeight + 2,
      overflow,
      modalFits:
        !rect ||
        (rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= innerWidth + 1 &&
          rect.bottom <= innerHeight + 1),
    };
  });
  assert.deepEqual(result, {
    mainScroll: 0,
    mainOverflow: false,
    documentOverflow: false,
    overflow: [],
    modalFits: true,
  });
  checks++;
}
async function screenshot(page, name) {
  if (artifacts) await page.screenshot({ path: join(artifacts, `${name}.png`) });
}
try {
  const { context, page, errors, send } = await openFixture(state);
  assert.equal(await page.title(), "Mira Monitor · LLM 用量");
  assert.equal(await page.locator("details").count(), 0);
  assert.match(await page.locator(".llm-preview").innerText(), /44[\s\S]*% 已用[\s\S]*33/);
  assert.equal(
    await page
      .locator(".llm-card .bar i")
      .first()
      .evaluate((el) => el.style.width),
    "44%",
  );
  const columns = await page.locator(".llm-preview-column").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y };
    }),
  );
  assert.equal(columns[0].y, columns[1].y);
  assert.ok(columns[1].x > columns[0].x);
  const headings = await page.locator(".llm-preview-heading").evaluateAll((els) =>
    els.map((el) => {
      const name = el.querySelector(".llm-preview-name");
      const window = el.querySelector(".llm-preview-window");
      const nameRect = name.getBoundingClientRect();
      const windowRect = window.getBoundingClientRect();
      return {
        sameLine: windowRect.left >= nameRect.right && windowRect.top < nameRect.bottom,
        nameWeight: getComputedStyle(name).fontWeight,
        windowWeight: getComputedStyle(window).fontWeight,
      };
    }),
  );
  assert.equal(headings.length, 2);
  for (const heading of headings) {
    assert.equal(heading.sameLine, true);
    assert.equal(heading.nameWeight, "900");
    assert.equal(heading.windowWeight, "400");
  }
  assert.match(await page.locator(".llm-card").nth(1).innerText(), /更新于 18:00/);
  await screenshot(page, "llm-used-overview");
  await assertFits(page);

  const today = page.getByRole("button", { name: "查看今日用量明细" });
  await today.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.equal(await page.locator(".usage-dialog-table tbody tr").count(), 8);
  assert.equal(
    await page
      .locator(".usage-dialog-heading button")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(await page.locator(".body").evaluate((el) => el.inert), true);
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page
      .getByRole("button", { name: "下一页" })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .locator(".usage-dialog-heading button")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await assertFits(page);
  await screenshot(page, "today-dialog");
  await page.getByRole("button", { name: "下一页" }).click();
  assert.match(await dialog.innerText(), /model-9/);
  await page.getByRole("button", { name: "下一页" }).click();
  assert.match(await dialog.innerText(), /联网搜索/);
  assert.equal(await page.getByRole("button", { name: "下一页" }).count(), 0);
  await assertFits(page);
  // A live update can shorten a list while its last page is open. It must
  // clamp the page index instead of leaving an empty, unreachable page.
  send({
    type: "update",
    topic: "glm:usage",
    now,
    data: {
      ...health,
      usage: { ...state.glm.usage, models: state.glm.usage.models.slice(0, 1), tools: [] },
    },
  });
  await page.waitForFunction(
    () => document.querySelectorAll(".usage-dialog-table tbody tr").length === 1,
  );
  assert.match(await dialog.innerText(), /model-1/);
  assert.equal(await page.locator(".usage-dialog-pager").count(), 0);
  await assertFits(page);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await today.evaluate((el) => el === document.activeElement), true);
  assert.equal(await page.locator(".body").evaluate((el) => el.inert), false);

  await page.getByRole("button", { name: "查看 MCP 用量明细" }).click();
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /MCP 本月明细/);
  await screenshot(page, "mcp-dialog");
  await page.getByRole("button", { name: "下一页" }).click();
  await assertFits(page);
  await page.getByRole("button", { name: "关闭用量明细" }).click();
  await dialog.waitFor({ state: "detached" });
  await today.click();
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /model-1/);
  await page.mouse.click(10, 10);
  await dialog.waitFor({ state: "detached" });
  await page.mouse.move(1600, 900);
  await page.mouse.wheel(0, 1200);
  await assertFits(page);
  assert.deepEqual(errors, []);
  await context.close();

  for (const viewport of [
    { width: 1100, height: 825 },
    { width: 1280, height: 720 },
  ]) {
    const t = await openFixture(state, viewport);
    await assertFits(t.page);
    await t.page.getByRole("button", { name: "查看今日用量明细" }).click();
    await t.page.getByRole("dialog").waitFor();
    await assertFits(t.page);
    assert.deepEqual(t.errors, []);
    await t.context.close();
  }
  for (const tab of ["clock", "vikunja"]) {
    const t = await openFixture(state, { tab });
    assert.equal(await t.page.locator(".llm-preview-column").count(), 2);
    assert.deepEqual(t.errors, []);
    await t.context.close();
  }
  for (const variant of ["missing", "stale", "full", "zero", "no-week", "long-names"]) {
    const s = structuredClone(state);
    if (variant === "missing") {
      Object.assign(s.glm, { fiveHour: null, weekly: null, mcp: null, usage: null });
      Object.assign(s.codex, {
        primary: null,
        secondary: null,
        creditsBalance: null,
        resetCredits: null,
      });
    } else if (variant === "stale") {
      s.glm.stale = s.codex.stale = true;
    } else if (variant === "full" || variant === "zero") {
      const pct = variant === "full" ? 100 : 0;
      s.glm.fiveHour.pct =
        s.glm.weekly.pct =
        s.codex.primary.usedPct =
        s.codex.secondary.usedPct =
          pct;
    } else if (variant === "no-week") {
      s.glm.weekly = s.codex.secondary = null;
    } else {
      s.glm.usage.models.forEach((m) => {
        m.name = "long-model-name-".repeat(16);
      });
    }
    const t = await openFixture(s);
    await assertFits(t.page);
    if (variant === "long-names") {
      await t.page.getByRole("button", { name: "查看今日用量明细" }).click();
      await t.page.getByRole("dialog").waitFor();
      await assertFits(t.page);
    }
    if (variant === "missing")
      assert.equal(await t.page.getByRole("button", { name: /查看.*明细/ }).count(), 0);
    assert.deepEqual(t.errors, []);
    await t.context.close();
  }
  const noJs = await openFixture(state, { js: false });
  assert.match(await noJs.page.locator(".llm-card").first().innerText(), /后重置/);
  assert.match(await noJs.page.locator(".llm-card").nth(1).innerText(), /更新于 18:00/);
  await assertFits(noJs.page);
  await noJs.context.close();
  console.log(
    `LLM browser acceptance passed (${checks} layout checks; dialogs, paging, focus, scaling, SSR and missing/stale states).`,
  );
} finally {
  await browser.close();
}
