/**
 * dsh-codex-bridge — host half(零运行时依赖,仅 node 内置模块)。
 *
 * 把 web profile 里**活着的** session controller 以 loopback HTTP 暴露出来,
 * 让进程外的 agent(典型:Codex,经 mcp/server.mjs 这个零依赖 stdio MCP server)
 * 能够:
 *
 *   POST /api/codex-bridge/sessions        新建会话(落在 web server 进程内 →
 *                                           GUI sidebar 出现、实时流式、审批全可见)
 *   POST /api/codex-bridge/prompt          注入消息(无 sessionId 先新建;
 *                                           mode=queue 排队 / steer 插话当前轮)
 *   GET  /api/codex-bridge/sessions        列会话(running/cwd/标题)
 *   GET  /api/codex-bridge/history         读对话(follow opening snapshot → 文本转录)
 *   GET  /api/codex-bridge/wait            长轮询:一个 turn 一条汇总 / 需要决定时通知
 *   POST /api/codex-bridge/decide          代 GUI 做决定:审批允许/拒绝、回答提问
 *                                        (唤醒:/prompt 带 threadId,一轮一绑自动解绑)
 *   POST /api/codex-bridge/adopt           收编落「未分组」的会话
 *   POST /api/codex-bridge/cancel          取消当前轮
 *
 * 与 `dsh --profile sdk`(独立进程 SDK)的分工:那条路适合"不需要 GUI 可见的
 * 后台派活";本插件面向"派活的会话我也要在 web GUI 里看着"。
 *
 * 安全:仅 loopback;配置了 token 时所有端点(除 /health)要求 Bearer。
 * 配置 ~/.dsh/codex-bridge.json(缺省全部为空 = loopback 无鉴权 + 不代决定):
 *   { "token": "", "defaultCwd": "", "defaultAgentPreset": "",
 *     "control": { "approvals": false, "questions": false } }
 *
 * control 两个开关控制"代 GUI 决定"的授权(默认关 = 审批/提问仍只由人类在 GUI 处理):
 * 开着时,插件在对应 agent 的 `approval/request` / `user-questions/request`
 * waterfall 上 prepend 监听,把决定权交给 codex(经 /decide),与人类 GUI 竞速
 * (next() 保留,先到先得——人类永远能接管)。
 */

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** Stable cordis plugin name(与 cordis.patch.yml insert id 一致)。 */
export const name = 'dsh-codex-bridge'

/** 挂载所需服务(web profile 常驻;缺失时路由仍在但处理器答 503,不拖死加载)。 */
export const inject = ['webServer']

const API = '/api/codex-bridge'
const MAX_HISTORY_MESSAGES = 200
const DEFAULT_HISTORY_MESSAGES = 60
const DEFAULT_WAIT_SEC = 45
const MAX_WAIT_SEC = 600

// ---------------------------------------------------------------------------
// 配置(~/.dsh/codex-bridge.json,anchored-monitor / model-ladder 同款通道)
// ---------------------------------------------------------------------------

/** @type {{ token: string, defaultCwd: string, defaultAgentPreset: string, defaultModel?: string | { provider: string, model: string, reasoningEffort?: string }, control: { approvals: boolean, questions: boolean }, wake: { enabled: boolean, codexBin: string } }} */
let cfg = { token: '', defaultCwd: '', defaultAgentPreset: '', control: { approvals: false, questions: false }, wake: { enabled: false, codexBin: 'codex' } }
let configReady = loadConfig()

function dshHome() {
  const env = process.env.DSH_HOME
  return env && env.trim() !== '' ? env : path.join(homedir(), '.dsh')
}

function configPath() {
  return path.join(dshHome(), 'codex-bridge.json')
}

let everLoaded = false

async function loadConfig() {
  let loaded = null
  try {
    const raw = await readFile(configPath(), 'utf8')
    const parsed = JSON.parse(raw)
    const control = parsed.control && typeof parsed.control === 'object' ? parsed.control : {}
    const wake = parsed.wake && typeof parsed.wake === 'object' ? parsed.wake : {}
    const dm = parsed.defaultModel
    const defaultModel =
      typeof dm === 'string' && dm.trim() !== ''
        ? dm
        : dm !== null && typeof dm === 'object' && String(dm.provider ?? '') !== '' && String(dm.model ?? '') !== ''
          ? dm
          : undefined
    loaded = {
      token: typeof parsed.token === 'string' ? parsed.token : '',
      defaultCwd: typeof parsed.defaultCwd === 'string' ? parsed.defaultCwd : '',
      defaultAgentPreset: typeof parsed.defaultAgentPreset === 'string' ? parsed.defaultAgentPreset : '',
      ...(defaultModel === undefined ? {} : { defaultModel }),
      control: {
        approvals: control.approvals === true,
        questions: control.questions === true,
      },
      wake: {
        enabled: wake.enabled === true,
        codexBin: typeof wake.codexBin === 'string' && wake.codexBin !== '' ? wake.codexBin : 'codex',
      },
    }
  } catch {
    loaded = null
  }
  if (loaded !== null) {
    cfg = loaded
    everLoaded = true
  } else if (!everLoaded) {
    // 首次就读不到(文件不存在/写坏):回落默认值
    cfg = { token: '', defaultCwd: '', defaultAgentPreset: '', control: { approvals: false, questions: false }, wake: { enabled: false, codexBin: 'codex' } }
    console.warn('[codex-bridge] 配置读取失败,使用默认值(无 token = 仅 loopback 保护):' + configPath())
  } else {
    // 热重载途中写坏:保留上一份好配置,不冲掉 token/开关
    console.warn('[codex-bridge] 配置解析失败,保留上一份配置:' + configPath())
  }
  if (cfg.token === '') {
    console.warn('[codex-bridge] 未配置 token:端点仅受 loopback 保护。')
  }
}

