// Server-side rendered panel markup: navbar + 30% tab rail + detail area.
//
// Every value is rendered into the HTML on the server; the client script only
// patches text nodes that actually changed on the 60s poll. Tabs are plain
// links, so switching a tab is one SSR request (no client-side routing, no
// framework) and the page is fully readable with JavaScript disabled.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const bar = (id, pct) =>
  `<div class="bar"><i id="${id}" style="width:${Math.max(0, Math.min(100, Number(pct) || 0))}%"></i></div>`;

// ---------------------------------------------------------------- tab rail

function tabRail({ tab, glmDom, tasksDom }) {
  const g = glmDom.texts;
  const v = tasksDom.texts;
  const item = (key, label, previewHtml, subHtml, href) => `
      <a class="tab${tab === key ? ' active' : ''}" href="${href}">
        <span class="tab-label">${label}</span>
        <span class="tab-preview">${previewHtml}</span>
        <span class="tab-sub">${subHtml}</span>
      </a>`;

  return `
    <nav class="rail">
      ${item(
        'glm',
        'GLM 用量',
        `<span id="p-glm-used">${esc(g['p-glm-used'])}</span><span class="unit">% 已用</span>`,
        `5 小时额度 ・ 剩余 <b id="p-glm-remain">${esc(g['p-glm-remain'])}</b>%<br>重置 <b id="p-glm-reset">${esc(g['p-glm-reset'])}</b>`,
        '/glm',
      )}
      ${item(
        'vikunja',
        'Vikunja',
        `<span id="p-vk-today">${esc(v['p-vk-today'])}</span><span class="unit">今日</span>`,
        `逾期 <b id="p-vk-overdue">${esc(v['p-vk-overdue'])}</b> ・ 未完成 <b id="p-vk-open">${esc(v['p-vk-open'])}</b>`,
        '/vikunja',
      )}
      <div class="rail-note">
        <div>点左侧标签切换面板</div>
        <div id="rail-status">状态 <b id="status-mark">${esc(['glm', 'vikunja'].includes(tab) ? '正常' : '—')}</b></div>
      </div>
    </nav>`;
}

// ------------------------------------------------------------- GLM detail

