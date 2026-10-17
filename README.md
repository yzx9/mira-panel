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
    ├── shared/   # @mira-panel/shared — PanelState 视图模型、WS 订阅契约（topic/消息）、格式化器、常量
    ├── server/   # @mira-panel/server — Hono 应用 + 订阅 hub + 四个纯取数数据层 + SSR 外壳拼装
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
| `npm test`                  | shared 格式化器 + server 数据层解析 + hub 订阅行为的黄金用例（node:test）        |
| `npm run fmt` / `fmt:check` | oxfmt 全仓格式化 / 校验                                                          |

服务进程管理走 `justfile`：`just status`（监听 + 健康检查）、`just restart`（重启）、
`just deploy`（构建 + 重启，merge 之后用它）、`just logs`。重启逻辑在
`scripts/restart-service.sh`：按端口找进程 → kill → 从**主 checkout** setsid 拉起新进程
→ healthz 验证。脚本会在 git worktree 里直接拒绝执行——从 worktree 起的服务在 worktree
被删后会变成幽灵进程（2026-10-15 的事故）；要看未合并分支的效果用**预览部署**：
`just restart force`（等价于 `restart-service.sh --force` / `FORCE=1`），合并后记得从
主 checkout `just deploy` 替换掉它。

## 页面结构

```
navbar   Mira Monitor              瞬时反馈 · 更新于 · [刷新数据] [刷新页面] [锁定]
──────┬──────────────────────────────────────────────────────────────
rail  │  detail（当前 tab 的完整内容）
30%   │  70%
      │
 时钟 │  /        大号 HH:MM（分钟走动）+ 日期墙（日期 · 星期 · 年份）
──────│
 GLM  │  /glm     5 小时额度（大号「已用」%）、MCP 月额度 + 分项、
 用量 │            今天模型用量（含工具调用行）、DeepSeek 余额、
      │            Tavily 积分、周额度（账号有则显示）
──────│
Vikunja│ /vikunja 汇总条（六等分白底格、格间一条竖线：未完成 / 今日 / 未来 7 天 / 逾期 / 无截止 / 以后）、
      │          全量任务列表（按桶分组，块右缘 ▲/▼ 翻页，不滚动）
```

**面板上只放数据，不放开发者说明或操作提示** —— 密钥怎么来、缓存多少秒这类文字只属于
README，出现在电子纸上就是噪声。

- **tab 是普通链接**（`/`、`/glm`、`/vikunja`）：切换 = 一次 SSR 请求，无前端路由、无 vue-router
- **rail 里的预览刻意极简**：时钟只显示当前时间，GLM 只显示 5 小时额度，Vikunja 只显示
  今日 + 逾期 + 未完成
- **选中态 = 整块反色**（黑底白字），一位信号、零动画

## 架构要点

- **视图模型单一契约**：`stateFor()` 从 hub 组装 `PanelState`
  （`packages/shared/src/types.ts`），SSR 渲染它、页面内嵌同 JSON 供水合；
  WS 推送与 SSR 嵌入走**同一份投影**（hub 的 `payloadFor`）—— 客户端不做任何
  取数归一化，保证水合与后续推送显示一致。
- **全 Vapor 组件**：每个 SFC 都按 Vapor 编译（无虚拟 DOM、细粒度响应式）。
  根组件 `App.vue` 刻意是**双根 fragment**（`<header>` + `.body` 必须是 `.screen`
  网格的直接子元素）；水合走 `createSSRApp + vaporInteropPlugin`（RC 期最稳路径）。
- **样式是全局 `<link>`**（`epaper.css`），绝不从 JS import —— 无 JS 的访客拿到的
  页面必须可读**且带样式**。
- **build id 是唯一整页重载触发器**：启动时对三个包的源码 + web 构建产物做
  size+mtime 哈希，客户端在 WS `hello` 里发现变化就自重载。旧的 signature 机制已随
  vanilla 打补丁脚本一起退役（Vue 响应式本来就能补结构变化；**绝不要**把每次取数
  都变的字段加进重载判断，那会退化成每分钟自触发的 reload 循环）。
- **倒计时是 `(resetMs, state.now)` 的纯函数**：数据层只携带 `resetMs`（epoch ms），
  展示串由 shared 格式化器在渲染/推送时现算 —— 比旧版在归一化时预计算更新鲜。

