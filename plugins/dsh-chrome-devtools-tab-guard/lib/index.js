/**
 * dsh-chrome-devtools-tab-guard - 多个会话共享同一个 chrome-devtools MCP 浏览器时,
 * 给 pageId 记归属并在 tool 层面拒绝跨会话的标签页操作。
 *
 * 归属规则:只有 new_page 结果里被标记 [selected] 的页面(即该次调用新建的页面)
 * 才记为调用会话所有;启动前的历史页面保持"未认领",任何会话都可用。
 * 归属表仅存内存,dsh 重启即清空。
 *
 * 拦截规则:带数字 pageId 参数的 mcp__chrome-devtools__* 调用,若该 pageId 已归
 * 属于别的会话,则 deny(提示改用自己会话的标签页,并提示"越权需要用户明确要求 +
 * 本会话切到 full access");调用会话本身处于 danger-full-access 时放行。
 */
const name = 'dsh-chrome-devtools-tab-guard'
const inject = ['tools']

const TOOL_PREFIX = 'mcp__chrome-devtools__'
const PAGES_HEADING = '## Pages'
const RECONNECT_MARK = 'Page ids have changed'
const FULL_ACCESS = 'danger-full-access'
const MAX_ANCESTOR_HOPS = 16

function chromeToolOf(toolName) {
  if (typeof toolName !== 'string' || !toolName.startsWith(TOOL_PREFIX)) return undefined
  return toolName.slice(TOOL_PREFIX.length)
}

function sessionIdOf(exec) {
  const id = exec?.agent?.session?.header?.id
  return typeof id === 'string' ? id : undefined
}

function textOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return undefined
  let out = ''
  for (const block of blocks) {
    if (block === null || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string') return undefined
    out += block.text + '\n'
  }
  return out
}

function pagesFromText(text) {
  const lines = text.split('\n')
  const start = lines.indexOf(PAGES_HEADING)
  if (start === -1) return undefined
  const pages = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = /^(\d+): /.exec(lines[i])
    if (match === null) break
    pages.push({ id: Number(match[1]), selected: /(?:^|\s)\[selected\](?:\s|$)/.test(lines[i]) })
  }
  return pages
}

function pagesFromStructured(value) {
  const structured = value?.structuredContent
  if (structured === null || typeof structured !== 'object' || !Array.isArray(structured.pages)) return undefined
  const pages = []
  for (const page of structured.pages) {
    if (page === null || typeof page !== 'object' || typeof page.id !== 'number') continue
    pages.push({ id: page.id, selected: page.selected === true })
  }
  return pages
}

function snapshotOf(result) {
  const value = result?.value
  const structured = value?.structuredContent
  const text = textOfBlocks(value?.content) ?? textOfBlocks(result?.content)
  const reconnected = structured?.reconnected === true || (typeof text === 'string' && text.includes(RECONNECT_MARK))
  const pages = pagesFromStructured(value) ?? (typeof text === 'string' ? pagesFromText(text) : undefined)
  return { pages, reconnected }
}

function shortId(id) {
  const text = String(id)
  return text.length > 8 ? text.slice(0, 8) : text
}

function denialReason(pageId, owner) {
  return [
    `\u3010tab-guard\u3011\u62d2\u7edd\u8de8\u4f1a\u8bdd\u6807\u7b7e\u9875\u64cd\u4f5c\uff1apage ${pageId} \u5c5e\u4e8e\u53e6\u4e00\u4e2a\u4f1a\u8bdd\uff08${shortId(owner)}\uff09\u3002`,
    '\u591a\u4e2a\u4f1a\u8bdd\u5171\u4eab\u540c\u4e00\u4e2a Chrome\uff0c\u8bf7\u4f7f\u7528\u672c\u4f1a\u8bdd\u81ea\u5df1\u7684\u6807\u7b7e\u9875\uff1a\u5148 mcp__chrome-devtools__new_page \u65b0\u5efa\u4e00\u4e2a\uff0c\u6216 mcp__chrome-devtools__list_pages \u67e5\u770b\u5f52\u5c5e\u540e\u64cd\u4f5c\u81ea\u5df1\u540d\u4e0b\u7684\u6807\u7b7e\u9875\u3002',
    '\u82e5\u786e\u5b9e\u9700\u8981\u64cd\u4f5c\u5176\u4ed6\u4f1a\u8bdd\u7684\u6807\u7b7e\u9875\uff0c\u53ea\u80fd\u7531\u7528\u6237\u660e\u786e\u8981\u6c42\uff0c\u5e76\u7531\u7528\u6237\u628a\u672c\u4f1a\u8bdd\u6c99\u7bb1\u5207\u5230 full access\uff08danger-full-access\uff09\u540e\u518d\u8bd5\uff1b\u4e0d\u8981\u81ea\u884c\u7ed5\u8fc7\u3002',
  ].join('\n')
}