async function saveConfig() {
  try {
    await mkdir(dshHome(), { recursive: true })
    await writeFile(configPath(), JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 })
  } catch (err) {
    console.warn('[codex-bridge] 配置写入失败: ' + String((err && err.message) || err))
  }
}

// ---------------------------------------------------------------------------
// 决定中继:审批 / 提问 的 pending 注册表 + /wait 唤醒
// ---------------------------------------------------------------------------

/**
 * pending 决定:kind=approval 的 outcome 是 'allowed-once'|'rejected';
 * kind=question 的 outcome 是 {answers:[{id, selected[], custom?}]}。
 * @type {Map<string, { decisionId: string, kind: string, sessionId: string, createdAt: number, resolve: (v: unknown) => void, meta: object }>}
 */
const pendingDecisions = new Map()
/** sessionId → 该会话活跃 /wait 的唤醒回调(return 模式用)。 */
const waitNotifiers = new Map()

function subscribeWait(sessionId, cb) {
  let set = waitNotifiers.get(sessionId)
  if (set === undefined) {
    set = new Set()
    waitNotifiers.set(sessionId, set)
  }
  set.add(cb)
  return () => {
    set.delete(cb)
    if (set.size === 0) waitNotifiers.delete(sessionId)
  }
}

/** 供 /wait 与 /decide 共用的 pending 视图(只含可安全 JSON 化的字段)。 */
function decisionView(entry) {
  if (entry === undefined) return undefined
  const { decisionId, kind, sessionId, createdAt, meta } = entry
  return { decisionId, kind, sessionId, createdAt, ...meta }
}

/**
 * 登记一条待决定事项(由 approval/request、user-questions/request 监听器调用)。
 * 同时唤醒该会话上 return 模式的 /wait。
 */
function registerDecision(sessionId, kind, meta) {
  const decisionId = randomUUID()
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  const entry = { decisionId, kind, sessionId, createdAt: Date.now(), resolve, meta }
  pendingDecisions.set(decisionId, entry)
  const notifiers = waitNotifiers.get(sessionId)
  if (notifiers !== undefined) {
    const note = { type: 'register', view: decisionView(entry) }
    for (const cb of notifiers) cb(note)
  }
  // 唤醒模式:决定时刻也把 codex 叫回来(审批/提问阻塞 = turn 停着等人)。
  // fire-and-forget——不能拖住下面 Promise.race 里人类抢先的机会;
  // 绑定不释放:watcher 继续盯到 turn/end,收尾唤醒后才自动解绑。
  if (cfg.wake.enabled) {
    const threadId = threadBindings.get(sessionId)
    if (threadId !== undefined) void notifyThread(threadId, decisionWakeText(sessionId, kind, decisionId, meta))
  }
  return { decisionId, promise }
}

/** 决定落定(无论由 codex 还是人类)后,通知 hold 模式的 /wait 记账。 */
function noteDecisionOutcome(sessionId, decisionId, outcome) {
  const notifiers = waitNotifiers.get(sessionId)
  if (notifiers === undefined) return
  const note = { type: 'outcome', decisionId, outcome: typeof outcome === 'string' ? outcome : 'answered' }
  for (const cb of notifiers) cb(note)
}

/** codex(或任何调用方)作出决定;返回 false 表示没有这条 pending(已决/已撤)。 */
function resolveDecision(decisionId, outcome) {
  const entry = pendingDecisions.get(decisionId)
  if (entry === undefined) return false
  pendingDecisions.delete(decisionId)
  entry.resolve(outcome)
  return true
}

/** 撤条但不决(人类已答 / 请求被取消);之后同 id 的 /decide 自然落空。 */
function dropDecision(decisionId) {
  return pendingDecisions.delete(decisionId)
}

function pendingForSession(sessionId) {
  const out = []
  for (const entry of pendingDecisions.values()) {
    if (entry.sessionId === sessionId) out.push(decisionView(entry))
  }
  return out
}

// ---------------------------------------------------------------------------
// 唤醒(Codex 侧通知):sessionId ↔ codex threadId 绑定 + turn/end watcher
// ---------------------------------------------------------------------------

/**
 * sessionId → 本轮绑定的 codex threadId。**一轮一绑**:由带 threadId 的
 * dsh_prompt 建立,watcher 退出(通知已发/被顶掉/兜底超时)即自动解绑;
 * 下一轮要唤醒,codex 在下一次 prompt 里再传 threadId 即可。
 */
const threadBindings = new Map()
/** sessionId → 在跑的 watcher 的 AbortController(新一轮带 threadId 的 prompt 会顶掉旧的)。 */
const watcherControls = new Map()

/** 只删自己这一轮绑的(避免误删更新的一轮)。 */
function releaseBinding(sessionId, threadId) {
  if (threadBindings.get(sessionId) === threadId) threadBindings.delete(sessionId)
}

/**
 * 经 `codex queue` 往指定 codex 线程发一条消息。
 * 实测:Desktop 里打开着的线程收到队列消息会自行开新 turn(唤醒成立);
 * 空闲/未加载的线程只入队不消费——所以唤醒只对开着的对话有效。
 */
function notifyThread(threadId, text) {
  return new Promise((resolve) => {
    const bin = cfg.wake.codexBin || 'codex'
    let child
    try {
      child = spawn(bin, ['queue', '--thread', threadId, '--message', text], { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (err) {
      warnOnce('wake-spawn', 'codex queue spawn 失败: ' + errText(err))
      resolve(false)
      return
    }
    let stderr = ''
    child.stderr?.on('data', (c) => {
      stderr += String(c)
    })
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }, 20000)
    child.on('error', (err) => {
      clearTimeout(timer)
      warnOnce('wake-spawn', 'codex queue 执行失败: ' + errText(err))
      resolve(false)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        console.log(`[codex-bridge] 已唤醒 codex 线程 ${threadId}`)
        resolve(true)
      } else {
        console.warn(`[codex-bridge] codex queue 退出码 ${code}: ${stderr.slice(0, 300)}`)
        resolve(false)
      }
    })
  })
}

