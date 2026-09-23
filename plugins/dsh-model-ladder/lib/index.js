/**
 * dsh-model-ladder — host half(零运行时依赖,仅 node 内置模块)。
 *
 * 模型高低阶梯自动退化:composer 内置模型选择器**保持原生**,它就是 low 槽
 * (窗口外跑什么 = 用户原生所选)。本插件在唯一注入缝 `agent/request`
 * (register with { prepend: true } → 最外层,覆盖必获胜;时序证据见 plan-model-ladder.md §0)
 * 上,当"当前轮 ≤ highUntilTurn"时把实际执行模型强制替换为 high 槽模型。
 *
 * 每会话状态 { highUntilTurn } 存内存 Map,可从持久投影(turnBoundary /
 * modelSelection)在挂载时重建;窗口进度不持久化(重启按"当前意图"重估,v1 语义)。
 * 配置 { window, high } 持久在 ~/.dsh/model-ladder.json(anchored-monitor 同款通道)。
 *
 * 路由(同源,loopback-only):
 *   GET  /api/model-ladder/state?sessionId=…   读配置 + 会话窗口(惰性武装)
 *   POST /api/model-ladder/session             { sessionId, turns } 置剩余轮数(0=关)
 *   POST /api/model-ladder/settings            { window?, high?, sessionId?, boost? }
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** Stable cordis plugin name(与 cordis.patch.yml insert id 一致)。 */
export const name = 'dsh-model-ladder'

/** 挂载所需服务(web profile 全部常驻;缺失则行进入 waiting,不影响其它插件)。 */
export const inject = ['llm', 'webServer', 'sessionProjections', 'sessions']

const API = '/api/model-ladder'
const WINDOW_MIN = 1
const WINDOW_MAX = 10
const DEFAULT_WINDOW = 3
const MAX_TRACKED_SESSIONS = 400

// ---------------------------------------------------------------------------
// 配置(window / high 槽)+ 有效性
// ---------------------------------------------------------------------------

/** @type {{ window: number, high: null | { provider: string, model: string, reasoningEffort?: string } }} */
let cfg = { window: DEFAULT_WINDOW, high: null }
/** high 槽经 resolveCallConfig 验证后的实际路由;null = 未配置或失效(passthrough)。 */
let highEffective = null
const warned = new Set()

function warnOnce(key, message) {
  if (warned.has(key)) return
  warned.add(key)
  try {
    console.warn('[model-ladder] ' + message)
  } catch {
    /* ignore */
  }
}

function homeFile(...parts) {
  return path.join(homedir(), '.dsh', ...parts)
}
function configPath() {
  return homeFile('model-ladder.json')
}

function clampWindow(raw) {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return DEFAULT_WINDOW
  if (n < WINDOW_MIN) return WINDOW_MIN
  if (n > WINDOW_MAX) return WINDOW_MAX
  return n
}

/** 宽松归一 high 槽:非法形状一律视为未配置(null)。 */
function normalizeHigh(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object') return null
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : ''
  const model = typeof raw.model === 'string' ? raw.model.trim() : ''
  if (!provider || !model) return null
  const effort = typeof raw.reasoningEffort === 'string' && raw.reasoningEffort !== '' ? raw.reasoningEffort : undefined
  return effort === undefined ? { provider, model } : { provider, model, reasoningEffort: effort }
}

let ctxRef = null
/** 配置加载完成前路由不读 cfg(await 此 promise;重启瞬间的极小窗口)。 */
let configReady = Promise.resolve()