### 路由

| 路径                          | 作用                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `/`、`/clock`、`/index.html`  | 时钟页（SSR，首页，bootstrap 只嵌 rail 所需的瘦切片）                                                             |
| `/glm`                        | GLM 面板（SSR，bootstrap 含 quota/usage/deepseek/tavily）                                                         |
| `/vikunja`                    | Vikunja 面板（SSR，bootstrap 含全量任务桶）                                                                       |
| `/ws`                         | **稳态数据通道**（WebSocket，见「刷新契约」）：页面声明当前 tab 的 topic，hub 按各源自有节奏推送                  |
| `/api/raw`                    | hub 里每个源的缓存状态（ok/stale/error/原始 payload）+ 客户端视口（调试用）                                       |
| `/api/vikunja/tasks/:id/done` | **唯一的写路径**（POST）：勾选完成一个任务。要求 `X-Panel-Write: 1` 头，锁定态 403，返回刷新后的 vikunja 视图模型 |
| `/healthz`                    | `ok`                                                                                                              |
| `/<file>`                     | 静态文件（`packages/server/public/` 与 web 构建产物）                                                             |

`/api/state`（及 `/api/usage` 别名）已随 60 秒轮询一起退役：稳态数据全部走 `/ws` 推送。

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
GET /api/v1/projects/{id}/tasks?filter=done = false&sort_by=position&order_by=asc&per_page=50&page=N
```

- `Authorization: Bearer <token>`，token 运行时按顺序解析：`VIKUNJA_API_KEY` 环境变量 →
  `${XDG_RUNTIME_DIR}/agenix/vikunja-env`（agenix 解密）→ Hermes 的 `.env`
- **逐项目分页拉全**：实例 `max_items_per_page = 50`，更大的 `per_page` 会被**静默钳到
  50**（go-vikunja/vikunja#2239）；且 `position` 排序**只在项目上下文可用**（全局
  `/tasks` 会 400 要求 project view id）。所以先取项目列表、再逐项目按 50/页拉到短页、
  按（项目, position）拼接；累计上限 500 条，触顶时汇总条标注「已达分页上限」
- **分桶在本地做**：逾期 / 今日 / 未来 7 天 / 无截止日期 / 7 天以后，五个桶**全量下发**，
  前端任务卡本地翻页（翻页零请求）
- `due_date` 为 `0001-01-01T00:00:00Z` 是 Vikunja 的"没有截止时间"哨兵值
  （`asc` 排序下排最前——这正是当年单次大请求被钳时最先丢的那批）
- **桶内顺序 = Vikunja 网页端的默认顺序**（`sort_by=position`，即手动拖拽序），
  分桶只做分组、不打乱组内顺序
- **触摸勾选完成**：任务行首的方框 → `POST /api/vikunja/tasks/:id/done` → 服务端
  `POST /api/v1/tasks/{id}` + JSON body `{"done":true}`。两个坑都有案底（已在本
  实例验证）：**v1 的更新动词是 POST**（2.x 起 PUT/PATCH 一律 405——社区旧帖里的
  PUT 是 2.0 之前的事），且**必须带 `Content-Type: application/json`**（表单编码
  会被静默忽略）；token 是细粒度 scope，**只读 token 写会 403**（面板把它翻译成
  502 + 「Token 无写权限」提示）。写路径按任务 id 记 in-flight（双击共享一次
  请求），完成幂等，无 undo——勾错了去 Vikunja 网页撤回

### DeepSeek 余额（`/glm` 的余额卡）

```
GET https://api.deepseek.com/user/balance
```

- `Authorization: Bearer <key>`，**直连**（不走代理）；金额是**字符串**（CNY/USD，
  多币种时取 CNY 条目）；官方只有余额端点、**没有用量端点**
- key 运行时按序尝试：`DEEPSEEK_API_KEY` 环境变量 → `${XDG_RUNTIME_DIR}/agenix/hermes-env`
  → `agenix/llm-api-keys`（**llm-api-keys 里的那把已失效**，靠 401 轮换兜底：认证失败
  自动换下一把候选，胜者缓存优先复用，全部失败才报错）
- `balance_infos` 为空 → 卡片显示空态；`is_available:false` → 标「不可用」tag
- hub 刷新节奏 **30 分钟**（余额变化慢），出错保旧值标陈旧

### Tavily 积分（`/glm` 的积分卡）

```
GET https://api.tavily.com/usage
```

- `Authorization: Bearer <tvly-…>`；展示**账户级**月度积分池（`current_plan` /
  `plan_usage` / `plan_limit`）+ 本 key 计数；`plan_limit` 为 null（无限额）时不画进度条
- 本机直连超时，请求经**本地 HTTP 代理**走 undici `ProxyAgent`（per-request
  dispatcher，其余数据源不受影响）。代理解析顺序：`TAVILY_PROXY` → `HTTPS_PROXY` →
  `ALL_PROXY`（进程 env）→ hermes-env 文件里的 `ALL_PROXY`/`HTTPS_PROXY` → 直连兜底
- 端点限频 **10 次/10 分钟** → hub 刷新节奏 **30 分钟**（只在 GLM 页被订阅时才取），
  远在限频窗口之内。撞到 429 只会标陈旧，自愈
- **月度重置时间是推导值**：响应里没有时间戳，卡片在渲染时按 `state.now` 算下月 1 日
  （`nextMonthStart`），随推送自动推进
- key 候选链与 401 轮换同 DeepSeek（`TAVILY_API_KEY` env → hermes-env → llm-api-keys）

### 已知限制

- **GLM「重置次数」拿不到。** 重置走 ZCode Server 的 `/api/v1/coding-plan/reset/{status,opportunity,use,history/read}`：
  在 bigmodel / api.z.ai 上该路径 `404 NOT_FOUND`，只有 `zcode.z.ai` 有（401）。它需要
  `Authorization: zcode <zcodejwtoken>` **加** `X-Bigmodel-Authorization: <MaaS OAuth JWT>`
  （Team 还要 organization/project 头），Coding Plan 的 API key 不够。
- GLM `modelSummaryList` 各模型 tokens 之和 ≠ `totalUsage.totalTokensUsage`（曾观察到差约
  19%），两个数字不要互相印证。
- DeepSeek 官方**没有用量端点**（只有余额）；Tavily 的月度重置时间不在响应里，按"下月 1 日"
  推导展示。
- Tavily `/usage` 与其他 Tavily 消费者**共享同 key 的 10 次/10 分钟限频**；若出现 429，把
  `hub.ts` 里 tavily 源的 `intervalMs` 抬高即可（当前 30 分钟，余量很大）。
- Vikunja 那边存在**真实重复任务**（同标题同截止、不同 id）—— 面板只是如实显示，去重要在
  Vikunja 侧做。

## 刷新契约（声明式订阅，电子纸友好）

- **首屏**：服务端渲染真实数字，**没有 JavaScript 也能读且带样式**。bootstrap 按 tab
  瘦身：时钟页只嵌 GLM 5 小时池 + Vikunja 计数（≈0.5 KB），Vikunja 全量桶只有
  `/vikunja` 页才嵌入——旧版「每页整面板 JSON」的几十 KB 没了
- **稳态 = WebSocket 声明订阅**：页面挂载后连 `/ws`，发送
  `{"type":"subscribe","tab":…,"locked":…,"vw":…,"vh":…,"dpr":…}`；服务端 hub 把
  topic 映射到上游取数单元（source），**只有被声明的 source 才有定时器**——深夜
  无人看屏时上游调用为零，时钟页也永远不会去调 GLM 的 model/tool-usage 端点
- **topic 粒度刻意细**（`packages/shared/src/topics.ts` 的 `TOPICS_FOR_TAB`）：

  | tab     | 声明的 topic                                                     |
  | ------- | ---------------------------------------------------------------- |
  | 时钟    | `glm:rail`（仅 5 小时池）、`vikunja:counts`（仅计数）            |
  | GLM     | `glm:quota`、`glm:usage`、`vikunja:counts`、`deepseek`、`tavily` |
  | Vikunja | `glm:rail`、`vikunja:full`（全量桶，只有这个页面收到）           |

- **服务端节奏**（hub.ts 的 `createPanelHub`，锁定态取 locked 列）：

  | source                          | 活跃节奏    | 锁定节奏 |
  | ------------------------------- | ----------- | -------- |
  | glm-quota / glm-usage / vikunja | 60 秒       | 10 分钟  |
  | deepseek / tavily               | **30 分钟** | 30 分钟  |

  多个订阅者共享同一定时器（一次上游取数、按 topic 投影后各自推送）；hub 统一持有
  缓存、in-flight 去重与 stale-on-error（数据层本身是纯取数函数）

- **更新即推送**：`{"type":"update","topic":…,"now":…,"data":…}`，载荷是**该 topic 的
  瘦切片**（rail 几十字节；hourly 序列、level、api 原文等 raw-only 字段永不上线）。
  Vue 只重绘变化的节点（电子纸上 = 只有变化的数字重刷）
- **手动**：右上两个按钮 —— `刷新数据` 发 `{"type":"refresh"}`（强制一轮取数后回
  `ack`，navbar 回执「已刷新 HH:MM:SS」），`刷新页面` 整页重载（电子纸会闪一次）；
  `锁定/解锁` 见下节
- **自动整页重载只有一个触发器**：`build` id 变化——重连后首条 `hello` 携带，与旧
  轮询的部署检测同契约
- **断线**：导航栏标「⚠ 连接断开」，退避重连（1s 起指数翻倍、封顶 30s，浏览器
  `online` 事件立即重试）；**没有 HTTP 轮询回退**——WS 是唯一稳态通道，设计如此
- **保活**：服务端每 30 秒发一条 JSON `ping`（浏览器对 WS ping 帧的应答不会唤醒 JS，
  看门狗只能看到应用层消息）；120 秒无消息判定半开、断开重连。ping 刻意不带
  `now`——锁定态的倒计时文字不因保活而重绘
- **取数失败时**：保留上一次数值 + 标「⚠ 数据陈旧」；**首次就失败**的源也会推送
  错误形状（空切片 + stale 标记），而不是永远沉默——面板绝不整页空白

## 锁定模式（君子协定）

navbar 右上的 **锁定** 按钮：点击后跳到时钟页并进入锁定态，原按钮变 **解锁**。

- 锁定态下**只允许看时钟界面**：rail 里 GLM/Vikunja 照常渲染（预览数字可见），但点击
  **静默无效**（无提示、无 toast）；**直接访问 `/glm`、`/vikunja` 也会被服务端 302 回
  时钟页**（锁定在 URL 层同样成立）；`刷新数据`/`刷新页面` 同样失效——唯一有效的交互
  就是解锁按钮
- 数据订阅的节奏切到锁定档（GLM/Vikunja 源 60 秒 → **10 分钟**；DeepSeek/Tavily 本来
  就是 30 分钟）；时钟本身照常每分钟走动（纯客户端，不取数）
- 锁定状态存在 **cookie**（`mira-panel-lock=1`），整页重载 / 部署自重载后仍然保持；
  cookie 对 SSR 可读，所以锁定后跳转的时钟页**第一帧就是锁定态**（只闪一次，不会先换
  按钮再换页闪两次）
- **现阶段是君子协定**，没有真正的访问控制；未来与另一台电脑联动时，把这个 cookie 换成
  联动信号即可（服务端也能读——接缝在 `packages/web/src/composables/useLock.ts` 与
  `app.ts` 的 `lockCookie`）

## 电子纸约束（改设计时请遵守）

1. 只用纯黑 `#000` / 纯白 `#fff`，不用灰、不用阴影、不用渐变
2. **零动画**：`transition` / `animation` 全部禁用，触摸反馈用瞬时反色（`:active`）
3. 数字用 `tabular-nums` + 稳定宽度，避免数字变化引起重排
4. 页面按 2200 × 1650 设计（1 CSS px = 1 物理 px），触摸目标远大于 44 px
5. 只做增量文字更新，不做无意义的整页重载
6. **单线原则**：任何两条边框不并行——内容之间只画**一条**分隔线，绝不出现双层框。
   实现方式：容器（`main` / `.vk` / `.vk-strip`）涂黑 + 6px gap + 子元素白底，
   沟槽本身就是分隔线（外缘自动无线，卡片增减自动正确）。内容区**外缘**（贴
   rail 分隔线与屏幕右缘）不画线；tab 不带边框，tab 之间一条横线；进度条外框
   就是它的 track，保留；**大面积黑底在墨水屏上渲染不均**，反色只用于交互态
   （选中 tab、按钮按压），持久展示一律白底黑字（`.tag` 用细描边 chip）。

