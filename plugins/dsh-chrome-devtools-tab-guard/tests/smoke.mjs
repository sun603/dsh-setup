import { strict as assert } from 'node:assert'
const mod = await import(new URL('../lib/index.js', import.meta.url).href)

const listeners = new Map()
const modes = new Map()
const sessionStore = new Map()

function makeSession(id, parentSession) {
  const header = parentSession === undefined ? { id: id } : { id: id, parentSession: parentSession }
  const session = { id: id, header: header }
  sessionStore.set(id, session)
  return session
}

const ctx = {
  logger: { error: function () {}, warn: function () {}, info: function () {} },
  get: function (serviceName) {
    if (serviceName === 'sessions') return { get: function (id) { return sessionStore.get(id) } }
    if (serviceName === 'sandboxPolicy') {
      return { resolve: function (request) { return { mode: modes.get(request.session.id) || 'workspace-write' } } }
    }
    return undefined
  },
  on: function (event, cb) {
    const list = listeners.get(event) || []
    list.push(cb)
    listeners.set(event, list)
    return function () {}
  },
}

mod.apply(ctx)

function execFor(session, toolName, args) {
  return { name: toolName, arguments: args, agent: { session: session } }
}

function textResult(text) {
  return { isError: false, value: { content: [{ type: 'text', text: text }] }, content: [{ type: 'text', text: text }] }
}

async function pre(exec) {
  const chain = listeners.get('tools/pre-execute') || []
  const next = async function () { return { kind: 'allow' } }
  let decision = { kind: 'allow' }
  for (const cb of chain) decision = await cb(exec, next)
  return decision
}

async function post(exec, result) {
  const chain = listeners.get('tools/post-execute') || []
  const next = async function () { return { kind: 'accept' } }
  let decision = { kind: 'accept' }
  for (const cb of chain) decision = await cb(exec, result, next)
  return decision
}

function emit(event) {
  const args = Array.prototype.slice.call(arguments, 1)
  for (const cb of listeners.get(event) || []) cb.apply(null, args)
}

let failures = 0
function check(label, cond, detail) {
  if (cond) console.log('ok   ' + label)
  else { failures += 1; console.log('FAIL ' + label + (detail === undefined ? '' : ' -> ' + JSON.stringify(detail))) }
}

const a = makeSession('session-aaaaaaaa')
const b = makeSession('session-bbbbbbbb')
const SNAP = 'mcp__chrome-devtools__take_snapshot'

// 1. new_page 结果里被选中的页面归调用会话
await post(execFor(a, 'mcp__chrome-devtools__new_page', { url: 'https://x' }),
  textResult('## Pages\n1: x (https://x) [selected]\n2: about:blank'))
check('A owns new page 1', (await pre(execFor(a, SNAP, { pageId: 1 }))).kind === 'allow')
const denied = await pre(execFor(b, SNAP, { pageId: 1 }))
check('B cross-session denied', denied.kind === 'deny', denied)
check('deny reason names own tab', typeof denied.reason === 'string' && denied.reason.includes('new_page'))
check('deny reason names full access', typeof denied.reason === 'string' && denied.reason.includes('danger-full-access'))
check('deny reason requires user request', typeof denied.reason === 'string' && denied.reason.includes('\u7528\u6237\u660e\u786e\u8981\u6c42'))
check('unowned page allowed', (await pre(execFor(b, SNAP, { pageId: 2 }))).kind === 'allow')
check('unknown page allowed', (await pre(execFor(b, SNAP, { pageId: 9 }))).kind === 'allow')
check('non-chrome tool untouched', (await pre(execFor(b, 'read', { file_path: '/tmp/x' }))).kind === 'allow')
check('no-pageId chrome call allowed', (await pre(execFor(b, 'mcp__chrome-devtools__list_pages', {}))).kind === 'allow')

// 2. full access 放行
modes.set('session-bbbbbbbb', 'danger-full-access')
check('B full-access allowed', (await pre(execFor(b, SNAP, { pageId: 1 }))).kind === 'allow')
modes.delete('session-bbbbbbbb')

// 3. 子会话(祖先链)可用父会话的页面
const child = makeSession('session-cccccccc', 'session-aaaaaaaa')
check('subagent of owner allowed', (await pre(execFor(child, SNAP, { pageId: 1 }))).kind === 'allow')
const grandchild = makeSession('session-dddddddd', 'session-cccccccc')
check('grandchild of owner allowed', (await pre(execFor(grandchild, SNAP, { pageId: 1 }))).kind === 'allow')

// 4. list_pages 附归属摘要
const summaryDecision = await post(execFor(b, 'mcp__chrome-devtools__list_pages', {}),
  textResult('## Pages\n1: x (https://x)\n2: about:blank'))
