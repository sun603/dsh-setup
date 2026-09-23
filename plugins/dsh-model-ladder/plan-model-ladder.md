# model-ladder — 模型高低阶梯自动退化模式 · 实现方案 v2

> 状态：设计定稿（v2，按用户交互反馈重排），待实现。本文档面向实现 Agent，所有机制均已在
> `dsh-src-research/.deepseek-harness/` 源码（tag `dsh-v0.1.2-rc.1`，与部署安装版
> 0.1.2-rc.1 完全一致）与本部署运行时（cordis inspect / anchored-monitor 先例）中核实，
> 文件路径与行号可作为证据复查。实现只写一个本地插件包 + 一条 profile patch，
> **不修改上游源码仓库，不改动任何原生 UI 行**。

## v2 变更记录（相对 v1）

- **UI 交互重排（用户拍板）**：原生模型选择器**完全不换**，它就是 low 槽（窗口外跑什么 =
  用户原生所选）。composer 工具行内置选择器的**左边**新增一个同款下拉 = high 槽，
  其上内联一个**可编辑数字 = 本会话剩余 high 轮数**：置 0 = 立即退出 high（"任何时候可关"），
  置 N = 立即高 N 轮（boost/续窗/复位同一入口），自然衰减到 0 停止。
  high 生效期间 widget 带主题色**高亮**。
- 因此**删除**：settings.low、settings.enabled、manualOther 让位态、对 `model/selection`
  事件的 boost 侦测（§1.2 表整体作废）、D5 single-seat 遮蔽方案及其退路（席位风险清零）。
- 会话状态从 `{highUntilTurn, manualOther}` 缩为 `{highUntilTurn}` 一个数。
- 新增一个 host 写路由 `POST /api/model-ladder/session`（数字编辑/选模型/↻ 都走它）。
- 打包路线改走**本仓库自有插件约定**（`plugins/model-ladder/` + install.sh 农场 junction +
  用户 patch 层 insert 行），不再照抄 anchored-monitor 的第三方 bundle 式 `pnpm add file:`。

---

## 0. 可行性结论

**可行，且不需要动 DSH 上游源码。** 所需的全部注入缝都存在并且有本地先例：

| 需求 | 依赖机制 | 证据 |
|---|---|---|
| 每轮实际调用前替换模型 | `agent/request` waterfall（可整体替换 `LlmCallConfig`，支持 `{ prepend: true }` 抢最外层） | `vendor/cordis/src/events.ts:113-118`（EventOptions.prepend，boolean 即 shorthand）、`:78-87`（"returns the outermost listener's return value"） |
| prepend 必获胜（关键时序，已逐环核实） | `session-controller/src/agent.ts:379-387` setup 先 `installSelection(agentCtx)` 后 `presets.mount`；**`agent-loop/src/index.ts:702` `setup?.(prepared.agent.ctx)`——setup 拿到的就是日后的 `agent.ctx` 同一对象**；后注册 prepend 进同一 hooks 数组头部 = 最外层 = 最终赢家 | 同上 + `packages/core/agent/src/model-selection.ts`（意图覆盖发生在 `await next()` 之后，含继承 effort 剥离逻辑，本方案照抄） |
| 监听器随会话销毁自动回收 | `ctx.on` 把 hook 挂为**所调 ctx 所属 fiber** 的 effect | `vendor/cordis/src/events.ts:246-258`（`register()` → `this.ctx.fiber.effect`） |
| 轮次计数 | 持久事件 `turn/start` + `turnBoundary` 投影（重启后单调可恢复）+ `agent/request` payload 自带 `{agent, turn, step, signal}`（`agent` 由调度器融合注入） | `packages/core/agent-loop/src/agent.ts:101`、`:264`；`packages/core/agent/src/dispatch.ts:107+`、`runtime-types.ts:251` |
| 新下拉放内置选择器左边、不碰原生 | composer 工具行渲染序 `[conversation.input.left…] [conversation.input.right] [conversation.input.model 内置] [ContextMeter]…`；`conversation.input.right` 是 **kind=list 附加席位（replaceRisk=none）**，紧贴内置选择器左侧 | `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:461-467`；Slots.listSubTree 实查（`conversation.input.right`: kind=list/scope=session/registration {id,order,label}） |
| 参数配置 | `ctx.settings.installSection`（host 侧注册 ns → 设置页自动出卡片）+ 客户端 `ctx.remote.settings.update/describe` | 先例：`packages/core/agent-loop/src/index.ts:394`、`packages/settings/settings/src/index.ts:472`、ui-settings-plugins 卡片 |
| 实时档位/剩余轮数显示 + 复位写入口 | host `webServer.register` 同源状态路由（GET 轮询 + POST 写）+ 客户端轮询（anchored-monitor 同款通道） | `~/.dsh/profiles/web/node_modules/@a9i5k4/dsh-anchored-monitor/lib/index.js:540+`（`{kind:'exact', path, handler}`，数组逐个 `ctx.webServer.register(route)`） |
| 选 high 模型走现有目录 | 共享目录服务 `ctx.modelDirectories.directoryFor(sessionId)`：`store/load/select`，select 即现有 `remote.session.selectModel` 全链路 | `packages/client/ui-model-selection/src/client/index.ts:156-179`、`service.ts`、`packages/api/session-controller/src/commands.ts:119-158` |
| 部署挂载 | profile 用户 patch 层本地包 insert 一行，宿主/浏览器双面同包 | 本仓库 `plugins/dsh-web-ui-addons/` 现状：农场 junction + `~/.dsh/profiles/web/cordis.patch.yml` `- insert:` 行 |

