# dsh-setup — DeepSeek Harness 插件集

一组跑在 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) **web profile** 上的本地插件:Web UI 增强、模型高低阶梯、复读防护、Chrome DevTools 接入、跨 agent 桥接。

**不在 npm 发布** —— 用法是 clone 到本机,注册进你自己的 DSH profile 即可使用(见下方「快速开始」)。

## 功能

| 插件 | 能做什么 |
|---|---|
| **dsh-web-ui-addons** | Web UI 小增强:复制会话 ID / 工作区路径、一键折叠全部工作区分组、在 VS Code 打开当前项目(本地或 SSH 远程)、双击折叠展开的 thinking 块、Ctrl+Enter 发送 / Enter 换行切换 |
| **dsh-model-ladder** | 模型高低阶梯:composer 原生模型选择器旁新增 ⚡high 槽,指定轮数强制高档模型,之后自动回落到会话原本的选择 |
| **loop-output-guard** | 复读防护:实时检测 assistant 输出的密集重复,自动终止当前轮并给出可见提示 |
| **dsh-chrome-devtools-mcp** | 把 Chrome DevTools MCP 暴露为 DSH agent 工具(页面快照、点击、填表、性能 trace 等) |
| **dsh-chrome-devtools-tab-guard** | 多会话共用一个 Chrome 时按会话划分标签页归属,操作其他会话的页面会被拦下 |
| **dsh-codex-bridge** | 把活着的 DSH web 会话通过 loopback HTTP + MCP 暴露给进程外 agent(如 Codex):建会话、发消息、读历史、取消回合、代审批 / 回答提问、回合结束自动唤醒 |
| **agent-memory** | 会话记忆自动提炼(设计稿阶段,尚未实装) |

## 快速开始

前提:本机已安装 DSH(`@deepseek-ai/dsh`),web profile 能正常启动。

```bash
git clone https://github.com/sun603/dsh-setup.git
cd dsh-setup
```

每个插件注册一次即可长期使用(链接进 DSH 共享模块农场 + 在 profile 补丁层加一行 + 重启):

```bash
# Linux / macOS
ln -s "$PWD/plugins/<插件名>" ~/.dsh/profiles/node_modules/<插件名>
```

```powershell
# Windows(管理员 PowerShell)
mklink /J "$HOME\.dsh\profiles\node_modules\<插件名>" "$PWD\plugins\<插件名>"
```

在 `~/.dsh/profiles/web/cordis.patch.yml` 的 `insert:` 段加:

```yaml
- insert:
    - id: <插件名>
      name: <插件名>
```

重启 dsh server 生效(web profile 默认不热载)。可以只注册想要的插件;安装 / 升级 / 卸载的完整机制与排障见 [AGENTS.md](AGENTS.md)。

## 目录

- `plugins/` —— 一个插件一个目录;部分插件带 README 与离线冒烟测试(`tests/`)
- `docs/` —— 经验沉淀与问题排查记录
- `AGENTS.md` —— 仓库约定(插件格式、安装机制、维护规则),给 agent 看

## License

[MIT](LICENSE)