/** 决定唤醒消息:带 decisionId 与完整上下文,让 codex 能直接代决或移交给用户。 */
function decisionWakeText(sessionId, kind, decisionId, meta) {
  let context
  if (kind === 'approval') {
    context = `tool=${meta?.toolName ?? '?'} reason=${meta?.reason ?? '?'}`
  } else {
    const qs = Array.isArray(meta?.questions) ? meta.questions : []
    context = qs
      .map((q) => {
        const opts = Array.isArray(q?.options) && q.options.length > 0
          ? ' options=' + q.options.map((o) => (typeof o === 'string' ? o : o?.label ?? '?')).join('|')
          : ''
        return `[${q?.id ?? '?'}] ${q?.question ?? '?'}${opts}`
      })
      .join('; ')
  }
  return (
    `[DSH decision pending] session=${sessionId} decisionId=${decisionId} kind=${kind} ${context}. ` +
    'Decide with dsh_decide only within your granted authority; otherwise hand the full context to the user for the DSH web GUI. ' +
    'If you already got this decision from dsh_wait, ignore this message.'
  )
}

/**
 * 武装一个**一轮制** watcher:开着 follow 流等这一轮结束 → queue 通知绑定的
 * codex 线程 → 自动解绑。已在等的会话被新一轮带 threadId 的 prompt 顶掉
 * (旧的静默退场不通知)。返回是否成功武装。
 */function armWatcher(ctx, sessionId) {
  if (!cfg.wake.enabled) return false
  const threadId = threadBindings.get(sessionId)
  if (threadId === undefined) return false
  const controller = ctx.get('sessionController')
  if (!controller) {
    releaseBinding(sessionId, threadId)
    return false
  }
  // 顶掉旧 watcher(其 catch 里按 controller 身份清理,不会误伤新的)
  const old = watcherControls.get(sessionId)
  if (old !== undefined) old.abort()
  const ac = new AbortController()
  watcherControls.set(sessionId, ac)
  const cleanup = () => {
    if (watcherControls.get(sessionId) === ac) watcherControls.delete(sessionId)
    releaseBinding(sessionId, threadId)
  }
  void (async () => {
    let latestSeq
    try {
      for await (const frame of controller.follow({ address: { kind: 'session', sessionId }, maxMessages: 1 }, ac.signal)) {
        if (frame && frame.type === 'snapshot') {
          latestSeq = typeof frame.cursor === 'number' ? frame.cursor : undefined
          continue
        }
        const event = frame && frame.type === 'event' ? frame.event : undefined
        if (!event || typeof event.type !== 'string') continue
        if (typeof event.seq === 'number') latestSeq = event.seq
        if (event.type === 'turn/end') break
      }
    } catch {
      // 被顶掉 / 兜底超时 / 流断:静默解绑,不通知
      cleanup()
      return
    }
    cleanup()
    const message =
      `[DSH turn finished] session=${sessionId} latestSeq=${latestSeq ?? '?'}. ` +
      'Read this turn result with dsh_history(sessionId) and continue; if you already got this turn result from dsh_wait, ignore this message.'
    await notifyThread(threadId, message)
  })()
  // 兜底 120 分钟自杀:超过这个时长的 turn 收不到唤醒(v1 限制,人工看 GUI);
  // abort 会走上面的 catch → 自动解绑
  setTimeout(() => ac.abort(), 120 * 60 * 1000)
  return true
}

// ---------------------------------------------------------------------------
// HTTP 工具(照 model-ladder / dsh-web-ui-addons 写法)
// ---------------------------------------------------------------------------

function writeJson(res, code, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

/** loopback + 可选 Bearer token。返回 false 时已写好拒绝响应。 */
function guard(req, res) {
  const address = req && req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : ''
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') {
    writeJson(res, 403, { ok: false, error: 'loopback only' })
    return false
  }
  if (cfg.token !== '') {
    const header = typeof req.headers?.authorization === 'string' ? req.headers.authorization : ''
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const alt = typeof req.headers?.['x-codex-bridge-token'] === 'string' ? req.headers['x-codex-bridge-token'] : ''
    if (bearer !== cfg.token && alt !== cfg.token) {
      writeJson(res, 401, { ok: false, error: 'bad token' })
      return false
    }
  }
  return true
}

async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > 1048576) return null
    chunks.push(buffer)
  }
  if (total === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

function queryParams(req) {
  try {
    return new URL(req.url || '', 'http://127.0.0.1').searchParams
  } catch {
    return new URL('http://127.0.0.1/').searchParams
  }
}

function errText(err) {
  return String((err && err.message) || err)
}

/** 把 model 参数归一成 {provider, model, reasoningEffort?};支持紧凑串与对象两种形式。 */
function normalizeModel(input) {
  let provider
  let model
  let reasoningEffort
  if (typeof input === 'string') {
    const s = input.trim()
    const idx = s.indexOf('/')
    if (idx <= 0 || idx === s.length - 1) {
      throw new Error('model 字符串格式应为 "provider/model"(如 aigw/deepseek-v4.1-flash)')
    }
    provider = s.slice(0, idx)
    model = s.slice(idx + 1)
  } else if (input !== null && typeof input === 'object') {
    provider = String(input.provider ?? '')
    model = String(input.model ?? '')
    if (input.reasoningEffort !== undefined && input.reasoningEffort !== null) reasoningEffort = String(input.reasoningEffort)
  } else {
    throw new Error('model 应为 "provider/model" 字符串或 {provider, model, reasoningEffort?} 对象')
  }
  if (provider === '' || model === '') throw new Error('model 需要 provider 和 model 两部分')
  return reasoningEffort === undefined ? { provider, model } : { provider, model, reasoningEffort }
}

const warned = new Set()
function warnOnce(key, message) {
  if (warned.has(key)) return
  warned.add(key)
  try {
    console.warn('[codex-bridge] ' + message)
  } catch {
    /* ignore */
  }
}

/**
 * cwd → workspaceId。传 workspaceId 才会把会话挂进 GUI 的对应分组;
 * 只传 cwd 时 sessionController.create 跳过 workspace 分支 → 落「未分组」。
 * 路径未注册过就按需建工作区(GUI 打开新目录同款行为);解析失败退回裸 cwd。
 * @returns {{ workspaceId?: string, grouped: boolean }}
 */
async function resolveWorkspace(ctx, cwd) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || cwd === '') return { grouped: false }
  try {
    let workspace = await registry.resolveByPath(cwd)
    if (workspace === undefined) workspace = await registry.create(cwd)
    const id = workspace?.id
    if (typeof id !== 'string' || id === '') return { grouped: false }
    return { workspaceId: id, grouped: true }
  } catch (err) {
    warnOnce('workspace', 'workspace 解析失败,退回裸 cwd(会话将落「未分组」): ' + errText(err))
    return { grouped: false }
  }
}

