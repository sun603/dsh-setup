#!/usr/bin/env node
/**
 * dsh-codex-bridge MCP server — 零依赖 stdio MCP(换行分隔 JSON-RPC 2.0)。
 *
 * 由 Codex(或任何 MCP client) spawn;把 dsh-codex-bridge 插件的 loopback HTTP
 * API 翻成 MCP 工具:
 *
 *   dsh_sessions                      列 web GUI 里的会话
 *   dsh_models  {}                    列出可路由模型 + 部署默认
 *   dsh_history  {sessionId, maxMessages?}   读对话转录
 *   dsh_prompt   {text, sessionId?, cwd?, mode?}  注入/新建会话派活
 *   dsh_wait     {sessionId, waitSec?, onDecision?, …}  阻塞等一个 turn 的汇总结局
 *   dsh_decide   {sessionId, decisionId?, allow?/selected?/custom?}  代 GUI 决定审批/提问
 *   dsh_adopt    {sessionId, cwd?}    收编落「未分组」的会话
 *   dsh_cancel   {sessionId}          取消当前轮
 *
 * 配置(环境变量):
 *   DSH_BRIDGE_URL   默认 http://127.0.0.1:3080
 *   DSH_BRIDGE_TOKEN 默认空(= 插件也未配 token)
 *
 * 注意:stdout 只承载 MCP 帧,日志一律走 stderr。
 */

const BASE_URL = (process.env.DSH_BRIDGE_URL || 'http://127.0.0.1:3080').replace(/\/+$/, '')
const TOKEN = process.env.DSH_BRIDGE_TOKEN || ''

