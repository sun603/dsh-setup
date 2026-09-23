#!/usr/bin/env node
/**
 * dsh-codex-bridge 离线冒烟:假 ctx + 假 sessionController + 假 req/res,
 * 直接驱动 lib/index.js 注册的全部路由处理器,不依赖真实 dsh server。
 *
 * 运行:node plugins/dsh-codex-bridge/tests/smoke.mjs
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const TMP = join(process.cwd(), '.tmp', 'codex-bridge-smoke')
const TOKEN = 'smoke-token-123'

// DSH_HOME 必须在 import 插件前就位(loadConfig 读它)。
process.env.DSH_HOME = TMP
await mkdir(TMP, { recursive: true })
await writeFile(join(TMP, 'codex-bridge.json'), JSON.stringify({ token: TOKEN, defaultCwd: '/tmp/default-cwd', defaultAgentPreset: '' }))

const { apply, name } = await import('../lib/index.js')

if (name !== 'dsh-codex-bridge') throw new Error('unexpected plugin name: ' + name)

// ---- 假 ctx / 假 controller ----

const promptCalls = []
const adopted = []
const registryCalls = []

/** 假 workspaceRegistry:/tmp/x 已注册,其它路径按需创建。 */
const fakeRegistry = {
  async resolveByPath(p) {
    registryCalls.push(['resolveByPath', p])
    return p === '/tmp/x'
      ? { id: 'ws-1', path: '/tmp/x', attachSession: async (id) => { adopted.push(id) } }
      : undefined
  },
  async create(p) {
    registryCalls.push(['create', p])
    return { id: 'ws-new', path: p, attachSession: async (id) => { adopted.push(id) } }
  },
}

/** follow 场景:'history' 首屏快照 / 'approval' / 'turn-end' / 'timeout' 挂起等 abort。 */
let followScenario = 'history'

const controller = {
  async list() {
    return { items: [{ sessionId: 'sess-live', updatedAt: 1789968325250, running: true, cwd: '/tmp/x', blank: false }] }
  },
  async create(request) {
    promptCalls.push(['create', request])
    return { sessionId: 'sess-new' }
  },
  async modelCatalog() {
    promptCalls.push(['modelCatalog', {}])
    return {
      default: { provider: 'aigw', model: 'deepseek-v4.1-flash' },
      routableProviders: ['aigw', 'stepfun'],
      groups: [
        { id: 'aigw', name: 'AIGW', models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }, { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash' }] },
        { id: 'stepfun', name: 'StepFun', models: [{ id: 'step-5-preview', name: 'Step 5 Preview' }] },
      ],
      failures: [],
    }
  },
  async selectModel(request) {
    promptCalls.push(['selectModel', request])
    return { selected: { provider: request.provider, model: request.model, ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }) } }
  },
  async prompt(request) {
    promptCalls.push(['prompt', request])
    return { accepted: true }
  },
  async cancel(request) {
    promptCalls.push(['cancel', request])
    return { accepted: true }
  },
  async *follow(request, signal) {
    promptCalls.push(['follow:' + followScenario, request])
    if (followScenario === 'history') {
      yield {
        type: 'snapshot',
        header: { title: undefined },
        cursor: 14,
        hasMore: true,
        records: [
          { type: 'event', event: { type: 'session/title', seq: 1, time: 1, data: { title: '冒烟会话' } } },
          { type: 'event', event: { type: 'user/message', seq: 2, time: 2, data: { message: { role: 'user', content: [{ type: 'text', text: '你好' }] } } } },
          {
            type: 'event',
            event: {
              type: 'assistant/message',
              seq: 14,
              time: 3,
              data: {
                message: {
                  role: 'assistant',
                  content: [
                    { type: 'reasoning', text: '先想一下' },
                    { type: 'text', text: '你好,有什么可以帮?' },
                    { type: 'tool-call', name: 'bash' },
                  ],
                },
              },
            },
          },
          { type: 'event', event: { type: 'turn/end', seq: 15, time: 4, data: {} } },
        ],
      }
      return
    }
    if (followScenario === 'timeout') {
      yield { type: 'snapshot', cursor: 100, hasMore: false, records: [] }
      // 挂起直到调用方 abort(模拟宿主流对 signal 的响应)
      while (!signal.aborted) await new Promise((r) => setTimeout(r, 20))
      throw new Error('aborted')
    }
    yield { type: 'snapshot', cursor: 100, hasMore: false, records: [] }
    yield { type: 'event', event: { type: 'step/start', seq: 101, time: 4, data: {} } }
    yield {
      type: 'event',
      event: {
        type: 'assistant/message',
        seq: 102,
        time: 5,
        data: { message: { role: 'assistant', content: [{ type: 'text', text: '先看看' }, { type: 'tool-call', name: 'run_code' }] } },
      },
    }
    yield { type: 'event', event: { type: 'step/start', seq: 103, time: 6, data: {} } }
    yield {
      type: 'event',
      event: { type: 'assistant/message', seq: 104, time: 7, data: { message: { role: 'assistant', content: [{ type: 'text', text: '干完了' }] } } },
    }
    if (followScenario === 'approval') {
      yield {
        type: 'event',
        event: { type: 'approval/asked', seq: 105, time: 8, data: { id: 'apr-1', toolName: 'bash', reason: 'rm -rf /tmp/x' } },
      }
    } else {
      yield { type: 'event', event: { type: 'turn/end', seq: 105, time: 8, data: {} } }
    }
  },
}