### 布局排版的三条硬规矩（都是踩过的坑）

1. **固定画布 + 按视口缩放**：`.screen` 是 2200 × 1650 的固定画布，用
   `transform: scale(min(vw/2200, vh/1650))` 适配。首屏前（`<head>` 里的内联脚本）
   就把 `--fit` 算好，避免闪一下再缩。
2. **卡片上绝不能写 `min-height: 0`**：那会让网格行高被同一行里**更矮**的那张卡决定，
   于是高卡的内容会溢出自己的网格位、压进下一块。行高必须由最高内容决定。
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

诊断手段：WS 的 subscribe 消息会把 `vw/vh/dpr` 一起报给服务端，服务端日志与 `/api/raw`
的 `client` 字段都能看到真实视口 —— 布局问题时先查这个，不要靠猜。

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
`curl -X POST` 405（**唯一例外**：`POST /api/vikunja/tasks/:id/done` 带
`X-Panel-Write: 1` 时 200，缺头 400，锁定态 403——勾选写路径的验收就用
一个牺牲任务走这三个分支）。

## 安全

- **面板无鉴权，且现在有一条写路径**：局域网内任何设备都能通过
  `/api/vikunja/tasks/:id/done` 勾掉任务——与锁定模式的君子协定同信任层级（家用
  可接受）。`X-Panel-Write: 1` 自定义头迫使跨站写入先走 CORS 预检，而本服务永不
  应答预检，跨站表单/fetch 因此写不进来；锁定 cookie 在服务端也被同一条路径拒绝
