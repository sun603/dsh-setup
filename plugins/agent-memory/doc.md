# agent-memory — 设计文档(占位,未实现)

> 状态:**仅设计,未实现、未注册、未部署**。本文件是最终实现与部署的唯一依据。
> 目标:给 DSH web profile 加 codex / claude code 风格的跨会话记忆机制 ——
> 纯静态 host 插件、无专用模型工具、prompt 引导模型用现有文件工具读写 markdown 记忆,
> 另带一个 LLM 提炼进程(手动命令 + 会话结束自动)。

## 1. 总体形态

- 目录:`plugins/agent-memory/`,纯 host 端(无 client UI)。
- 注册:`~/.dsh/profiles/web/cordis.patch.yml` 加一行 + 模块农场 junction;重启 dsh server 生效。
- 核心机制:
  1. **注入**:`systemPrompt.section` + 4 个 `systemPrompt.variable`,把两级记忆的「已解析路径 + MEMORY.md 索引」注入 system prompt;全文不注入,细节文件模型按需 read。
  2. **直接写**:不注册 memory 专用工具,模型用 read/write/edit/grep 直接维护记忆目录,prompt 里定写入规矩。
  3. **提炼进程**:补充性扫尾 —— 读最近会话转录,LLM 提炼模型漏记的内容、合并重复、压缩索引;以结构化操作(JSON ops)产出,插件校验后落盘。

## 2. 存储布局(全部在 `~/.dsh/memory/`,不进工作区)

```
~/.dsh/memory/
  global/
    MEMORY.md                 # 索引:一行一条摘要 → 细节文件名
    <topic>.md                # 细节文件,一个主题一个文件
  projects/
    <basename-slug>--<8位路径hash>/   # 如 dsh-setup--3f9a1c2e
      MEMORY.md
      <topic>.md
  distill-state.json          # 提炼水位线:lastRun + 已处理 sessionId 列表
```

- 项目目录映射:`slug(basename)` + `--` + 规范化路径(统一 `/`、小写)SHA-256 前 8 位,避免同名目录碰撞。
- 两级记忆集中 `~/.dsh` 下,整体清理删一个目录;天然跨 profile 共享(视为特性)。
- 开关关闭只停注入/引导,**不删已有文件**。

## 3. 配置(DSH `settings` 服务,命名空间 `agentMemory`)

| 字段 | 默认 | 说明 |
|---|---|---|
| `enableGlobal` | `true` | 注入并引导使用全局记忆 |
| `enableProject` | `true` | 注入并引导使用项目记忆 |
| `maxIndexLines` | `150` | 每级索引注入截断行数,超出附截断标记 |
| `autoDistill` | `false` | 会话结束自动提炼(有 token 成本,先手动体验) |
| `distillModel` | `""`(跟随默认模型) | 提炼专用模型,可用便宜模型 |
| `maxSessionsPerRun` | `5` | 单次提炼最多处理的会话数 |

## 4. Prompt 注入

注册一个 section(`name: "agent-memory"`,order ≈ 150,排在工具说明之后),text 固定,
引用 4 个 variable(同步 provider,mtime 缓存,读失败静默降级为占位串 —— 注意 render 是 strict 的,
registered-but-valueless 会 throw,所以 provider **永远返回字符串**):

| variable | 内容 |
|---|---|
| `memory_global_path` | `~/.dsh/memory/global` 绝对路径;`enableGlobal=false` → "disabled by config" |
| `memory_project_path` | 按 assemble 上下文 agent cwd 映射出的项目记忆绝对路径;关闭同理占位 |
| `memory_global_index` | 全局 MEMORY.md 前 maxIndexLines 行;无文件/为空 → "(empty)" |
| `memory_project_index` | 同上,项目级 |

section 模板(codex 风格使用手册,内容为设计稿,实现时可微调措辞):

```
## Memory

You have persistent memory from prior sessions.
- Global memory: {{memory_global_path}}
- Project memory: {{memory_project_path}}

{{memory_global_index}}
{{memory_project_index}}

### When to use memory
- Skip ONLY for clearly self-contained requests (current time, simple
  translation, one-line command, trivial formatting).
- Use by default when the query touches this workspace's history,
  conventions, prior decisions, or is ambiguous and non-trivial.
- If unsure, do a quick memory pass.

### Quick memory pass (budget: <= 4-6 file operations)
1. Skim the indexes above for task-relevant entries.
2. grep MEMORY.md with those keywords if the index is long.
3. Read only the 1-2 most relevant topic files; stop if no hits.

### Staleness
Facts from memory that you did not re-verify this turn: say they are
memory-derived and may be stale; offer to refresh when useful.

### Writing memory
- Record: durable user preferences, project conventions, hard-won
  pitfalls and fixes, key decisions.
- Skip: secrets/credentials, ephemeral task state, anything already in
  AGENTS.md files.
- How: use write/edit tools directly. One topic per detail file; after
  writing, add or replace its one-line entry in MEMORY.md so the index
  always matches the files. Keep index lines under ~120 chars.
```