**日志一致性（沿 v1，机制已核实）**：`agent/request` waterfall 的结果随后被 `llm.prepareCall`
解析并写入持久事件 `request/header`（`packages/core/agent-loop/src/agent.ts:478-518`），
因此**在这个缝上换模型自动满足仓库的 "model-visible ⟺ logged" 规则**，会话日志与
`modelSelection` 投影都会如实反映实际执行模型（档位切换以 `reason:'change'` 落盘）。
不要改用 `llm/stream` 拦截——那里换模型会晚于 header 落盘，产生日志不一致。

**一个明示的显示推论**：high 带期间原生下拉仍显示用户所选（= low 槽）模型——那是"意图"；
实际执行看 `request/header` 与我们的 widget 高亮/数字。这是"原生 UI 不变"的既定取舍。

---

## 1. 需求与行为规范

### 1.1 术语

- **档位（tier）**：`high`（widget 所选模型）或 `low`（原生选择器所选模型，即会话意图本身）。
- **轮（turn）**：用户可见的一个对话回合。一次用户消息 → agent 完整多步活动 = 1 轮；
  steering/排队消息、goal 自动续轮各自开启新 turn。对应持久事件 `turn/start` 的序号。
  一个 turn 内的所有 step（每次模型调用）**档位一致**。
- **剩余轮数（remaining）**：widget 上内联可编辑数字，**含当前进行轮**：
  `remaining = max(0, highUntilTurn − lastTurn + 1)`（当前轮在带内时）。
- **boost**：把 remaining 置为正数的动作（编辑数字、从 0 时选 high 模型、点 ↻ 均可触发）。

### 1.2 行为规格（状态机）

每会话调度器状态：`Map<sessionId, { highUntilTurn: number }>`（无持久化，可从投影重建，见 §4.3）。

**覆盖规则（host 半，prepend 的 `agent/request` 监听器内求值）**：

```
tier(turn) =
  若 high 槽未配置或解析失效                    → passthrough
  若 session 为子代理/工作流会话（见 §7 E6）     → passthrough
  否则若 turn ≤ highUntilTurn                   → 强制 high
  否则                                          → passthrough（= 用户原生所选，天然就是 low 槽）
```

low 侧**没有强制逻辑**：窗口外 `await next()` 的结果（会话意图）原样返回。

**remaining 的写入（全部经 `POST /api/model-ladder/session`，{sessionId, turns}）**：