- 四把密钥都**只在服务端内存**中使用：不落盘、不进代码/仓库（GLM 走 `execFile(helper)`
  的 stdout；Vikunja/DeepSeek/Tavily 走 env 与 agenix 运行时文件的候选链 + Bearer 头）、
  不写日志、不进 `/api/raw`（raw 只含上游响应原文，均为数字）
- `DEEPSEEK_API_KEY` / `TAVILY_API_KEY` / `TAVILY_PROXY` 是**可选的显式覆盖**；不设时
  自动走 agenix 候选链与 hermes-env 的代理解析
- **绝不要把密钥内联到命令行/prompt**：Hermes 会把工具调用参数原文写进 `state.db`
  （显示层的 `***` 只是显示层）

## TODO

- [x] npm workspaces monorepo + 全仓 TS + Hono + Vue 3.6 Vapor 重构
- [x] WebSocket 声明式订阅改造（hub 统一节奏/缓存/投影，`/api/state` 轮询退役，
      2026-10 已落地）
- [ ] 持久化：**已决定先保持现状**（Hermes 后台拉起的进程；gateway 重启后需手动重启）
- [ ] 还能接哪些数据源（Readeck / FreshRSS / HN）
- [x] Vikunja 触摸勾选完成（`POST /api/vikunja/tasks/:id/done` + 三层防重复提交，
      2026-10 已落地）
- [ ] 是否把 Pi 的字体改动（`noto-fonts-cjk-sans`）固化进 nix-config 仓库
- [ ] GLM 错误消息里的上游响应体做一次 key 脱敏（一行加固，待确认）
- [ ] Vue 3.6 稳定发布后：升级 RC → stable，评估 `createVaporApp` 根（甩掉 VDOM
      runtime，客户端 bundle 从 165KB 降到 ~80KB）

## 重启服务（掉线时）

```bash
cd ~/git/mira-panel
npm install          # 仅在依赖变化后需要（如新增 undici 那次）
npm run build        # 若 web 构建产物不存在
npm start            # Tavily 代理无需显式指定：进程 env 没有代理时会自动读
                     # agenix/hermes-env 里的 ALL_PROXY；要覆盖就 TAVILY_PROXY=… npm start
```

kiosk 只在**服务器重启后拿到新 build id** 才整页自刷新 —— 光 build 不重启，面板不会变。