/** 验证 high 槽是否仍可解析为真实路由;失败 → 阶梯自动 passthrough(E4)。 */
async function revalidateHigh() {
  const high = cfg.high
  if (high === null) {
    highEffective = null
    return
  }
  const llm = ctxRef && ctxRef.llm
  if (llm === undefined || llm === null) return
  try {
    const resolved = await llm.resolveCallConfig({ provider: high.provider, model: high.model })
    highEffective = {
      provider: typeof resolved.provider === 'string' && resolved.provider ? resolved.provider : high.provider,
      model: typeof resolved.model === 'string' && resolved.model ? resolved.model : high.model,
      ...(high.reasoningEffort === undefined ? {} : { reasoningEffort: high.reasoningEffort }),
    }
    warned.delete('high-invalid:' + high.provider + '/' + high.model)
  } catch (error) {
    highEffective = null
    warnOnce('high-invalid:' + high.provider + '/' + high.model,
      'high 槽 ' + high.provider + '/' + high.model + ' 暂不可解析,阶梯停用: ' + String(error && error.message ? error.message : error))
  }
}

async function loadConfig() {
  try {
    const raw = JSON.parse(await readFile(configPath(), 'utf8'))
    cfg = { window: clampWindow(raw.window), high: normalizeHigh(raw.high) }
  } catch {
    cfg = { window: DEFAULT_WINDOW, high: null }
  }
  await revalidateHigh()
}

let saveChain = Promise.resolve()
function saveConfig() {
  saveChain = saveChain
    .then(async () => {
      try {
        await mkdir(homeFile(), { recursive: true })
        await writeFile(configPath(), JSON.stringify(cfg, null, 2), 'utf8')
      } catch (error) {
        warnOnce('save', '配置写入失败: ' + String(error && error.message ? error.message : error))
      }
    })
    .catch(() => {})
  return saveChain
}

// ---------------------------------------------------------------------------
// 会话调度状态(内存 Map,派生 remaining;见 plan §4.3)
// ---------------------------------------------------------------------------

/** sessionId(string) → { highUntilTurn: number } */
const states = new Map()

function readProjection(session, key) {
  try {
    return ctxRef.sessionProjections.stateOf(session, key)
  } catch {
    return undefined
  }
}

/** 轮钟:lastTurn = 最近已开启轮号;open = 该轮进行中;current = 当前/下一请求所属轮。 */
function turnInfo(session) {
  const tb = readProjection(session, 'turnBoundary')
  const lastTurn = tb && Number.isFinite(Number(tb.lastTurn)) ? Number(tb.lastTurn) : 0
  const open = !!tb && tb.openTurnStartSeq !== null && tb.openTurnStartSeq !== undefined
  return { lastTurn, open, current: open ? Math.max(1, lastTurn) : lastTurn + 1 }
}

/** 会话模型意图(持久投影):pending ?? lastUsed。 */
function intentOf(session) {
  const ms = readProjection(session, 'modelSelection')
  if (!ms) return null
  return ms.pending || ms.lastUsed || null
}

function isSubagent(session) {
  let header = null
  try {
    header = session.header
  } catch {
    return false
  }
  if (!header) return false
  return header.parentSession !== undefined || header.origin === 'subagent'
}

function sameSel(a, b) {
  if (a === b) return true
  return !!a && !!b && a.provider === b.provider && a.model === b.model
}

function setHighUntil(id, highUntilTurn) {
  states.set(id, { highUntilTurn })
  if (states.size > MAX_TRACKED_SESSIONS) {
    // 简单 FIFO 收缩:保留刚写入的项,丢弃最老的一个。
    for (const oldest of states.keys()) {
      if (oldest !== id) {
        states.delete(oldest)
        break
      }
    }
  }
}

/**
 * 首次遇到某会话时建立窗口(创建-only;已有条目原样返回)。
 * 初值语义(§1.2,v1.1 修订):新会话默认**带外(passthrough)= 用户原生所选
 * (low 槽)。low 就是默认模型;high 只在用户显式 boost(数字/↻/选 high 槽模型)
 * 时开启。会话意图 == high 槽 → 视为刚 boost 满血新窗口;其余 → 带外。
 */
function armSession(session) {
  const id = String(session.id)
  const { current } = turnInfo(session)
  const intent = intentOf(session)
  let highUntilTurn
  if (highEffective !== null && sameSel(intent, highEffective)) {
    highUntilTurn = current + cfg.window - 1
  } else {
    highUntilTurn = current - 1
  }
  setHighUntil(id, highUntilTurn)
  return states.get(id)
}

