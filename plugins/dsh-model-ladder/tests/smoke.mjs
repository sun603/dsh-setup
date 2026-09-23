/* dsh-model-ladder host-half offline smoke test (fake ctx)。
 * HOME 在 import 被测模块前重定向到一次性临时目录:测试自给自足,
 * 绝不误写真实 ~/.dsh/model-ladder.json(homedir()/os.homedir 都认 HOME)。 */
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

process.env.HOME = mkdtempSync(join(tmpdir(), 'mll-smoke-'))

const mod = await import(new URL('../lib/index.js', import.meta.url).href)

// ---- fakes ----
const listeners = new Map()
const registeredRoutes = []
const requestHandlers = new Map()
const sessions = new Map()
const projections = new Map()

function fakeSession(id, { lastTurn = 0, open = false, intent = null, subagent = false } = {}) {
  const session = { id, header: subagent ? { parentSession: 'someone' } : {} }
  sessions.set(id, session)
  projections.set(session, {
    turnBoundary: { lastTurn, openTurnStartSeq: open ? 111 : null, lastStepStartSeq: null, lastStepBoundary: null },
    modelSelection: intent ? { lastUsed: intent, pending: null } : { lastUsed: null, pending: null },
  })
  return session
}

/** 推进轮钟(镜像 reality:轮开始时 turnBoundary.lastTurn=turn,进行中 open=true)。 */
function advance(session, turn, open) {
  projections.get(session).turnBoundary.lastTurn = turn
  projections.get(session).turnBoundary.openTurnStartSeq = open ? 111 + turn : null
}

function makeCtx() {
  const ctx = {
    llm: {
      resolveCallConfig: async (c) => {
        if (c.model === 'gone') throw new Error('NO_ROUTE')
        return { provider: c.provider, model: c.model }
      },
    },
    webServer: { register: (r) => { registeredRoutes.push(r); return () => {} } },
    sessionProjections: { stateOf: (session, key) => { const p = projections.get(session); return p ? p[key] : undefined } },
    sessions: { get: (id) => sessions.get(id) },
    get: (name) => ctx[name],
    on: (name, cb) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(cb); return () => {} },
    effect: (fn) => fn(),
  }
  return ctx
}
const ctx = makeCtx()
mod.apply(ctx)

function emit(name, ...args) { for (const cb of listeners.get(name) || []) cb(...args) }
function createAgent(session) {
  const agent = { session, ctx: { on: (n, cb) => { if (n === 'agent/request') requestHandlers.set(String(session.id), cb); return () => {} } } }
  emit('agent/created', { agent })
}

function route(path) { return registeredRoutes.find((r) => r.path === path) }
async function call(path, method, body) {
  const res = { code: 0, body: null, writeHead(c) { this.code = c }, end(b) { this.body = b } }
  const req = {
    method,
    url: 'http://127.0.0.1' + path,
    socket: { remoteAddress: '127.0.0.1' },
    [Symbol.asyncIterator]: async function* () { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) },
  }
  await route(path).handler(req, res)
  return { code: res.code, json: res.body ? JSON.parse(res.body) : null }
}

