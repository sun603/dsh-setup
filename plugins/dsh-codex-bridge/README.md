# dsh-codex-bridge

让**进程外的 agent**(典型:Codex)完整地读写并驱动 **web profile 里活着的 DSH 会话**:
新建会话(立刻出现在 web GUI,实时流式、审批可见)、注入消息、读对话转录、阻塞等待轮次结局、**代 GUI 决定审批与提问**、取消当前轮。

进程外 client 经一个零依赖 stdio MCP server(`mcp/server.mjs`)接入;DSH 侧是常驻 host 插件,提供 loopback HTTP API。

```
Codex ──(stdio MCP)──► mcp/server.mjs ──(HTTP 127.0.0.1:3080)──► dsh-codex-bridge 插件
                                                                      │
                                                                      ▼
                                                        sessionController(web server 进程内)
                                                                      │
                                                                      ▼
                                                        GUI 里可见的活会话(工具/审批/流式)
```

## 为什么不是 `dsh --profile sdk`

SDK(stdio JSON-RPC)是独立进程、独立 agent 注册表:它落地的会话**不会**可靠地出现在 web GUI 的会话列表(实测未写入共享 projection cache),GUI 的实时流也只跟 web server 自己的 agent。SDK 路线适合"不需要 GUI 可见的后台派活";本插件面向"派活的会话我也要在 web GUI 里看着"。

## 组成

| 文件 | 面 | 职责 |
|---|---|---|
| `lib/index.js` | host | 9 个 loopback HTTP 端点;session/workspace 走 `ctx.sessionController`/`ctx.workspaceRegistry`,代决定走 agent 作用域 waterfall listener,唤醒走一轮制 turn/end watcher + `codex queue` |
| `mcp/server.mjs` | 进程外 | 零依赖 stdio MCP server,8 个工具,转发到上面的 HTTP API |
| `tests/smoke.mjs` | 测试 | 假 ctx + 假 controller + 假 agent/waterfall + 假 codex 脚本驱动全部路由、决定中继与唤醒与模型选择(92 项) |
| `tests/mcp-smoke.mjs` | 测试 | stub HTTP + 真实 spawn MCP server 走完整握手与工具调用(35 项) |

运行测试:`node plugins/dsh-codex-bridge/tests/smoke.mjs && node plugins/dsh-codex-bridge/tests/mcp-smoke.mjs`

## HTTP 端点(插件)

全部仅 loopback;配置了 token 时除 `/health` 外都要求 `Authorization: Bearer <token>`(或 `X-Codex-Bridge-Token` 头)。

| 方法/路径 |  body / query | 响应 |
|---|---|---|
| `GET /api/codex-bridge/health` | — | `{ok, plugin, controller}` |
| `POST /api/codex-bridge/prompt` | `{text, sessionId?, cwd?, agentPreset?, mode?, threadId?, model?}` | `{sessionId, created, accepted, cwd?, grouped?, wakeArmed?}`;无 sessionId 先新建(并挂进匹配 cwd 的 workspace 分组);`mode=steer` 插话当前轮,默认 `queue` 排队;带 `threadId` = 一轮制唤醒绑定(见「唤醒」节) |
| `GET /api/codex-bridge/models` | — | `{default, routableProviders, groups:[{id,name,models:[{id,name,description?,reasoning?}]}], failures}`——当前可路由模型清单 + 部署默认 |
| `GET /api/codex-bridge/sessions` | — | `{sessions:[{sessionId, updatedAt, running, blank, cwd, parentSessionId, origin}]}` |
| `GET /api/codex-bridge/history` | `sessionId`, `maxMessages?`, `afterSeq?`, `includeThinking?` | `{sessionId, title, cursor, latestSeq, hasMore, messages:[{role,text,seq,time}]}`;转录含 tool-call/tool-result 摘要行;`afterSeq` 只回 seq 更大的消息(增量),`latestSeq` 是下次的 `afterSeq` |
| `GET /api/codex-bridge/wait` | `sessionId`, `waitSec?`(默认 45,上限 600), `afterSeq?`, `detail?`(`final` 默认 / `all`), `onDecision?`(`return` 默认 / `hold`), `includeThinking?` | 长轮询:`{sessionId, reason, latestSeq, digest, decision?, approval?, pending?, decisions?, final?, messages?}`;`reason` = `turn-end`(一轮结束)/ `decision`(有待决定事项,带 decisionId 与完整上下文)/ `approval`(有待审批且本插件未接管决定权)/ `timeout`。**一个 turn 只回一次**:`detail=final` 给一行 digest(步数/工具调用/中间文本量)+ 最后一条 assistant 文本;`detail=all` 才给全部过程消息 |
| `POST /api/codex-bridge/decide` | `{sessionId, decisionId?, allow?\|selected?\|custom?\|answers?}` | 代 GUI 做决定:审批 `allow:true/false` → `allowed-once/rejected`;提问 `selected`(选项标签)/ `custom`(自由文本)/ `answers`(多问题)。与人类 GUI 竞速,先到先得 |
| `POST /api/codex-bridge/adopt` | `{sessionId, cwd?}` | 把已有会话收编进匹配其 cwd 的 workspace 分组(补救落「未分组」的会话);`cwd` 缺省从会话反查 |
| `POST /api/codex-bridge/cancel` | `{sessionId}` | `{sessionId, accepted}` 取消当前轮 |