| 动作 | 规则 |
|---|---|
| 编辑数字为 N（≥1） | `highUntilTurn = 当前轮 + N − 1`（当前轮计入带内；0 → 立即退出） |
| 编辑数字为 0 | `highUntilTurn = 当前轮 − 1`：**下一个请求（step）起**立即 passthrough（当前轮已发出的 step 不回改；用户显式动作即时生效，header 以 `reason:'change'` 如实落盘）；widget 显示 0、高亮熄灭 |
| 在 high 下拉选模型 | 写 settings.high + 校验；若当前 remaining == 0 → 同时置 remaining = settings.window（自动 boost）；已在带内 → 只换模型不动计数 |
| 点 ↻ | `remaining = settings.window`（默认 3） |

衰减不需要写路径：`turnBoundary.lastTurn` 单调前进，remaining 是派生值。

**新会话自动 high（用户已确认保留）**：武装时（§4.3）`highUntilTurn = 0 + window` →
前 window 轮自动 high，之后自动落回原生所选。high 槽未配置时自然不生效。

**重启/恢复（v1 语义，明确告知）**：宿主进程重启后按"当前意图"重估——挂载时 remaining ≥ 1
（意图视为仍在带内）则视为刚 boost（满血 window 轮），否则视为 0。不承诺保留中断窗口的
剩余数（v2 候选：`sessionQuery.observeSession` 折叠日志精确重建，见 §9）。

### 1.3 用户故事核对

1. 开新会话 → 前 3 轮（默认 window）自动 pro，之后自动跑原生所选（日志 request/header 如实记录）。✓
2. 需要计划/难题 → widget 输 3（或点 ↻）→ 立即 boost，未来 3 轮 high，之后自动回 low。✓
3. high 带中途想接着用 → 再点 ↻ 或改数字 = 续窗/复位计数器。✓
4. 任何时候想关 → 数字拨到 0，下一轮起 passthrough；带内显示 0 且高亮熄灭。✓
5. 换 low 模型 → 原生下拉/`/model` 弹层照常，就是会话所选；high 槽独立配置，两下拉外观同款。✓
6. 是否正在用 high 一眼可辨 → widget 激活态主题色高亮 + 数字常显剩余轮数。✓

---

## 2. 总体架构

**载体**：本仓库自有插件 `plugins/model-ladder/`（包名 `model-ladder`，AGENTS.md 自有插件
格式：`main: lib/index.js` host 半 + `./client` 浏览器半 + `dsh.client.platform: "web"`；
手写纯 JS、无构建步骤）。**不改上游源码**，不新增会话事件类型，不新增 Remote 命名空间。

```
┌─ Browser (apps/web GUI) ─────────────────────────────────────────┐
│ client 半（lib/client.js, __ModuleLoader__.load）                 │
│  · 注册 conversation.input.right（list 席位，不碰任何内置行）：     │
│    ModelLadderWidget                                              │
│    - high 下拉（同款样式，目录=ctx.modelDirectories）             │
│      选中 → remote.settings.update(high) +（remaining==0 时）POST │
│    - 内联数字输入 → POST /api/model-ladder/session {turns}        │
│    - ↻ → POST {turns: settings.window}                            │
│    - 高亮/数字/置灰 ← fetch /api/model-ladder/state（1.5s 轮询）   │
└──────────────────────────────────┬───────────────────────────────┘
                                   ▼
┌─ Host (dsh web 进程) ────────────────────────────────────────────────┐
│ host 半（lib/index.js）                                               │
│  · settings.installSection('model-ladder', {window, high})            │
│  · on('agent/created') → 该 agent.ctx 上注册:                         │
│      on('agent/request', …, {prepend:true})  ← 唯一覆盖点             │
│    （监听器归属 agent 纤维，随会话销毁自动回收）                       │
│  · on('session/event') 观察 'turn/start'（lastTurn 缓存，可选）       │
│  · on('settings/updated' ns=model-ladder) → resolveCallConfig         │
│    验证 high；on('llm/adapters-updated') 复验                         │
│  · webServer: GET /api/model-ladder/state · POST /api/model-ladder/session │
└────────────────────────────────────────────────────────────────────────┘
```