const TOOLS = [
  {
    name: 'dsh_sessions',
    description:
      'List DeepSeek Harness sessions visible in the web GUI (newest activity first). Returns sessionId, running flag, cwd and updatedAt for each.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'dsh_models',
    description:
      'List the models currently routable on the DSH host (provider-grouped catalog plus the deployment default). Use it to pick a valid model id before passing model to dsh_prompt; models that fail to load are reported separately.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'dsh_history',
    description:
      'Read the transcript of one DSH session (user and assistant messages, tool calls summarized; reasoning/thinking text is excluded unless includeThinking=true). Use the sessionId from dsh_sessions or from a previous dsh_prompt result. INCREMENTAL: the response header carries latestSeq (the session log cursor); pass it back as afterSeq to receive only messages appended since your last read — repeat to poll a running session without re-reading old text.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Target session id.' },
        maxMessages: { type: 'number', description: 'Max messages to return (default 60, max 200).' },
        afterSeq: { type: 'number', description: 'Only return messages with seq greater than this (use latestSeq from a previous call).' },
        includeThinking: { type: 'boolean', description: 'Include the agent reasoning/thinking text (default false).' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'dsh_prompt',
    description:
      'Send a prompt to a DSH session. Without sessionId a NEW session is created (visible live in the DSH web GUI) and its id returned; the new session runs in the same working directory Codex is currently in (pass cwd to override). With sessionId the prompt is injected into that session: mode=queue waits for the current turn, mode=steer interrupts it. Returns immediately after the message is admitted. Pass threadId (your own Codex thread id, from your status line or thread URL) to get woken automatically when THIS turn finishes — the binding is one-shot (auto-released after the notification), so pass it again on each prompt you want woken for. With wake armed you can end your turn instead of blocking in dsh_wait; the user in the DSH web GUI can always take over at any time.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Prompt text.' },
        sessionId: { type: 'string', description: 'Existing session id; omit to create a new session.' },
        cwd: { type: 'string', description: 'Working directory for a new session (default: the directory this MCP server runs in, i.e. the Codex workspace).' },
        mode: { type: 'string', enum: ['queue', 'steer'], description: 'Delivery mode for an existing session (default queue).' },
        threadId: { type: 'string', description: 'Your Codex thread id (status line / thread URL). One-shot: this thread is woken when this turn finishes, then the binding auto-releases. Omit to skip wake (then use dsh_wait).' },
        model: {
          description: 'Optional model for this session: compact "provider/model" string (e.g. "aigw/deepseek-v4.1-flash") or an object {provider, model, reasoningEffort?}. The selection is session-scoped and persists for later turns. Omit to use the deployment default — for NEW sessions the bridge applies its configured defaultModel (~/.dsh/codex-bridge.json) when set; existing sessions always keep their own model. Use dsh_models to list valid ids. Only set this when the user explicitly asks for a specific model.',
          oneOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: {
                provider: { type: 'string', description: 'Provider id, e.g. "aigw".' },
                model: { type: 'string', description: 'Model id under that provider.' },
                reasoningEffort: { type: 'string', description: 'Optional reasoning effort for models that support it.' },
              },
              required: ['provider', 'model'],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'dsh_wait',
    description:
      'Block until one DSH turn finishes, then return ONE consolidated result for that turn: a one-line digest (steps, tool calls) plus the final assistant message. If the agent blocks on a decision (approval request or ask-user question) it returns DECISION PENDING with the full context — decide it yourself with dsh_decide, or tell the user to handle it in the DSH web GUI and call dsh_wait again (onDecision:"hold" waits through the human instead of returning). TIMEOUT means nothing finished within waitSec — call again, do not end your turn to "wait". Use this right after dsh_prompt instead of polling dsh_history in a loop.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Target session id.' },
        afterSeq: { type: 'number', description: 'Only count events after this seq (use latestSeq from a previous call). Omit to wait for whatever happens next.' },
        waitSec: { type: 'number', description: 'Maximum seconds to block (default 45, max 600).' },
        detail: { type: 'string', enum: ['final', 'all'], description: '"final" (default) returns the turn digest + final message only; "all" returns every intermediate message.' },
        onDecision: { type: 'string', enum: ['return', 'hold'], description: '"return" (default) returns as soon as a decision is pending; "hold" keeps waiting until the turn ends and reports the decisions in the result.' },
        includeThinking: { type: 'boolean', description: 'Include the agent reasoning/thinking text in returned messages (default false).' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'dsh_decide',
    description:
      'Decide a pending interaction in a DSH session on behalf of the user: approve or reject a tool-call approval request, or answer an ask-user question. The pending context (tool name + reason, or question + options) comes from the DECISION PENDING result of dsh_wait — pass its decisionId. For approvals use allow=true/false; for questions use selected (option labels) or custom (free text), or answers for multi-question requests. The human in the DSH web GUI can always decide instead — first decision wins.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Target session id.' },
        decisionId: { type: 'string', description: 'decisionId from the DECISION PENDING result. Omit to decide the oldest pending item in this session.' },
        allow: { type: 'boolean', description: 'For approvals: true = allow once, false = reject.' },
        selected: { type: 'string', description: 'For questions: option label(s) to select. Array for multi-select.' },
        custom: { type: 'string', description: 'For questions: free-text answer instead of / alongside options.' },
        answers: {
          type: 'array',
          description: 'For multi-question requests: per-question answers.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              selected: { type: 'string' },
              custom: { type: 'string' },
            },
            required: ['id'],
          },
        },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'dsh_adopt',
    description:
      'File an existing DSH session into the workspace group that matches its working directory — repairs sessions sitting in 未分组/ungrouped (e.g. created before workspace matching existed). Omit cwd to detect it from the session itself.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Target session id.' },
        cwd: { type: 'string', description: 'Workspace path to file it under (default: detected from the session).' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'dsh_cancel',
    description: 'Cancel the active turn of a DSH session.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: 'Target session id.' } },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
]

// ---------------------------------------------------------------------------
// HTTP → bridge plugin
// ---------------------------------------------------------------------------

