# dsh-chrome-devtools-tab-guard

多个会话共用一个 chrome-devtools MCP 浏览器时,在 **tool 层**给标签页记归属并拒绝跨会话操作。
host-only 插件(无浏览器端),与 [dsh-chrome-devtools-mcp](../dsh-chrome-devtools-mcp) 配套使用。

## 行为

| 场景 | 结果 |
| --- | --- |
| 本会话 `new_page` 新建的标签页(结果里 `[selected]` 的那个,或唯一新增 id) | 归本会话所有 |
| 其他会话的标签页 + 本会话非 full access | **deny**,错误文本提示改用自己会话的标签页,并提示"越权必须由用户明确要求且切到 full access" |
| 其他会话的标签页 + 本会话 `danger-full-access` | 放行(提权通道) |
| 未认领/未知 pageId | 放行(保守:插件启动前或插件未观察到的页面不拦) |
| `list_pages` | 保留原列表,末尾追加一行归属摘要 + (有他会话页面时)一行规则提示 |
| 子会话按 `parentSession` 祖先链访问父会话的页面 | 放行 |

归属表只看 `mcp__chrome-devtools__*` 工具的返回文本 `## Pages` 段(该 MCP 默认不带
`structuredContent`;`--experimentalStructuredContent` 打开时也支持解析结构化 pages)。
快照里消失的 pageId 会释放归属;文本出现 `Page ids have changed`(浏览器重连、id 重排)或
会话 `session/disposed` 时清空/释放对应归属。

## 已知边界

- 归属表**仅存内存**,dsh 重启即清空;重启后已存在的标签页视为"未认领",任何会话可用。
- 只对带**数字 `pageId` 参数**的调用生效。pageIdRouting 默认开启,页面级工具的 pageId 是必填项;
  若哪天用 `--no-page-id-routing`/`--slim` 启动,落到"全局选中页"的调用拦不住。
- 其他会话的标签页**不会**被自动关闭;会话结束后标签页留在浏览器里,可手动关。
- 归属只按"谁新建"判定,不按"谁在用":插件加载前就打开的标签页不会被任何会话自动认领。

## 验证

```bash
node tests/smoke.mjs
```

离线冒烟(fake ctx)覆盖:new_page 认领(含无 `[selected]` 标记的兜底)、跨会话 deny 文案、
full-access 放行、祖先链放行、未知/未认领放行、`list_pages` 摘要、关闭/重连/会话销毁释放归属、
错误结果不认领、非 chrome 工具与无 pageId 调用不受影响。

## 注册

标准形式(农场 junction + 裸包名):

```bash
bash scripts/install.sh web --only dsh-chrome-devtools-tab-guard
```

本机实际登记形式(2026-09-14):`~/.dsh/profiles/web/cordis.patch.yml` 里 insert 行的 `name`
直接写绝对路径 `.../dsh-chrome-devtools-tab-guard/lib/index.js`(loader 会把文件系统路径转成
file URL,等价于 junction)。这么登记只是因为在受限沙箱里无法创建工作区外的软链接;想换回标准
形式:先建好 `~/.dsh/profiles/node_modules/dsh-chrome-devtools-tab-guard` 软链接,再把该行的
name 改成裸包名即可。

改完 host 代码后重启 dsh server 生效(web profile 的 HMR 默认禁用)。
