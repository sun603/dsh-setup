#!/usr/bin/env node
/**
 * dsh-codex-bridge MCP server 端到端冒烟:
 * 起一个内存 stub HTTP bridge → spawn mcp/server.mjs → 走完整 MCP 握手 + 四个工具。
 *
 * 运行:node plugins/dsh-codex-bridge/tests/mcp-smoke.mjs
 */

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverPath = path.join(here, '..', 'mcp', 'server.mjs')
const TOKEN = 'mcp-smoke-token'

// ---- stub bridge(复刻插件端点的最小语义)----

let lastPromptBody = null
let waitCallCount = 0

const stub = createServer((req, res) => {
  const read = () =>
    new Promise((resolve) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => resolve(body === '' ? {} : JSON.parse(body)))
    })
  const json = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
  const authOk = req.headers.authorization === 'Bearer ' + TOKEN
  void (async () => {
    if (req.url === '/api/codex-bridge/health') return json(200, { ok: true, plugin: 'dsh-codex-bridge', controller: true })
    if (!authOk) return json(401, { ok: false, error: 'bad token' })
    if (req.url === '/api/codex-bridge/sessions' && req.method === 'GET') {
      return json(200, { ok: true, sessions: [{ sessionId: 'sess-live', updatedAt: 1789968325250, running: true, cwd: '/tmp/x', blank: false }] })
    }
    if (req.url?.startsWith('/api/codex-bridge/history') && req.method === 'GET') {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (url.searchParams.get('sessionId') !== 'sess-live') return json(404, { ok: false, error: 'session not found' })
      const afterSeq = Number(url.searchParams.get('afterSeq'))
      const all = [
        { role: 'user', text: '你好', seq: 2 },
        { role: 'assistant', text: '你好,有什么可以帮?', seq: 14 },
      ]
      const messages = Number.isFinite(afterSeq) ? all.filter((m) => m.seq > afterSeq) : all
      return json(200, {
        ok: true,
        sessionId: 'sess-live',
        title: '冒烟会话',
        cursor: 14,
        latestSeq: 14,
        hasMore: false,
        messages,
      })
    }
    if (req.url === '/api/codex-bridge/models' && req.method === 'GET') {
      return json(200, {
        ok: true,
        default: { provider: 'aigw', model: 'deepseek-v4.1-flash' },
        routableProviders: ['aigw', 'stepfun'],
        groups: [
          { id: 'aigw', name: 'AIGW', models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }, { id: 'qwen3.8-flash' }] },
          { id: 'stepfun', name: 'StepFun', models: [{ id: 'step-5-preview' }] },
        ],
        failures: [],
      })
    }
    if (req.url === '/api/codex-bridge/prompt' && req.method === 'POST') {
      const body = await read()
      lastPromptBody = body
      const wakeArmed = typeof body.threadId === 'string' && body.threadId !== '' ? true : undefined
      if (body.sessionId === undefined) {
        return json(200, { ok: true, sessionId: 'sess-new', created: true, accepted: true, cwd: body.cwd ?? '/tmp/default-cwd', grouped: true, ...(wakeArmed === undefined ? {} : { wakeArmed }) })
      }
      return json(200, { ok: true, sessionId: body.sessionId, created: false, accepted: true, ...(wakeArmed === undefined ? {} : { wakeArmed }) })
    }
    if (req.url === '/api/codex-bridge/adopt' && req.method === 'POST') {
      const body = await read()
      if (body.sessionId !== 'sess-live') return json(404, { ok: false, error: 'session cwd unknown' })
      return json(200, { ok: true, sessionId: 'sess-live', workspaceId: 'ws-1', path: '/tmp/x' })
    }
    if (req.url === '/api/codex-bridge/cancel' && req.method === 'POST') {
      const body = await read()
      return json(200, { ok: true, sessionId: body.sessionId, accepted: true })
    }
    if (req.url?.startsWith('/api/codex-bridge/wait') && req.method === 'GET') {
      const url = new URL(req.url, 'http://127.0.0.1')
      const detail = url.searchParams.get('detail') ?? 'final'
      // 按调用次序轮换结局:turn-end → approval → timeout → decision;detail=all 走全量形状
      const scenario = detail === 'all' ? 'turn-end' : ['turn-end', 'approval', 'timeout', 'decision'][waitCallCount++ % 4]
      if (scenario === 'approval') {
        return json(200, {
          ok: true,
          sessionId: 'sess-live',
          reason: 'approval',
          latestSeq: 102,
          approval: { toolName: 'bash', reason: 'rm -rf /tmp/x' },
          digest: '1 steps · 1 tool calls (bash×1)',
          final: { role: 'assistant', text: '准备执行删除' },
        })
      }
      if (scenario === 'timeout') {
        return json(200, { ok: true, sessionId: 'sess-live', reason: 'timeout', latestSeq: 100, approval: null, digest: '', final: null })
      }
      if (scenario === 'decision') {
        return json(200, {
          ok: true,
          sessionId: 'sess-live',
          reason: 'decision',
          latestSeq: 103,
          digest: '1 steps · 1 tool calls (bash×1)',
          decision: { decisionId: 'dec-1', kind: 'approval', sessionId: 'sess-live', createdAt: 1, toolName: 'bash', reason: 'podman 需要 full-access' },
        })
      }
      if (detail === 'all') {
        return json(200, {
          ok: true,
          sessionId: 'sess-live',
          reason: 'turn-end',
          latestSeq: 101,
          approval: null,
          digest: '2 steps · 1 tool calls (run_code×1)',
          messages: [
            { role: 'assistant', text: '先看看\n[tool-call run_code]' },
            { role: 'assistant', text: '干完了' },
          ],
        })
      }
      return json(200, {
        ok: true,
        sessionId: 'sess-live',
        reason: 'turn-end',
        latestSeq: 101,
        approval: null,
        digest: '3 steps · 2 tool calls (run_code×2) · 4.8k chars intermediate',
        final: { role: 'assistant', text: '干完了' },
      })
    }
    if (req.url === '/api/codex-bridge/decide' && req.method === 'POST') {
      const body = await read()
      if (body.sessionId !== 'sess-live') return json(404, { ok: false, error: 'no pending decision for this session' })
      if (body.kind === 'question' || body.selected !== undefined || body.custom !== undefined) {
        return json(200, { ok: true, sessionId: 'sess-live', decisionId: 'dec-q1', kind: 'question', outcome: { answers: [{ id: 'q1', selected: body.selected ? [body.selected] : [], ...(body.custom ? { custom: body.custom } : {}) }] } })
      }
      return json(200, { ok: true, sessionId: 'sess-live', decisionId: 'dec-1', kind: 'approval', outcome: body.allow === true ? 'allowed-once' : 'rejected' })
    }
    return json(404, { ok: false, error: 'stub: no route ' + req.url })
  })()
})