function glmMain({ data, dom }) {
  const t = dom.texts;
  const fh = data.fiveHour;

  const hero = fh
    ? `
      <section class="card wide hero">
        <h2>5 小时额度 <span class="tag">TOKENS_LIMIT · unit=3 · number=5</span></h2>
        <div class="hero-row">
          <div class="hero-num">
            <span id="fh-pct">${esc(t['fh-pct'])}</span><span class="pct">%</span>
            <span class="hero-cap">已用</span>
          </div>
          <div class="hero-side">
            <div class="kv strong">剩余 <b id="fh-remain">${esc(t['fh-remain'])}</b>%</div>
            <div class="kv"><b id="fh-reset-in">${esc(t['fh-reset-in'])}</b></div>
            <div class="kv dim">重置时刻 <span id="fh-reset-at">${esc(t['fh-reset-at'])}</span></div>
          </div>
        </div>
        ${bar('fh-bar', fh.bar)}
        <div class="hint">额度耗尽要等下一个 5 小时周期；keepalive 盯着的就是这个窗口</div>
      </section>`
    : `
      <section class="card wide hero">
        <h2>5 小时额度</h2>
        <div class="hint">接口本次没有返回该项 —— 按官方约定隐藏，而不是显示空卡</div>
      </section>`;

  const mcp = data.mcp
    ? `
      <section class="card">
        <h2>MCP 月额度 <span class="tag">unit=5 ・ <span id="mcp-reset-in">${esc(t['mcp-reset-in'])}</span> 后重置</span></h2>
        <div class="big"><span id="mcp-used">${esc(t['mcp-used'])}</span><span class="small"> / <span id="mcp-total">${esc(t['mcp-total'])}</span></span></div>
        ${bar('mcp-bar', data.mcp.bar)}
        <div class="kv">已用 <b id="mcp-pct">${esc(t['mcp-pct'])}</b>% ・ 剩余 <b id="mcp-remain">${esc(t['mcp-remain'])}</b> ・ <span id="mcp-reset-at">${esc(t['mcp-reset-at'])}</span> 重置</div>
        <table class="rows">
          ${data.mcp.details
            .map(
              (d, i) =>
                `<tr><td id="mcp-d${i}-name">${esc(t[`mcp-d${i}-name`])}</td><td class="num" id="mcp-d${i}-usage">${esc(t[`mcp-d${i}-usage`])}</td></tr>`,
            )
            .join('')}
        </table>
      </section>`
    : `<section class="card"><h2>MCP 月额度</h2><div class="hint">接口本次没有返回该项</div></section>`;

  const usage = data.usage
    ? `
      <section class="card">
        <h2>近 24 小时模型用量</h2>
        <div class="big"><span id="us-calls">${esc(t['us-calls'])}</span><span class="small"> 次调用 ・ <b id="us-tokens">${esc(t['us-tokens'])}</b> tokens</span></div>
        <table class="rows">
          ${data.usage.models
            .map(
              (m, i) =>
                `<tr><td id="us-m${i}-name">${esc(t[`us-m${i}-name`])}</td><td class="num" id="us-m${i}-tokens">${esc(t[`us-m${i}-tokens`])}</td></tr>`,
            )
            .join('')}
        </table>
      </section>`
    : `<section class="card"><h2>近 24 小时模型用量</h2><div class="hint">暂不可用</div></section>`;

  const tools = data.usage
    ? `
      <section class="card">
        <h2>工具调用 <span class="tag">近 24 小时</span></h2>
        <table class="rows big-rows">
          ${data.usage.tools
            .map(
              (x, i) =>
                `<tr><td id="us-t${i}-name">${esc(t[`us-t${i}-name`])}</td><td class="num" id="us-t${i}-count">${esc(t[`us-t${i}-count`])}</td></tr>`,
            )
            .join('')}
        </table>
      </section>`
    : `<section class="card"><h2>工具调用</h2><div class="hint">暂不可用</div></section>`;

  const hourly = data.usage?.hourlyTokens?.length
    ? (() => {
        const series = data.usage.hourlyTokens;
        const labels = data.usage.hourlyLabels ?? [];
        const max = Math.max(...series, 1);
        const peak = series.indexOf(max);
        const bars = series
          .map((v, i) => {
            const h = Math.max(2, Math.round((v / max) * 100));
            return `<i style="height:${h}%" title="${esc(labels[i] ?? '')}"></i>`;
          })
          .join('');
        return `
      <section class="card wide">
        <h2>逐小时 tokens <span class="tag">峰值 ${esc((max / 1e6).toFixed(0))}M @ ${esc(labels[peak] ?? '')}</span></h2>
        <div class="chart">${bars}</div>
        <div class="axis"><span>${esc(labels[0] ?? '')}</span><span>${esc(labels[labels.length - 1] ?? '')}</span></div>
      </section>`;
      })()
    : '';

  const weekly = data.weekly
    ? `
      <section class="card">
        <h2>周额度 <span class="tag">unit=6</span></h2>
        <div class="big"><span id="wk-pct">${esc(t['wk-pct'])}</span><span class="small">% 已用</span></div>
        ${bar('wk-bar', data.weekly.bar)}
        <div class="kv">剩余 <b id="wk-remain">${esc(t['wk-remain'])}</b>% ・ <b id="wk-reset-in">${esc(t['wk-reset-in'])}</b></div>
      </section>`
    : `
      <section class="card">
        <h2>状态</h2>
        <table class="rows">
          <tr><td>数据源</td><td class="num">open.bigmodel.cn</td></tr>
          <tr><td>套餐</td><td class="num" id="st-level">${esc(t.level)}</td></tr>
          <tr><td>更新于</td><td class="num" id="st-fetched">${esc(t['fetched-at'])}</td></tr>
          <tr><td>5h 重置</td><td class="num" id="st-reset">${esc(t['p-glm-reset'])}</td></tr>
          <tr><td>取数</td><td class="num">服务端 25s 缓存</td></tr>
        </table>
        <div class="hint">周额度项本账号未返回，按官方约定隐藏</div>
      </section>`;

  return `${hero}
    ${mcp}
    ${usage}
    ${hourly}
    ${tools}
    ${weekly}`;
}

// --------------------------------------------------------- Vikunja detail