`/history` 用 `sessionController.follow()` 的 opening snapshot 取窗口,不解析会话文件;更早的历史靠调大 `maxMessages`。

## 降噪与增量读

**降噪(默认已做)**:follow snapshot 里每会话几十种事件,转录只保留三类——`user/message`、`assistant/message`、`session/title`;工具调用压成 `[tool-call xxx]` / `[tool-result]` 单行摘要;`reasoning`(thinking)文本**默认丢弃**(它是转录里最主要的噪音源),需要时传 `includeThinking=true`。

**增量读**:响应头带 `latestSeq`(= 快照的日志游标),每条消息带 `seq`。轮询一个会话时:

```
dsh_history(sessionId)                    → 头:[latestSeq=137] …首屏消息
dsh_history(sessionId, afterSeq=137)      → (3 new since seq 137) 只回新增
dsh_history(sessionId, afterSeq=最新值)    → (nothing new) 无新增
```

注意 `afterSeq` 是在**快照窗口内**过滤:若两次读取之间新增超过 `maxMessages` 条,窗口已滑走的部分补不回来(响应带 `[window truncated]` 提示)——长时间不读的会话要么调大 `maxMessages`,要么接受截断。

## 等待式通知 + 代决定(替代轮询)

MCP 工具是请求/响应,服务端没有"推"的通道——所以用**长轮询**把事件本身作为工具结果送回来。**一个 turn 只返回一条汇总**,不是每步都响:

```
dsh_prompt({text:"…"})          → 立即返回 sessionId(消息已入队)
dsh_wait({sessionId})           → 阻塞到下面四种结局之一,每次只回一条:
   TURN ENDED [latestSeq=180]
   19 steps · 17 tool calls (run_code×17, todo_write×1) · 4.8k chars intermediate
   --- final message ---
   <该 turn 最后一条 assistant 文本>
   DECISION PENDING (approval) … tool "bash" — podman 需要 full-access
     decisionId=… → codex 自己 dsh_decide{allow:true|false},或让用户去 GUI 点,再 dsh_wait
   DECISION PENDING (question) … Q[q1]: 用哪个方案? options: A | B
     decisionId=… → dsh_decide{selected:"A"} / {custom:"…"} / {answers:[…]}
   TIMEOUT after 45s …          这个窗口内没有 turn 结束(再调,不要结束回合去"等")
```

### 代决定的机制与安全姿态

- dsh 的审批/提问决定通道是 **agent 作用域的 waterfall**(`approval/request` / `user-questions/request`),GUI 只是其中一个 listener。本插件在 `agent/created` 时 prepend 自己的 listener:
  - `control.approvals` / `control.questions` **关着**(默认)→ 直接 `next()`,行为与从前完全一样(只有人类能决定)
  - 开着 → 登记 pending(带 decisionId + 完整上下文),然后 **`Promise.race([next(), 等 codex 决定])`**——人类 GUI 始终在赛道上,**先到先得**,codex 锁不死人类
- `/decide` 落到 pending 上:审批返回 `allowed-once`/`rejected`;提问返回 `{answers:[{id, selected[], custom?}]}`
- 审计:`approval/asked` + `approval/decided` 成对会话事件照写(结果在内;决定者身份不记是 dsh 固有限制),插件每次代决定另打服务端日志
- `dsh_wait` 的 `onDecision`:`return`(默认)一有待决定事项就返回叫 codex 去决;`hold` 握着直到 turn 结束、把经过的决定写进结果(适合"让用户去点,我等结果"的场景)
- 已实现的其余部分:`/wait` 开着 `sessionController.follow()` 流,`turn/end`/`approval/asked`/`approval/decided` 等持久事件 + pending 注册表共同驱动;超时由 `AbortController` 收口,响应保证发出