const routes = new Map()
const fakeWebServer = {
  register: (route) => {
    routes.set(route.path, route)
    return () => routes.delete(route.path)
  },
}

// ---- 假 agent / waterfall 捕获(决定中继用)----
/** event → 已注册的 listener(append 顺序;新注册的取最后一条)。 */
const agentListeners = new Map()
const createdHandlers = []
const fakeAgent = {
  session: { id: 'sess-live' },
  ctx: {
    on(event, listener) {
      if (!agentListeners.has(event)) agentListeners.set(event, [])
      agentListeners.get(event).push(listener)
      return () => {}
    },
  },
}
function fireAgentCreated() {
  for (const h of createdHandlers) h({ agent: fakeAgent })
}
function lastListener(event) {
  const list = agentListeners.get(event) ?? []
  return list.length === 0 ? undefined : list[list.length - 1]
}

const ctx = {
  // inject: ['webServer'] 在真实 Cordis 里把服务挂成 ctx 属性;假 ctx 照抄这个面。
  webServer: fakeWebServer,
  on(event, handler) {
    if (event === 'agent/created') createdHandlers.push(handler)
    return () => {}
  },
  get(key) {
    if (key === 'webServer') return fakeWebServer
    if (key === 'sessionController') return controller
    if (key === 'workspaceRegistry') return fakeRegistry
    return undefined
  },
  effect(fn) {
    return fn()
  },
}

apply(ctx)
fireAgentCreated()

if (routes.size !== 9) throw new Error('expected 9 routes, got ' + routes.size)

// ---- 假 req/res ----

function mockReq(method, url, { body, remoteAddress = '127.0.0.1', headers = {} } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
  return {
    method,
    url,
    headers,
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() {
      if (payload !== null) yield payload
    },
  }
}

function mockRes() {
  const res = { statusCode: null, body: '' }
  res.writeHead = (code) => { res.statusCode = code }
  res.end = (chunk) => { res.body = chunk === undefined ? '' : String(chunk) }
  return res
}

async function call(method, url, options) {
  const path = url.split('?')[0]
  const route = routes.get(path)
  if (!route) throw new Error('no route for ' + path)
  const req = mockReq(method, url, options)
  const res = mockRes()
  await route.handler(req, res)
  let json = null
  try { json = JSON.parse(res.body) } catch { /* keep null */ }
  return { status: res.statusCode, json }
}

let failures = 0
function check(label, cond, extra) {
  if (cond) {
    console.log('  ok  ' + label)
  } else {
    failures++
    console.log('  FAIL ' + label + (extra === undefined ? '' : ' — ' + JSON.stringify(extra)))
  }
}

// ---- 用例 ----

console.log('smoke: ' + name)