function taskRows(items, cap) {
  if (!items.length) return '<div class="empty">暂无</div>';
  const shown = items.slice(0, cap);
  return `
        <table class="rows">
          ${shown
            .map(
              (t) => `<tr>
            <td class="title">${esc(t.title)}</td>
            <td class="proj">${esc(t.project)}</td>
            <td class="num">${esc(t.when)}</td>
          </tr>`,
            )
            .join('')}
        </table>
        ${items.length > shown.length ? `<div class="more">另有 ${items.length - shown.length} 项</div>` : ''}`;
}

function vikunjaMain({ data }) {
  if (!data.buckets) {
    return `<section class="card wide"><h2>Vikunja</h2><div class="hint">取数失败：${esc(data.error ?? '未知错误')}</div></section>`;
  }
  const b = data.buckets;
  const c = data.counts;
  return `
      <section class="card">
        <h2>今日到期 <span class="tag">${esc(String(c.today))} 项</span></h2>
        ${taskRows(b.today, 7)}
      </section>

      <section class="card">
        <h2>未来 7 天 <span class="tag">${esc(String(c.soon))} 项</span></h2>
        ${taskRows(b.soon, 7)}
      </section>

      <section class="card">
        <h2>逾期 <span class="tag">${esc(String(c.overdue))} 项</span></h2>
        ${taskRows(b.overdue, 5)}
      </section>

      <section class="card">
        <h2>汇总 <span class="tag">未完成 ${esc(String(c.open))}</span></h2>
        <table class="rows big-rows">
          <tr><td>今日到期</td><td class="num" id="vk-today">${esc(String(c.today))}</td></tr>
          <tr><td>未来 7 天</td><td class="num" id="vk-soon">${esc(String(c.soon))}</td></tr>
          <tr><td>逾期</td><td class="num" id="vk-overdue">${esc(String(c.overdue))}</td></tr>
          <tr><td>无截止日期</td><td class="num" id="vk-nodue">${esc(String(c.noDue))}</td></tr>
          <tr><td>7 天以后</td><td class="num" id="vk-later">${esc(String(c.later))}</td></tr>
        </table>
      </section>`;
}

// ------------------------------------------------------------------ shell