export function apply(ctx) {
  const owners = new Map()
  const knownPages = new Set()

  function store() {
    const service = ctx.get('sessions')
    return service && typeof service.get === 'function' ? service : undefined
  }

  function reachesAncestor(ancestorId, session) {
    let cursor = session
    for (let hop = 0; hop < MAX_ANCESTOR_HOPS && cursor; hop += 1) {
      const parentId = cursor?.header?.parentSession
      if (typeof parentId !== 'string') return false
      if (parentId === ancestorId) return true
      cursor = store()?.get(parentId)
    }
    return false
  }

  function ownedByCaller(ownerId, exec) {
    const callerId = sessionIdOf(exec)
    if (callerId === undefined) return false
    if (callerId === ownerId) return true
    const session = exec?.agent?.session
    return session === undefined ? false : reachesAncestor(ownerId, session)
  }

  function modeOf(exec) {
    const policy = ctx.get('sandboxPolicy')
    const session = exec?.agent?.session
    if (policy === undefined || typeof policy.resolve !== 'function' || session === undefined) return undefined
    try {
      return policy.resolve({ session }).mode
    } catch {
      return undefined
    }
  }

  function denialFor(exec) {
    if (chromeToolOf(exec?.name) === undefined) return undefined
    const args = exec?.arguments
    const pageId = args !== null && typeof args === 'object' ? args.pageId : undefined
    if (typeof pageId !== 'number' || !Number.isInteger(pageId)) return undefined
    const owner = owners.get(pageId)
    if (owner === undefined) return undefined
    if (ownedByCaller(owner, exec)) return undefined
    if (modeOf(exec) === FULL_ACCESS) return undefined
    return denialReason(pageId, owner)
  }

  function claim(exec, result) {
    const snapshot = snapshotOf(result)
    if (snapshot.reconnected) {
      owners.clear()
      knownPages.clear()
    }
    if (snapshot.pages === undefined) return
    const seen = new Set()
    const fresh = []
    for (const page of snapshot.pages) {
      seen.add(page.id)
      if (!knownPages.has(page.id)) fresh.push(page.id)
      knownPages.add(page.id)
    }
    for (const pageId of [...owners.keys()]) if (!seen.has(pageId)) owners.delete(pageId)
    if (chromeToolOf(exec?.name) !== 'new_page') return
    const callerId = sessionIdOf(exec)
    if (callerId === undefined) return
    const claimed = snapshot.pages.filter((page) => page.selected).map((page) => page.id)
    if (claimed.length > 0) {
      for (const pageId of claimed) owners.set(pageId, callerId)
      return
    }
    if (fresh.length === 1) owners.set(fresh[0], callerId)
  }

  function ownershipSummary(exec, result) {
    const pages = snapshotOf(result).pages
    if (pages === undefined || pages.length === 0) return undefined
    const callerId = sessionIdOf(exec)
    const parts = []
    let foreign = false
    for (const page of pages) {
      const owner = owners.get(page.id)
      if (owner === undefined) parts.push(`${page.id}=\u672a\u8ba4\u9886`)
      else if (callerId !== undefined && ownedByCaller(owner, exec)) parts.push(`${page.id}=\u672c\u4f1a\u8bdd`)
      else {
        foreign = true
        parts.push(`${page.id}=\u5176\u4ed6\u4f1a\u8bdd(${shortId(owner)})`)
      }
    }
    const lines = [`\u3010tab-guard\u3011\u5f52\u5c5e: ${parts.join(', ')}`]
    if (foreign) lines.push('\u3010tab-guard\u3011\u5176\u4ed6\u4f1a\u8bdd\u7684\u6807\u7b7e\u9875\u5728\u975e full-access \u6a21\u5f0f\u4e0b\u4f1a\u88ab\u62d2\u7edd\uff1b\u786e\u9700\u65f6\u8bf7\u7528\u6237\u660e\u786e\u8981\u6c42\u5e76\u5207\u5230 full access\u3002')
    return lines.join('\n')
  }

  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const reason = denialFor(exec)
      if (reason !== undefined) return { kind: 'deny', reason }
    } catch (error) {
      ctx.logger.error(`tab-guard: pre-execute check failed: ${String(error)}`)
    }
    return next()
  })

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    const tool = chromeToolOf(exec?.name)
    if (tool === undefined || decision.kind !== 'accept') return decision
    try {
      if (result?.isError !== true) claim(exec, result)
    } catch (error) {
      ctx.logger.error(`tab-guard: ownership update failed: ${String(error)}`)
    }
    if (tool !== 'list_pages' || Object.hasOwn(decision, 'value')) return decision
    try {
      const summary = ownershipSummary(exec, result)
      if (summary === undefined) return decision
      const content = decision.content ?? result?.content
      if (!Array.isArray(content) || content.length === 0) return decision
      const last = content[content.length - 1]
      if (last === null || typeof last !== 'object' || last.type !== 'text' || typeof last.text !== 'string') {
        return { ...decision, content: [...content, { type: 'text', text: summary }] }
      }
      return { ...decision, content: [...content.slice(0, -1), { ...last, text: `${last.text}\n\n${summary}` }] }
    } catch (error) {
      ctx.logger.error(`tab-guard: list_pages summary failed: ${String(error)}`)
      return decision
    }
  })

  ctx.on('session/disposed', (session) => {
    const id = session?.header?.id
    if (typeof id !== 'string') return
    for (const [pageId, owner] of [...owners]) if (owner === id) owners.delete(pageId)
    for (const pageId of [...knownPages]) if (!owners.has(pageId)) knownPages.delete(pageId)
  })
}

export { inject, name }