为什么不用 MCP 通知(`notifications/message` 等):codex 的模型只在自己的 turn 内行动, turn 外到达的通知被客户端排队、模型看不到;而长轮询把事件**放进工具结果**,模型一次调用醒来就直接看到"该批审批了/活干完了"。

代价:一次 `dsh_wait` 占用一个 HTTP 连接最多 `waitSec` 秒(默认 45,上限 600);并发多个会话等待就是多条连接,宿主机本地无压力。

## 模型选择

`create()` 不接受模型——模型是 session 级的 `selectModel`(持久,影响后续轮次)。桥接层的用法:

- `dsh_models`:透出 `sessionController.modelCatalog()`(provider 分组 + 部署默认 + 加载失败的 provider)
- 三级优先级:**显式 `model` 参数** > `defaultModel`(仅新建会话)> 部署默认
- `dsh_prompt` 的 `model` 参数(可选;不传时新建会话走 `defaultModel`,已有会话保持自己的模型):
  - 紧凑串 `"aigw/deepseek-v4.1-flash"`(按**第一个** `/` 拆 provider/model,兼容 model 名里带 `/` 的 provider)
  - 对象 `{provider, model, reasoningEffort?}`(reasoningEffort 仅模型支持时有效)
- 执行顺序:`create`(或选定 session)→ `selectModel` → `prompt`,本轮即用新模型;`selectModel` 失败时**不派活**(400/500 原样透出,不静默用默认模型搪塞)
- 响应回显 `model:{provider, model}`,codex 可确认生效
- 预设(agent persona / permission bundle)**不暴露**:会话一律用部署默认,要改用户在 GUI 改

## 唤醒(DSH turn 结束 → codex 自动接手)

上面的长轮询要求 codex **待在调用里**;而 codex 的 MCP 客户端约 300 秒会切断工具调用,长任务就被动陷入"超时→重等"循环。唤醒机制把完成事件**推出请求生命周期**:

```
codex:dsh_prompt{text, threadId:自己的 threadId} → 结束回合去等
桥插件:为该会话武装**一轮制** watcher(follow 流盯 turn/end)
DSH turn 结束 → 插件 spawn:codex queue --thread <threadId>
  --message "[DSH turn finished] session=… latestSeq=…. Read this turn result with dsh_history(sessionId) and continue"
→ 绑定自动释放 → codex 线程收到队列消息,自行开新 turn → 接手
```

**决定也唤醒**(审批/提问阻塞 = turn 停着等人,同样是“该回来动手”的时刻):

```
DSH 卡在审批/提问 → registerDecision 登记 pending 的同时(不 await,fire-and-forget)
  → codex queue --message "[DSH decision pending] session=… decisionId=… kind=approval tool=… reason=…"
    (提问则带问题与选项;指令:授权范围内 dsh_decide,否则交用户在 GUI 决)
→ codex 醒来代决/移交 → 绑定**不释放**,watcher 继续盯到 turn/end → 收尾唤醒后才解绑
```

一轮里有 N 次决定 = **N+1 次唤醒**(N 次决定 + 1 次收尾)。决定唤醒只在 `control.*` 开着时发生(监听器登记 pending 才可能被叫),且 `wake.enabled` 开着、该会话有绑定;消息带“若你已从 dsh_wait 拿到同一决定,忽略此消息”防双通知。

