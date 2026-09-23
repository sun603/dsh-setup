window.__ModuleLoader__.load({
  id: 'dsh-model-ladder',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    let react = require('react')

    // ---------------------------------------------------------------------
    // dsh-model-ladder — browser half。
    //
    // 视觉规格 1:1 抄自原生 composer 模型选择器
    // (packages/client/ui-model-selection/src/client/ModelSelect.tsx +
    // ModelSelect.module.css, dsh 0.1.2-rc.1):同款 28px 无边框圆角 chip、
    // 13/20/500 secondary 文本、caption 图标、同款 menu 卡片(specific-menu
    // 表面 + elevation-prominent 阴影 + 20px 圆角 + sticky 组标题 +
    // 38px option + 尾部 check),图标直接 require 平台模块 ui-primitives。
    //
    // chip = [✦ sparkle][high 模型名][剩余轮数 input][↻][chevron ▾]
    // 席位 conversation.input.right(list/session)→ 渲染紧贴原生选择器左侧;
    // 原生行零改动。
    // ---------------------------------------------------------------------

    var h = react.createElement
    var useState = react.useState
    var useRef = react.useRef
    var useEffect = react.useEffect

    // 平台模块表里的原生图标(缺省时回落文本字形,不让 UI 崩)。
    var icons = null
    try { icons = require('@deepseek-ai/dsh-client-ui-primitives') } catch { icons = null }
    function icon(name, fallback, extraProps) {
      if (icons && typeof icons[name] === 'function') {
        return h(icons[name], Object.assign({ 'aria-hidden': true }, extraProps))
      }
      return h('span', Object.assign({ className: 'mll-glyph', 'aria-hidden': true }, extraProps), fallback)
    }

    function T(zh, en) {
      var lang = (typeof navigator !== 'undefined' && navigator.language) || 'zh'
      return lang.toLowerCase().indexOf('zh') === 0 ? zh : en
    }

    // ---- CSS:数值全部来自 ModelSelect.module.css(见文件头)----
    var cssTagId = 'dsh-model-ladder/action.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(cssTagId) + ']') === null) {
      var tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-model-ladder'
      tag.dataset.pluginCss = cssTagId
      tag.textContent = [
        // root 与 trigger:原生 .root/.trigger 原样(28px chip,radius 24,无边框)
        '.mll{position:relative;min-width:0;display:inline-flex;flex:none}',
        '.mll-trigger{display:flex;align-items:center;gap:4px;min-width:0;max-width:220px;max-width:min(360px,45cqw);height:28px;padding:0 4px 0 8px;border:none;border-radius:24px;outline:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;font-weight:500;cursor:pointer;font-family:inherit}',
        '.mll-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
        '.mll-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}',
        '.mll-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
        '.mll-trigger .mll-icon{flex:0 0 auto;display:grid;place-items:center;color:var(--dsw-alias-label-caption)}',
        '.mll-glyph{font-size:12px;line-height:1}',
        '.mll-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        // 高亮 = 生效中:brand 文本色 + accent hover 底(与原生 hover 同族)
        '.mll-on .mll-trigger{color:var(--dsw-alias-brand-text, var(--dsw-alias-brand-primary));background:var(--dsw-alias-interactive-bg-hover-accent)}',
        '.mll-on .mll-trigger .mll-icon{color:var(--dsw-alias-brand-text, var(--dsw-alias-brand-primary))}',
        '.mll-err .mll-trigger{color:var(--dsw-alias-state-error-primary)}',
        // 剩余轮数:原生 .triggerEffort 的观感(caption tone),但可编辑;
        // hover 出下划线暗示可改。
        '.mll-num{flex:0 0 auto;width:22px;height:20px;padding:0;border:none;border-radius:6px;background:transparent;outline:none;color:var(--dsw-alias-label-caption);font-size:13px;line-height:20px;font-weight:500;text-align:center;font-family:inherit;cursor:text;text-decoration:underline;text-decoration-color:transparent;text-underline-offset:3px}',
        '.mll-num:hover{text-decoration-color:var(--dsw-alias-border-l3)}',
        '.mll-num:focus{background:var(--dsw-alias-interactive-bg-hover);text-decoration-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}',
        '.mll-on .mll-num{color:inherit}',
        // 复位小按钮
        '.mll-reset{flex:0 0 auto;display:grid;place-items:center;width:20px;height:20px;padding:0;border:none;border-radius:6px;outline:none;background:transparent;color:var(--dsw-alias-label-caption);cursor:pointer}',
        '.mll-reset:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
        '.mll-trigger .mll-chevron{flex:0 0 auto;color:var(--dsw-alias-label-caption);transition:transform 120ms ease}',
        '.mll-trigger[aria-expanded="true"] .mll-chevron{transform:rotate(180deg)}',
        // menu:原生 .menu 原样(bottom 8px 间距、radius 20、specific-menu、prominent 阴影;
        // 方向差异:本席位在原生左侧,菜单左对齐展开 left:0)
        '.mll-menu{position:absolute;left:0;bottom:calc(100% + 8px);z-index:20;display:flex;flex-direction:column;width:max-content;min-width:min(240px,calc(100vw - 32px));max-width:min(420px,calc(100vw - 32px));max-height:min(360px,calc(100vh - 96px));overflow:hidden;padding:4px;border:0;border-radius:20px;background:var(--dsw-specific-menu);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}',
        '.mll-status,.mll-empty{padding:10px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}',
        '.mll-error{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:4px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}',
        '.mll-retry{flex:0 0 auto;padding:0;border:none;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}',
        '.mll-error span{min-width:0;overflow-wrap:anywhere}',
        '.mll-groups{min-height:0;overflow-y:auto}',
        '.mll-group+.mll-group{margin-top:4px}',
        '.mll-group-title{position:sticky;top:0;z-index:1;padding:5px 8px 3px;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-weight:500}',
        '.mll-option{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:auto;min-width:100%;min-height:38px;padding:6px 8px;border:none;border-radius:10px;outline:none;background:transparent;color:inherit;text-align:left;cursor:pointer}',
        '.mll-option:hover:not(:disabled),.mll-option:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}',
        '.mll-option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
        '.mll-option-copy{display:flex;flex:1;flex-direction:column;min-width:0}',
        '.mll-model-name{overflow:hidden;color:inherit;font-size:14px;line-height:20px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}',
        '.mll-route{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}',
        '.mll-check{display:grid;place-items:center;flex:0 0 18px;color:var(--dsw-alias-label-primary)}',
        '.mll-divider{height:1px;margin:4px 8px;background:var(--dsw-alias-border-l1)}',
      ].join('')
      document.head.appendChild(tag)
    }

    // ---- host 通道 ----
    var API = '/api/model-ladder'
    function getJson(url) {
      return fetch(url, { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status)
        return res.json()
      })
    }
    function postJson(url, body) {
      return fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      }).then(function (res) {
        return res.text().then(function (text) {
          var data = null
          try { data = text ? JSON.parse(text) : null } catch { data = null }
          if (!res.ok) throw new Error((data && data.error) || 'HTTP ' + res.status)
          return data
        })
      })
    }

    // ---------------------------------------------------------------------
    function ModelLadderWidget(props) {
      var sessionId = props.sessionId
      var services = props.services

      var dataRef = useRef(null) // host state;从未成功 → 不渲染
      var failedRef = useRef(0)
      var _force = useState(0); var force = _force[1]
      var _open = useState(false); var open = _open[0]; var setOpen = _open[1]
      var _draft = useState(null); var draft = _draft[0]; var setDraft = _draft[1]
      var busyRef = useRef(false)
      var actionErrRef = useRef(null) // 最近一次操作失败/无效选择提示(菜单里可见)
      var _retry = useState(0); var retryTick = _retry[0]; var setRetryTick = _retry[1] // 目录不可用时的手动重试
      var rootRef = useRef(null)
      var triggerRef = useRef(null)
      var itemRefs = useRef([])

      var models = services && services.get ? services.get() : undefined
      var directory = null
      var directoryError = null
      if (models && sessionId) {
        try { directory = models.directoryFor(sessionId) }
        catch (error) { directory = null; directoryError = String(error && error.message ? error.message : error) }
      } else if (!models) {
        directoryError = T('modelDirectories 服务未就绪', 'modelDirectories service not ready')
      }
      var snapshot = directory ? directory.store.getSnapshot() : null

      react.useEffect(function () {
        if (!directory) return undefined
        var stop = directory.store.subscribe(function () { force(function (x) { return x + 1 }) })
        try { directory.load().catch(function () {}) } catch { /* ignore */ }
        return stop
      }, [directory])

      react.useEffect(function () {
        if (!sessionId) return undefined
        var dead = false
        function poll() {
          if (typeof document !== 'undefined' && document.hidden) return
          if (busyRef.current) return
          busyRef.current = true
          getJson(API + '/state?sessionId=' + encodeURIComponent(sessionId)).then(
            function (j) {
              if (dead) return
              busyRef.current = false
              if (j && j.ok) { dataRef.current = j; failedRef.current = 0; force(function (x) { return x + 1 }) }
            },
            function () {
              if (dead) return
              busyRef.current = false
              failedRef.current += 1
              if (failedRef.current >= 3) { dataRef.current = null; force(function (x) { return x + 1 }) }
            },
          )
        }
        poll()
        var t = setInterval(poll, 1500)
        return function () { dead = true; clearInterval(t) }
      }, [sessionId])

      // 外点关闭 + Escape(原生同款:Escape 先回根,我们单层直接关)。
      react.useEffect(function () {
        if (!open) return undefined
        function onDown(ev) {
          if (rootRef.current && !rootRef.current.contains(ev.target)) setOpen(false)
        }
        function onKey(ev) { if (ev.key === 'Escape') { setOpen(false); queueMicrotask(function () { triggerRef.current && triggerRef.current.focus() }) } }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return function () { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
      }, [open])

      // 方向键在 option 间移动焦点(原生 moveFocus 同款语义)。
      function onRootKeyDown(ev) {
        if (!open) return
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault()
          var items = itemRefs.current.filter(function (x) { return x !== null })
          if (items.length === 0) return
          var active = items.indexOf(document.activeElement)
          var next = (Math.max(active, 0) + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          if (items[next]) items[next].focus()
        }
      }

      var st = dataRef.current
      if (!st) return null
      var session = st.session
      if (!session) return null

      var window_ = st.window || 3
      var remaining = session.remaining
      var fullWindow = remaining === window_ // 满窗 → ✗ 置 0;其余(含 0)→ ↻ 回 window_
      var active = session.tier === 'high'
      var highSet = !!st.high
      var highBroken = highSet && !st.highValid

      function applyState(j) { if (j && j.ok) { dataRef.current = j; actionErrRef.current = null; force(function (x) { return x + 1 }) } }
      function failAction(message) {
        actionErrRef.current = message
        if (typeof console !== 'undefined') console.warn('[model-ladder] ' + message)
        force(function (x) { return x + 1 })
      }

      function commitTurns(raw) {
        var n = Math.floor(Number(raw))
        if (!Number.isFinite(n) || raw === '' || String(raw).trim() === '' || n < 0 || n > 10) { setDraft(null); return }
        if (n === remaining) { setDraft(null); return }
        postJson(API + '/session', { sessionId: sessionId, turns: n }).then(
          function (j) { setDraft(null); applyState(j) },
          function (e) { setDraft(null); failAction(String(e && e.message ? e.message : e)) },
        )
      }

      function pickHigh(provider, modelId) {
        setOpen(false)
        postJson(API + '/settings', {
          sessionId: sessionId,
          high: { provider: provider, model: modelId },
          boost: remaining === 0, // 带外 → 顺手开窗口;带内 → 只换模型
        }).then(function (j) {
          applyState(j)
          // 选了但仍解析不出来 → 明确告知(否则观感是"选了没反应,无法重选")。
          if (j && j.ok && j.high && j.highValid === false) {
            failAction(T('所选模型仍无法解析(' + provider + '/' + modelId + '),换一个或清除高模型', 'That route still does not resolve; pick another or clear the high model.'))
          }
        }, function (e) { failAction(String(e && e.message ? e.message : e)) })
      }

      function clearHigh() {
        setOpen(false)
        postJson(API + '/settings', { sessionId: sessionId, high: null }).then(applyState, function (e) { failAction(String(e && e.message ? e.message : e)) })
      }

      // chip 文本(原生 modelLabel 同款回退链)
      var modelLabel = T('选高模型', 'High model')
      if (highSet) {
        var found = null
        var groups = (snapshot && snapshot.groups) || []
        for (var gi = 0; gi < groups.length && !found; gi++) {
          if (groups[gi].id !== st.high.provider) continue
          var ms = groups[gi].models || []
          for (var mi = 0; mi < ms.length; mi++) { if (ms[mi].id === st.high.model) { found = ms[mi]; break } }
        }
        modelLabel = found && found.name ? found.name : st.high.provider + '/' + st.high.model
      }
      if (highBroken) modelLabel = T('高模型失效', 'Invalid')

      var title = highBroken
        ? T('high 槽模型当前无法解析,阶梯已自动停用;重选一个模型即可恢复', 'High route no longer resolves; ladder is paused. Pick a model to resume.')
        : active
          ? T('高模型生效中 · 含本轮剩 ' + remaining + ' 轮 · 点数字可改 · ↻ 续 ' + window_ + ' 轮', 'High tier active · ' + remaining + ' turn(s) left incl. this one · edit the number · ↻ re-arms ' + window_)
          : highSet
            ? T('当前跑原生所选。数字>0 立即高 N 轮;0=关', 'Running the session model. Type N>0 to go high for N turns; 0 = off.')
            : T('选择一个高模型启用阶梯', 'Pick a high model to arm the ladder')

      itemRefs.current = []
      var menu = null
      if (open) {
        var rows = []
        var glist = (snapshot && snapshot.groups) || []
        var loading = snapshot && snapshot.status === 'loading'
        var failed = snapshot && snapshot.status === 'error'
        var unavailable = directory === null
        if (actionErrRef.current) {
          rows.push(h('div', { key: 'a', className: 'mll-error' },
            h('span', { key: 't', className: 'mll-error-copy' }, String(actionErrRef.current)),
            h('button', { key: 'x', type: 'button', className: 'mll-retry', onClick: function () { actionErrRef.current = null; force(function (x) { return x + 1 }) } }, T('忽略', 'Dismiss'))))
        }
        if (unavailable) {
          // 目录服务取不到 / directoryFor 抛错:不再静默禁点,显示原因 + 手动重试。
          rows.push(h('div', { key: 'nd', className: 'mll-error' },
            h('span', { key: 't', className: 'mll-error-copy' },
              T('模型目录暂不可用', 'Model catalog unavailable')
              + (directoryError ? ' — ' + directoryError : '')
              + T(';会自动重试', '; retrying automatically')),
            h('button', { key: 'r', type: 'button', className: 'mll-retry', onClick: function () { setRetryTick(retryTick + 1) } }, T('重试', 'Retry'))))
        } else if (failed) {
          rows.push(h('div', { key: 'e', className: 'mll-error' },
            h('span', { key: 't', className: 'mll-error-copy' }, String((snapshot && snapshot.error) || T('目录加载失败', 'catalog load failed'))),
            h('button', { key: 'r', type: 'button', className: 'mll-retry', onClick: function () { try { directory.load().catch(function () {}) } catch (e) { /* ignore */ } } }, T('重试', 'Retry'))))
        }
        for (var g = 0; g < glist.length; g++) {
          (function (group) {
            var gRows = (group.models || []).map(function (model) {
              var selected = highSet && st.high.provider === group.id && st.high.model === model.id
              var idx = itemRefs.current.length
              return h('button', {
                key: group.id + '/' + model.id,
                ref: function (node) { itemRefs.current[idx] = node },
                type: 'button', role: 'menuitemradio', 'aria-checked': selected,
                className: 'mll-option',
                title: model.name,
                onClick: function () { pickHigh(group.id, model.id) },
              },
                h('span', { key: 'c', className: 'mll-option-copy' },
                  h('span', { key: 'n', className: 'mll-model-name' }, model.name),
                  h('span', { key: 'r', className: 'mll-route' }, group.name || group.id)),
                h('span', { key: 'k', className: 'mll-check' }, selected ? icon('IconCheckOutline16', '✓') : null))
            })
            if (gRows.length > 0) {
              rows.push(h('section', { key: 'g' + group.id, role: 'group' },
                h('div', { key: 't', className: 'mll-group-title' }, group.name || group.id),
                gRows))
            }
          })(glist[g])
        }
        if (highSet) {
          rows.push(h('div', { key: 'd', className: 'mll-divider' }))
          var clearIdx = itemRefs.current.length
          rows.push(h('button', {
            key: 'clear', type: 'button', role: 'menuitem',
            ref: function (node) { itemRefs.current[clearIdx] = node },
            className: 'mll-option',
            onClick: clearHigh,
          }, h('span', { key: 'c', className: 'mll-option-copy' },
            h('span', { key: 'n', className: 'mll-model-name' }, T('清除高模型（停用阶梯）', 'Clear high model')))))
        }
        menu = h('div', { key: 'menu', className: 'mll-menu', role: 'menu', 'aria-label': T('高模型菜单', 'High model menu'), 'aria-busy': loading && !unavailable ? 'true' : 'false' },
          rows.length > 0
            ? h('div', { key: 'gs', className: 'mll-groups scrollable' }, rows)
            : h('div', { key: 's', className: loading ? 'mll-status' : 'mll-empty' },
              loading ? T('加载模型目录…', 'Loading models…') : T('模型目录为空', 'No models available')))
      }

      return h('div', {
        ref: rootRef,
        className: 'mll' + (active ? ' mll-on' : '') + (highBroken ? ' mll-err' : ''),
        onKeyDown: onRootKeyDown,
      },
        h('div', {
          key: 'chip',
          ref: triggerRef,
          className: 'mll-trigger',
          role: 'button',
          tabIndex: 0,
          title: title,
          'aria-haspopup': 'menu',
          'aria-expanded': open ? 'true' : 'false',
          onClick: function () { setOpen(!open) },
          onKeyUp: function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setOpen(!open) }
          },
        },
          h('span', { key: 's', className: 'mll-icon' }, icon(highBroken ? 'IconWarningOutline16' : 'IconSparkle16', highBroken ? '!' : '✦')),
          h('span', { key: 'l', className: 'mll-label' }, modelLabel),
          h('input', {
            key: 'n', className: 'mll-num', type: 'text', inputMode: 'numeric',
            title: T('剩余高模型轮数(含本轮;0=关,最大 10)', 'Remaining high turns incl. this one (0 = off, max 10)'),
            value: draft !== null ? draft : String(remaining),
            onClick: function (ev) { ev.stopPropagation() },
            onChange: function (ev) { setDraft(ev.target.value.replace(/[^0-9]/g, '').slice(0, 2)) },
            onFocus: function (ev) { ev.currentTarget.select() },
            onBlur: function () { if (draft !== null) commitTurns(draft) },
            onKeyDown: function (ev) {
              ev.stopPropagation()
              if (ev.key === 'Enter') ev.currentTarget.blur()
              else if (ev.key === 'Escape') { ev.stopPropagation(); setDraft(null) }
            },
          }),
          // ↻/✗ 智能开关:满窗 → ✗ 置 0;其余(含 0)→ ↻ 回 window_。
          h('button', {
            key: 'r', type: 'button', className: 'mll-reset',
            title: fullWindow
              ? T('关闭:归 0,回到原生所选', 'Off: set to 0 (back to native selection)')
              : T('复位:重新高 ' + window_ + ' 轮', 'Reset: re-arm ' + window_ + ' high turn(s)'),
            onClick: function (ev) {
              ev.stopPropagation()
              postJson(API + '/session', { sessionId: sessionId, turns: fullWindow ? 0 : window_ }).then(applyState, function (e) { failAction(String(e && e.message ? e.message : e)) })
            },
          }, fullWindow ? icon('IconCloseOutline16', '✗') : icon('IconRefreshOutline14', '↻')),
          h('span', { key: 'c', className: 'mll-icon mll-chevron' }, icon('IconChevronDownOutline14', '▾'))),
        menu)
    }

    // ---------------------------------------------------------------------
    var inject = ['slots']

    function apply(ctx) {
      var slots = ctx.slots
      // 服务**每次渲染惰性取**:apply 跑的时候 modelDirectories 可能还没注册
      // (bundle 加载顺序),或运行期被重建;快照一次会让下拉永远静默死掉。
      var services = {
        get: function () {
          try { return ctx.get('modelDirectories') } catch (e) { return undefined }
        },
      }
      slots.inject('conversation.input.right', function () {
        return slots.register(
          { name: 'conversation.input.right', id: 'dsh-model-ladder', order: 15 },
          function (props) { return h(ModelLadderWidget, Object.assign({ services: services }, props)) },
        )
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
