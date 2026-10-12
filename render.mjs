// Server-side rendered panel markup.
//
// Every value is rendered into the HTML on the server; the client script only
// patches text nodes that actually changed on the 60s refresh. That keeps the
// e-paper webview workload to "a few glyphs" instead of a full page repaint,
// and the panel still shows real numbers with JavaScript disabled.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const bar = (id, pct) =>
  `<div class="bar"><i id="${id}" style="width:${Math.max(0, Math.min(100, Number(pct) || 0))}%"></i></div>`;

export function renderPage(data, dom) {
  const t = dom.texts;
  const fh = data.fiveHour;

  const fiveHourCard = fh
    ? `
      <section class="card hero">
        <h2>5 小时额度 <span class="tag">TOKENS_LIMIT</span></h2>
        <div class="hero-row">
          <div class="hero-num"><span id="fh-remain">${esc(t['fh-remain'])}</span><span class="pct">%</span></div>
          <div class="hero-side">
            <div class="kv">已用 <b id="fh-pct">${esc(t['fh-pct'])}</b>%</div>
            <div class="kv"><b id="fh-reset-in">${esc(t['fh-reset-in'])}</b></div>
            <div class="kv dim">重置时刻 <span id="fh-reset-at">${esc(t['fh-reset-at'])}</span></div>
          </div>
        </div>
        ${bar('fh-bar', fh.bar)}
        <div class="hint">额度耗尽需等下一个 5 小时周期；keepalive 的存在就是为了让这个窗口一直活着</div>
      </section>`
    : `
      <section class="card hero">
        <h2>5 小时额度</h2>
        <div class="hint">接口本次未返回该额度项 —— 按官方约定隐藏，而不是显示空卡</div>
      </section>`;

  const weekly = data.weekly
    ? `
      <div class="sub">
        <h3>周额度 <span class="tag">unit=6</span></h3>
        <div class="kv">已用 <b id="wk-pct">${esc(t['wk-pct'])}</b>% ・ 剩余 <b id="wk-remain">${esc(t['wk-remain'])}</b>%</div>
        <div class="kv dim"><b id="wk-reset-in">${esc(t['wk-reset-in'])}</b></div>
        ${bar('wk-bar', data.weekly.bar)}
      </div>`
    : '';

  const mcp = data.mcp
    ? `
      <section class="card">
        <h2>MCP 月额度 <span class="tag">unit=5</span></h2>
        <div class="big"><span id="mcp-used">${esc(t['mcp-used'])}</span><span class="small"> / <span id="mcp-total">${esc(t['mcp-total'])}</span></span></div>
        ${bar('mcp-bar', data.mcp.bar)}
        <div class="kv">已用 <b id="mcp-pct">${esc(t['mcp-pct'])}</b>% ・ 剩余 <b id="mcp-remain">${esc(t['mcp-remain'])}</b></div>
        <div class="kv dim"><span id="mcp-reset-at">${esc(t['mcp-reset-at'])}</span> 重置（<span id="mcp-reset-in">${esc(t['mcp-reset-in'])}</span>）</div>
        <table class="rows">
          ${data.mcp.details
            .map(
              (d, i) => `<tr><td id="mcp-d${i}-name">${esc(t[`mcp-d${i}-name`])}</td><td class="num" id="mcp-d${i}-usage">${esc(t[`mcp-d${i}-usage`])}</td></tr>`,
            )
            .join('')}
        </table>
      </section>`
    : `
      <section class="card">
        <h2>MCP 月额度</h2>
        <div class="hint">接口本次未返回该额度项</div>
      </section>`;

  const usage = data.usage
    ? `
      <section class="card">
        <h2>近 24 小时模型用量</h2>
        <div class="big"><span id="us-calls">${esc(t['us-calls'])}</span><span class="small"> 次调用</span></div>
        <div class="kv">合计 <b id="us-tokens">${esc(t['us-tokens'])}</b> tokens</div>
        <table class="rows">
          ${data.usage.models
            .map(
              (m, i) => `<tr><td id="us-m${i}-name">${esc(t[`us-m${i}-name`])}</td><td class="num" id="us-m${i}-tokens">${esc(t[`us-m${i}-tokens`])}</td></tr>`,
            )
            .join('')}
        </table>
      </section>

      <section class="card">
        <h2>工具调用 <span class="tag">近 24 小时</span></h2>
        <table class="rows big-rows">
          ${data.usage.tools
            .map(
              (x, i) => `<tr><td id="us-t${i}-name">${esc(t[`us-t${i}-name`])}</td><td class="num" id="us-t${i}-count">${esc(t[`us-t${i}-count`])}</td></tr>`,
            )
            .join('')}
        </table>
      </section>`
    : `
      <section class="card"><h2>近 24 小时模型用量</h2><div class="hint">暂不可用</div></section>
      <section class="card"><h2>工具调用</h2><div class="hint">暂不可用</div></section>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="theme-color" content="#ffffff">
<title>GLM 用量面板</title>
<style>
  /* BOOX Mira e-paper rules: pure #000 on #fff, no greys, no shadows, no
     gradients, no animation/transition, tabular numerals so a changing digit
     never reflows the layout. Only changed text nodes are re-written. */
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

  .screen { height: 100vh; display: grid; grid-template-rows: 132px 1fr 72px; }

  header { display: flex; align-items: center; justify-content: space-between;
           padding: 0 40px; border-bottom: 6px solid #000; }
  h1 { font-size: 50px; font-weight: 900; letter-spacing: 3px; }
  .head-right { display: flex; align-items: center; gap: 28px; font-size: 30px; }
  .level { border: 5px solid #000; padding: 6px 22px; font-size: 34px; font-weight: 900; letter-spacing: 2px; }

  main { display: grid; grid-template-columns: repeat(3, 1fr);
         grid-template-rows: 1fr 1fr; gap: 22px; padding: 22px; }

  .card { border: 6px solid #000; padding: 26px 30px; display: flex;
          flex-direction: column; gap: 14px; overflow: hidden; }
  .card.hero { grid-column: span 2; }

  h2 { font-size: 40px; font-weight: 900; letter-spacing: 1px; }
  .tag { font-size: 22px; font-weight: 400; border: 3px solid #000; padding: 2px 12px;
         vertical-align: middle; margin-left: 12px; }
  h3 { font-size: 32px; font-weight: 900; }

  .hero-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 30px; }
  .hero-num { font-size: 190px; font-weight: 900; line-height: 0.9; }
  .hero-num .pct { font-size: 70px; font-weight: 900; margin-left: 10px; }
  .hero-side { display: flex; flex-direction: column; gap: 12px; font-size: 34px; text-align: right; }

  .big { font-size: 96px; font-weight: 900; line-height: 1; }
  .big .small { font-size: 36px; font-weight: 400; }

  .kv { font-size: 32px; }
  .kv.dim { font-size: 26px; }

  .bar { border: 5px solid #000; height: 46px; padding: 4px; }
  .bar i { display: block; height: 100%; background: #000; }

  table.rows { width: 100%; border-collapse: collapse; font-size: 30px; margin-top: auto; }
  table.rows td { padding: 8px 0; border-top: 3px solid #000; }
  table.rows tr:first-child td { border-top: 5px solid #000; }
  table.rows td.num { text-align: right; font-weight: 900; }
  table.big-rows { font-size: 38px; }
  table.big-rows td.num { font-size: 46px; }

  .sub { margin-top: 6px; display: flex; flex-direction: column; gap: 10px; }
  .hint { font-size: 24px; margin-top: auto; }

  button { font: inherit; font-size: 46px; font-weight: 900; letter-spacing: 4px;
           background: #fff; color: #000; border: 6px solid #000;
           padding: 26px 0; width: 100%; cursor: pointer; }
  button:active { background: #000; color: #fff; }

  footer { display: flex; align-items: center; justify-content: space-between;
           padding: 0 40px; border-top: 6px solid #000; font-size: 26px; }
</style>
</head>
<body>
<div class="screen">

  <header>
    <h1>GLM 用量面板</h1>
    <div class="head-right">
      <span>套餐 <span class="level" id="level">${esc(t.level)}</span></span>
      <span>数据 <b id="health-mark">${esc(t['health-mark'])}</b></span>
      <span>更新于 <b id="fetched-at">${esc(t['fetched-at'])}</b></span>
    </div>
  </header>

  <main>
    ${fiveHourCard}
    ${mcp}
    ${usage}
    <section class="card">
      <h2>刷新</h2>
      <button id="refresh">立即刷新</button>
      <div class="kv dim" id="status-line">每 60 秒自动更新（只重绘变化的数字）</div>
      ${weekly}
    </section>
  </main>

  <footer>
    <div>数据源 open.bigmodel.cn ・ API key 由 nix 链在服务端解析 ・ 树莓派端零外部请求</div>
    <div id="fetched-date">${esc(data.fetchedDate ?? '')}</div>
  </footer>

</div>
<script>
(function () {
  // Patch only the text nodes whose value actually changed: unchanged nodes are
  // never touched, so an e-paper refresh stays local instead of a full repaint.
  var INTERVAL = 60000;

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
    for (k in payload.texts) setText(k, payload.texts[k]);
    for (k in payload.bars) setBar(k, payload.bars[k]);
    setText('status-line', payload.stale
      ? ('⚠ 取数失败：' + (payload.error || '未知错误'))
      : '每 60 秒自动更新（只重绘变化的数字）');
  }

  function refresh() {
    var el = document.getElementById('status-line');
    var previous = el ? el.textContent : '';
    fetch('/api/usage', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (p) {
        apply(p);
        // Manual taps deserve visible feedback even when nothing changed.
        if (el && el.textContent === previous) setText('status-line', '已检查，数据无变化 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      })
      .catch(function (e) { setText('status-line', '⚠ 请求失败：' + e.message); });
  }

  document.getElementById('refresh').addEventListener('click', refresh);
  setInterval(refresh, INTERVAL);
})();
</script>
</body>
</html>
`;
}