/** 读取窗口;缺失则建立。**幂等**——GET 轮询/多次请求不会重置已有进度。 */
function ensureArmed(session) {
  const id = String(session.id)
  const existing = states.get(id)
  if (existing) return existing
  return armSession(session)
}

/** 会话状态路由视图(含派生 remaining / tier)。 */
function sessionView(session) {
  const st = states.get(String(session.id))
  if (!st) return null
  const { current } = turnInfo(session)
  const remaining = Math.max(0, st.highUntilTurn - current + 1)
  return {
    highUntilTurn: st.highUntilTurn,
    currentTurn: current,
    remaining,
    tier: highEffective !== null && remaining > 0 ? 'high' : 'low',
  }
}

function statePayload(session) {
  return {
    ok: true,
    window: cfg.window,
    high: cfg.high,
    highValid: highEffective !== null,
    session: session === undefined || session === null ? null : sessionView(session),
  }
}

// ---------------------------------------------------------------------------
// HTTP 工具(照 anchored-monitor 写法)
// ---------------------------------------------------------------------------

function writeJson(res, code, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

function guard(req, res) {
  const address = req && req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : ''
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') {
    writeJson(res, 403, { ok: false, error: 'loopback only' })
    return false
  }
  return true
}

async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > 65536) return null
    chunks.push(buffer)
  }
  if (total === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

function querySessionId(req) {
  try {
    const url = new URL(req.url || '', 'http://127.0.0.1')
    const id = url.searchParams.get('sessionId')
    return id === null || id === '' ? null : id
  } catch {
    return null
  }
}

/** 解析并校验目标会话:必须在内存、必须是普通会话。返回 { session } 或 { error, code }。 */
function resolveTargetSession(rawId) {
  const id = typeof rawId === 'string' ? rawId : ''
  if (!id) return { code: 400, error: 'sessionId required' }
  const sessions = ctxRef.get('sessions')
  if (!sessions) return { code: 503, error: 'sessions service unavailable' }
  let session
  try {
    session = sessions.get(id)
  } catch {
    session = undefined
  }
  if (!session) return { code: 404, error: 'session not resident' }
  if (isSubagent(session)) return { code: 403, error: 'subagent session' }
  return { session }
}

// ---------------------------------------------------------------------------
// 插件主体
// ---------------------------------------------------------------------------

export function apply(ctx) {
  ctxRef = ctx
  configReady = loadConfig()

  // provider 目录变化(凭据增删等)→ 复验 high 槽有效性。
  ctx.on('llm/adapters-updated', () => {
    void revalidateHigh()
  })

  // 武装点:agent/created(root 平面收 scoped 事件,先例 anchored-monitor)。
  // 所有 setup 注册(installModelSelection、preset 行)都已先于本事件完成;
  // 我们以 prepend 挂到同一 agent.ctx 的 `agent/request` 上 → 最外层 → 最终覆盖。
  ctx.on('agent/created', (payload) => {
    const agent = payload && payload.agent
    if (!agent || !agent.session || !agent.ctx) return
    if (isSubagent(agent.session)) return
    // 覆盖监听器必须**同步**注册(首个 agent/request 可能立刻到来;prepend
    // 依赖它在 installModelSelection 之后、任何请求之前进入 hooks 头部)。
    // 武装是惰性的:首次请求 / 路由读取时才建状态(见 ensureArmed)。
    agent.ctx.on(
      'agent/request',
      async (requestPayload, next) => {
        const resolved = await next()
        try {
          await configReady
          const target = requestPayload && requestPayload.agent && requestPayload.agent.session
          if (!target) return resolved
          const st = ensureArmed(target)
          const turn = Number(requestPayload.turn)
          if (!Number.isFinite(turn) || turn > st.highUntilTurn) return resolved
          if (highEffective === null) return resolved
          const high = highEffective
          if (
            resolved
            && resolved.provider === high.provider
            && resolved.model === high.model
            && (resolved.reasoningEffort === undefined ? null : String(resolved.reasoningEffort))
              === (high.reasoningEffort === undefined ? null : high.reasoningEffort)
          ) {
            return resolved
          }
          // high 带:整体换 provider/model;剥离继承的 reasoningEffort(与
          // model-selection.ts 同款),仅当 high 槽自带 effort 时回填。
          if (resolved === undefined || resolved === null) return resolved
          const { reasoningEffort: _inherited, ...rest } = resolved
          return {
            ...rest,
            provider: high.provider,
            model: high.model,
            ...(high.reasoningEffort === undefined ? {} : { reasoningEffort: high.reasoningEffort }),
          }
        } catch (error) {
          warnOnce('override', '覆盖评估异常,passthrough: ' + String(error && error.message ? error.message : error))
          return resolved
        }
      },
      { prepend: true },
    )
  })

  // ---- 路由 ----
  const routes = [
    {
      kind: 'exact',
      path: API + '/state',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if ((req.method || 'GET') !== 'GET') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        await configReady
        const id = querySessionId(req)
        let session = null
        if (id !== null) {
          const resolvedTarget = resolveTargetSession(id)
          if (resolvedTarget.session) {
            ensureArmed(resolvedTarget.session) // 惰性武装:打开即有窗口视图(不重置进度)
            session = resolvedTarget.session
          }
        }
        writeJson(res, 200, statePayload(session))
      },
    },
    {
      kind: 'exact',
      path: API + '/session',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        await configReady
        const body = await readJsonBody(req)
        if (!body || typeof body !== 'object') return writeJson(res, 400, { ok: false, error: 'json body required' })
        const resolvedTarget = resolveTargetSession(body.sessionId)
        if (!resolvedTarget.session) return writeJson(res, resolvedTarget.code || 400, { ok: false, error: resolvedTarget.error || 'bad request' })
        const session = resolvedTarget.session
        const turns = Math.floor(Number(body.turns))
        if (!Number.isFinite(turns) || turns < 0 || turns > WINDOW_MAX) {
          return writeJson(res, 400, { ok: false, error: 'turns must be an integer in 0..' + WINDOW_MAX })
        }
        ensureArmed(session) // 确保有基础状态后再覆盖
        const { current } = turnInfo(session)
        setHighUntil(String(session.id), turns === 0 ? current - 1 : current + turns - 1)
        writeJson(res, 200, statePayload(session))
      },
    },
    {
      kind: 'exact',
      path: API + '/settings',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        await configReady
        const body = await readJsonBody(req)
        if (!body || typeof body !== 'object') return writeJson(res, 400, { ok: false, error: 'json body required' })
        if ('window' in body) cfg = { ...cfg, window: clampWindow(body.window) }
        let highTouched = false
        if ('high' in body) {
          cfg = { ...cfg, high: normalizeHigh(body.high) }
          highTouched = true
        }
        if (highTouched || 'window' in body) {
          await saveConfig()
          if (highTouched) await revalidateHigh()
        }
        // 选 high 即 boost(用户拍板):仅当显式 boost=true 且会话可解析。
        let session = null
        const resolvedTarget = 'sessionId' in body && body.sessionId !== undefined && body.sessionId !== null
          ? resolveTargetSession(String(body.sessionId))
          : { session: null }
        if (resolvedTarget.session) {
          session = resolvedTarget.session
          if (body.boost === true && highTouched && highEffective !== null) {
            const { current } = turnInfo(session)
            setHighUntil(String(session.id), current + cfg.window - 1)
          } else {
            ensureArmed(session)
          }
        }
        writeJson(res, 200, statePayload(session))
      },
    },
  ]
  for (const route of routes) {
    ctx.effect(() => ctx.webServer.register(route))
  }
}