const summaryText = summaryDecision.content[summaryDecision.content.length - 1].text
check('list_pages keeps original text', summaryText.includes('## Pages') && summaryText.includes('2: about:blank'))
check('list_pages adds ownership', summaryText.includes('tab-guard') && summaryText.includes('1=') && summaryText.includes('2='))
check('list_pages marks foreign page', summaryText.includes('1=\u5176\u4ed6\u4f1a\u8bdd'))
check('list_pages marks unowned page', summaryText.includes('2=\u672a\u8ba4\u9886'))

// 5. close_page 快照里消失的页面释放归属
await post(execFor(a, 'mcp__chrome-devtools__close_page', { pageId: 1 }), textResult('## Pages\n2: about:blank'))
check('closed page released', (await pre(execFor(b, SNAP, { pageId: 1 }))).kind === 'allow')

// 6. 重连提示清空归属表
await post(execFor(a, 'mcp__chrome-devtools__new_page', { url: 'https://z' }), textResult('## Pages\n5: z [selected]'))
check('page 5 owned by A', (await pre(execFor(b, SNAP, { pageId: 5 }))).kind === 'deny')
await post(execFor(b, SNAP, { pageId: 5 }),
  textResult('Note: the browser was restarted or reconnected since the last call. Page ids have changed. Call list_pages to see open pages.'))
check('reconnect clears ownership', (await pre(execFor(b, SNAP, { pageId: 5 }))).kind === 'allow')

// 7. structuredContent 快照也能记归属
await post(execFor(a, 'mcp__chrome-devtools__new_page', { url: 'https://s' }),
  { isError: false, value: { content: [{ type: 'text', text: 'ok' }], structuredContent: { pages: [{ id: 11, selected: true }] } }, content: [{ type: 'text', text: 'ok' }] })
check('structured snapshot claims', (await pre(execFor(b, SNAP, { pageId: 11 }))).kind === 'deny')

// 8. 失败结果不记归属
await post(execFor(a, 'mcp__chrome-devtools__new_page', { url: 'https://e' }),
  { isError: true, content: [{ type: 'text', text: 'boom' }] })
check('error result does not claim', (await pre(execFor(b, SNAP, { pageId: 3 }))).kind === 'allow')

// 9. 会话销毁释放其页面
await post(execFor(a, 'mcp__chrome-devtools__new_page', { url: 'https://q' }), textResult('## Pages\n7: q [selected]'))
check('page 7 owned by A', (await pre(execFor(b, SNAP, { pageId: 7 }))).kind === 'deny')
emit('session/disposed', a)
check('disposed session releases pages', (await pre(execFor(b, SNAP, { pageId: 7 }))).kind === 'allow')

// 9b. 缺少 [selected] 标记时:唯一新增页面兜底归属调用会话
const d = makeSession('session-eeeeeeee')
await post(execFor(d, 'mcp__chrome-devtools__new_page', { url: 'https://f1' }), textResult('## Pages\n21: f1 (https://f1)'))
check('single fresh page claimed without marker', (await pre(execFor(b, SNAP, { pageId: 21 }))).kind === 'deny')
await post(execFor(d, 'mcp__chrome-devtools__new_page', { url: 'https://f2' }), textResult('## Pages\n21: f1 (https://f1)\n22: f2 (https://f2)'))
check('second single fresh page claimed in turn', (await pre(execFor(b, SNAP, { pageId: 22 }))).kind === 'deny')
check('earlier claimed page still owned', (await pre(execFor(b, SNAP, { pageId: 21 }))).kind === 'deny')
await post(execFor(d, 'mcp__chrome-devtools__new_page', { url: 'https://f3' }), textResult('## Pages\n21: f1 (https://f1)\n22: f2 (https://f2)\n23: f3 (https://f3)\n24: g (https://g)'))
check('ambiguous fresh pages left unowned', (await pre(execFor(b, SNAP, { pageId: 23 }))).kind === 'allow')
check('second ambiguous fresh page unowned', (await pre(execFor(b, SNAP, { pageId: 24 }))).kind === 'allow')

// 10. list_pages 无页面段时不改动结果
const noPagesResult = textResult('(no output)')
const untouched = await post(execFor(b, 'mcp__chrome-devtools__list_pages', {}), noPagesResult)
const untouchedText = (untouched.content || noPagesResult.content)[0].text
check('list_pages without pages untouched', untouchedText === '(no output)')
check('list_pages without pages returns accept', untouched.kind === 'accept')

console.log('')
if (failures > 0) { console.log('FAILURES: ' + failures); process.exit(1) }
console.log('all tab-guard smoke checks passed')
assert.ok(true)