调度状态全在 host 半内存 Map（按 sessionId），**可由持久投影重建**（§4.3）；
`model-ladder` 配置（window + high 槽）持久在用户 settings 文档里（现有 settings 存储）。
remaining 是 host 派生值，client 只读显示 + 写整数，**不存在双端计数漂移**。

---

## 3. 设计决策记录（ADR 摘要）

- **D1 覆盖点选 `agent/request`（prepend），不选 `llm/stream`**：header 在 waterfall 之后
  落盘，日志/投影自动一致（§0 已核实逐环，含 setup 与 agent.ctx 同对象证据）；
  `llm/stream` 晚于 header，破坏 model-visible⟺logged。
- **D2（v2 改写）low 槽 = 会话意图本身，零逻辑**：窗口外 passthrough，"选什么 low"就是
  原生所选；自动退化完全不回写 `model/selection`。连带删除 v1 的让位态——用户随时可在
  原生入口选任意模型，它自动成为新的 low，无冲突可发生。
- **D3 boost 是显式动作（数字/↻/首次选 high），不侦测 selection 事件**：语义单一、可解释；
  实现为 host 写路由 + client 控件，避开"任何入口选 high 都算 boost"带来的心智负担。
- **D4 配置放 settings ns**（不新造持久层）：自动获得设置页卡片、通用读写 RPC
  （`remote.settings`）、变更事件（`settings/updated`）。ns 里只放全局项（window、high 槽）；
  会话态 remaining 不进 settings，活在 host Map + 路由。
- **D5（v2 改写）附加席位，不占位替换**：用 `conversation.input.right`（list、
  replaceRisk=none）紧挨内置选择器左侧，原生行为零改动，v1 的 single-seat 遮蔽风险不复存在；
  `/model` 弹层与内置下拉天然共存（它们就是 low 槽的入口）。
- **D6 数字含当前轮；用户显式动作下一 step 即生效，自动衰减按轮生效**：boost/续窗/置 0
  都是用户此刻的明确意图，下一个请求（step）就换档，不等轮边界（v1 的"手动降级即时生效"
  同款语义；header 变化可审计）；而**自动**退出（remaining 自然走到 0）只发生在轮边界，
  保证无人干预时一轮内档位一致。widget 数字随 state 轮询即时反映。

---

## 4. Host 半详细设计（lib/index.js）

### 4.1 插件对象

```js
export const name = 'dsh-model-ladder'
export const inject = ['llm', 'webServer', 'sessionProjections', 'sessions']
export function apply(ctx) { ... }
```

（实现注记：`settings` 服务未用——见 4.2 勘误；`agents` 服务不需要——武装走
`agent/created` 事件与会话投影，目标会话直接由 `sessions.get(id)` 解析。）

### 4.2 配置持久化（勘误：不用 settings 服务）

计划原文设想用 `settings.installSection` 注册 `model-ladder` ns。实现时发现
**设置页不会为任意 ns 自动生成卡片**（每张卡都是 ui-settings-plugins 手工注册），
且该 API 需要 schemastery 裸导入（符号链接农场下解析不可靠）——v1 放弃设置页卡片，
配置改存 **`~/.dsh/model-ladder.json`**（anchored-monitor 同款通道）：

```json
{ "window": 3, "high": { "provider": "…", "model": "…" } }
```

写入通道 = 同源路由 `POST /api/model-ladder/settings`（widget 走它）；
`window` 无 UI 控件，改配置或经该路由写（v2 候选）。
`high` 初始 null：未配置时调度器整体 passthrough、widget 提示"请选择 high 模型"。
每次写入与 `llm/adapters-updated` 事件后对 high 跑 `ctx.llm.resolveCallConfig({...})`
验证，失败 → `highEffective=null`（widget 标"配对失效"）；调度器只在 high 有效时启用。

### 4.3 调度器状态与重建

`Map<sessionId, { highUntilTurn }>`。