{
  const r = await call('GET', '/api/codex-bridge/health')
  check('health 200', r.status === 200 && r.json.ok === true, r)
  check('health 报道 controller', r.json.controller === true, r)
}
{
  const r = await call('GET', '/api/codex-bridge/sessions', { headers: { authorization: 'Bearer ' + TOKEN } })
  check('sessions 200 + 1 item', r.status === 200 && r.json.sessions.length === 1 && r.json.sessions[0].sessionId === 'sess-live', r)
}
{
  const r = await call('GET', '/api/codex-bridge/sessions', { headers: { authorization: 'Bearer wrong' } })
  check('sessions bad token 401', r.status === 401, r)
}
{
  const r = await call('GET', '/api/codex-bridge/sessions', { remoteAddress: '10.0.0.2', headers: { authorization: 'Bearer ' + TOKEN } })
  check('non-loopback 403', r.status === 403, r)
}
{
  const r = await call('GET', '/api/codex-bridge/history?sessionId=sess-live&maxMessages=10', { headers: { authorization: 'Bearer ' + TOKEN } })
  check('history 200', r.status === 200, r)
  check('history title', r.json.title === '冒烟会话', r)
  check('history messages', r.json.messages.length === 2 && r.json.messages[0].role === 'user' && r.json.messages[1].text.includes('tool-call'), r)
  check('history 默认不含 thinking', !r.json.messages[1].text.includes('先想一下'), r)
  check('history cursor/hasMore', r.json.cursor === 14 && r.json.hasMore === true, r)
  check('history latestSeq', r.json.latestSeq === 14, r)
}
{
  const r = await call('GET', '/api/codex-bridge/history?sessionId=sess-live&afterSeq=10', { headers: { authorization: 'Bearer ' + TOKEN } })
  check('history afterSeq 只回新消息', r.status === 200 && r.json.messages.length === 1 && r.json.messages[0].seq === 14, r)
}
{
  const r = await call('GET', '/api/codex-bridge/history?sessionId=sess-live&afterSeq=14', { headers: { authorization: 'Bearer ' + TOKEN } })
  check('history afterSeq=cursor 回空', r.status === 200 && r.json.messages.length === 0, r)
}
{
  const r = await call('GET', '/api/codex-bridge/history?sessionId=sess-live&includeThinking=true', { headers: { authorization: 'Bearer ' + TOKEN } })
  check('history includeThinking 带上 reasoning', r.json.messages[1].text.includes('[thinking] 先想一下'), r)
}
{
  const r = await call('GET', '/api/codex-bridge/history', { headers: { authorization: 'Bearer ' + TOKEN } })
  check('history 缺 sessionId 400', r.status === 400, r)
}
{
  followScenario = 'approval'
  const r = await call('GET', '/api/codex-bridge/wait?sessionId=sess-live&waitSec=5', { headers: { authorization: 'Bearer ' + TOKEN } })
  check('wait approval 200', r.status === 200, r)
  check('wait approval 结局', r.json.reason === 'approval' && r.json.approval?.toolName === 'bash' && r.json.approval?.reason === 'rm -rf /tmp/x', r)
  check('wait approval 只回最后一条(默认 final)', r.json.final?.text === '干完了' && r.json.messages === undefined, r)
  check('wait approval digest', r.json.digest === '2 steps · 1 tool calls (run_code×1) · 6 chars intermediate', r)
  check('wait approval latestSeq', r.json.latestSeq === 105, r)
}
{
  followScenario = 'turn-end'
  const r = await call('GET', '/api/codex-bridge/wait?sessionId=sess-live&waitSec=5', { headers: { authorization: 'Bearer ' + TOKEN } })
  check('wait turn-end 结局', r.json.reason === 'turn-end' && r.json.final?.text === '干完了' && r.json.latestSeq === 105, r)
  check('wait turn-end digest', r.json.digest === '2 steps · 1 tool calls (run_code×1) · 6 chars intermediate', r)
}
{
  followScenario = 'turn-end'
  const r = await call('GET', '/api/codex-bridge/wait?sessionId=sess-live&waitSec=5&detail=all', { headers: { authorization: 'Bearer ' + TOKEN } })
  check('wait detail=all 回全部过程消息', r.json.messages?.length === 2 && r.json.messages[0].text.startsWith('先看看') && r.json.messages[0].text.includes('[tool-call run_code]') && r.json.final === undefined, r)
}
{
  followScenario = 'turn-end'
  const r = await call('GET', '/api/codex-bridge/wait?sessionId=sess-live&waitSec=5&afterSeq=101', { headers: { authorization: 'Bearer ' + TOKEN } })
  check('wait afterSeq 过滤旧消息', r.json.reason === 'turn-end' && r.json.final?.text === '干完了' && r.json.digest === '1 steps · 1 tool calls (run_code×1) · 6 chars intermediate', r)
}
{
  followScenario = 'timeout'
  const started = Date.now()
  const r = await call('GET', '/api/codex-bridge/wait?sessionId=sess-live&waitSec=1', { headers: { authorization: 'Bearer ' + TOKEN } })
  const elapsed = Date.now() - started
  check('wait timeout 结局', r.json.reason === 'timeout' && r.json.messages === undefined && !r.json.final && r.json.latestSeq === 100, r)
  check('wait timeout 按时返回(1s 档)', elapsed >= 900 && elapsed < 4000, { elapsed })
}
{
  followScenario = 'history'
  const r = await call('POST', '/api/codex-bridge/wait', { headers: { authorization: 'Bearer ' + TOKEN } })
  check('wait POST 405', r.status === 405, r)
}
{
  promptCalls.length = 0
  registryCalls.length = 0
  const r = await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '跑个任务' },
  })
  check('prompt 新建 200', r.status === 200 && r.json.sessionId === 'sess-new' && r.json.created === true && r.json.accepted === true, r)
  check('prompt 新建回带 cwd', r.json.cwd === '/tmp/default-cwd', r)
  check('prompt 新建 grouped=true', r.json.grouped === true, r)
  check('prompt 新建走 workspaceId(非裸 cwd)', promptCalls[0][1].workspaceId === 'ws-new' && promptCalls[0][1].cwd === undefined, promptCalls)
  check('prompt 新建按需建工作区', registryCalls[0][0] === 'resolveByPath' && registryCalls[1][0] === 'create', registryCalls)
  check('prompt 新建后 prompt(requestId/mode=queue)', promptCalls[1][0] === 'prompt' && promptCalls[1][1].mode === 'queue' && typeof promptCalls[1][1].requestId === 'string', promptCalls)
}
{
  promptCalls.length = 0
  registryCalls.length = 0
  const r = await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '已注册目录', cwd: '/tmp/x' },
  })
  check('prompt 已注册目录复用工作区', r.json.grouped === true && promptCalls[0][1].workspaceId === 'ws-1' && registryCalls.length === 1, { r, registryCalls })
}
{
  adopted.length = 0
  const r = await call('POST', '/api/codex-bridge/adopt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { sessionId: 'sess-live' },
  })
  check('adopt 反查 cwd 并收编', r.status === 200 && r.json.workspaceId === 'ws-1' && r.json.path === '/tmp/x' && adopted[0] === 'sess-live', r)
}
{
  adopted.length = 0
  const r = await call('POST', '/api/codex-bridge/adopt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { sessionId: 'sess-live', cwd: '/tmp/unknown' },
  })
  check('adopt 未注册目录按需建', r.status === 200 && r.json.workspaceId === 'ws-new' && adopted[0] === 'sess-live', r)
}
{
  const r = await call('POST', '/api/codex-bridge/adopt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { sessionId: 'no-such-session' },
  })
  check('adopt 未知会话 404', r.status === 404, r)
}
{
  promptCalls.length = 0
  const r = await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '插话', sessionId: 'sess-live', mode: 'steer' },
  })
  check('prompt 注入 200', r.status === 200 && r.json.sessionId === 'sess-live' && r.json.created === false, r)
  check('prompt 注入 mode=steer', promptCalls.length === 1 && promptCalls[0][1].mode === 'steer', promptCalls)
}
{
  const r = await call('POST', '/api/codex-bridge/prompt', { headers: { authorization: 'Bearer ' + TOKEN }, body: { text: '   ' } })
  check('prompt 空文本 400', r.status === 400, r)
}
{
  const r = await call('POST', '/api/codex-bridge/cancel', { headers: { authorization: 'Bearer ' + TOKEN }, body: { sessionId: 'sess-live' } })
  check('cancel 200', r.status === 200 && r.json.accepted === true, r)
}
{
  const r = await call('POST', '/api/codex-bridge/sessions', { headers: { authorization: 'Bearer ' + TOKEN } })
  check('sessions POST 405', r.status === 405, r)
}