async function callBridge(method, urlPath, body) {
  const ac = new AbortController()
  // 必须大于 /wait 的 waitSec 上限(600s),否则长等待被客户端侧超时截断。
  const timer = setTimeout(() => ac.abort(), 620000)
  try {
    const res = await fetch(BASE_URL + urlPath, {
      method,
      headers: {
        ...(TOKEN !== '' ? { authorization: 'Bearer ' + TOKEN } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    })
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error('bridge returned non-JSON (HTTP ' + res.status + '): ' + text.slice(0, 200))
    }
    if (!res.ok || (json && json.ok === false)) {
      throw new Error((json && json.error) || ('bridge HTTP ' + res.status))
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

function toolText(payload) {
  return { content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }] }
}

function toolError(message) {
  return { content: [{ type: 'text', text: 'Error: ' + message }], isError: true }
}

function fmtTime(ms) {
  if (typeof ms !== 'number') return '?'
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
}

async function callTool(name, args) {
  switch (name) {
    case 'dsh_sessions': {
      const json = await callBridge('GET', '/api/codex-bridge/sessions')
      const lines = (json.sessions ?? []).map(
        (s) => `${s.sessionId}  ${s.running ? 'RUNNING' : 'idle   '}  ${fmtTime(s.updatedAt)}  ${s.cwd ?? ''}`,
      )
      return toolText(lines.length === 0 ? '(no sessions)' : lines.join('\n'))
    }
    case 'dsh_models': {
      const json = await callBridge('GET', '/api/codex-bridge/models')
      const lines = []
      const def = json.default
      if (def && def.provider !== undefined) lines.push(`default: ${def.provider}/${def.model}${def.reasoningEffort ? ' (' + def.reasoningEffort + ')' : ''}`)
      for (const g of json.groups ?? []) {
        lines.push(`${g.id} (${g.name}):`)
        for (const m of g.models ?? []) lines.push(`  - ${g.id}/${m.id}${m.name && m.name !== m.id ? ' — ' + m.name : ''}`)
      }
      const failures = json.failures ?? []
      if (failures.length > 0) lines.push(`unavailable providers: ${failures.map((f) => f.id + (f.name ? ' (' + f.name + ')' : '')).join(', ')}`)
      return toolText(lines.join('\n') || '(no models)')
    }
    case 'dsh_history': {
      const sessionId = String(args.sessionId ?? '')
      if (sessionId === '') return toolError('sessionId required')
      const max = Number.isFinite(args.maxMessages) && args.maxMessages > 0 ? Math.floor(args.maxMessages) : 60
      const afterSeq = Number.isFinite(args.afterSeq) && args.afterSeq >= 0 ? Math.floor(args.afterSeq) : undefined
      let url = '/api/codex-bridge/history?sessionId=' + encodeURIComponent(sessionId) + '&maxMessages=' + max
      if (afterSeq !== undefined) url += '&afterSeq=' + afterSeq
      if (args.includeThinking === true) url += '&includeThinking=true'
      const json = await callBridge('GET', url)
      const fresh = (json.messages ?? []).length
      const header =
        `session ${sessionId}${json.title ? ' — ' + json.title : ''} [latestSeq=${json.latestSeq}]` +
        (afterSeq !== undefined ? ` (${fresh} new since seq ${afterSeq})` : ` (${fresh} messages in window)`) +
        (json.hasMore ? ' [window truncated — raise maxMessages]' : '')
      const body = (json.messages ?? []).map((m) => `[${m.role}] ${m.text}`).join('\n\n')
      return toolText(header + '\n\n' + (body === '' ? (afterSeq !== undefined ? '(nothing new)' : '(empty transcript)') : body))
    }
    case 'dsh_prompt': {
      const text = String(args.text ?? '')
      if (text.trim() === '') return toolError('text required')
      const body = { text }
      if (typeof args.sessionId === 'string' && args.sessionId !== '') body.sessionId = args.sessionId
      // 目录匹配:新建会话默认用本进程 cwd —— codex spawn MCP 子进程时继承其
      // 工作目录(实测两次确认),即 codex 在哪个目录跑,dsh 新会话就在哪个目录。
      if (typeof args.cwd === 'string' && args.cwd !== '') body.cwd = args.cwd
      else if (body.sessionId === undefined) body.cwd = process.cwd()
      if (args.mode === 'steer') body.mode = 'steer'
      if (typeof args.threadId === 'string') body.threadId = args.threadId
      if (args.model !== undefined) body.model = args.model
      const json = await callBridge('POST', '/api/codex-bridge/prompt', body)
      const where =
        json.grouped === true
          ? `visible in the DSH web GUI under the ${json.cwd ?? 'matching'} workspace group`
          : json.cwd !== undefined
            ? `Working directory: ${json.cwd} — switch to that workspace in the DSH web GUI sidebar to watch it (or run dsh_adopt to file it into the right group)`
            : ''
      const wake = json.wakeArmed === true
        ? ' Wake armed (one-shot) — this thread will be notified automatically when the turn finishes; you can end your turn now. Pass threadId again next time if you want wake on the following turn too.'
        : json.wakeArmed === false
          ? ' threadId was passed but wake is disabled on the bridge (wake.enabled=false) — keep using dsh_wait.'
          : ''
      return toolText(
        `admitted into session ${json.sessionId}${json.created && where !== '' ? ' (newly created — ' + where + ')' : ''}. ` +
          'The DSH agent is working.' +
          (json.model && json.model.provider !== undefined
            ? ` Model set to ${json.model.provider}/${json.model.model}${json.model.reasoningEffort ? ' (' + json.model.reasoningEffort + ')' : ''} (session-scoped, persists for later turns).`
            : '') +
          (wake !== '' ? wake : ' Follow up with dsh_wait to block until the turn ends — or pass threadId together with dsh_prompt (this call or the next one) to get woken automatically instead of waiting.'),
      )
    }
    case 'dsh_wait': {
      const sessionId = String(args.sessionId ?? '')
      if (sessionId === '') return toolError('sessionId required')
      let waitSec = Number.isFinite(args.waitSec) ? Math.floor(args.waitSec) : 45
      waitSec = Math.min(Math.max(waitSec, 1), 600)
      const afterSeq = Number.isFinite(args.afterSeq) && args.afterSeq >= 0 ? Math.floor(args.afterSeq) : undefined
      const detail = args.detail === 'all' ? 'all' : 'final'
      const onDecision = args.onDecision === 'hold' ? 'hold' : 'return'
      let url = '/api/codex-bridge/wait?sessionId=' + encodeURIComponent(sessionId) + '&waitSec=' + waitSec + '&detail=' + detail + '&onDecision=' + onDecision
      if (afterSeq !== undefined) url += '&afterSeq=' + afterSeq
      if (args.includeThinking === true) url += '&includeThinking=true'
      const json = await callBridge('GET', url)
      const lines = []
      if (json.reason === 'turn-end') {
        lines.push(`TURN ENDED in session ${sessionId} [latestSeq=${json.latestSeq}]`)
        if (json.digest) lines.push(json.digest)
        if (detail === 'all') {
          const all = json.messages ?? []
          lines.push('', `${all.length} message(s) during the turn:`)
          for (const m of all) lines.push(`[${m.role}] ${m.text}`)
        } else if (json.final?.text) {
          lines.push('', '--- final message ---', json.final.text)
        }
        for (const d of json.decisions ?? []) {
          const what = d.kind === 'approval' ? `approval "${d.toolName ?? '?'}"` : 'question'
          lines.push(`[decision] ${what} → ${d.outcome ?? 'pending'}`)
        }
      } else if (json.reason === 'decision') {
        const d = json.decision ?? {}
        if (d.kind === 'approval') {
          lines.push(
            `DECISION PENDING (approval) in session ${sessionId}: tool "${d.toolName ?? '?'}"` +
              (d.reason ? ' — ' + d.reason : '') +
              `. decisionId=${d.decisionId}. Decide it with dsh_decide {allow:true|false}, or tell the user to approve/deny in the DSH web GUI and call dsh_wait again (onDecision:"hold" to wait through them).`,
          )
        } else {
          const qs = Array.isArray(d.questions) ? d.questions : []
          lines.push(`DECISION PENDING (question) in session ${sessionId}. decisionId=${d.decisionId}`)
          for (const q of qs) {
            lines.push(`  Q${q.id ? ' [' + q.id + ']' : ''}: ${q.question}`)
            if (q.detail) lines.push('    detail: ' + q.detail)
            if (Array.isArray(q.options) && q.options.length > 0) lines.push('    options: ' + q.options.join(' | '))
          }
          lines.push('Answer with dsh_decide {selected:"…"|custom:"…"|answers:[…]}.')
        }
        if (json.digest) lines.push(json.digest)
      } else if (json.reason === 'approval') {
        lines.push(
          `APPROVAL PENDING in session ${sessionId}: tool "${json.approval?.toolName ?? '?'}" is blocked waiting for a human decision` +
            (json.approval?.reason ? ' — ' + json.approval.reason : '') +
            '. Tell the user to approve or deny it in the DSH web GUI, then call dsh_wait again (onDecision:"hold" waits through their click).',
        )
        if (json.digest) lines.push(json.digest)
      } else {
        lines.push(`TIMEOUT after ${waitSec}s — no turn finished in session ${sessionId} [latestSeq=${json.latestSeq}]`)
        if (json.digest) lines.push('so far: ' + json.digest)
        for (const d of json.pending ?? []) {
          const what = d.kind === 'approval' ? `approval "${d.toolName ?? '?'}"` : 'question'
          lines.push(`still pending: ${what} decisionId=${d.decisionId} — use dsh_decide or ask the user.`)
        }
      }
      return toolText(lines.join('\n'))
    }
    case 'dsh_decide': {
      const sessionId = String(args.sessionId ?? '')
      if (sessionId === '') return toolError('sessionId required')
      const body = { sessionId }
      if (typeof args.decisionId === 'string' && args.decisionId !== '') body.decisionId = args.decisionId
      if (typeof args.allow === 'boolean') body.allow = args.allow
      if (typeof args.selected === 'string' && args.selected !== '') body.selected = args.selected
      else if (Array.isArray(args.selected)) body.selected = args.selected
      if (typeof args.custom === 'string' && args.custom !== '') body.custom = args.custom
      if (Array.isArray(args.answers)) body.answers = args.answers
      const json = await callBridge('POST', '/api/codex-bridge/decide', body)
      const outcome = typeof json.outcome === 'string' ? json.outcome : 'answered'
      return toolText(`decided (${json.kind}) for session ${sessionId}: ${outcome}. The agent continues — call dsh_wait for the turn result.`)
    }
    case 'dsh_adopt': {
      const sessionId = String(args.sessionId ?? '')
      if (sessionId === '') return toolError('sessionId required')
      const body = { sessionId }
      if (typeof args.cwd === 'string' && args.cwd !== '') body.cwd = args.cwd
      const json = await callBridge('POST', '/api/codex-bridge/adopt', body)
      return toolText(`session ${sessionId} filed into workspace ${json.path} (${json.workspaceId}) — it now appears in that group in the DSH web GUI sidebar.`)
    }
    case 'dsh_cancel': {
      const sessionId = String(args.sessionId ?? '')
      if (sessionId === '') return toolError('sessionId required')
      const json = await callBridge('POST', '/api/codex-bridge/cancel', { sessionId })
      return toolText(`cancel accepted=${json.accepted === true} for session ${sessionId}`)
    }
    default:
      return toolError('unknown tool ' + name)
  }
}

// ---------------------------------------------------------------------------
// MCP stdio 帧(换行分隔 JSON-RPC 2.0)
// ---------------------------------------------------------------------------

let buffer = ''

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle(msg) {
  const { id, method, params } = msg
  if (id === undefined) return // notification: ignore
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: (params && params.protocolVersion) || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'dsh-codex-bridge', version: '0.1.0' },
      })
    case 'ping':
      return reply(id, {})
    case 'tools/list':
      return reply(id, { tools: TOOLS })
    case 'tools/call': {
      const name = params && params.name
      const args = (params && params.arguments) || {}
      try {
        return reply(id, await callTool(name, args))
      } catch (err) {
        return reply(id, toolError(String((err && err.message) || err)))
      }
    }
    case 'resources/list':
      return reply(id, { resources: [] })
    case 'prompts/list':
      return reply(id, { prompts: [] })
    default:
      return replyError(id, -32601, 'method not found: ' + method)
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (line === '') continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    void handle(msg).catch((err) => {
      console.error('[dsh-codex-bridge mcp] handler error: ' + String((err && err.stack) || err))
      if (msg && msg.id !== undefined) replyError(msg.id, -32603, String((err && err.message) || err))
    })
  }
})
process.stdin.on('end', () => process.exit(0))

console.error('[dsh-codex-bridge mcp] ready, bridge at ' + BASE_URL + (TOKEN !== '' ? ' (token set)' : ' (no token)'))