- `on('agent/created', { agent })`（root 平面监听 scoped 事件，先例 anchored-monitor）：
  - 若 `agent.session.header.parentSession !== undefined` 或
    `header.origin === 'subagent'`：不武装（子代理与工作流子会话不受本模式影响）。
  - 在此**同步**注册覆盖监听器（首个 `agent/request` 可能紧随而来）；**武装是惰性的**
    （勘误）：`ensureArmed(session)` 在首次 `agent/request` / 首次路由读取时建状态，
    **create-only、幂等**——GET 轮询永不重置已有窗口（实现中冒烟测试 E1 专防此雷）。
  - 武装规则读投影 `turnBoundary.lastTurn`（`stateOf(session,'turnBoundary')?.lastTurn ?? 0`，
    与 `agent-loop/src/agent.ts:101` 同源）与意图 `modelSelection`（`pending ?? lastUsed`）：
    - **新会话（`intent===null && lastTurn<=1`）**：`highUntilTurn = window`（前 window 轮
      自动 high；`<=1` 因为惰性武装发生在 turn/start 落盘之后——实现注记）；
    - **恢复会话**：意图 == high 槽 → 视为刚 boost：`highUntilTurn = current + window - 1`
      （空闲时 `current = lastTurn + 1`，等价于原式 `lastTurn + window`）；
      否则 `highUntilTurn = current - 1`（带外，passthrough）。
      （v1 简化：不从日志重建中断窗口的精确剩余数，§1.2 明示语义。）
    - 若意图恰为某第三模型：它就是新 low 槽，无需特殊态。
  - 覆盖监听器注册在 `agent.ctx.on('agent/request', handler, { prepend: true })`，监听器归属
    agent 纤维（`events.ts:246-258` + `symbols.tracker` 使 `this.ctx`=调用侧 ctx），随会话
    销毁自动回收。
- `on('session/event')` 观察 `turn/start`：不实现——每次从投影现读（投影即事实源）。
  **不观察 `model/selection`**（v1 的 §1.2 表已作废）。

### 4.4 覆盖处理器（核心，~15 行）

```js
async (payload, next) => {           // payload: { agent, turn, step, signal }
  const resolved = await next()      // 内层含 installModelSelection 的意图覆盖
  const st = states.get(String(payload.agent.session.id))
  const high = currentHigh()         // {provider, model, reasoningEffort?} | null（含有效性）
  if (!high || !st || payload.turn > st.highUntilTurn) return resolved   // passthrough
  if (sameSelection(resolved, high)) return resolved
  const { reasoningEffort: _drop, ...rest } = resolved   // 同 model-selection.ts 剥离继承 effort
  return { ...rest, provider: high.provider, model: high.model,
           ...(high.reasoningEffort ? { reasoningEffort: high.reasoningEffort } : {}) }
}
```

### 4.5 状态路由（webServer.register `{kind:'exact', path, handler}`，照 anchored-monitor 写法）

```
GET  /api/model-ladder/state?sessionId=…
→ 200 { window, high, highValid,
        session: { highUntilTurn, lastTurn, remaining, tier } | null }   // remaining=派生值

POST /api/model-ladder/session { sessionId, turns: int ≥ 0 }
→ 200 同 GET 响应   // 置 remaining：turns==0 → highUntilTurn=当前轮−1；
                     turns≥1 → highUntilTurn=当前轮+turns−1；仅回 JSON、幂等
```

当前轮号取 `lastTurn + (进行中 ? 1 : 0)`——以 `agent/request` 武装时缓存与 `turn/start`
事件对齐；无活络 agent 的会话以投影 `lastTurn` 为"当前轮"。写路径只动该会话 Map 项，
无其它副作用；sessionId 非法 → 400。

---

## 5. Client 半详细设计（lib/client.js）

手写 `window.__ModuleLoader__.load({ id, factory })`，形态完全照抄 anchored-monitor 与本仓库
dsh-web-ui-addons（React.createElement，无 JSX/构建；中英文案 `T(zh, en)` 辅助）。

依赖注入：`exports.inject = ['slots', 'sessions', 'modelDirectories', 'remote', 'remote.settings']`
（`modelDirectories` 由内置 ui-model-selection 挂在 root ctx，`ctx.get` 防御式读取；
built-in 行保持挂载——它现在是 low 槽本体）。