// ---- 决定中续:审批 / 提问 的代决定(control 开关两阶段)----

{
  // Phase 1:control 关(当前配置)→ 监听器直接 next(),不接管
  let nextCalled = false
  const listener = lastListener('approval/request')
  const outcome = await listener({ toolName: 'bash', reason: 'escalate' }, () => {
    nextCalled = true
    return Promise.resolve('allowed-once')
  })
  check('control 关:审批直接委托 GUI', nextCalled === true && outcome === 'allowed-once', { nextCalled, outcome })
  const r = await call('POST', '/api/codex-bridge/decide', { headers: { authorization: 'Bearer ' + TOKEN }, body: { sessionId: 'sess-live' } })
  check('control 关:无 pending 可决 → 404', r.status === 404, r)
}
{
  // Phase 2:改写配置打开 control,重新挂载(模拟重启后的新配置)
  await writeFile(join(TMP, 'codex-bridge.json'), JSON.stringify({ token: TOKEN, defaultCwd: '/tmp/default-cwd', control: { approvals: true, questions: true } }))
  agentListeners.clear()
  createdHandlers.length = 0
  apply(ctx)
  fireAgentCreated()
  await new Promise((r) => setTimeout(r, 60)) // 等 loadConfig 落定
  check('control 开:两个 listener 已注册', lastListener('approval/request') !== undefined && lastListener('user-questions/request') !== undefined)
}
{
  // codex 代批:监听器挂起 → /decide allow → 监听器返回 allowed-once
  // (注意:listener 会立刻 next() 启动人类竞速路径——设计如此;人类路径永悬不影响 codex 决定)
  const listener = lastListener('approval/request')
  let humanPathStarted = false
  const pending = listener({ toolName: 'bash', reason: 'podman 需要 full-access' }, () => {
    humanPathStarted = true
    return new Promise(() => {}) // 人类永不点(测 codex 路径)
  })
  await new Promise((r) => setTimeout(r, 20))
  check('人类竞速路径已启动(GUI 未被屏蔽)', humanPathStarted === true)
  const decided = await call('POST', '/api/codex-bridge/decide', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { sessionId: 'sess-live', allow: true },
  })
  check('decide allow → allowed-once', decided.status === 200 && decided.json.outcome === 'allowed-once' && decided.json.kind === 'approval', decided)
  check('decide 后监听器收结果', (await pending) === 'allowed-once')
  const again = await call('POST', '/api/codex-bridge/decide', { headers: { authorization: 'Bearer ' + TOKEN }, body: { sessionId: 'sess-live', allow: true } })
  check('重复 decide → 404(pending 已清)', again.status === 404, again)
}
{
  // 人类竞速:next() 先返回 → 人类赢,pending 撤条
  const listener = lastListener('approval/request')
  const outcome = await listener({ toolName: 'bash', reason: 'x' }, () => Promise.resolve('rejected'))
  check('人类先决:监听器返回人类结果', outcome === 'rejected', { outcome })
  const r = await call('POST', '/api/codex-bridge/decide', { headers: { authorization: 'Bearer ' + TOKEN }, body: { sessionId: 'sess-live', allow: true } })
  check('人类先决:pending 已撤 → 404', r.status === 404, r)
}
{
  // deny 路径
  const listener = lastListener('approval/request')
  const pending = listener({ toolName: 'bash', reason: 'rm -rf' }, () => new Promise(() => {}))
  await new Promise((r) => setTimeout(r, 20))
  const decided = await call('POST', '/api/codex-bridge/decide', { headers: { authorization: 'Bearer ' + TOKEN }, body: { sessionId: 'sess-live', allow: false } })
  check('decide deny → rejected', decided.json.outcome === 'rejected', decided)
  check('deny 后监听器收结果', (await pending) === 'rejected')
}
{
  // 提问:selected / custom 两种答法
  const listener = lastListener('user-questions/request')
  const req = { questions: [{ id: 'q1', question: '用哪个方案?', options: ['A', 'B'] }] }
  const pending = listener(req, () => new Promise(() => {}))
  await new Promise((r) => setTimeout(r, 20))
  const decided = await call('POST', '/api/codex-bridge/decide', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { sessionId: 'sess-live', selected: 'A' },
  })
  check('decide 提问 selected', decided.json.outcome?.answers?.[0]?.selected?.[0] === 'A' && decided.json.outcome.answers[0].id === 'q1', decided)
  check('提问回答送达监听器', JSON.stringify(await pending).includes('"selected":["A"]'))
}
{
  // decisionId 精确寻址
  const listener = lastListener('user-questions/request')
  const pending = listener({ questions: [{ id: 'q2', question: '确认?' }] }, () => new Promise(() => {}))
  await new Promise((r) => setTimeout(r, 20))
  const bad = await call('POST', '/api/codex-bridge/decide', { headers: { authorization: 'Bearer ' + TOKEN }, body: { sessionId: 'sess-live', decisionId: 'nope', custom: 'x' } })
  check('未知 decisionId → 404', bad.status === 404, bad)
  const good = await call('POST', '/api/codex-bridge/decide', { headers: { authorization: 'Bearer ' + TOKEN }, body: { sessionId: 'sess-live', custom: '继续' } })
  check('缺省 decisionId 取最旧一条', good.status === 200 && good.json.outcome.answers[0].custom === '继续', good)
  await pending
}
{
  // /wait return 模式:决定登记即唤醒,带回 decisionId
  followScenario = 'timeout'
  const waitP = call('GET', '/api/codex-bridge/wait?sessionId=sess-live&waitSec=3', { headers: { authorization: 'Bearer ' + TOKEN } })
  await new Promise((r) => setTimeout(r, 80))
  const listener = lastListener('approval/request')
  void listener({ toolName: 'bash', reason: 'podman' }, () => new Promise(() => {}))
  const r = await waitP
  check('wait return 模式:decision 唤醒', r.json.reason === 'decision' && r.json.decision?.kind === 'approval' && r.json.decision?.toolName === 'bash' && typeof r.json.decision?.decisionId === 'string', r)
  // 清掉这条 pending(人类路径永悬,drop 掉)
  const cleanup = await call('POST', '/api/codex-bridge/decide', { headers: { authorization: 'Bearer ' + TOKEN }, body: { sessionId: 'sess-live', allow: false } })
  check('wait 测试后清理 pending', cleanup.status === 200, cleanup)
}
{
  // /wait hold 模式:决定不唤醒,记入 decisions;decide 后 outcome 回填
  followScenario = 'timeout'
  const waitP = call('GET', '/api/codex-bridge/wait?sessionId=sess-live&waitSec=1&onDecision=hold', { headers: { authorization: 'Bearer ' + TOKEN } })
  await new Promise((r) => setTimeout(r, 80))
  const listener = lastListener('approval/request')
  const pending = listener({ toolName: 'bash', reason: 'podman' }, () => new Promise(() => {}))
  await new Promise((r) => setTimeout(r, 40))
  await call('POST', '/api/codex-bridge/decide', { headers: { authorization: 'Bearer ' + TOKEN }, body: { sessionId: 'sess-live', allow: true } })
  const r = await waitP
  check('wait hold 模式:超时但带 decisions', r.json.reason === 'timeout' && r.json.decisions?.length === 1 && r.json.decisions[0].outcome === 'allowed-once', r)
  await pending
}
{
  const r = await call('POST', '/api/codex-bridge/decide', { headers: { authorization: 'Bearer ' + TOKEN }, body: {} })
  check('decide 缺 sessionId 400', r.status === 400, r)
}

