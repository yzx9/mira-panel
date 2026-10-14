# mira-panel

BOOX Mira 电子纸面板（树莓派 `yzx9-pie` kiosk 的落地页），一个 **navbar + 左侧 30% tab 栏 + 右侧详情** 的应用。

- **服务地址：** `http://192.0.2.10:15932`（本机 `yzx9-ws`，监听 `0.0.0.0:15932`）
- **树莓派侧：** `hosts/yzx9-pie/cage.nix` 的 Firefox kiosk 直接打开上面这个 URL
- **防火墙：** `hosts/yzx9-ws/networking.nix` 已放行 `192.0.2.0/24 → 15932`（无需改动）

## 仓库结构（npm workspaces monorepo）

```
mira-panel/
├── flake.nix / .envrc        # nix flake devShell（nodejs_24 + chromium）+ direnv
├── package.json              # workspaces 根：dev / build / start / typecheck / test / fmt
├── tsconfig.base.json        # strict + erasableSyntaxOnly + verbatimModuleSyntax + noEmit
└── packages/
    ├── shared/   # @mira-panel/shared — PanelState 视图模型类型、展示格式化器、常量（含黄金测试）
    ├── server/   # @mira-panel/server — Hono 应用 + 两个数据层 + SSR 外壳拼装（Node 24 原生跑 .ts）
    └── web/      # @mira-panel/web  — Vue 3.6 RC 全 Vapor 组件，SSR + 水合
```

技术栈：**Vue 3.6.0-rc.11（Vapor 模式）+ Vite 8 + Hono 4 + TypeScript（全仓）**。
格式化只用 oxfmt（`.ts/.json/.css/.vue/.md` 全覆盖，默认配置零 rc 文件）。

## 开发环境（Nix flake + direnv）

```bash
direnv allow              # 首次进入目录时放行 .envrc（use flake）
                          # 首次会生成 flake.lock 并拉取 nixpkgs
```

devShell 提供 `nodejs_24`（原生 type-stripping 跑 `.ts`，无需编译）与 `chromium`
（截图验收用）。没有 direnv 时 `nix develop` 等价。

## 常用命令

| 命令                        | 作用                                                                             |
| --------------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`               | 开发：单进程 = node:http + Vite 中间件（SSR/HMR）+ Hono（API/静态兜底）          |
| `npm run build`             | 产出 `packages/web/dist/client`（含哈希资产的外壳）+ `dist/server`（SSR bundle） |
| `npm start`                 | 生产：Hono 直接跑（需先 `npm run build`）                                        |
| `npm run typecheck`         | 三个包串联的 tsc / vue-tsc 检查（运行时不做类型检查，这是唯一门禁）              |
| `npm test`                  | shared 包格式化器黄金用例（node:test）                                           |
| `npm run fmt` / `fmt:check` | oxfmt 全仓格式化 / 校验                                                          |

## 页面结构

```
navbar   Mira Monitor                  套餐/状态 · 更新于 · [刷新数据] [刷新页面]
──────┬──────────────────────────────────────────────────────────────
rail  │  detail（当前 tab 的完整内容）
30%   │  70%
      │
 GLM  │  /glm     5 小时额度（大号「已用」%）、MCP 月额度 + 分项、
 用量 │            今天模型用量、工具调用、状态