export function renderPage({ tab, build, signature, glm, glmDom, tasks, tasksDom }) {
  const isVikunja = tab === 'vikunja';
  const statusDom = isVikunja ? tasksDom : glmDom;
  const active = isVikunja ? tasks : glm;
  const title = 'Mira Monitor';

  const main = isVikunja ? vikunjaMain({ data: tasks }) : glmMain({ data: glm, dom: glmDom });

  const meta = isVikunja
    ? `<span>未完成 <b id="head-count">${esc(String(tasks.counts?.open ?? '—'))}</b></span>
       <span>数据 <b id="health-mark">${esc(tasksDom.texts['vk-health'])}</b></span>`
    : `<span>套餐 <span class="level" id="level">${esc(glmDom.texts.level)}</span></span>
       <span>数据 <b id="health-mark">${esc(glmDom.texts['health-mark'])}</b></span>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="theme-color" content="#ffffff">
<title>${title} · ${isVikunja ? 'Vikunja' : 'GLM 用量'}</title>
<style>
  /* BOOX Mira e-paper rules: pure #000 on #fff, no greys/shadows/gradients, no
     animation or transition, tabular numerals so a changing digit never reflows.
     Only changed text nodes are re-written by the 60s poll. */
  * { box-sizing: border-box; margin: 0; padding: 0;
      transition: none !important; animation: none !important; }

  html, body {
    height: 100%; background: #fff; color: #000;
    font-family: "Noto Sans CJK SC", "Source Han Sans SC", "Noto Sans SC", sans-serif;
    font-variant-numeric: tabular-nums;
    -webkit-tap-highlight-color: transparent;
    -webkit-user-select: none; user-select: none;
    touch-action: manipulation; overscroll-behavior: none;
  }

  /* Fixed 2200x1650 design canvas, scaled to whatever viewport the kiosk really
     reports. On the Mira (2200x1650 CSS px) the factor is 1, so 1 CSS px = 1
     physical px; on a smaller or high-DPR viewport the whole panel scales down
     instead of overflowing — overflow is what squashed the bars and pushed card
     content out of its border. */
  .viewport { position: fixed; inset: 0; overflow: hidden; background: #fff; }
  .screen { width: 2200px; height: 1650px; display: grid;
            grid-template-rows: 116px 1fr 54px;
            transform: scale(var(--fit, 1)); transform-origin: 0 0; }
  /* ---------------------------------------------------------- navbar */
  header { display: flex; align-items: center; justify-content: space-between;
           padding: 0 34px; border-bottom: 6px solid #000; }
  h1 { font-size: 52px; font-weight: 900; letter-spacing: 4px; }
  .head-right { display: flex; align-items: center; gap: 22px; font-size: 28px; }
  .level { border: 5px solid #000; padding: 4px 18px; font-size: 30px; font-weight: 900; letter-spacing: 2px; }

  /* ------------------------------------------------------------ body */
  .body { display: grid; grid-template-columns: 30% 1fr; min-height: 0; }

  .rail { border-right: 6px solid #000; padding: 20px; display: flex;
          flex-direction: column; gap: 18px; min-height: 0; }
  .tab { display: flex; flex-direction: column; gap: 10px; text-decoration: none;
         color: #000; border: 6px solid #000; padding: 22px 24px; }
  /* Instant inversion marks the selected tab: one bit, no animation. */
  .tab.active { background: #000; color: #fff; }
  .tab-label { font-size: 38px; font-weight: 900; letter-spacing: 2px; }
  .tab-preview { font-size: 92px; font-weight: 900; line-height: 1; }
  .tab-preview .unit { font-size: 30px; font-weight: 400; margin-left: 10px; }
  .tab-sub { font-size: 26px; line-height: 1.4; }
  .rail-note { margin-top: auto; font-size: 24px; line-height: 1.5; }

  main { padding: 14px; display: grid; grid-template-columns: 1fr 1fr;
         gap: 14px; align-content: start; min-height: 0;
         overflow-y: auto; scrollbar-width: none; }
  main::-webkit-scrollbar { display: none; }

  /* No overflow:hidden here: a card that does not fit must never silently
     swallow a row of text — better to see it spilling than to lose it.
     No min-height:0 either — that lets a grid row be sized by the SHORTER
     card in the row, which is how the third MCP detail row escaped its box. */
  .card { border: 6px solid #000; padding: 18px 22px; display: flex;
          flex-direction: column; gap: 10px; }
  .card.wide { grid-column: span 2; }

  h2 { font-size: 32px; font-weight: 900; letter-spacing: 1px; }
  .tag { font-size: 20px; font-weight: 400; border: 3px solid #000; padding: 2px 10px;
         vertical-align: middle; margin-left: 10px; }

  /* ------------------------------------------------------ sections */
  .hero-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
  .hero-num { font-size: 146px; font-weight: 900; line-height: 0.9; display: flex;
              align-items: baseline; }
  .hero-num .pct { font-size: 62px; margin-left: 8px; }
  .hero-cap { font-size: 28px; font-weight: 400; margin-left: 16px; }
  .hero-side { display: flex; flex-direction: column; gap: 8px; font-size: 30px; text-align: right; }
  .kv.strong { font-size: 38px; font-weight: 900; }

  .big { font-size: 68px; font-weight: 900; line-height: 1; }
  .big .small { font-size: 28px; font-weight: 400; }
  .kv { font-size: 28px; }
  .kv.dim { font-size: 22px; }
  .hint { font-size: 21px; margin-top: auto; }
  .empty { font-size: 28px; margin-top: 6px; }
  .more { font-size: 23px; margin-top: auto; }

  /* flex:none — a height-constrained card must never squash the bars, which is
     what happened when the whole grid overflowed the viewport. */
  .bar { border: 5px solid #000; height: 44px; padding: 4px; flex: none; }
  .bar i { display: block; height: 100%; min-height: 26px; background: #000; }

  table.rows { width: 100%; border-collapse: collapse; font-size: 26px; }
  table.rows td { padding: 5px 0; border-top: 3px solid #000; vertical-align: top; }
  table.rows tr:first-child td { border-top: 5px solid #000; }
  table.rows td.num { text-align: right; font-weight: 900; white-space: nowrap; padding-left: 14px; }
  table.rows td.title { width: 100%; }
  table.rows td.proj { white-space: nowrap; padding-left: 14px; font-size: 22px; }
  table.big-rows { font-size: 29px; }
  table.big-rows td.num { font-size: 36px; }

  .chart { display: flex; align-items: flex-end; gap: 6px; height: 150px;
           border-bottom: 5px solid #000; flex: none; }
  .chart i { flex: 1 1 0; background: #000; min-height: 3px; }
  .axis { display: flex; justify-content: space-between; font-size: 23px; }

  button { font: inherit; font-weight: 900; letter-spacing: 2px; background: #fff;
           color: #000; border: 5px solid #000; padding: 12px 22px; cursor: pointer; }
  button:active { background: #000; color: #fff; }

  footer { display: flex; align-items: center; justify-content: space-between;
           padding: 0 34px; border-top: 6px solid #000; font-size: 24px; }
</style>
</head>
<body>
<script>
/* Size the fixed design canvas to the real viewport before first paint. */
(function () {
  function fit() {
    var s = Math.min(window.innerWidth / 2200, window.innerHeight / 1650);
    document.documentElement.style.setProperty('--fit', s);
  }
  fit();
  window.addEventListener('resize', fit);
})();
</script>
<div class="viewport">
<div class="screen">

  <header>
    <h1>Mira Monitor</h1>
    <div class="head-right">
      ${meta}
      <span>更新于 <b id="fetched-at">${esc(statusDom.texts['fetched-at'] ?? statusDom.texts['vk-fetched-at'] ?? '—')}</b></span>
      <button id="refresh">刷新数据</button>
      <button id="reload">刷新页面</button>
    </div>
  </header>

  <div class="body">
    ${tabRail({ tab, glmDom, tasksDom })}
    <main>
      ${main}
    </main>
  </div>

  <footer>
    <div>${isVikunja ? '数据源 todo.example.com ・ Bearer token 由服务端解析' : '数据源 open.bigmodel.cn ・ API key 由 nix 链在服务端解析'} ・ 树莓派端零外部请求</div>
    <div id="status-line">每 60 秒自动更新（只重绘变化的数字）</div>
  </footer>

</div>
</div>
<script>
(function () {
  // Two reload triggers, then text-level patching only:
  //   build     - the server is running newer code
  //   signature - non-patchable content changed (e.g. the task list)
  var INTERVAL = 60000;
  var TAB = ${JSON.stringify(tab)};
  var BUILD = ${JSON.stringify(build ?? 'dev')};
  var SIGNATURE = ${JSON.stringify(signature ?? 'none')};

  function setText(id, value) {
    if (value === undefined || value === null) return;
    var el = document.getElementById(id);
    if (el && el.textContent !== String(value)) el.textContent = String(value);
  }

  function setBar(id, pct) {
    var el = document.getElementById(id);
    if (!el) return;
    var w = Math.max(0, Math.min(100, Number(pct) || 0)) + '%';
    if (el.style.width !== w) el.style.width = w;
  }

  function apply(payload) {
    var k;
    if (payload.build && payload.build !== BUILD) { location.reload(); return; }
    if (payload.signature && payload.signature !== SIGNATURE) { location.reload(); return; }
    for (k in payload.texts) setText(k, payload.texts[k]);
    for (k in payload.bars) setBar(k, payload.bars[k]);
    setText('status-line', payload.stale
      ? ('⚠ 取数失败：' + (payload.error || '未知错误'))
      : '每 60 秒自动更新（只重绘变化的数字）');
  }

  function refresh() {
    var el = document.getElementById('status-line');
    var before = el ? el.textContent : '';
    // Also report the viewport, so the server log tells us what the kiosk really
    // renders at (a smaller/high-DPR viewport is what breaks the fixed layout).
    var qs = '&vw=' + window.innerWidth + '&vh=' + window.innerHeight +
             '&dpr=' + (window.devicePixelRatio || 1);
    fetch('/api/state?tab=' + TAB + qs, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (p) {
        apply(p);
        if (el && el.textContent === before) {
          setText('status-line', '已检查，数据无变化 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
        }
      })
      .catch(function (e) { setText('status-line', '⚠ 请求失败：' + e.message); });
  }

  document.getElementById('refresh').addEventListener('click', refresh);
  document.getElementById('reload').addEventListener('click', function () { location.reload(); });
  setInterval(refresh, INTERVAL);
})();
</script>
</body>
</html>
`;
}