`ModelLadderWidget` 注册进 `conversation.input.right`（list 席位，registration {id, order, label}；
per-session props 经 `inject(sessionId)` 面获取——seat 契约以实现时 Slots 实查为准，
内置 ModelSelect 的 register 已证明 session-scope 席位可注入 sessionId）：

```js
slots.register({ name: 'conversation.input.right', id: 'model-ladder',
                 order: 10, inject: (sessionId) => ({ sessionId }) },
               (props) => h(ModelLadderWidget, props))
```

组件构成（单个紧凑控件，贴内置选择器左侧，样式/尺寸参考 ModelSelect.tsx，不引第三方依赖，
主题色走 shell 既有 token，深浅色自适应）：

1. **high 下拉区**：目录数据 `modelDirectories.directoryFor(sessionId).store`
   （SnapshotStore subscribe 渲染，与内置同款，含"当前值=settings.high"回显）。
   选中 → `remote.settings.update(NS, {high: sel}, rev)`；host 校验通过后若
   `GET state` 显示 remaining==0 → 顺带 `POST {turns: window}`（选即 boost；已在带内只换模型）。
2. **内联数字输入**：显示 `remaining`（含当前轮），blur/Enter 提交 `POST {turns: N}`；
   0 = 关（下一 step 即生效，D6）；非法值回退显示。
3. **↻ 按钮**：`POST {turns: window}`。
4. **高亮**：`remaining ≥ 1 && tier == high && highValid` → widget 激活态（主题强调色描边 +
   浅底色）；passthrough/未配置 → 常规态；high 槽无效 → 置灰 + tooltip"配对失效"。
   数据源 `GET /api/model-ladder/state` 1.5s 轮询（仅当前活动会话；参照 anchored-monitor
   轮询与容错写法，页面不可见时可暂停）。
5. 会话无 widget 武装状态（子代理会话等）→ `session: null` → 组件整体不渲染。

---

## 6. 包与安装（本仓库自有插件约定）

```
plugins/model-ladder/
├── package.json        # name:"model-ladder", type:"module", main:lib/index.js,
│                       # exports "." / "./client", dsh.client.platform:"web"（AGENTS.md 模板）
├── lib/index.js        # host 半
├── lib/client.js       # 浏览器半（__ModuleLoader__.load 信封，id 必须等于包名）
└── README.md           # 含 Model Experience 小节：KV-cache 与成本影响（双语）
```

- `scripts/install.sh` 的 `--only` 纳管（同 dsh-web-ui-addons：农场 junction + 自动写
  `~/.dsh/profiles/web/cordis.patch.yml` 的 `- insert: [{id: model-ladder, name: model-ladder}]`）。
- 生效：**重启 dsh server**（与已挂起的 addons 重启待办共用一次；重启中断当前会话，由用户执行）。
- 卸载：patch 行删除 + 农场 junction 删除 + 重启（监听/路由/席位随纤维消失，零残留）。

## 7. 边界与异常清单

- **E1 覆盖与 `consumeSelection` 交互**：意图（=low 槽所选）与 high 带实际 header 不匹配时
  pending 不被吞（`session-controller/agent.ts:338-350`）；passthrough 轮 header==意图 →
  正常消费。TC-4 验证。
- **E2 step 中途配置变更/置 0**：tier 判定每请求重读 → 下一请求即生效，单个 step 内绝不
  撕裂（自动衰减只在轮边界换档；显式动作按 D6 下一 step 生效）。
- **E3 low 模型上下文窗口小于 transcript**：交给现有 compaction/context 机制（与用户手选
  小窗模型同路径），README 注明。
- **E4 high 槽配对无效**（凭据删除、provider 下线）：resolveCallConfig 失败 → 自动
  passthrough + widget 置灰"配对失效"，不抛错、不断流。
- **E5 席位 props 面**：若 `conversation.input.right` 的注册契约实测拿不到 sessionId，
  退路为从 `ctx.sessions` 当前 scope 解析；再不行用 `conversation.input.overlay`
  （list，composer 卡内浮层）。三席位均已实查存在。