──────│
Vikunja│ /vikunja 今日到期、未来 7 天、逾期、汇总（未完成 / 无期限 / 7 天以后）
```

**面板上只放数据，不放开发者说明或操作提示** —— 密钥怎么来、缓存多少秒这类文字只属于
README，出现在电子纸上就是噪声。

- **tab 是普通链接**（`/glm`、`/vikunja`）：切换 = 一次 SSR 请求，无前端路由、无 vue-router
- **rail 里的预览刻意极简**：GLM 只显示 5 小时额度，Vikunja 只显示今日 + 逾期 + 未完成
- **选中态 = 整块反色**（黑底白字），一位信号、零动画

## 架构要点

- **视图模型单一契约**：服务端 `stateFor()` 把两个数据源归一成 `PanelState`
  （`packages/shared/src/types.ts`），SSR 渲染它、页面内嵌同 JSON 供水合、
  `/api/state` 返回同一形状 —— 客户端不做任何取数归一化，保证水合逐字节一致。
- **全 Vapor 组件**：每个 SFC 都按 Vapor 编译（无虚拟 DOM、细粒度响应式）。
  根组件 `App.vue` 刻意是**双根 fragment**（`<header>` + `.body` 必须是 `.screen`
  网格的直接子元素）；水合走 `createSSRApp + vaporInteropPlugin`（RC 期最稳路径）。
- **样式是全局 `<link>`**（`epaper.css`），绝不从 JS import —— 无 JS 的访客拿到的
  页面必须可读**且带样式**。
- **build id 是唯一整页重载触发器**：启动时对三个包的源码 + web 构建产物做
  size+mtime 哈希，客户端轮询发现变化就自重载。旧的 signature 机制已随 vanilla
  打补丁脚本一起退役（Vue 响应式本来就能补结构变化；**绝不要**把每次取数都变的
  字段加进重载判断，那会退化成每分钟自触发的 reload 循环）。
- **倒计时是 `(resetMs, state.now)` 的纯函数**：数据层只携带 `resetMs`（epoch ms），
  展示串由 shared 格式化器在渲染/轮询时现算 —— 比旧版在归一化时预计算更新鲜。

### 路由

| 路径                       | 作用                                                                       |
| -------------------------- | -------------------------------------------------------------------------- |
| `/`、`/glm`、`/index.html` | GLM 面板（SSR）                                                            |
| `/vikunja`                 | Vikunja 面板（SSR）                                                        |
| `/api/state`               | 60 秒轮询用的整面板载荷 `{build, now, glm, vikunja}`（vw/vh/dpr 照旧上报） |
| `/api/usage`               | `/api/state` 别名（兼容旧链接）                                            |
| `/api/raw`                 | 两个数据源的完整原始结果 + 客户端视口（调试用）                            |
| `/healthz`                 | `ok`                                                                       |
| `/<file>`                  | 静态文件（`packages/server/public/` 与 web 构建产物）                      |

## 数据来源

### GLM Coding Plan（`/glm`）

官方文档：`zai-org/ZCode` → `docs/bigmodel-coding-plan-usage-quota.md`

```
GET <host>/api/monitor/usage/quota/limit        # 无查询参数
GET <host>/api/monitor/usage/model-usage?startTime=&endTime=
GET <host>/api/monitor/usage/tool-usage?startTime=&endTime=
```

- `Authorization: <完整 API key>` —— **不要加 `Bearer` 前缀，加了会鉴权失败**
- host 由 nix 生成的 `claude-code-glm-settings.json` 里的 `ANTHROPIC_BASE_URL` 推导
- key 由 `apiKeyHelper` 在**服务端**运行时解析（无硬编码 store 路径 → 每次 nix rebuild 都不会失效）
- 额度项按 `type + unit + number` 识别，**不能按下标兜底**：
  - `TOKENS_LIMIT unit=3 number=5` → 5 小时池
  - `TOKENS_LIMIT unit=6 number=1` → 周池（部分账号不返回 → 隐藏该项）
  - `TIME_LIMIT unit=5 number=1` → MCP / 工具月额度
- `percentage` 是**已用**百分比；界面展示剩余时用 `100 - percentage`
- 时间窗 = **今天 00:00:00 → 23:59:59**（不是滚动 24 小时）。已验证 `totalUsage`
  完全按请求窗口统计，所以"今天"的数字是当天真实累计。
- 逐小时的 `tokensUsage` / `x_time` 仍保留在 `/api/raw` 里（将来若做趋势图直接用）

### Vikunja（`/vikunja`）

```
GET https://todo.example.com/api/v1/projects
GET /api/v1/tasks?filter=done = false&sort_by=due_date&order_by=asc&per_page=200
```

- `Authorization: Bearer <token>`，token 运行时按顺序解析：`VIKUNJA_API_KEY` 环境变量 →
  `${XDG_RUNTIME_DIR}/agenix/vikunja-env`（agenix 解密）→ Hermes 的 `.env`
- 一次筛选查询拿全部未完成任务，**分桶在本地做**：今日 / 未来 7 天 / 逾期 / 无截止日期 / 7 天以后
- `due_date` 为 `0001-01-01T00:00:00Z` 是 Vikunja 的"没有截止时间"哨兵值
- 逾期列表按**最近到期优先**排序

### 已知限制

- **GLM「重置次数」拿不到。** 重置走 ZCode Server 的 `/api/v1/coding-plan/reset/{status,opportunity,use,history/read}`：
  在 bigmodel / api.z.ai 上该路径 `404 NOT_FOUND`，只有 `zcode.z.ai` 有（401）。它需要
  `Authorization: zcode <zcodejwtoken>` **加** `X-Bigmodel-Authorization: <MaaS OAuth JWT>`
  （Team 还要 organization/project 头），Coding Plan 的 API key 不够。
- GLM `modelSummaryList` 各模型 tokens 之和 ≠ `totalUsage.totalTokensUsage`（曾观察到差约
  19%），两个数字不要互相印证。
- Vikunja 那边存在**真实重复任务**（同标题同截止、不同 id）—— 面板只是如实显示，去重要在
  Vikunja 侧做。

## 刷新契约（电子纸友好）

- **首屏**：服务端渲染真实数字，**没有 JavaScript 也能读且带样式**
- **更新**：客户端每 **60 秒** fetch `/api/state`，把整个 `PanelState` 换进响应式系统，
  Vue 只重绘变化的节点（电子纸上 = 只有变化的数字重刷）
- **手动**：右上两个按钮 —— `刷新数据` 立即取数并在 navbar 回执「已刷新 HH:MM:SS」
  （轻），`刷新页面` 整页重载（电子纸会闪一次）
- **自动整页重载只有一个触发器**：`build` id 变化（服务端代码/构建变了 → 部署无人值守到达）
- **服务端缓存**：GLM 25 秒、Vikunja 45 秒，都有 in-flight 去重，无脑刷不会打爆上游
- **取数失败时**：保留上一次数值 + 标「⚠ 数据陈旧」；浏览器侧请求失败标「⚠ 请求失败」，
  绝不整页空白

## 电子纸约束（改设计时请遵守）

1. 只用纯黑 `#000` / 纯白 `#fff`，不用灰、不用阴影、不用渐变
2. **零动画**：`transition` / `animation` 全部禁用，触摸反馈用瞬时反色（`:active`）
3. 数字用 `tabular-nums` + 稳定宽度，避免数字变化引起重排
4. 页面按 2200 × 1650 设计（1 CSS px = 1 物理 px），触摸目标远大于 44 px
5. 只做增量文字更新，不做无意义的整页重载