- **实测依据**(2026-09-22):往 Desktop 里开着的线程 queue 一条探针,线程自行醒来并回复;往 8 小时前的旧线程 queue 则只入队不消费——**唤醒只对"打开着的"线程成立**,关掉的会话要在 Desktop 里重新打开才会消费队列
- 配置 `wake.enabled`(默认 **false**,`~/.dsh/codex-bridge.json` 热加载);`wake.codexBin` 默认 `codex`(PATH 解析)
- **一轮一绑**:threadId 随某一次 prompt 传入,只对这一轮生效;**收尾唤醒后**绑定自动解除(期间的决定唤醒不解除),下一轮要唤醒需在下次 prompt 里再传。没有独立的绑定/解绑工具——不传就是没有通知;会话已在跑时想补唤醒,随下一条 prompt 带上 threadId 即可(新 watcher 顶掉旧的)
- 绑定是**内存态且一轮即弃**:dsh server 重启自然清空,无需解绑;watcher 兜底 120 分钟自杀(超过此时长的 turn 收不到唤醒,v1 限制)
- 唤醒消息与 `dsh_wait` 结果可能同时到(代码在 wait 里、turn 结束了):消息里已写明"若已从 dsh_wait 拿到同一 turn 结果,忽略此消息"
- 未定方向(未实现):app-server 协议的 `Turn/start` 是更原生的唤醒入口,但 CLI proxy 连不上 Desktop 持有的控制 socket;`codex queue` 是当前唯一验证可用的外部推送通道

## 配置(`~/.dsh/codex-bridge.json`)

```json
{
  "token": "换成一串随机值",
  "defaultCwd": "",
  "defaultAgentPreset": "",
  "defaultModel": "aigw/deepseek-v4.1-flash",
  "control": { "approvals": false, "questions": false },
  "wake": { "enabled": false, "codexBin": "codex" }
}
```

- `token`:空 = 仅 loopback 保护(启动时 stderr 警告);非空 = 所有端点(除 `/health`)要求 Bearer。
- `defaultCwd`:**兜底值**。正常路径用不到——codex 侧由 MCP server 自动带上自己的工作目录(见下);只有直接打 HTTP 且不带 `cwd` 时才落到这个值,空 = 用服务端默认工作区。
- `defaultModel`:**新建会话的默认模型**(紧凑串或对象,同 `dsh_prompt` 的 `model` 参数)。仅在 `dsh_prompt` 未带 `sessionId`(新建)且未显式传 `model` 时生效;**绝不作用于已有会话**(那等于偷改别人会话的模型);显式 `model` 永远压过它。热加载。
- `defaultAgentPreset`:新建会话默认挂的 agent preset 名(空 = 服务端默认)。
- `control.approvals` / `control.questions`:**代决定授权,默认全关**(= 审批/提问仍只由人类在 GUI 处理)。开哪个,codex 才能经 `dsh_decide` 决定哪个通道;人类 GUI 始终与 codex 竞速,先到先得。
- `wake.enabled` / `wake.codexBin`:**唤醒开关,默认关**。开着且 codex 的 `dsh_prompt` 带了 `threadId`,该轮结束才会往这个线程 queue 唤醒消息(一轮制);`codexBin` 是 `codex` 可执行名/路径。

### 目录匹配(默认行为)

codex spawn MCP 子进程时**继承其当前工作目录**(本机实测两次确认:`codex exec` 在哪个目录跑,探针打出的 cwd 就是哪个目录)。因此:

- `dsh_prompt` 不带 `sessionId` 时,MCP server 把 `process.cwd()` 作为 `cwd` 传给插件 → **dsh 新会话的工作目录 = codex 当前工作目录**;
- 插件再把 `cwd` 解析成 `workspaceId`(`workspaceRegistry.resolveByPath`,未注册则按需 `create`)传给 `sessionController.create`——**只有传 workspaceId,会话才会挂进 GUI sidebar 的对应分组**;只传 cwd 会落进「未分组」(2026-09-21 实测踩中:session-586b922c 就是这么落错的);
- 已经落错的会话用 `dsh_adopt` 补救(幂等,校验会话 cwd 与 workspace 路径一致后才收编);
- 传了 `cwd` 参数则以传入值为准;
- 注入已有会话(`sessionId`)时不涉及 cwd(会话目录早已确定)。

codex 不把父进程的任意环境变量传给 MCP 子进程(只保留 PATH/HOME 等并在 config.toml `env` 表里追加),所以 `DSH_BRIDGE_URL`/`DSH_BRIDGE_TOKEN` 必须写在 config.toml 的 `env` 表内——当前配置正是如此。

改配置**即时生效**(每个请求处理前重读文件;解析失败时保留上一份好配置,不会把 token 冲掉)。

## MCP 工具(Codex 侧)