await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve))
const port = stub.address().port

// ---- spawn MCP server ----

const child = spawn(process.execPath, [serverPath], {
  env: { ...process.env, DSH_BRIDGE_URL: 'http://127.0.0.1:' + port, DSH_BRIDGE_TOKEN: TOKEN },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let buffer = ''
const pending = new Map()
let nextId = 1
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  buffer += chunk
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (line === '') continue
    const msg = JSON.parse(line)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
})
let stderrTail = ''
child.stderr.setEncoding('utf8')
child.stderr.on('data', (c) => { stderrTail += c })
function rpc(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, resolve)
    const timer = setTimeout(() => reject(new Error('timeout: ' + method)), 15000)
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg) })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }) + '\n')
  })
}

let failures = 0
function check(label, cond, extra) {
  if (cond) console.log('  ok  ' + label)
  else {
    failures++
    console.log('  FAIL ' + label + (extra === undefined ? '' : ' — ' + JSON.stringify(extra).slice(0, 400)))
  }
}

function textOf(result) {
  return (result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
}

try {
  console.log('mcp smoke: dsh-codex-bridge')

  const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } })
  check('initialize serverInfo', init.result?.serverInfo?.name === 'dsh-codex-bridge', init)
  check('initialize protocolVersion 回声', init.result?.protocolVersion === '2024-11-05', init)
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

  const tools = await rpc('tools/list')
  const names = (tools.result?.tools ?? []).map((t) => t.name)
  check('tools/list 八个工具', names.join(',') === 'dsh_sessions,dsh_models,dsh_history,dsh_prompt,dsh_wait,dsh_decide,dsh_adopt,dsh_cancel', names)

  const ping = await rpc('ping')
  check('ping', ping.result !== undefined && ping.error === undefined, ping)

  const sessions = await rpc('tools/call', { name: 'dsh_sessions', arguments: {} })
  check('dsh_sessions 文本含 sess-live', textOf(sessions.result).includes('sess-live') && sessions.result.isError !== true, sessions)

  const history = await rpc('tools/call', { name: 'dsh_history', arguments: { sessionId: 'sess-live' } })
  const historyText = textOf(history.result)
  check('dsh_history 转录', historyText.includes('你好,有什么可以帮?') && historyText.includes('[user]'), historyText)
  check('dsh_history 头带 latestSeq', historyText.includes('latestSeq=14'), historyText)

  const incremental = await rpc('tools/call', { name: 'dsh_history', arguments: { sessionId: 'sess-live', afterSeq: 2 } })
  const incText = textOf(incremental.result)
  check('dsh_history afterSeq 只回新消息', incText.includes('(1 new since seq 2)') && incText.includes('你好,有什么可以帮?') && !incText.includes('[user]'), incText)

  const nothingNew = await rpc('tools/call', { name: 'dsh_history', arguments: { sessionId: 'sess-live', afterSeq: 14 } })
  check('dsh_history 无新消息', textOf(nothingNew.result).includes('(nothing new)'), nothingNew)

  // dsh_wait:stub 按调用次序轮换 turn-end → approval → timeout;detail=all 走全量形状
  const waitTurn = await rpc('tools/call', { name: 'dsh_wait', arguments: { sessionId: 'sess-live', waitSec: 5 } })
  const turnText = textOf(waitTurn.result)
  check('dsh_wait turn-end 汇总', turnText.includes('TURN ENDED') && turnText.includes('3 steps · 2 tool calls (run_code×2) · 4.8k chars intermediate') && turnText.includes('--- final message ---') && turnText.includes('干完了'), turnText)

  const waitApproval = await rpc('tools/call', { name: 'dsh_wait', arguments: { sessionId: 'sess-live', waitSec: 5, afterSeq: 100 } })
  const approvalText = textOf(waitApproval.result)
  check('dsh_wait approval', approvalText.includes('APPROVAL PENDING') && approvalText.includes('"bash"') && approvalText.includes('DSH web GUI'), approvalText)

  const waitTimeout = await rpc('tools/call', { name: 'dsh_wait', arguments: { sessionId: 'sess-live', waitSec: 3 } })
  check('dsh_wait timeout', textOf(waitTimeout.result).includes('TIMEOUT after 3s'), waitTimeout)

  const waitDecision = await rpc('tools/call', { name: 'dsh_wait', arguments: { sessionId: 'sess-live', waitSec: 5 } })
  const decisionText = textOf(waitDecision.result)
  check('dsh_wait decision 渲染', decisionText.includes('DECISION PENDING (approval)') && decisionText.includes('dec-1') && decisionText.includes('podman') && decisionText.includes('dsh_decide'), decisionText)

  const decideAllow = await rpc('tools/call', { name: 'dsh_decide', arguments: { sessionId: 'sess-live', decisionId: 'dec-1', allow: true } })
  check('dsh_decide allow', textOf(decideAllow.result).includes('decided (approval)') && textOf(decideAllow.result).includes('allowed-once'), decideAllow)

  const decideQuestion = await rpc('tools/call', { name: 'dsh_decide', arguments: { sessionId: 'sess-live', selected: 'A' } })
  check('dsh_decide 提问 selected', textOf(decideQuestion.result).includes('decided (question)') && textOf(decideQuestion.result).includes('answered'), decideQuestion)

  const decideMissing = await rpc('tools/call', { name: 'dsh_decide', arguments: {} })
  check('dsh_decide 缺参 isError', decideMissing.result?.isError === true, decideMissing)

  const models = await rpc('tools/call', { name: 'dsh_models', arguments: {} })
  const modelsText = textOf(models.result)
  check('dsh_models 渲染 default + 分组', modelsText.includes('default: aigw/deepseek-v4.1-flash') && modelsText.includes('aigw (AIGW):') && modelsText.includes('- aigw/deepseek-v4.1-flash') && modelsText.includes('- stepfun/step-5-preview'), modelsText)

  const withModel = await rpc('tools/call', { name: 'dsh_prompt', arguments: { text: '带模型派活', model: 'stepfun/step-5-preview' } })
  check('dsh_prompt 透传 model', lastPromptBody?.model === 'stepfun/step-5-preview', lastPromptBody)

  const withThread = await rpc('tools/call', { name: 'dsh_prompt', arguments: { text: '带线程派活', threadId: 'thr-test' } })
  const threadText = textOf(withThread.result)
  check('dsh_prompt 透传 threadId', lastPromptBody?.threadId === 'thr-test', lastPromptBody)
  check('dsh_prompt 唤醒三态文案(armed)', threadText.includes('Wake armed (one-shot)') && threadText.includes('end your turn'), threadText)

  const noThread = await rpc('tools/call', { name: 'dsh_prompt', arguments: { text: '不带线程' } })
  check('dsh_prompt 无 threadId 走 wait 提示', textOf(noThread.result).includes('dsh_wait') && textOf(noThread.result).includes('pass threadId together with dsh_prompt'), noThread)

  const waitAll = await rpc('tools/call', { name: 'dsh_wait', arguments: { sessionId: 'sess-live', waitSec: 5, detail: 'all' } })
  const allText = textOf(waitAll.result)
  check('dsh_wait detail=all', allText.includes('message(s) during the turn') && allText.includes('先看看'), allText)

  const waitMissing = await rpc('tools/call', { name: 'dsh_wait', arguments: {} })
  check('dsh_wait 缺参 isError', waitMissing.result?.isError === true, waitMissing)

  const adopt = await rpc('tools/call', { name: 'dsh_adopt', arguments: { sessionId: 'sess-live' } })
  check('dsh_adopt 收编', textOf(adopt.result).includes('filed into workspace /tmp/x') && textOf(adopt.result).includes('ws-1'), adopt)

  const adoptMissing = await rpc('tools/call', { name: 'dsh_adopt', arguments: { sessionId: 'nope' } })
  check('dsh_adopt 失败 isError', adoptMissing.result?.isError === true, adoptMissing)

  const created = await rpc('tools/call', { name: 'dsh_prompt', arguments: { text: '跑个任务' } })
  const createdText = textOf(created.result)
  check('dsh_prompt 新建会话', createdText.includes('sess-new') && createdText.includes('newly created'), createdText)
  check('dsh_prompt 新建报工作区分组', createdText.includes('visible in the DSH web GUI under the') && createdText.includes('workspace group'), createdText)
  check('dsh_prompt 新建带 cwd=本进程目录', lastPromptBody?.cwd === process.cwd(), lastPromptBody)

  const cwdOverride = await rpc('tools/call', { name: 'dsh_prompt', arguments: { text: '指定目录', cwd: '/tmp/other' } })
  check('dsh_prompt 显式 cwd 优先', lastPromptBody?.cwd === '/tmp/other', lastPromptBody)

  const injected = await rpc('tools/call', { name: 'dsh_prompt', arguments: { sessionId: 'sess-live', text: '插话', mode: 'steer' } })
  check('dsh_prompt 注入', textOf(injected.result).includes('sess-live') && textOf(injected.result).includes('admitted'), injected)
  check('dsh_prompt 注入不带 cwd(会话已有目录)', lastPromptBody?.cwd === undefined, lastPromptBody)

  const missing = await rpc('tools/call', { name: 'dsh_history', arguments: {} })
  check('缺参走 isError', missing.result?.isError === true, missing)

  const unknown = await rpc('tools/call', { name: 'nope', arguments: {} })
  check('未知工具 isError', unknown.result?.isError === true, unknown)

  const noMethod = await rpc('no/such/method')
  check('未知方法 -32601', noMethod.error?.code === -32601, noMethod)

  const badUrl = await rpc('tools/call', { name: 'dsh_history', arguments: { sessionId: 'nope' } })
  check('stub 404 → isError', badUrl.result?.isError === true, badUrl)
} finally {
  child.kill()
  stub.close()
}

console.log(failures === 0 ? 'MCP SMOKE OK (all passed)' : 'MCP SMOKE FAILED: ' + failures)
if (stderrTail.trim() !== '') console.log('mcp stderr: ' + stderrTail.trim())
process.exit(failures === 0 ? 0 : 1)