let failures = 0
function check(label, cond, detail) {
  if (cond) console.log('ok   ' + label)
  else { failures += 1; console.log('FAIL ' + label + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')) }
}
const LOW = () => inner({ provider: 'deepseek', model: 'flash', reasoningEffort: 'high', maxTokens: 100 })
const inner = async (cfg) => ({ ...cfg })

// ================= A. 未配置 high:一切 passthrough(TC-10) =================
const s0 = fakeSession('sess-0') // 新会话
createAgent(s0)
let h = requestHandlers.get('sess-0')
let r = await h({ agent: { session: s0 }, turn: 1 }, LOW)
check('A1 no-high passthrough', r.model === 'flash', r)
check('A2 effort stripped even passthrough? no — untouched', r.reasoningEffort === 'high', r)

// ===== B. 配置 high → 新会话默认 low(不带自动 high;v1.1 修订) =====
let p = await call('/api/model-ladder/settings', 'POST', { high: { provider: 'deepseek', model: 'pro' } })
check('B1 high saved+valid', p.json.highValid === true && p.json.high.model === 'pro', p.json)
const s1 = fakeSession('sess-a') // 新会话(intent 无)→ 默认 passthrough(low)
createAgent(s1)
h = requestHandlers.get('sess-a')
for (const [turn, want] of [[1, 'flash'], [2, 'flash'], [3, 'flash'], [4, 'flash']]) {
  advance(s1, turn, true)
  r = await h({ agent: { session: s1 }, turn }, LOW)
  check('B turn' + turn + ' → ' + want + ' (low = default)', r.model === want, r)
  check('B turn' + turn + ' effort/maxTokens untouched', r.reasoningEffort === 'high' && r.maxTokens === 100, r)
}
// 显示口径:新会话不带窗口,始终 low
let g = await stateGet('sess-a')
check('G1 new session stays low (no auto window)', g.json.session.remaining === 0 && g.json.session.tier === 'low' && g.json.session.currentTurn === 4, g.json.session)

// ================= C. 手动 boost(TC-2):idle 时置 3 → 下 3 轮 =================
advance(s1, 4, false) // turn/end(轮 4 结束;lastTurn 仍 4,current=5)
p = await call('/api/model-ladder/session', 'POST', { sessionId: 'sess-a', turns: 3 })
check('C1 boost at idle → until 7, remaining 3', p.json.session.highUntilTurn === 7 && p.json.session.remaining === 3 && p.json.session.tier === 'high', p.json.session)

// ================= D. 带内改数字续窗 + 显式置 0 即时生效(TC-3/TC-6) =================
advance(s1, 5, true)
r = await h({ agent: { session: s1 }, turn: 5 }, LOW)
check('D1 turn5 high', r.model === 'pro', r)
// 置 0:下一个 step 即生效 → 当前轮 turn5 的后续 step 应 passthrough
await call('/api/model-ladder/session', 'POST', { sessionId: 'sess-a', turns: 0 })
r = await h({ agent: { session: s1 }, turn: 5 }, LOW)
check('D2 set-0 immediate (same turn later step)', r.model === 'flash', r)
// 再 boost 回来(带内 → 只换不动数的反例:显式 turns=2)
p = await call('/api/model-ladder/session', 'POST', { sessionId: 'sess-a', turns: 2 })
check('D3 re-boost at cur=5 → until 6', p.json.session.highUntilTurn === 6, p.json.session)
advance(s1, 6, true)
r = await h({ agent: { session: s1 }, turn: 6 }, LOW)
check('D4 turn6 high again', r.model === 'pro', r)

// ================= E. 轮询幂等(D 的 until 不被 GET 重置) =================
for (let i = 0; i < 3; i++) await stateGet('sess-a')
check('E1 GET never re-arms', (await stateGet('sess-a')).json.session.highUntilTurn === 6)
async function stateGet(id) {
  const res = { code: 0, body: null, writeHead(c) { this.code = c }, end(b) { this.body = b } }
  const req = { method: 'GET', url: 'http://x/api/model-ladder/state?sessionId=' + id, socket: { remoteAddress: '127.0.0.1' }, [Symbol.asyncIterator]: async function* () {} }
  await route('/api/model-ladder/state').handler(req, res)
  return { code: res.code, json: JSON.parse(res.body) }
}

// ================= F. high 失效 → passthrough;恢复 → 带内再生效(E4/TC-7) =================
advance(s1, 7, false)
await call('/api/model-ladder/session', 'POST', { sessionId: 'sess-a', turns: 2 }) // until 8
p = await call('/api/model-ladder/settings', 'POST', { high: { provider: 'x', model: 'gone' } })
check('F1 invalid marked highValid=false', p.json.highValid === false, p.json)
advance(s1, 7, true)
r = await h({ agent: { session: s1 }, turn: 7 }, LOW)
check('F2 invalid → passthrough in-band', r.model === 'flash', r)
p = await call('/api/model-ladder/settings', 'POST', { high: { provider: 'deepseek', model: 'pro' } })
r = await h({ agent: { session: s1 }, turn: 7 }, LOW)
check('F3 revalidates → high again (settings POST revalidates)', r.model === 'pro', r)
// adapters-updated 复验通路
await call('/api/model-ladder/settings', 'POST', { high: { provider: 'x', model: 'gone' } })
emit('llm/adapters-updated')
await new Promise((resolve) => setImmediate(resolve))
r = await h({ agent: { session: s1 }, turn: 7 }, LOW)
check('F4 adapters-updated revalidated invalid', r.model === 'flash', r)
await call('/api/model-ladder/settings', 'POST', { high: { provider: 'deepseek', model: 'pro' } })

// ================= G. 选 high 即 boost(client 组合:host 只看 boost 标志) =================
advance(s1, 8, false) // until 8 → current=9 带外
p = await call('/api/model-ladder/session', 'POST', { sessionId: 'sess-a', turns: 0 })
p = await call('/api/model-ladder/settings', 'POST', { sessionId: 'sess-a', high: { provider: 'deepseek', model: 'pro' }, boost: true })
check('G1 boost=true re-arms window', p.json.session.remaining === 3 && p.json.session.tier === 'high', p.json.session)
p = await call('/api/model-ladder/settings', 'POST', { sessionId: 'sess-a', high: { provider: 'deepseek', model: 'pro' }, boost: false })
check('G2 boost=false keeps in-band state', p.json.session.remaining === 3, p.json.session)

// ================= H. 重启/恢复语义(§1.2) =================
const s2 = fakeSession('sess-b', { lastTurn: 10, intent: { provider: 'deepseek', model: 'pro' } })
createAgent(s2) // 意图==high → 满血新窗口 11..13
h = requestHandlers.get('sess-b')
r = await h({ agent: { session: s2 }, turn: 11 }, LOW)
check('H1 resume intent==high → fresh window', r.model === 'pro', r)
const s3 = fakeSession('sess-d', { lastTurn: 3, intent: { provider: 'deepseek', model: 'other' } })
createAgent(s3)
h = requestHandlers.get('sess-d')
r = await h({ agent: { session: s3 }, turn: 4 }, LOW)
check('H2 resume intent!=high → passthrough', r.model === 'flash', r)

// ================= I. 子代理与守卫(E6/TC-8,守卫) =================
const s4 = fakeSession('sess-e', { subagent: true })
createAgent(s4)
check('I1 subagent not armed', !requestHandlers.has('sess-e'))
g = await stateGet('sess-e')
check('I2 subagent state session null', g.json.session === null, g.json)
p = await call('/api/model-ladder/session', 'POST', { sessionId: 'sess-e', turns: 3 })
check('I3 subagent boost rejected', p.code === 403, p)
p = await call('/api/model-ladder/session', 'POST', { sessionId: 'ghost', turns: 3 })
check('I4 unknown session 404', p.code === 404, p)
p = await call('/api/model-ladder/session', 'POST', { sessionId: 'sess-a', turns: 99 })
check('I5 turns>max 400', p.code === 400, p)
{
  const res = { code: 0, body: null, writeHead(c) { this.code = c }, end(b) { this.body = b } }
  await route('/api/model-ladder/state').handler({ method: 'GET', url: 'http://x/api/model-ladder/state', socket: { remoteAddress: '10.1.2.3' }, [Symbol.asyncIterator]: async function* () {} }, res)
  check('I6 non-loopback 403', res.code === 403, res.code)
}

// ================= 持久化 =================
const persisted = JSON.parse(await readFile(join(process.env.HOME, '.dsh', 'model-ladder.json'), 'utf8'))
check('P1 config persisted to redirected HOME', persisted.high && persisted.high.model === 'pro' && persisted.window === 3, persisted)

console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURES')
process.exit(failures === 0 ? 0 : 1)
