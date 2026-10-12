# mira-panel

BOOX Mira 电子纸面板（树莓派 `yzx9-pie` kiosk 的落地页），一个 **navbar + 左侧 30% tab 栏 + 右侧详情** 的应用。

- **服务地址：** `http://192.0.2.10:15932`（本机 `yzx9-ws`，监听 `0.0.0.0:15932`）
- **树莓派侧：** `hosts/yzx9-pie/cage.nix` 的 Firefox kiosk 直接打开上面这个 URL
- **防火墙：** `hosts/yzx9-ws/networking.nix` 已放行 `192.0.2.0/24 → 15932`（无需改动）

## 页面结构

```
navbar   Mira Monitor                  套餐/状态 · 更新于 · [刷新数据] [刷新页面]
──────┬──────────────────────────────────────────────────────────────
rail  │  detail（当前 tab 的完整内容）
30%   │  70%
      │
 GLM  │  /glm     5 小时额度（大号「已用」%）、MCP 月额度 + 分项、
 用量 │            近 24 小时模型用量、逐小时 tokens 图、工具调用、周额度
──────│
Vikunja│ /vikunja 今日到期、未来 7 天、逾期、汇总（未完成 / 无期限 / 7 天以后）
```

- **tab 是普通链接**（`/glm`、`/vikunja`）：切换 = 一次 SSR 请求，无前端路由、无框架；JS 关闭也能读
- **rail 里的预览刻意极简**：GLM 只显示 5 小时额度，Vikunja 只显示今日 + 逾期 + 未完成
- **选中态 = 整块反色**（黑底白字），一位信号、零动画

## 技术栈

Node 24 内置模块，**零依赖、零构建、零 npm**。首屏全部服务端渲染，树莓派只下载一个 HTML。

| 文件 | 说明 |
| --- | --- |
| `server.mjs` | 路由、build/signature 计算、`/api/state` 载荷组装 |
| `usage.mjs` | GLM 数据层：nix 链解析 API key → 3 个 monitor 接口 → 归一化 + 缓存 25s |
| `vikunja.mjs` | Vikunja 数据层：token 解析 → 一次筛选查询 → 本地分桶 + 缓存 45s |
| `render.mjs` | navbar / rail / 各 tab 详情的 SSR 模板 + 60 秒增量更新脚本 |
| `public/draft.html` | v0 布局草案（假数据），留作对比 |

### 路由

| 路径 | 作用 |
| --- | --- |
| `/`、`/glm` | GLM 面板（SSR） |
| `/vikunja` | Vikunja 面板（SSR） |
| `/api/state?tab=glm\|vikunja` | 60 秒轮询用的瘦载荷 `{build, signature, texts, bars, stale, error}` |
| `/api/usage` | `/api/state?tab=glm` 的别名（兼容旧链接） |
| `/api/raw` | 两个数据源的完整归一化结果（调试用） |
| `/healthz` | `ok` |
| `/<file>` | `public/` 静态文件 |

## 运行

```bash
cd ~/git/mira-panel
node server.mjs          # PORT= / HOST= 可覆盖
```

健康检查 `curl http://127.0.0.1:15932/healthz`。

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
- 逐小时图用 `model-usage` 的 `tokensUsage` 序列 + `x_time` 标签（25 个小时桶，界面写"近 24 小时"）

### Vikunja（`/vikunja`）

```
GET https://todo.example.com/api/v1/projects
GET /api/v1/tasks?filter=done = false&sort_by=due_date&order_by=asc&per_page=200
```

- `Authorization: Bearer <token>`，token 运行时按顺序解析：`VIKUNJA_API_KEY` 环境变量 → `${XDG_RUNTIME_DIR}/agenix/vikunja-env`（agenix 解密）→ Hermes 的 `.env`
- 一次筛选查询拿全部未完成任务，**分桶在本地做**：今日 / 未来 7 天 / 逾期 / 无截止日期 / 7 天以后
- `due_date` 为 `0001-01-01T00:00:00Z` 是 Vikunja 的"没有截止时间"哨兵值
- 逾期列表按**最近到期优先**排序（Vikunja 默认最旧优先，对积压不友好）

### 已知限制

- **GLM「重置次数」拿不到。** 重置走 ZCode Server 的 `/api/v1/coding-plan/reset/{status,opportunity,use,history/read}`：在 bigmodel / api.z.ai 上该路径 `404 NOT_FOUND`，只有 `zcode.z.ai` 有（401）。它需要 `Authorization: zcode <zcodejwtoken>` **加** `X-Bigmodel-Authorization: <MaaS OAuth JWT>`（Team 还要 organization/project 头），Coding Plan 的 API key 不够；官方也说明重置卡只发给"登录 ZCode 并连接了 Coding Plan"的账号。
- GLM `modelSummaryList` 各模型 tokens 之和 ≠ `totalUsage.totalTokensUsage`（曾观察到差约 19%），两个数字不要互相印证。
- Vikunja 那边存在**真实重复任务**（同标题同截止、不同 id）—— 面板只是如实显示，去重要在 Vikunja 侧做。