// ---------------------------------------------------------------------------
// 转录提取:follow snapshot 的持久 event → 紧凑消息列表
// ---------------------------------------------------------------------------

/** 从一条 content block 数组里抽文本;tool-call/tool-result 压成一行摘要。 */
function blocksToText(blocks, includeThinking) {
  if (!Array.isArray(blocks)) return ''
  const parts = []
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    else if (b.type === 'reasoning' && typeof b.text === 'string') {
      if (includeThinking) parts.push('[thinking] ' + b.text)
    } else if (b.type === 'tool-call') parts.push('[tool-call ' + String(b.name) + ']')
    else if (b.type === 'tool-result') parts.push('[tool-result' + (b.isError ? ' error' : '') + ']')
  }
  return parts.join('\n').trim()
}

/** 一条持久 event(user/message | assistant/message)→ { role, text, seq, time };非消息事件回 null。 */
function eventToMessage(event, includeThinking) {
  if (!event || typeof event.type !== 'string') return null
  if (event.type !== 'user/message' && event.type !== 'assistant/message') return null
  const data = event.data && typeof event.data === 'object' ? event.data : {}
  const message = data.message && typeof data.message === 'object' ? data.message : {}
  const role = typeof message.role === 'string' ? message.role : event.type === 'user/message' ? 'user' : 'assistant'
  const text = blocksToText(message.content, includeThinking)
  if (text === '') return null
  return { role, text, seq: typeof event.seq === 'number' ? event.seq : undefined, time: event.time }
}

/**
 * follow opening snapshot → { title, cursor, hasMore, messages }。
 * afterSeq:只保留 seq 严格大于它的消息(增量读;在快照窗口内过滤,窗口外由 hasMore 提示)。
 * includeThinking:是否保留 reasoning 文本(默认否——转录里最主要的噪音源)。
 */
function snapshotToTranscript(snapshot, options) {
  const afterSeq = options && typeof options.afterSeq === 'number' ? options.afterSeq : undefined
  const includeThinking = options?.includeThinking === true
  const messages = []
  let title
  const records = Array.isArray(snapshot?.records) ? snapshot.records : []
  for (const record of records) {
    const event = record && typeof record === 'object' ? record.event : undefined
    if (!event || typeof event.type !== 'string') continue
    if (event.type === 'session/title') {
      const data = event.data && typeof event.data === 'object' ? event.data : {}
      if (typeof data.title === 'string') title = data.title
      continue
    }
    if (afterSeq !== undefined && !(typeof event.seq === 'number' && event.seq > afterSeq)) continue
    const m = eventToMessage(event, includeThinking)
    if (m) messages.push(m)
  }
  if (title === undefined && typeof snapshot?.header?.title === 'string') title = snapshot.header.title
  return {
    title,
    cursor: typeof snapshot?.cursor === 'number' ? snapshot.cursor : undefined,
    hasMore: snapshot?.hasMore === true,
    messages,
  }
}

// ---------------------------------------------------------------------------
// 插件主体
// ---------------------------------------------------------------------------