### 布局排版的三条硬规矩（都是踩过的坑）

1. **固定画布 + 按视口缩放**：`.screen` 是 2200 × 1650 的固定画布，用
   `transform: scale(min(vw/2200, vh/1650))` 适配。首屏前（`<head>` 里的内联脚本）
   就把 `--fit` 算好，避免闪一下再缩。
2. **卡片上绝不能写 `min-height: 0`**：那会让网格行高被同一行里**更矮**的那张卡决定，
   于是高卡的内容会跑到边框外面。行高必须由最高内容决定。
3. **进度条 / 图表必须 `flex: none`**：卡片是 flex 列容器，一旦卡盒比内容矮，
   默认 `flex-shrink: 1` 会把进度条压成一条线。同时卡片**不要**加 `overflow: hidden`，
   宁可看见溢出也不要静默丢内容。
4. **网格行填满高度**：`main` 不加 `align-content: start`，让 auto 行拉伸铺满。
5. **面板上只放数据**：开发者说明一律写进 README；错误状态走 navbar 的「数据」位。

### Vue/Vapor 侧的坑（本次重构新踩的）

- **表格必须显式 `<tbody>`**：vapor 会把 v-for / v-else 的 fragment 锚点以 HTML 注释
  形式输出；裸 `<tr>` 会被解析器包上隐式 tbody，锚点与行的归属关系就被破坏 ——
  水合时行文本会漏出卡片、后续卡片直接消失。所有 `<tr>` 一律包 `<tbody>`。
