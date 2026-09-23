# dsh-model-ladder — 模型高低阶梯自动退化 / High-low model ladder

[English](#english) · [中文](#中文)

## 中文

在 composer 工具行、**原生模型选择器的左边**新增一个小控件；原生选择器完全不改动——
它就是 **low 槽**（阶梯窗口外实际跑什么，就是你在原生选择器里选的模型）。

- **⚡ 下拉**：选择 **high 槽**模型（与内置下拉同款目录，只读目录、独立槽位，不会改你的会话意图）。
- **数字**：本会话剩余 high 轮数（含当前轮）。
  - 输入 N（1–10）→ 立即高 N 轮（当前轮起算）；
  - 输入 0 → 立即关闭 high（下一个请求即 passthrough）；
  - 自然衰减到 0 只发生在轮边界（无人干预时一轮内档位一致；一个 turn 的所有 step 同档）。
- **↻ / ✗**：剩余轮数 ≠ window 时显示 ↻（点击回满窗 window 轮）；恰好等于 window 时显示 ✗（点击归 0 关闭，回到原生所选）；归 0 后又变回 ↻。
- **高亮**：high 生效期间控件以品牌色点亮；一眼可辨当前是否在用高模型。
- **新会话**默认 low（= 原生所选）；仅显式 boost（数字 / ↻ / 选 high 槽模型）才进入 high。
- 在 high 下拉里选模型：当前处于带外时顺手 boost 一个窗口；已在带内则只换模型不动计数。
- **失效与恢复**：high 槽模型变得无法解析（凭据删除、模型下架等）时 chip 变红显示「高模型失效」，
  阶梯自动 passthrough；点开下拉重选一个可解析的模型即恢复。下拉**永远可点开**——目录服务
  暂不可用/加载失败时，菜单内会显示原因与「重试」按钮；选择仍无法解析的模型会给出可见提示，
  不再出现「点了没反应」的静默死状态。

### 如实记账

档位切换发生在 `agent/request` 瀑布最外层（`{ prepend: true }`），**晚于此的
`request/header` 持久事件如实记录实际执行模型**——日志、投影与 UI 状态不会互相矛盾。
注意：`request/header` 如实记录后，会话的 `lastUsed` 会变成实际执行的模型，原生下拉会
跟着它显示为 high 槽模型（high 带期间/之后皆是）。实际执行以本控件高亮与 header 日志
为准。这是「如实记账」的直接后果，见 plan-model-ladder.md v1.1 修订。

### Model Experience（KV-cache / 成本）

- 一个 turn 内所有 step 同档：避免半轮 pro 半轮 flash 造成的上下文重编码撕裂。
- 自动降档后 prompt 前缀的 KV-cache 因模型切换整段失效一次（换模型 = 换 cache 空间），
  这正是「窗口结束才降」的意义：把失效成本固定在轮边界，而不是每次手切。
- high → low 不回写 `model/selection` 持久事件：日志里只有你的真实选择，没有机械噪声。
- low 槽模型上下文窗口小于 transcript 时走现有 compaction 路径，与手选小窗模型一致。

### 安装 / 卸载

由本仓库 `scripts/install.sh` 纳管（农场 junction + web profile patch insert 行），改码后重启 dsh server 生效。
卸载 = 删 patch 行 + junction + 重启；配置残留在 `~/.dsh/model-ladder.json`（可直接删）。

### 配置（`~/.dsh/model-ladder.json`）

```json
{ "window": 3, "high": { "provider": "deepseek", "model": "deepseek-v4-pro" } }
```

`window` 1–10；`high` 为 null 时阶梯整体 passthrough。也可经同源路由
`POST /api/model-ladder/settings` 写（composer 控件就走它）。

## English

Adds one compact control immediately **left of the native model selector** in the composer
tool row. The native selector is untouched — it *is* the **low slot**: outside a high window,
the session runs exactly what you picked there.

- **⚡ dropdown**: pick the **high slot** model (shared catalog, separate slot; it never
  rewrites your session intent).
- **number**: remaining high turns for this session (current turn inclusive). `N` → boost N
  turns from now; `0` → off from the next request; natural decay only happens at turn
  boundaries (one turn, one tier).
- **↻ / ✗**: when remaining ≠ `window`, show ↻ (click → re-arm a fresh `window`); when exactly
  `window`, show ✗ (click → 0, off, back to the native selection); back to ↻ at 0.
- **highlight**: the widget lights up in the brand accent while high is active.
- New sessions default to low (= the native selection); only an explicit boost (number / ↻ /
  picking a high-slot model) enters high.
- Picking a high model while out-of-window also boosts; inside a window it only swaps the model.
- **Invalid & recovery**: when the high route stops resolving the chip turns red ("Invalid") and the
  ladder passes through; reopen the dropdown and pick a resolvable model. The dropdown always opens —
  an unavailable/failed catalog shows its reason and a Retry button inside the menu, and picking a route
  that still cannot resolve is surfaced as a visible error instead of a silent dead click.

Tier switches happen in the outermost `agent/request` waterfall listener (`prepend: true`), so
the durable `request/header` records the model that *actually runs* — logs, projections and
the widget never disagree. Note: once `request/header` has recorded the high model, the
session's `lastUsed` becomes high and the native selector follows it (during and after the
window). The widget highlight and header logs are the source of truth for what actually runs;
see plan-model-ladder.md v1.1 revision.

Switching models invalidates the prompt KV-cache once per boundary; that is exactly why
downgrades are queued to turn boundaries instead of leaking mid-turn.