- **E6 子代理/工作流**：v1 明确不武装（§4.3 过滤），子代理模型由其现有
  `subagentModelSelection` 机制管；client 半对 `session:null` 不渲染。
- **E7 与 anchored-monitor 共存**：其 L2 重置动 persona/工具不动模型；两插件监听的事件
  不相交于同一 waterfall（我们独占 prepend agent/request）。无冲突；TC-9 冒烟确认。
- **E8 并发会话**：remaining 按 sessionId 分片；window/high 槽是全局偏好。
- **E9 数字输入的并发写**：POST 幂等覆盖 `highUntilTurn`，双 tab 同开会话后写先赢；
  1.5s 轮询收敛显示，v1 可接受（README 一句）。

## 8. 实现步骤（按序执行，每步可独立验证）

1. **Host 半骨架**：settings ns + 状态 Map + `agent/created` 武装 + prepend 覆盖。
   → 无 UI 即可用 CLI 验证：新会话前 window 轮 header=high，之后=passthrough。
2. **状态路由**：GET state + POST session 两端点；curl 直接验 boost/置 0。
3. **Client 半**：`input.right` 注册 + 下拉/数字/↻/高亮 + 轮询。GUI 手工过 §1.3 六个故事。
4. **设置卡片**：确认 installSection 渲染 window 数字项与 high 槽只读展示
   （若 card 表单成本高，v1 允许"下拉写 settings、设置页只读"）。
5. **包化与安装**：§6；README（含 KV/成本 Model Experience 节、双语）。
6. 跑 §9 验收全表；更新本文档"实际实现偏差"一节（保持零漂移记录）。

## 9. 验收用例表

| # | 场景 | 期望 |
|---|---|---|
| TC-1 | 武装，新会话连发 4 条消息（window=3） | 第 1–3 轮 `request/header`=high、第 4 轮=原生所选；prepend 覆盖真实生效（header 与之一致，非仅日志噪声） |
| TC-2 | turn 5（已 low），数字输入 3 | turn 5（进行中，剩余 step）+ 6,7 为 high；widget 数字从 3 递减，高亮点亮；turn 8 起 low、高亮熄灭 |
| TC-3 | high 带中（数字=2）再点 ↻（window=3） | 数字回 3，从当前轮重计，续窗无撕裂 |
| TC-4 | high 带中原生下拉/`/model` 选任意模型 X | high 带剩余轮仍 high；X 成为意图并被正常消费记录（`model/selection` 事件仅来自真实用户选择）；出带后跑 X；boost 不被 consume 清掉 |
| TC-5 | 窗口中途重启宿主再续话 | 按 §1.2 重启语义：意图==high → 满血新窗口；否则带外；不报错、不粘滞 |
| TC-6 | 数字拨 0（high 带中） | 下一个 step 起即 passthrough（显式动作即时生效，D6），header 落 `reason:'change'`；widget 立即显示 0、高亮熄灭。对照：不干预自然走到 0 → 切换只发生在轮边界、轮内档位一致 |
| TC-7 | 删除 high 模型凭据 | passthrough + widget 置灰"配对失效"；无请求失败 |
| TC-8 | 子代理/工作流会话 | 模型不被阶梯改写；composer 无 widget |
| TC-9 | 与 anchored-monitor/dsh-web-ui-addons 同开 | 各面板与 composer 控件互不干扰；L2 干预与阶梯共存 |
| TC-10 | 全程未配置 high 槽 | 一切行为与未装本插件完全一致；widget 置灰可用但无效 |
| TC-11 | 原生选择器行为回归 | 内置下拉/`/model` 弹层/ContextMeter 与 v1 安装前逐像素一致（席位纯附加） |

## 10. v2 候选（明确不做）

- 从持久日志精确重建中断窗口剩余轮数（`sessionQuery.observeSession` 折叠）；
- 每会话独立 high 槽覆盖（当前为全局配对 + 会话进度）；
- 预算触发（按 tokens/成本而非轮数）；
- 进入 plan mode 自动 boost（挂 `plan` 投影变化）；
- high 槽 effort 的独立微调（当前跟随配对值）。