| 工具 | 参数 | 行为 |
|---|---|---|
| `dsh_models` | — | 列出可路由模型(provider 分组)+ 部署默认;给 `dsh_prompt` 的 `model` 参数选合法值 |
| `dsh_sessions` | — | 列 GUI 可见会话(RUNNING/idle、cwd、更新时间) |
| `dsh_history` | `sessionId`, `maxMessages?`, `afterSeq?`, `includeThinking?` | 读转录;`hasMore` 为真时调大 `maxMessages`;传 `afterSeq`(上次的 `latestSeq`)只读新增 |
| `dsh_prompt` | `text`, `sessionId?`, `cwd?`, `mode?`, `threadId?`, `model?` | 无 sessionId = 新建(返回新 id;目录默认 = codex 当前目录，并挂进对应 workspace 分组);有 = 注入(`queue` 默认 / `steer`);带 `threadId` = 这一轮结束自动唤醒本线程(一轮制) |
| `dsh_wait` | `sessionId`, `waitSec?`, `afterSeq?`, `detail?`, `onDecision?`, `includeThinking?` | **阻塞等待,一个 turn 返回一条汇总**:digest + 最后一条消息;四种结局 TURN ENDED / DECISION PENDING(审批或提问,带 decisionId)/ APPROVAL PENDING(未接管决定权时)/ TIMEOUT。派活后的标准后续动作 |
| `dsh_decide` | `sessionId`, `decisionId?`, `allow?\|selected?\|custom?\|answers?` | 代 GUI 决定:审批 allow 允许/拒绝;提问 selected 选项 / custom 自由文本 / answers 多问题。与人类竞速,先到先得 |
| `dsh_adopt` | `sessionId`, `cwd?` | 把落「未分组」的已有会话收编进匹配目录的 workspace 分组 |
| `dsh_cancel` | `sessionId` | 取消当前轮 |

`dsh_prompt` 在消息**入队后立即返回**;agent 仍在跑。标准后续是 `dsh_wait`(阻塞到结局),只在想手动控制节奏时才用 `dsh_history` 增量轮询。

## 接入 Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.dsh]
command = "node"
args = ["<dsh-setup 仓库根目录的绝对路径>/plugins/dsh-codex-bridge/mcp/server.mjs"]
env = { DSH_BRIDGE_URL = "http://127.0.0.1:3080", DSH_BRIDGE_TOKEN = "与 ~/.dsh/codex-bridge.json 一致" }
```

`DSH_BRIDGE_URL` / `DSH_BRIDGE_TOKEN` 可省略(默认 `http://127.0.0.1:3080` / 空)。

## 安装(本机)

1. 注册到 web profile(农场 junction + patch insert 行):跑仓库 `scripts/install.sh`(它会自动做这两步),或手动:
   ```bash
   ln -s "$PWD/plugins/dsh-codex-bridge" ~/.dsh/profiles/node_modules/dsh-codex-bridge   # 在仓库根目录执行
   ```
   并在 `~/.dsh/profiles/web/cordis.patch.yml` 加:
   ```yaml
   - insert:
       - id: dsh-codex-bridge
         name: dsh-codex-bridge
   ```
2. `dsh --profile web --dump-config` 复验(EXIT=0、组合结果含本插件)。
3. **重启 dsh server**(web profile 的 HMR 默认禁用;重启会中断当前会话,挑时机手动执行)。
4. 生效验证:`curl http://127.0.0.1:3080/api/codex-bridge/health` → `{"ok":true,...}`。

## 已知边界

- 只面向 web profile(依赖 `sessionController`);其它 profile 下路由会答 503。
- `/prompt` 的 `sessionId` 语义:给了就必须已存在(持久化即可,冷会话会自动恢复);不存在时不会悄悄新建,而是报错——要新建请省略 `sessionId`。
- 会话标题由 DSH 正常的首 prompt LLM 标题流程生成,插件不干预。
- 本插件不碰 `dsh-webhook`(那条路只能建新根会话、不能驱动指定会话)。
- **代决定的 waterfall 顺序已实测验证**(2026-09-21):插件在 `agent.ctx` 上 prepend 的 listener 抢在 GUI 转发器之前——真实审批场景中 GUI 无人点击,`dsh_decide` 直接放行、工具调用继续、turn 正常结束;审计对(approval/asked + approval/decided)正常落盘。
- 已挂起的审批/提问(插件上线前就卡住的)不受影响,仍需人类在 GUI 处理;代决定只对上线后新发起的请求生效。
- 会话级模型切换、权限 preset 切换、fork/重命名等 GUI 控制面**尚未**接入(T2,各是一个端点+一个工具)。