## 刷新契约（电子纸友好）

- **首屏**：服务端渲染真实数字，**没有 JavaScript 也能读**
- **更新**：内联小脚本每 **60 秒** fetch `/api/state?tab=…`，**只写 `textContent` 发生变化的节点**（未变化的节点完全不碰，条宽只在数值变化时才写 `style.width`）
- **手动**：右上两个按钮 —— `刷新数据` 只重新取数并打补丁（轻），`刷新页面` 整页重载（重跑 SSR，电子纸会闪一次）
- **两个自动重载触发器**（只在真正必要时才闪）：
  - `build`：服务端代码变了（server / usage / render / vikunja 的 size+mtime 哈希）
  - `signature`：**不可打补丁的内容**变了（例如任务列表构成、额度项结构）
  - ⚠️ signature **绝不能包含每次取数都会变的字段**（如 `fetchedAt`），否则会退化成每分钟自触发的 reload 循环
- 服务端缓存：GLM 25 秒、Vikunja 45 秒，都有 in-flight 去重，所以无脑刷也不会打爆上游
- 取数失败时：保留上一次数值 + 标「⚠ 数据陈旧」，绝不整页空白

## 电子纸约束（改设计时请遵守）

1. 只用纯黑 `#000` / 纯白 `#fff`，不用灰、不用阴影、不用渐变
2. **零动画**：`transition` / `animation` 全部禁用，触摸反馈用瞬时反色（`:active`）
3. 数字用 `tabular-nums` + 稳定宽度，避免数字变化引起重排
4. 页面按 2200 × 1650 设计（1 CSS px = 1 物理 px），触摸目标远大于 44 px
5. 只做增量文字更新，不做无意义的整页重载

### 布局排版的三条硬规矩（都是踩过的坑）

1. **固定画布 + 按视口缩放**：`.screen` 是 2200 × 1650 的固定画布，用
   `transform: scale(min(vw/2200, vh/1650))` 适配。首屏前（`<body>` 开头的内联脚本）
   就把 `--fit` 算好，避免闪一下再缩。本机 Pi 实测视口 2200×1650 @1x → scale 1.000，
   仍是原生 1:1；换成更小或高 DPR 的视口时整页等比缩小，而不会溢出把布局压扁。
2. **卡片上绝不能写 `min-height: 0`**：那会让网格行高被同一行里**更矮**的那张卡决定，
   于是高卡的内容（例如 MCP 的第三行分项）会跑到边框外面。行高必须由最高内容决定。
3. **进度条 / 图表必须 `flex: none`**：卡片是 flex 列容器，一旦卡盒比内容矮，
   默认 `flex-shrink: 1` 会把进度条压成一条线（看起来就是"进度条坏了"）。
   同时卡片**不要**加 `overflow: hidden`，宁可看见溢出也不要静默丢内容。

诊断手段：60 秒轮询会把 `vw/vh/dpr` 一起报给服务端（`noteClientViewport`），
服务端日志与 `/api/raw` 的 `client` 字段都能看到真实视口 —— 布局问题时先查这个，
不要靠猜。本地可以用无头 Chromium 自己截图验收：

```bash
nix-shell -p chromium --run 'chromium --headless=new --disable-gpu --no-sandbox \
  --hide-scrollbars --window-size=2200,1650 --screenshot=/tmp/shot.png http://127.0.0.1:15932/glm'
```

## 安全

- 两个 token 都**只在服务端内存**中使用：不落盘、不进 argv/env（GLM 走 `execFile(helper)` 的 stdout，Vikunja 走 Bearer 头）、不写日志
- **绝不要把密钥内联到命令行/prompt**：Hermes 会把工具调用参数原文写进 `state.db`（显示层的 `***` 只是显示层）

## TODO

- [x] `git init` + 提交（4 个 commit）
- [x] 左右分栏 + tab 化 + Vikunja 面板
- [ ] 持久化：**已决定先保持现状**（Hermes 后台拉起的进程；gateway 重启后需手动重启）
- [ ] 还能接哪些数据源（Readeck / FreshRSS / HN）
- [ ] Vikunja 是否支持触摸勾选完成（需要写接口 + 防重复提交）
- [ ] 是否把 Pi 的字体改动（`noto-fonts-cjk-sans`）固化进 nix-config 仓库
- [ ] GLM 错误消息里的上游响应体做一次 key 脱敏（一行加固，待确认）

## 重启服务（掉线时）

```bash
cd ~/git/mira-panel && node server.mjs
```