- **App 根必须是双根 fragment**：`.screen` 网格行是 `116px 1fr`，任何包裹元素都会
  变成唯一网格子元素、压碎布局。
- **水合一致性**：展示串一律出自 shared 格式化器（`toLocaleString` 显式 `'en-US'`、
  时间串服务端预格式化）；手动刷新的回执（flash）SSR 恒为 null。
- **SSR bundle 必须内联整个 Vue runtime**：`@vue/runtime-vapor` 只有 esm-bundler 构建，
  `vue` 的 node 入口是预打包单文件且没有 vapor 导出 —— 外部化会得到跑不起来的混搭。
  见 `vite.config.ts` 的 `ssr.noExternal + resolve.conditions`。
- **升级 Vue RC 要手动**：`package.json` 精确钉 `3.6.0-rc.11`，升级改版本号后重跑
  截图验收。

诊断手段：60 秒轮询会把 `vw/vh/dpr` 一起报给服务端，服务端日志与 `/api/raw` 的
`client` 字段都能看到真实视口 —— 布局问题时先查这个，不要靠猜。

## 验收工作流（改动后照跑一遍）

```bash
npm run typecheck && npm test
npm run build && npm start          # 或 npm run dev
```

本地用无头 Chromium 截图对比新旧（devShell 里已有 chromium）：

```bash
chromium --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --user-data-dir=/tmp/chrome --window-size=2200,1650 --virtual-time-budget=6000 \
  --screenshot=/tmp/shot.png http://127.0.0.1:15932/glm
```

验收要点：截图与旧版逐字节一致（同等数据下）；浏览器控制台零水合告警；
`curl -s /glm | grep 亿` 无 JS 也能读到真实数字；`curl -I` 200 无 body、
`curl -X POST` 405。

## 安全

- 两个 token 都**只在服务端内存**中使用：不落盘、不进 argv/env（GLM 走 `execFile(helper)`
  的 stdout，Vikunja 走 Bearer 头）、不写日志
- **绝不要把密钥内联到命令行/prompt**：Hermes 会把工具调用参数原文写进 `state.db`
  （显示层的 `***` 只是显示层）

## TODO

- [x] npm workspaces monorepo + 全仓 TS + Hono + Vue 3.6 Vapor 重构
- [ ] 持久化：**已决定先保持现状**（Hermes 后台拉起的进程；gateway 重启后需手动重启）
- [ ] 还能接哪些数据源（Readeck / FreshRSS / HN）
- [ ] Vikunja 是否支持触摸勾选完成（需要写接口 + 防重复提交）
- [ ] 是否把 Pi 的字体改动（`noto-fonts-cjk-sans`）固化进 nix-config 仓库
- [ ] GLM 错误消息里的上游响应体做一次 key 脱敏（一行加固，待确认）
- [ ] Vue 3.6 稳定发布后：升级 RC → stable，评估 `createVaporApp` 根（甩掉 VDOM
      runtime，客户端 bundle 从 165KB 降到 ~80KB）

## 重启服务（掉线时）

```bash
cd ~/git/mira-panel
npm run build        # 若 web 构建产物不存在
npm start
```