// ---- 模型选择:/models + /prompt 的 model 参数 ----

{
  const r = await call('GET', '/api/codex-bridge/models', { headers: { authorization: 'Bearer ' + TOKEN } })
  check('/models 返回 catalog', r.status === 200 && r.json.default?.model === 'deepseek-v4.1-flash' && r.json.groups?.length === 2, r)
}
{
  // 紧凑串:"provider/model" 按第一个 / 拆
  promptCalls.length = 0
  const r = await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '紧凑串', cwd: '/tmp/x', model: 'aigw/deepseek-v4.1-flash' },
  })
  const sel = promptCalls.find((c) => c[0] === 'selectModel')
  check('紧凑串:selectModel 拆对', sel?.[1]?.provider === 'aigw' && sel?.[1]?.model === 'deepseek-v4.1-flash', sel)
  check('紧凑串:selectModel 先于 prompt', promptCalls.findIndex((c) => c[0] === 'selectModel') < promptCalls.findIndex((c) => c[0] === 'prompt'), promptCalls.map((c) => c[0]))
  check('紧凑串:响应回显 model', r.json.model?.provider === 'aigw' && r.json.model?.model === 'deepseek-v4.1-flash', r)
}
{
  // 对象形式 + reasoningEffort 透传
  promptCalls.length = 0
  await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '对象', sessionId: 'sess-live', model: { provider: 'stepfun', model: 'step-5-preview', reasoningEffort: 'high' } },
  })
  const sel = promptCalls.find((c) => c[0] === 'selectModel')
  check('对象:字段透传', sel?.[1]?.provider === 'stepfun' && sel?.[1]?.model === 'step-5-preview' && sel?.[1]?.reasoningEffort === 'high', sel)
}
{
  // 不传 model:不调 selectModel(用部署默认)
  promptCalls.length = 0
  const r = await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '无模型', sessionId: 'sess-live' },
  })
  check('不传 model:不调 selectModel', !promptCalls.some((c) => c[0] === 'selectModel'), promptCalls.map((c) => c[0]))
  check('不传 model:响应无 model 字段', r.json.model === undefined, r)
}
{
  // 非法 model:400 且不派活(不静默用默认)
  promptCalls.length = 0
  const r = await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '坏模型', sessionId: 'sess-live', model: 'no-slash' },
  })
  check('非法 model:400', r.status === 400, r)
  check('非法 model:不派活', !promptCalls.some((c) => c[0] === 'prompt'), promptCalls.map((c) => c[0]))
}

