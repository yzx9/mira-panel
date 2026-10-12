# mira-panel

BOOX Mira 电子纸面板（树莓派 `yzx9-pie` kiosk 的落地页），当前显示 **GLM Coding Plan 用量**。

- **服务地址：** `http://192.0.2.10:15932`（本机 `yzx9-ws`，监听 `0.0.0.0:15932`）
- **树莓派侧：** `hosts/yzx9-pie/cage.nix` 的 Firefox kiosk 直接打开上面这个 URL
- **防火墙：** `hosts/yzx9-ws/networking.nix` 已放行 `192.0.2.0/24 → 15932`（无需改动）

## 技术栈

Node 24 内置模块，**零依赖、零构建、零 npm**。首屏由服务端渲染，树莓派只下载一个 HTML。

| 文件 | 说明 |
| --- | --- |
| `server.mjs` | 路由：`/`（SSR 面板）、`/api/usage`（JSON）、`/healthz`、`public/` 静态文件 |
| `usage.mjs` | 数据层：nix 链解析 API key → 调 3 个 monitor 接口 → 归一化 + 格式化 + 缓存 |
| `render.mjs` | 把数据渲染成 HTML（样式内联，含 60 秒增量更新的小脚本） |
| `public/draft.html` | v0 布局草案（假数据），留作对比 |

## 运行

```bash
cd ~/git/mira-panel
node server.mjs          # PORT= / HOST= 可覆盖
```

健康检查 `curl http://127.0.0.1:15932/healthz`；调试数据 `curl http://127.0.0.1:15932/api/usage`。

## 数据来源（GLM Coding Plan）

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

### 已知限制

- **「重置次数」拿不到。** 重置走 ZCode Server 的 `/api/v1/coding-plan/reset/{status,opportunity,use,history/read}`：在 bigmodel / api.z.ai 上该路径 `404 NOT_FOUND`，只有 `zcode.z.ai` 有（401）。它需要 `Authorization: zcode <zcodejwtoken>` + `X-Bigmodel-Authorization: <MaaS OAuth JWT>`（Team 还要 organization/project 头），Coding Plan 的 API key 不够；官方也说明重置卡只发给"登录 ZCode 并连接了 Coding Plan"的账号。
- `modelSummaryList` 各模型 tokens 之和 ≠ `totalUsage.totalTokensUsage`（曾观察到差约 19%），两个数字不要互相印证。

## 刷新契约（电子纸友好）

- 首屏：服务端渲染真实数字，**没有 JavaScript 也能读**
- 更新：内联小脚本每 **60 秒** fetch `/api/usage`，**只写 `textContent` 发生变化的节点**（未变化的节点完全不碰，条宽只在数值变化时才写 `style.width`）
- 手动：右下「立即刷新」按钮调同一个接口，并给出反馈文案
- 服务端 25 秒缓存 + in-flight 去重，所以无脑刷也不会打爆上游接口
- 取数失败时：保留上一次的数值 + 顶部标「⚠ 数据陈旧」，绝不整页空白

## 电子纸约束（改设计时请遵守）

1. 只用纯黑 `#000` / 纯白 `#fff`，不用灰、不用阴影、不用渐变
2. **零动画**：`transition` / `animation` 全部禁用，触摸反馈用瞬时反色（`:active`）
3. 数字用 `tabular-nums` + 稳定宽度，避免数字变化引起重排
4. 页面按 2200 × 1650 设计（1 CSS px = 1 物理 px），触摸目标远大于 44 px
5. 不整页自动重载，只做增量文字更新

## TODO

- [x] `git init` + 首次提交（`feat: add e-paper panel serving GLM Coding Plan usage`）
- [ ] 持久化：**已决定先保持现状**（Hermes 后台拉起的进程；gateway 重启后需手动重启）
- [ ] 面板是否要加其他数据源（Vikunja / Readeck / FreshRSS / HN）
- [ ] 是否把 Pi 的字体改动（`noto-fonts-cjk-sans`）固化进 nix-config 仓库

## 重启服务（掉线时）

```bash
cd ~/git/mira-panel && node server.mjs
```