## 11. 风险与回滚

| 风险 | 缓解 |
|---|---|
| prepend 未如预期成为最外层（cordis 版本语义差异） | 源码已逐环核实（§0）；TC-1 第 1 步仍先验；失败才考虑 upstream 路线（预计不需要） |
| `input.right` 席位 props 面与预期不符 | E5 三级退路（scope 解析 / overlay 席位），全部实测存在 |
| 自动 low 后用户以为高模型在跑 | widget 高亮 + 剩余数字常显 + request/header 可审计 + README 说明 |
| 想停用 | 数字置 0 即关；完全卸载 = patch 行 + junction 删除 + 重启，settings ns 留档无副作用 |

---

## 12. 实现记录（2026-09-08）

- 落地文件：`plugins/dsh-model-ladder/`（`package.json` / `lib/index.js` host 半 /
  `lib/client.js` client 半 / `README.md` / `tests/smoke.mjs` 离线冒烟）。
- 安装：`scripts/install.sh web --only dsh-model-ladder` 已完成（农场 symlink +
  web profile patch insert 行）；**待重启 dsh server 生效**（与 addons 共用一次重启）。
- 离线冒烟 37 项全绿（fake ctx + HOME 隔离），覆盖 TC-1/2/3/6/7/8/9/10、轮询幂等、
  high 失效→passthrough→恢复、adapters-updated 复验、boost 链、loopback/参数守卫、
  配置持久化回读。运行：`HOME=/tmp/… node plugins/dsh-model-ladder/tests/smoke.mjs`。
- 与 §5 的偏差：widget 无独立 window 控件（↻ 即恢复配置 window；window 改经配置文件
  或 `POST /settings {window}`）；popover 增加"清除 high 槽"项；`highValid=false` 时
  trigger 显示"配对失效"并标红。
- 待重启后在线验收：§9 表中依赖真实 UI/重启的用例（TC-4/5/11 与视觉高亮）。

### 附：本方案引用过的源码位置（复查清单）

- `packages/core/agent/src/model-selection.ts`（意图覆盖监听器全文，75 行，含 effort 剥离）
- `packages/core/agent/src/dispatch.ts:107+`、`runtime-types.ts:166,251`（agent/created、agent/request 的 scoped 语义与 payload 注入）
- `packages/core/agent-loop/src/agent.ts:101`（turnBoundary 投影）、`:264`（turn/start 落盘）、`:478-518`（agent/request → prepareCall → request/header 顺序）
- `packages/core/agent-loop/src/index.ts:702`（setup 收到 `prepared.agent.ctx`——prepend 时序的决定性一环）
- `packages/api/session-controller/src/agent.ts:276-350`（selectionFor/consumeSelection）、`:379-387`（setup 顺序证据）、`:327`（model/selection 落盘点）
- `packages/api/session-controller/src/commands.ts:119-158`（selectModel Remote 全链路）
- `packages/client/ui-model-selection/src/client/index.ts:110-179`、`service.ts`（共享目录服务与 seat 注册先例）
- `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:461-467`（工具行渲染序：left → right → model → ContextMeter）
- `packages/settings/settings/src/index.ts:472`（installSection）
- `vendor/cordis/src/events.ts:78-87,113-118,246-258`（waterfall 最外层获胜 / prepend / 监听器 fiber 归属）
- `docs/cordis-primer.md:12,22,31`（事件模式语义）
- Slots.listSubTree 实查（本 session GUI）：`conversation.input.right` = list/session/none-risk；`conversation.input.model` = single/session/shadows-shipped-ui（v2 不再触碰）
- `@a9i5k4/dsh-anchored-monitor`（`~/.dsh/profiles/web/node_modules/`）：root 平面监听、HTTP 路由、client 轮询、手写法 client bundle 的全部先例；本仓库 `plugins/dsh-web-ui-addons/`：自有插件包格式与 patch install 先例