{
  // defaultModel:仅新建会话生效(已有会话不碰)
  await writeFile(join(TMP, 'codex-bridge.json'), JSON.stringify({
    token: TOKEN,
    control: { approvals: true, questions: true },
    defaultModel: 'stepfun/step-5-preview',
  }))
  promptCalls.length = 0
  const r = await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '默认模型新建', cwd: '/tmp/x' },
  })
  const sel = promptCalls.find((c) => c[0] === 'selectModel')
  check('defaultModel:新建会话自动选模型', sel?.[1]?.provider === 'stepfun' && sel?.[1]?.model === 'step-5-preview', sel)
  check('defaultModel:响应回显', r.json.model?.model === 'step-5-preview', r)
}
{
  // defaultModel 不作用于已有会话
  promptCalls.length = 0
  await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '已有会话', sessionId: 'sess-live' },
  })
  check('defaultModel:已有会话不选模型', !promptCalls.some((c) => c[0] === 'selectModel'), promptCalls.map((c) => c[0]))
}
{
  // 显式 model 压过 defaultModel
  promptCalls.length = 0
  await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '显式优先', cwd: '/tmp/x', model: { provider: 'aigw', model: 'qwen3.8-flash' } },
  })
  const sel = promptCalls.find((c) => c[0] === 'selectModel')
  check('显式 model 压过 defaultModel', sel?.[1]?.provider === 'aigw' && sel?.[1]?.model === 'qwen3.8-flash', sel)
}
{
  // defaultModel 非法:新建会话 400 且不派活(与显式 model 同路径)
  await writeFile(join(TMP, 'codex-bridge.json'), JSON.stringify({ token: TOKEN, defaultModel: 'bad-no-slash' }))
  promptCalls.length = 0
  const r = await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '坏默认', cwd: '/tmp/x' },
  })
  check('defaultModel 非法:400', r.status === 400, r)
  check('defaultModel 非法:不派活', !promptCalls.some((c) => c[0] === 'prompt'), promptCalls.map((c) => c[0]))
  // 恢复:无 defaultModel 的配置(后续唤醒段会再写自己的)
  await writeFile(join(TMP, 'codex-bridge.json'), JSON.stringify({ token: TOKEN, control: { approvals: true, questions: true } }))
}