- 索引变化只影响 variable 值,assembly 每步重渲染 —— 记忆更新后下一步即生效;
  代价是记忆变化时前缀缓存失效(频率低,可接受)。
- 两级都关且无内容 → 段落收缩为最小骨架,保证渲染稳定。

## 5. 提炼进程(混合式,不照搬 codex)

codex 是「模型只写暂存便签,提炼进程独占写 MEMORY.md」,代价是写完不能马上用。
本方案反过来:**直接写保持即时生效;提炼进程只做补充扫尾** —— 它挂了、关了,基础功能不受影响。

### 数据流

```
触发(/memory-distill 命令 / agent/disposed 自动)
  → 收集输入:
     a. 上次提炼后新增/修改的会话(sessionQuery,水位线去重,封顶 maxSessionsPerRun)
     b. 当前 MEMORY.md 索引 + 细节文件列表
  → LLM 调用(llm.stream;提炼 prompt;转录只取 user/assistant 文本,
     丢 tool 输出,封顶 ~20k token)
  → LLM 返回 JSON 操作集(不让它直接写文件):
     [{op:"upsert", scope, topic, indexLine, content?}, {op:"remove", scope, topic}]
  → 插件校验并落盘:路径白名单、单文件大小上限、索引同步、原子写
  → 成功后推进水位线 distill-state.json;失败记日志、下次重跑
```

### 触发

- `/memory-distill`:`commands.register` 手动命令,必有。
- 自动:监听 `agent/disposed`,30 秒防抖合并多次触发,受 `autoDistill` 开关控制(默认关)。

### 模型

默认 `agentDefaultModel.currentSelection()`;`distillModel` 可覆盖。

## 6. 实现文件规划

```
plugins/agent-memory/
  doc.md            # 本文件
  package.json      # 按仓库规范(host-only,无 ./client、无 dsh.client 字段)
  lib/
    index.js        # apply:settings 注册、路径映射、索引缓存、section + 4 variables
    distill.js      # 水位线、sessionQuery 拉会话、LLM 调用、JSON ops 校验落盘、命令注册
```

- 依赖只用 node 内置模块(`fs`/`path`/`crypto`/`os`);服务一律 `ctx.get(...)` 可选获取,
  缺 `settings`/`systemPrompt` 时打日志静默退出,不 inject 硬依赖。
- DSH_HOME 解析:`process.env.DSH_HOME || join(os.homedir(), '.dsh')`。

## 7. 注册与部署(实现后)

1. junction:`~/.dsh/profiles/node_modules/agent-memory` → 本目录。
2. `~/.dsh/profiles/web/cordis.patch.yml` 加 `- insert: [{ id: agent-memory, name: agent-memory }]`。
3. 重启 dsh server 生效(改代码同样只需重启,junction 直链源码)。

## 8. 验证清单(实现后)

1. 新开会话,system prompt 含 `## Memory` 段。
2. 「记住:本项目 maven 用 Java 17」→ 生成 `projects/<key>/MEMORY.md` + 细节文件,索引同步。
3. 新会话问相关历史 → 模型按 quick pass 读到记忆,未验证时声明来源。
4. 关 `enableProject` → 项目段收缩、文件保留;再开 → 恢复。
5. `maxIndexLines: 3` → 索引截断 + 省略标记。
6. 手改 MEMORY.md → 下一步 assembly 反映新内容(mtime 缓存失效正确)。
7. `/memory-distill` → 提炼产出 ops 落盘,水位线推进;开 `autoDistill` 后会话结束自动触发且防抖生效。
8. 提炼失败(模型不可用)→ 水位线不推进、不影响会话、日志可查。

## 9. 明确不做

- 无 memory_save / memory_forget 等专用模型工具(已论证:价值薄,路径解析可由 prompt 注入替代)。
- 无 client 端 UI 面板。
- 无 codex 式 rollout 归档搜索(依赖它的离线管道,我们没有)。
- 不做写入暂存区(notes)模式;将来若改独占式提炼,prompt 改一段即可,存储布局不变。

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 模型不主动写记忆 | section 写入规矩写明确;实测不行再加强指令 |
| 索引与文件漂移 | prompt 要求「更新即同步索引」;提炼进程顺手校验 |
| 索引膨胀 | maxIndexLines 截断;写入规矩限行长;提炼进程压缩 |
| variable provider 同步读文件慢 | mtime 缓存,命中零 I/O;文件都很小 |
| 提炼烧 token | autoDistill 默认关;maxSessionsPerRun 封顶;可用便宜模型 |
| LLM 提炼出垃圾/泄密 | ops 校验落盘;提炼 prompt 禁止记录凭证、强调宁缺毋滥;MEMORY.md 可手改 |
| 提炼中途失败 | 水位线只在成功后推进;失败静默记日志不打断会话 |