/** turn 级一行汇总:步数 / 工具调用(按次数排序)/ 用户插话 / 中间文本量。 */
function buildDigest({ steps, userMsgs, toolCounts, intermediateChars }) {
  const parts = []
  if (steps > 0) parts.push(`${steps} steps`)
  let toolTotal = 0
  for (const n of toolCounts.values()) toolTotal += n
  if (toolTotal > 0) {
    const named = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name}×${n}`).join(', ')
    parts.push(`${toolTotal} tool calls (${named})`)
  }
  if (userMsgs > 0) parts.push(`${userMsgs} user messages`)
  if (intermediateChars > 0) {
    const size = intermediateChars >= 1024 ? `${(intermediateChars / 1024).toFixed(1)}k` : String(intermediateChars)
    parts.push(`${size} chars intermediate`)
  }
  return parts.join(' · ')
}

export function apply(ctx) {
  configReady = loadConfig()

  const controller = () => ctx.get('sessionController')

  // ---- 决定中继:审批 / 提问 的 agent 作用域 waterfall 监听 ----
  // 每个 agent 创建时 prepend 两个 listener。control 开关关着时直接 next()
  // (= 现状,GUI 全权);开着时登记 pending 并与人类 GUI 竞速(next() 保留,
  // 先到先得——人类永远能压过 codex)。
  ctx.on('agent/created', (payload) => {
    const agent = payload && payload.agent
    const agentCtx = agent && agent.ctx
    const sessionId = agent && agent.session ? String(agent.session.id ?? '') : ''
    if (!agentCtx || sessionId === '') return
    try {
      agentCtx.on(
        'approval/request',
        async (req, next) => {
          await loadConfig() // 热加载:control 开关翻改动即时生效
          if (!cfg.control.approvals) return next()
          const { decisionId, promise } = registerDecision(sessionId, 'approval', {
            toolName: typeof req?.toolName === 'string' ? req.toolName : undefined,
            reason: typeof req?.reason === 'string' ? req.reason : undefined,
          })
          console.log(`[codex-bridge] 审批待决定: ${sessionId} tool=${req?.toolName ?? '?'} decision=${decisionId}`)
          const signal = req?.signal
          const onAbort = () => dropDecision(decisionId)
          if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true })
          const human = Promise.resolve().then(() => next()).catch(() => 'unavailable')
          const outcome = await Promise.race([human, promise])
          if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort)
          dropDecision(decisionId)
          noteDecisionOutcome(sessionId, decisionId, outcome)
          console.log(`[codex-bridge] 审批已决定: ${sessionId} decision=${decisionId} outcome=${String(outcome)}`)
          return outcome
        },
        { prepend: true },
      )
      agentCtx.on(
        'user-questions/request',
        async (req, next) => {
          await loadConfig() // 热加载:control 开关翻动即时生效
          if (!cfg.control.questions) return next()
          const questions = Array.isArray(req?.questions)
            ? req.questions.map((q) => ({
                id: typeof q?.id === 'string' ? q.id : '',
                question: typeof q?.question === 'string' ? q.question : '',
                header: typeof q?.header === 'string' ? q.header : undefined,
                detail: typeof q?.detail === 'string' ? q.detail : undefined,
                options: Array.isArray(q?.options) ? q.options : undefined,
              }))
            : []
          const { decisionId, promise } = registerDecision(sessionId, 'question', { questions })
          console.log(`[codex-bridge] 提问待回答: ${sessionId} decision=${decisionId} questions=${questions.length}`)
          const signal = req?.signal
          const onAbort = () => dropDecision(decisionId)
          if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true })
          const human = Promise.resolve().then(() => next()).catch(() => undefined)
          const outcome = await Promise.race([human, promise])
          if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort)
          dropDecision(decisionId)
          noteDecisionOutcome(sessionId, decisionId, outcome)
          console.log(`[codex-bridge] 提问已回答: ${sessionId} decision=${decisionId}`)
          return outcome
        },
        { prepend: true },
      )
    } catch (err) {
      warnOnce('decision-hook', 'agent listener 注册失败(该 agent 的决定中继不可用): ' + errText(err))
    }
  })

  const routes = [
    {
      kind: 'exact',
      path: API + '/health',
      handler: async (req, res) => {
        if ((req.method || 'GET') !== 'GET') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        writeJson(res, 200, { ok: true, plugin: name, controller: controller() !== undefined })
      },
    },
    {
      kind: 'exact',
      path: API + '/sessions',
      handler: async (req, res) => {
        await loadConfig() // 热加载:改配置即时生效,不用重启
        if (!guard(req, res)) return
        if ((req.method || 'GET') !== 'GET') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        const c = controller()
        if (!c) return writeJson(res, 503, { ok: false, error: 'sessionController unavailable' })
        try {
          const value = await c.list({}, new AbortController().signal)
          const sessions = (value?.items ?? []).map((s) => ({
            sessionId: s.sessionId,
            updatedAt: s.updatedAt,
            running: s.running === true,
            blank: s.blank === true,
            cwd: typeof s.cwd === 'string' ? s.cwd : undefined,
            parentSessionId: s.parentSessionId,
            origin: s.origin,
          }))
          writeJson(res, 200, { ok: true, sessions })
        } catch (err) {
          writeJson(res, 500, { ok: false, error: errText(err) })
        }
      },
    },
    {
      kind: 'exact',
      path: API + '/history',
      handler: async (req, res) => {
        await loadConfig() // 热加载:改配置即时生效,不用重启
        if (!guard(req, res)) return
        if ((req.method || 'GET') !== 'GET') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        const c = controller()
        if (!c) return writeJson(res, 503, { ok: false, error: 'sessionController unavailable' })
        const params = queryParams(req)
        const sessionId = params.get('sessionId') ?? ''
        if (sessionId === '') return writeJson(res, 400, { ok: false, error: 'sessionId required' })
        let maxMessages = Number.parseInt(params.get('maxMessages') ?? '', 10)
        if (!Number.isFinite(maxMessages) || maxMessages <= 0) maxMessages = DEFAULT_HISTORY_MESSAGES
        maxMessages = Math.min(maxMessages, MAX_HISTORY_MESSAGES)
        // 增量读:只回 seq 严格大于 afterSeq 的消息;latestSeq(= snapshot cursor)
        // 是下一次调用的 afterSeq。窗口内过滤——更早的已被窗口截掉时不补。
        const afterSeqRaw = Number.parseInt(params.get('afterSeq') ?? '', 10)
        const afterSeq = Number.isFinite(afterSeqRaw) && afterSeqRaw >= 0 ? afterSeqRaw : undefined
        const includeThinking = params.get('includeThinking') === 'true'
        const ac = new AbortController()
        try {
          let snapshot
          for await (const frame of c.follow({ address: { kind: 'session', sessionId }, maxMessages }, ac.signal)) {
            if (frame && frame.type === 'snapshot') {
              snapshot = frame
              break
            }
          }
          if (snapshot === undefined) return writeJson(res, 404, { ok: false, error: 'session not found' })
          const transcript = snapshotToTranscript(snapshot, { afterSeq, includeThinking })
          writeJson(res, 200, { ok: true, sessionId, latestSeq: transcript.cursor, ...transcript })
        } catch (err) {
          writeJson(res, 404, { ok: false, error: errText(err) })
        } finally {
          ac.abort()
        }
      },
    },
    {
      kind: 'exact',
      path: API + '/wait',
      handler: async (req, res) => {
        await loadConfig() // 热加载:改配置即时生效,不用重启
        if (!guard(req, res)) return
        if ((req.method || 'GET') !== 'GET') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        const c = controller()
        if (!c) return writeJson(res, 503, { ok: false, error: 'sessionController unavailable' })
        const params = queryParams(req)
        const sessionId = params.get('sessionId') ?? ''
        if (sessionId === '') return writeJson(res, 400, { ok: false, error: 'sessionId required' })
        let waitSec = Number.parseInt(params.get('waitSec') ?? '', 10)
        if (!Number.isFinite(waitSec) || waitSec <= 0) waitSec = DEFAULT_WAIT_SEC
        waitSec = Math.min(waitSec, MAX_WAIT_SEC)
        const afterSeqRaw = Number.parseInt(params.get('afterSeq') ?? '', 10)
        let afterSeq = Number.isFinite(afterSeqRaw) && afterSeqRaw >= 0 ? afterSeqRaw : undefined
        const includeThinking = params.get('includeThinking') === 'true'
        // detail=final(默认):一个 turn 只回一条汇总(最后一条 assistant 文本 + 一行
        // digest),避免把 turn 内每步的碎嘴都搬回去;detail=all 才回全部过程消息。
        const detail = params.get('detail') === 'all' ? 'all' : 'final'
        // onDecision=return(默认):一有审批/提问待决定就返回,让 codex 去 /decide
        // (或转告人类);hold:握着不返回,直到 turn 结束,决定过程写进结果。
        const onDecision = params.get('onDecision') === 'hold' ? 'hold' : 'return'

        // 长轮询:开着 follow 流等"接下来发生什么"。默认只认快照之后的事件
        // (afterSeq 缺省 = snapshot cursor)。结局:
        //   turn-end 一轮结束 / decision 有待决定事项(审批/提问)
        //   approval 有待审批且本插件未接管决定权 / timeout 什么都没发生
        const ac = new AbortController()
        let timer
        const timedOut = new Promise((resolve) => {
          timer = setTimeout(() => {
            ac.abort()
            resolve('timeout')
          }, waitSec * 1000)
        })
        const messages = []
        const decisions = []
        let latestSeq
        let reason = 'timeout'
        let decision = null
        let approval = null
        let responded = false
        // turn 级统计(汇总用)
        let steps = 0
        let userMsgs = 0
        let intermediateChars = 0
        let finalMessage = null
        const toolCounts = new Map()
        const finish = (code, payload) => {
          if (responded) return
          responded = true
          writeJson(res, code, payload)
        }
        // 决定中继通知:register(有待决定)/ outcome(已决定)
        const unsubscribe = subscribeWait(sessionId, (note) => {
          if (responded) return
          if (note.type === 'register') {
            if (onDecision === 'return') {
              reason = 'decision'
              decision = note.view
              ac.abort() // 打断 pump(for-await 收尾后由 race 统一响应)
            } else {
              decisions.push({ ...note.view, outcome: undefined })
            }
          } else if (note.type === 'outcome') {
            const hit = decisions.find((d) => d.decisionId === note.decisionId)
            if (hit) hit.outcome = note.outcome
          }
        })
        const pump = (async () => {
          try {
            for await (const frame of c.follow({ address: { kind: 'session', sessionId }, maxMessages: 1 }, ac.signal)) {
              if (frame && frame.type === 'snapshot') {
                latestSeq = typeof frame.cursor === 'number' ? frame.cursor : undefined
                if (afterSeq === undefined) afterSeq = latestSeq
                continue
              }
              const event = frame && frame.type === 'event' ? frame.event : undefined
              if (!event || typeof event.type !== 'string') continue
              if (typeof event.seq === 'number') latestSeq = event.seq
              if (afterSeq !== undefined && typeof event.seq === 'number' && event.seq <= afterSeq) continue
              if (event.type === 'step/start') {
                steps += 1
              } else if (event.type === 'user/message') {
                userMsgs += 1
                if (detail === 'all') {
                  const m = eventToMessage(event, includeThinking)
                  if (m) messages.push(m)
                }
              } else if (event.type === 'assistant/message') {
                const data = event.data && typeof event.data === 'object' ? event.data : {}
                const content = data.message && typeof data.message === 'object' ? data.message.content : undefined
                if (Array.isArray(content)) {
                  for (const b of content) {
                    if (!b || typeof b !== 'object') continue
                    if (b.type === 'tool-call') {
                      const name = typeof b.name === 'string' ? b.name : '?'
                      toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1)
                    }
                  }
                }
                if (detail === 'all') {
                  const m = eventToMessage(event, includeThinking)
                  if (m) messages.push(m)
                } else {
                  // final 模式:只取纯文本(reasoning 可选),工具调用已由 digest 计数
                  const textBlocks = Array.isArray(content)
                    ? content.filter((b) => b && typeof b === 'object' && (b.type === 'text' || (includeThinking && b.type === 'reasoning')))
                    : []
                  const text = blocksToText(textBlocks, includeThinking)
                  if (text !== '') {
                    intermediateChars += text.length
                    finalMessage = { role: 'assistant', text, seq: event.seq, time: event.time }
                  }
                }
              } else if (event.type === 'approval/asked') {
                const data = event.data && typeof event.data === 'object' ? event.data : {}
                const view = {
                  kind: 'approval',
                  toolName: typeof data.toolName === 'string' ? data.toolName : undefined,
                  reason: typeof data.reason === 'string' ? data.reason : undefined,
                }
                if (onDecision === 'return' && !cfg.control.approvals) {
                  // 本插件不接管审批决定:通知 codex 去叫人类(无 decisionId 可决)
                  reason = 'approval'
                  approval = view
                  ac.abort()
                  return
                }
                if (!cfg.control.approvals) {
                  // hold + 控制关:事件是唯一来源,推占位(由 approval/decided 补 outcome)
                  decisions.push({ ...view, decisionId: undefined, outcome: undefined })
                }
                // 控制开着:register 通知会推带 decisionId 的条目,不重复记
              } else if (event.type === 'approval/decided') {
                const data = event.data && typeof event.data === 'object' ? event.data : {}
                const outcome = typeof data.outcome === 'string' ? data.outcome : undefined
                // 补登:hold 模式下 approval/asked 先于监听器登记,按序匹配最后一条无 outcome 的
                for (let i = decisions.length - 1; i >= 0; i--) {
                  if (decisions[i].kind === 'approval' && decisions[i].outcome === undefined) {
                    decisions[i].outcome = outcome
                    break
                  }
                }
              } else if (event.type === 'turn/end') {
                reason = 'turn-end'
                return
              }
            }
          } catch (err) {
            if (!ac.signal.aborted) throw err
            // 被我们的超时/决定通知 abort → reason 已由相应路径设置
          }
        })()
        pump.catch(() => {}) // 超时后 pump 才结束也不算 unhandled
        try {
          await Promise.race([pump, timedOut])
          const digest = buildDigest({ steps, userMsgs, toolCounts, intermediateChars })
          const pending = pendingForSession(sessionId)
          finish(200, {
            ok: true,
            sessionId,
            reason,
            latestSeq,
            digest,
            ...(decision === null ? {} : { decision }),
            ...(approval === null ? {} : { approval }),
            ...(pending.length > 0 ? { pending } : {}),
            ...(decisions.length > 0 ? { decisions } : {}),
            ...(detail === 'all' ? { messages } : { final: finalMessage }),
          })
        } catch (err) {
          finish(404, { ok: false, error: errText(err) })
        } finally {
          unsubscribe()
          clearTimeout(timer)
          ac.abort()
        }
      },
    },
    {
      kind: 'exact',
      path: API + '/models',
      handler: async (req, res) => {
        await loadConfig() // 热加载
        if (!guard(req, res)) return
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        const c = controller()
        if (!c) return writeJson(res, 503, { ok: false, error: 'sessionController unavailable' })
        try {
          const catalog = await c.modelCatalog()
          writeJson(res, 200, { ok: true, ...catalog })
        } catch (err) {
          writeJson(res, 500, { ok: false, error: errText(err) })
        }
      },
    },
    {
      kind: 'exact',
      path: API + '/prompt',
      handler: async (req, res) => {
        await loadConfig() // 热加载:改配置即时生效,不用重启
        if (!guard(req, res)) return
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        const c = controller()
        if (!c) return writeJson(res, 503, { ok: false, error: 'sessionController unavailable' })
        const body = await readJsonBody(req)
        if (!body || typeof body !== 'object') return writeJson(res, 400, { ok: false, error: 'json body required' })
        const text = typeof body.text === 'string' ? body.text : ''
        if (text.trim() === '') return writeJson(res, 400, { ok: false, error: 'text required' })
        const mode = body.mode === 'steer' ? 'steer' : 'queue'
        // 可选 threadId:派活即完成一轮制唤醒绑定(codex 一次调用搞定;这一轮
        // 结束通知后自动解绑,下一轮要唤醒需再传)。wake 关着时忽略不存。
        const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : ''
        let sessionId = typeof body.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : undefined
        const isNewSession = sessionId === undefined
        // 模型解析:显式 model 参数 > defaultModel(仅新建会话)> 部署默认。
        // defaultModel 绝不作用于已有会话——那等于偷偷改别人会话的模型。
        let modelInput = body.model
        if ((modelInput === undefined || modelInput === null) && isNewSession && cfg.defaultModel !== undefined) {
          modelInput = cfg.defaultModel
        }
        let created = false
        let effectiveCwd
        let grouped = false
        try {
          if (sessionId === undefined) {
            const createRequest = {}
            const cwd = typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : cfg.defaultCwd
            const agentPreset = typeof body.agentPreset === 'string' && body.agentPreset !== '' ? body.agentPreset : cfg.defaultAgentPreset
            if (agentPreset !== '') createRequest.agentPreset = agentPreset
            const resolved = await resolveWorkspace(ctx, cwd)
            if (resolved.workspaceId !== undefined) createRequest.workspaceId = resolved.workspaceId
            else if (cwd !== '') createRequest.cwd = cwd
            grouped = resolved.grouped
            effectiveCwd = cwd !== '' ? cwd : undefined
            const createdValue = await c.create(createRequest)
            sessionId = createdValue?.sessionId
            created = true
          }
          if (typeof sessionId !== 'string' || sessionId === '') {
            return writeJson(res, 500, { ok: false, error: 'create returned no sessionId' })
          }
          // 可选模型选择:create 不接受 model,须先 selectModel 再 prompt(本轮即生效)。
          // 选择是 session 级持久的;失败则不派活(不静默用默认模型搪塞用户的明确要求)。
          let appliedModel
          if (modelInput !== undefined && modelInput !== null) {
            let selection
            try {
              selection = normalizeModel(modelInput)
            } catch (err) {
              return writeJson(res, 400, { ok: false, error: errText(err), sessionId, created })
            }
            try {
              const selected = await c.selectModel({ sessionId, ...selection })
              appliedModel = selected?.selected ?? selection
            } catch (err) {
              return writeJson(res, 500, { ok: false, error: 'selectModel 失败: ' + errText(err), sessionId, created })
            }
          }
          const value = await c.prompt({
            requestId: randomUUID(),
            sessionId,
            mode,
            content: [{ type: 'text', text }],
          }, new AbortController().signal)
          let wakeArmed
          if (threadId !== '' && cfg.wake.enabled) {
            threadBindings.set(sessionId, threadId)
            wakeArmed = armWatcher(ctx, sessionId)
          } else if (threadId !== '') {
            wakeArmed = false // 传了 threadId 但 wake 被关
          }
          writeJson(res, 200, {
            ok: true,
            sessionId,
            created,
            accepted: value?.accepted === true,
            ...(effectiveCwd === undefined ? {} : { cwd: effectiveCwd }),
            ...(created ? { grouped } : {}),
            ...(wakeArmed === undefined ? {} : { wakeArmed }),
            ...(appliedModel === undefined ? {} : { model: appliedModel }),
          })
        } catch (err) {
          writeJson(res, 500, { ok: false, error: errText(err), sessionId, created })
        }
      },
    },
    {
      kind: 'exact',
      path: API + '/decide',
      handler: async (req, res) => {
        await loadConfig() // 热加载:改配置即时生效,不用重启
        if (!guard(req, res)) return
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        const body = await readJsonBody(req)
        if (!body || typeof body !== 'object') return writeJson(res, 400, { ok: false, error: 'json body required' })
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        if (sessionId === '') return writeJson(res, 400, { ok: false, error: 'sessionId required' })
        // 定位 pending:decisionId 精确匹配,否则取该会话最旧一条
        let entry
        if (typeof body.decisionId === 'string' && body.decisionId !== '') {
          const hit = pendingDecisions.get(body.decisionId)
          if (hit === undefined || hit.sessionId !== sessionId) {
            return writeJson(res, 404, { ok: false, error: 'no such pending decision (already settled or unknown)' })
          }
          entry = hit
        } else {
          const list = pendingForSession(sessionId)
          if (list.length === 0) return writeJson(res, 404, { ok: false, error: 'no pending decision for this session' })
          entry = pendingDecisions.get(list[0].decisionId)
        }
        let outcome
        if (entry.kind === 'approval') {
          outcome = body.allow === true ? 'allowed-once' : 'rejected'
        } else {
          const questions = Array.isArray(entry.meta?.questions) ? entry.meta.questions : []
          let answers
          if (Array.isArray(body.answers)) {
            answers = body.answers.map((a) => {
              const selected = Array.isArray(a?.selected)
                ? a.selected.map(String)
                : typeof a?.selected === 'string'
                  ? [a.selected]
                  : []
              return {
                id: String(a?.id ?? ''),
                selected,
                ...(typeof a?.custom === 'string' && a.custom !== '' ? { custom: a.custom } : {}),
              }
            })
          } else {
            const selected = Array.isArray(body.selected)
              ? body.selected.map(String)
              : typeof body.selected === 'string'
                ? [body.selected]
                : []
            const custom = typeof body.custom === 'string' && body.custom !== '' ? body.custom : undefined
            answers = questions.map((q) => ({ id: String(q.id ?? ''), selected, ...(custom === undefined ? {} : { custom }) }))
          }
          if (answers.length === 0 || answers.some((a) => a.id === '')) {
            return writeJson(res, 400, { ok: false, error: 'answers require question ids (use answers:[{id,…}] or selected/custom)' })
          }
          outcome = { answers }
        }
        if (!resolveDecision(entry.decisionId, outcome)) {
          return writeJson(res, 404, { ok: false, error: 'decision already settled' })
        }
        console.log(`[codex-bridge] 代决定: ${sessionId} decision=${entry.decisionId} kind=${entry.kind} outcome=${JSON.stringify(outcome)}`)
        writeJson(res, 200, { ok: true, sessionId, decisionId: entry.decisionId, kind: entry.kind, outcome })
      },
    },
    {
      kind: 'exact',
      path: API + '/adopt',
      handler: async (req, res) => {
        await loadConfig() // 热加载:改配置即时生效,不用重启
        if (!guard(req, res)) return
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        const c = controller()
        if (!c) return writeJson(res, 503, { ok: false, error: 'sessionController unavailable' })
        const registry = ctx.get('workspaceRegistry')
        if (!registry) return writeJson(res, 503, { ok: false, error: 'workspaceRegistry unavailable' })
        const body = await readJsonBody(req)
        if (!body || typeof body !== 'object') return writeJson(res, 400, { ok: false, error: 'json body required' })
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        if (sessionId === '') return writeJson(res, 400, { ok: false, error: 'sessionId required' })
        let cwd = typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : undefined
        if (cwd === undefined) {
          // 没带 cwd 就从会话列表反查(列表项带 cwd)
          try {
            const value = await c.list({}, new AbortController().signal)
            const entry = (value?.items ?? []).find((s) => s && s.sessionId === sessionId)
            cwd = typeof entry?.cwd === 'string' ? entry.cwd : undefined
          } catch (err) {
            return writeJson(res, 500, { ok: false, error: errText(err) })
          }
        }
        if (cwd === undefined || cwd === '') return writeJson(res, 404, { ok: false, error: 'session cwd unknown' })
        try {
          let workspace = await registry.resolveByPath(cwd)
          if (workspace === undefined) workspace = await registry.create(cwd)
          if (workspace === undefined) return writeJson(res, 500, { ok: false, error: 'workspace resolve failed' })
          await workspace.attachSession(sessionId)
          writeJson(res, 200, { ok: true, sessionId, workspaceId: workspace.id, path: workspace.path })
        } catch (err) {
          writeJson(res, 500, { ok: false, error: errText(err) })
        }
      },
    },
    {
      kind: 'exact',
      path: API + '/cancel',
      handler: async (req, res) => {
        await loadConfig() // 热加载:改配置即时生效,不用重启
        if (!guard(req, res)) return
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        const c = controller()
        if (!c) return writeJson(res, 503, { ok: false, error: 'sessionController unavailable' })
        const body = await readJsonBody(req)
        const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId : ''
        if (sessionId === '') return writeJson(res, 400, { ok: false, error: 'sessionId required' })
        try {
          const value = await c.cancel({ sessionId })
          writeJson(res, 200, { ok: true, sessionId, accepted: value?.accepted === true })
        } catch (err) {
          writeJson(res, 500, { ok: false, error: errText(err) })
        }
      },
    },
  ]

  for (const route of routes) {
    ctx.effect(() => ctx.webServer.register(route))
  }

  console.log('[codex-bridge] 路由已注册:' + routes.map((r) => r.path).join(', '))
}