// ---- 唤醒:dsh_prompt 带 threadId(一轮一绑)+ watcher 通知(假 codex 脚本记账)----

const wakeBin = join(TMP, 'fake-codex.sh')
const wakeLog = join(TMP, 'wake.log')
await writeFile(wakeBin, '#!/bin/sh\nprintf "%s\n" "$*" >> ' + JSON.stringify(wakeLog) + '\n')
await chmod(wakeBin, 0o755)
await writeFile(wakeLog, '') // 清空:防上次运行的残留行污染计数
const wakeLines = async () => {
  try {
    return (await readFile(wakeLog, 'utf8')).split('\n').filter((l) => l !== '')
  } catch {
    return []
  }
}

{
  // wake 关(当前配置无 wake 段):传了 threadId 也不武装
  followScenario = 'turn-end'
  const r = await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '唤醒关', cwd: '/tmp/x', threadId: 'thr-off' },
  })
  check('wake 关:传 threadId 不武装', r.json.wakeArmed === false, r)
  await new Promise((res) => setTimeout(res, 300))
  check('wake 关:不发通知', (await wakeLines()).length === 0)
}
{
  // wake 开:派活带 threadId → 一轮制武装 → turn/end → 假 codex 收到 queue 通知
  await writeFile(join(TMP, 'codex-bridge.json'), JSON.stringify({
    token: TOKEN,
    control: { approvals: true, questions: true },
    wake: { enabled: true, codexBin: wakeBin },
  }))
  followScenario = 'turn-end'
  const r = await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '唤醒开', cwd: '/tmp/x', threadId: 'thr-A' },
  })
  check('wake 开:wakeArmed=true', r.json.wakeArmed === true, r)
  await new Promise((res) => setTimeout(res, 600))
  const lines = await wakeLines()
  check('watcher 触发 codex queue 通知', lines.some((l) => l.includes('--thread') && l.includes('thr-A') && l.includes('DSH turn finished') && l.includes('sess-new')), lines)
  check('一轮只通知一次', lines.filter((l) => l.includes('thr-A')).length === 1, lines)
}
{
  // 一轮制:下一轮要唤醒得再传 threadId(再武装 → 再通知一条)
  followScenario = 'turn-end'
  const r = await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '第二轮', sessionId: 'sess-live', threadId: 'thr-A' },
  })
  check('再传 threadId:再武装', r.json.wakeArmed === true, r)
  await new Promise((res) => setTimeout(res, 600))
  const lines = await wakeLines()
  check('第二轮再通知一次', lines.filter((l) => l.includes('thr-A')).length === 2, lines)
}
{
  // 不传 threadId:不武装、不通知(计数不变)
  followScenario = 'turn-end'
  const before = (await wakeLines()).length
  await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '无线程', sessionId: 'sess-live' },
  })
  await new Promise((res) => setTimeout(res, 400))
  const after = (await wakeLines()).length
  check('不传 threadId:无唤醒(计数不变)', before === after, { before, after })
  const r = await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '无线程2', sessionId: 'sess-live' },
  })
  check('不传 threadId:响应无 wakeArmed 字段', r.json.wakeArmed === undefined, r)
}

// ---- 决定唤醒:wake 模式下审批/提问也 hook codex(N+1:决定唤醒 + 收尾唤醒)----

{
  // 审批:watcher 挂起(timeout 场景,绑定活着)→ 触发决定 → 决定唤醒发射
  followScenario = 'timeout'
  await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '决定唤醒', sessionId: 'sess-live', threadId: 'thr-D' },
  })
  const listener = lastListener('approval/request')
  const pending = listener({ toolName: 'bash', reason: 'podman 需要 full-access' }, () => new Promise(() => {}))
  await new Promise((r) => setTimeout(r, 300)) // 等 fire-and-forget 的 queue 落盘
  const line = (await wakeLines()).find((l) => l.includes('thr-D'))
  check(
    '审批决定唤醒:内容含 kind/tool/reason/decisionId',
    line !== undefined && line.includes('[DSH decision pending]') && line.includes('kind=approval') && line.includes('tool=bash') && line.includes('reason=podman') && /decisionId=[0-9a-f-]{36}/.test(line),
    line,
  )
  // 醒来后 codex 代决 → 监听器收结果
  const decided = await call('POST', '/api/codex-bridge/decide', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { sessionId: 'sess-live', allow: true },
  })
  check('决定唤醒后代决仍可用', decided.status === 200 && decided.json.outcome === 'allowed-once', decided)
  check('代决后监听器收结果', (await pending) === 'allowed-once')
  // N+1:收尾唤醒仍打到同一线程(决定唤醒没有释放绑定)
  followScenario = 'turn-end'
  await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '收尾', sessionId: 'sess-live', threadId: 'thr-D' },
  })
  await new Promise((r) => setTimeout(r, 600))
  const finish = (await wakeLines()).filter((l) => l.includes('thr-D') && l.includes('DSH turn finished'))
  check('N+1:收尾唤醒仍打到同一线程', finish.length === 1, finish)
}
{
  // 提问:决定唤醒带问题与选项
  followScenario = 'timeout'
  await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '提问唤醒', sessionId: 'sess-live', threadId: 'thr-Q' },
  })
  const listener = lastListener('user-questions/request')
  const pending = listener({ questions: [{ id: 'q1', question: '继续还是停止?', options: [{ label: '继续' }, { label: '停止' }] }] }, () => new Promise(() => {}))
  await new Promise((r) => setTimeout(r, 300))
  const line = (await wakeLines()).find((l) => l.includes('thr-Q'))
  check('提问决定唤醒:含问题与选项', line !== undefined && line.includes('kind=question') && line.includes('继续还是停止?') && line.includes('options=继续|停止'), line)
  await call('POST', '/api/codex-bridge/decide', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { sessionId: 'sess-live', selected: '继续' },
  })
  await pending
}
{
  // wake 关:不发射决定唤醒(热加载关开关)
  await writeFile(join(TMP, 'codex-bridge.json'), JSON.stringify({ token: TOKEN, control: { approvals: true, questions: true } }))
  followScenario = 'timeout'
  const r = await call('POST', '/api/codex-bridge/prompt', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { text: '唤醒已关', sessionId: 'sess-live', threadId: 'thr-off2' },
  })
  check('wake 关:传 threadId 不武装', r.json.wakeArmed === false, r)
  const before = (await wakeLines()).length
  const listener = lastListener('approval/request')
  const pending = listener({ toolName: 'bash', reason: 'x' }, () => new Promise(() => {}))
  await new Promise((r) => setTimeout(r, 300))
  check('wake 关:决定不唤醒', (await wakeLines()).length === before)
  await call('POST', '/api/codex-bridge/decide', {
    headers: { authorization: 'Bearer ' + TOKEN },
    body: { sessionId: 'sess-live', allow: true },
  })
  await pending
}

console.log(failures === 0 ? 'SMOKE OK (all passed)' : 'SMOKE FAILED: ' + failures)
process.exit(failures === 0 ? 0 : 1)
