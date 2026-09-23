# dsh-setup — DeepSeek Harness 插件集

本仓库是一组供 DeepSeek Harness **web profile** 加载的本地插件。每个插件一个目录,放在 `plugins/` 下,通过 DSH profile 的补丁层注册到 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`。

## 仓库布局

```
├── AGENTS.md               # 本文件:项目说明(入库)
├── AGENTS.local.md          # 本机环境说明(已 gitignore,不入库)
├── README.md                # 面向使用者的说明(功能清单 + 快速开始;机制细节在本文件)
├── third-party.json          # 本机第三方插件清单(本地配置,已 gitignore;格式见「第三方插件纳管」)
├── docs/
│   └── experience.md         # 经验沉淀:全局 AGENTS.md 每次修改的详细记录(入库)
├── scripts/
│   └── install.md            # 安装脚本模板(install.ps1 / install.sh 由此生成;生成的脚本不入库)
└── plugins/
    └── <plugin-name>/       # 一个插件 = 一个带 package.json 的目录
        ├── package.json
        └── lib/
            ├── index.js     # host 端(Cordis 插件)
            └── client.js    # 浏览器端 bundle
```

## 插件包格式(自有插件;新增插件必须遵守)

**package.json 必填字段:**

```json
{
  "name": "<包名>",
  "license": "MIT",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" }
  },
  "dsh": { "client": { "platform": "web" } }
}
```

- `name` 是全仓库唯一包名,也是加载器行 id、桥接 `id`、目录名。
- `license` 固定 `MIT`(本仓库统一开源协议,全文见根目录 `LICENSE`)。
- `dsh.client.platform: "web"` 告诉 dsh 的 client-modules 扫描器把 `./client` 打进浏览器启动图(`window.__DSH_BOOT__`)。

**host 端 `lib/index.js`:** 普通 ESM Cordis 插件,`export { apply, inject, name }`。DSH 服务通过 `ctx.get('...')` 取(如 `webServer`、`subprocess`、`agents`、`sandboxPolicy`)。不要在宿主端用 `harness.handle`(那是动态插件的机制,静态插件里不存在;用 `webServer.register` 提供 HTTP 端点给浏览器端调用)。

**client 端 `lib/client.js`:** 固定 bundle 信封:

```js
window.__ModuleLoader__.load({
  id: "<包名>",                       // 必须等于 package.json 的 name
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");     // 浏览器端 React
    // ... 插件代码:apply(ctx) 里用 ctx.slots.register 注册 UI ...
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
```

- 浏览器端内置能力:真实的 `fetch`、`document`、`setTimeout` 等全局可用(不同于沙箱化的动态插件运行器)。
- 与服务端通信:同源 HTTP 端点(如 `fetch("/api/xxx")`),host 端用 `webServer.register({ kind: "exact", path, handler })` 提供。

## 安装机制(DSH 侧)

1. **解析:** dsh 加载器按包名解析插件。每个 profile 通过 Node 父目录向上查找,最终落到**共享模块农场 `$DSH_HOME/profiles/node_modules`**(一个包一个 junction 链接,指向本仓库 `plugins/<包名>`)。已有 `dsh-*` 官方包都在这个农场里。
2. **注册:** 在 profile 的用户补丁层 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 加一行:

   ```yaml
   - insert:
       - id: <包名>
         name: <包名>
   ```
3. **生效:** web profile 的 HMR 默认禁用,修改后**必须重启 dsh server**。

**手动注册命令**(`scripts/install.sh` 默认模式做的就是这两步,幂等;链接直接指向仓库源码,`git pull` 后重启即生效,无需重装):

```bash
# Linux / macOS:建农场 symlink
ln -s "<仓库根>/plugins/<包名>" ~/.dsh/profiles/node_modules/<包名>
```

```powershell
# Windows:junction(需管理员 PowerShell 或已开开发者模式)
mklink /J "$HOME\.dsh\profiles\node_modules\<包名>" "<仓库根>\plugins\<包名>"
```

**卸载自有插件**:删 `cordis.patch.yml` 里对应的 `- insert:` 段 → 删农场里该包名的链接 → 重启 dsh server。

**换机器**:clone 本仓库 → 按上面逐个插件手动注册 → 重启 dsh server。

## 第三方插件纳管

第三方插件(npm 发布的 dsh bundle 包)与自有插件是两套逻辑:**源码不 vendor 进 `plugins/`,不钉版本**;并且**用哪些第三方插件属于本机配置**——声明文件 `third-party.json` 放仓库根但已 gitignore,各机器自配,仓库只固定机制与格式。

- **格式**(`third-party.json`,每条字段):`name`(npm 包名)/ `tag`(npm dist-tag,缺省 `latest`)/ `repo`(上游地址,升级前看变更)/ `note`(用途与注意)。
- **安装/升级**:统一走官方 `dsh plugin --profile <p> add <name>@<tag>`(dsh 按已装状态自动调和 profile 的 `dsh.profile.bundles`);不要手编 profile 的 package.json,也不要绕过它裸跑 pnpm。
- **查新/升级节奏**:`bash scripts/install.sh [profile] --check`(或默认安装模式末尾的版本报告)对比「已装 vs registry dist-tag」;要升级先浏览 `repo` 的 CHANGELOG/releases,确认后 `--update`,重启 dsh server 生效。
- **卸载**:`dsh plugin --profile <p> remove <name>`,并删 manifest 条目。
- **核心升级后排障**:升级 dsh 核心后若 web profile 起不来、报 `does not provide an export named ...`,崩的是 **pnpm 装进 profile 的第三方包**(编译时绑的是旧版核心 API,导出被改名/删除就 import 失败),不是本仓库的 junction 插件。修法:升级到已跟上新 API 的版本(`dsh plugin --profile <p> add <name>@latest`,会写 `~/.dsh/profiles/<p>/`,受限沙箱下需 full access)或先 `remove`;应急逃生用 `dsh --profile web-safe`。

## 备用 profile(web-safe)

`$DSH_HOME/profiles/web-safe`:不加载任何插件的原版 web(仅 in-box 模板 bundles `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`),平时不用。当 web profile 在插件安装/升级后起不来时,用 `dsh --profile web-safe` 启动干净服务做修复或逃生。由 `scripts/install.sh` 默认模式缺则创建、存在即不碰(重建=删目录重跑);**禁止往 web-safe 装插件**(脚本有守卫)。

## 本机 vs 共享

- `scripts/*.ps1`、`scripts/*.sh`、`scripts/*.cmd` 是本机生成的安装脚本,**不入库**;生成模板见 `scripts/install.md`(含 Windows 与 Linux 两个平台的完整脚本)。
- `AGENTS.local.md` 记录本机 DSH 环境路径与已注册状态,**不入库**。
- `third-party.json` 声明本机使用哪些第三方插件,**本地配置不入库**(格式见「第三方插件纳管」)。
- 以上本地文件都不要通过 git 提交(见 `.gitignore`),否则会覆盖/泄漏他机环境信息。
- **入库文件的内容同样禁含本机信息(不止文件名):** `AGENTS.md`、`README.md`、`docs/*.md`、插件代码与注释、测试 fixtures 中不得出现本机用户名、主机名、Tailscale/内网 IP、绝对 home 路径、公司内网域名、公司内部数据样本;需要时改写为占位符(`$HOME`、`<tailscale-ip>`、`<repo-root>`、`<user>`)。本机细节只沉淀到 `AGENTS.local.md`。
- **提交前自查:** `git grep -nE '<本机用户名>|<内网域名>|<home 路径>'` 扫当前树;`git grep -nE '<pattern>' $(git rev-list --all)` 扫历史;`git status --ignored` 确认本地文件仍被 `.gitignore` 挡住。

## 维护约定

- 新增插件:在 `plugins/` 下建目录 → 按上述格式写文件 → 本机跑 `scripts/install.ps1`(或手动注册)→ 重启 dsh server。
- 修改 host/client 代码后:重启 dsh server 生效(junction 直接指向本仓库源码,无需重新安装)。
- Windows PowerShell 5.x 读取无 BOM 的 UTF-8 文件按 ANSI 解码,**非 ASCII 注释可能吞掉下一行代码** —— 仓库内所有 `.ps1` 文件必须保持纯 ASCII。
- 提交身份:本仓库对外开源,commit 作者一律用公开 GitHub 身份(仓库级 local config 设置,不动全局 git config);公司邮箱/内部身份不进历史——如已误入,推送公开 remote 前先重写历史(`git rebase -i --root` 合成单 commit + `--reset-author`)。
- 临时产物(探针脚本、日志、截图、schema 转储)放 `.tmp/`,备份文件用 `.bak-*` 后缀——两者都已 gitignore,不要散落在仓库根或插件目录里被 `git add -A` 带进去。

## 全局 AGENTS.md 维护约定

- 全局规则文件 `~/.dsh/AGENTS.md` **直接改**(工作区外,需要时以 full access 升级获批),不做仓库→全局的同步流程。
- 本仓库只负责沉淀修改经验:每次改了全局 AGENTS.md 的什么、为什么、怎么改顺手,记入 **`docs/experience.md`**(详细)与本文件「经验记录」小节(简版),方便以后照着手改。
- 全局 AGENTS.md 一律使用**英文**编写。它是 DeepSeek Harness 用户级通用规则(如沙箱行为、GCM),**不属于本机环境**;本机环境信息只放 `AGENTS.local.md`(gitignore,不入库)。
- 措辞规矩:「当 X 时可以 Y」,不写「只有 X 才 Y」/「只要 X 就 Y」的硬性规则。

## 经验记录

- 简版规则摘要放这里;每次修改的详细背景、决策与措辞讨论见 `docs/experience.md`。
- **沙箱 + GCM(已直接写入全局 AGENTS.md 的 `## Work Rules`,详见 `docs/experience.md` 第 1 条):**
  - GCM(Git Credential Manager)只有在 full access 沙箱模式下才能读取系统凭据;受限模式(如 `workspace-write`)下 `git push` 会因此失败,应视为权限问题,不是 git 配置问题。
  - 受限模式下操作因 sandbox 权限被拒时,可在用户批准下以原命令原样重试一次带 `danger-full-access` 的命令;仅限权限导致的失败,不要用于无关错误。(见全局 AGENTS.md:`When an operation is denied or fails because of sandbox permissions...`)
- **弃用 `<thinking>` 文本标签(详见 `docs/experience.md` 第 2 条):** 全局规则不再让模型输出 `<thinking>` 标签(dsh 不折叠文本标签,标签会污染可见输出);过程与分析一律走原生 thinking (reasoning) 通道,UI 自动折叠。措辞规矩:惜字如金,只正面写「过程走 thinking 通道」,不加标签禁令、体积限制或规则定位声明。
- **提问规则 + 删除 streaming 解释句(详见 `docs/experience.md` 第 3 条):** Work Rules 的 "stop and ask" 改为「问用户通常比在代码/环境里翻找更高效;不是 benchmark 模式,不必事事自主调查;信任用户」;删掉 Thinking Rules 里 streaming 不可撤回的解释句(无可执行指令)。措辞规矩:提问规则写理由式措辞,不用命令式 "stop";规则里不留设计层面解释。改全局文件前先给 diff 草案,确认后再改。
- **开源前隐私自查 + 提交身份(详见 `docs/experience.md` 第 6 条):** 曾把本机用户名、Tailscale 主机名+IP、另一台机器的 `user@ip`、绝对 home 路径、公司内部数据样本写进入库文档,且全部历史的 commit 作者是公司真名+公司邮箱。规矩加强为:①入库文件**内容级**禁本机信息(见「本机 vs 共享」);②commit 身份用公开 GitHub 身份(noreply 邮箱);③历史被污染就 `git rebase -i --root` 合成单 commit 再推公开仓库;④GitHub「Keep my email addresses private」只覆盖 web 端操作,命令行历史要用 noreply 邮箱必须自己在 git 里设。
- **本机首次创建全局 AGENTS.md + 反转 Local environment 约定(详见 `docs/experience.md` 第 4 条):** 本机原无全局 AGENTS.md,参考另一台已配置机器(Windows)的写法新建;用户认为除 sandbox escalate + GCM 外其他规则无用,只留两条 Work Rules;用户明确要求把 Local environment 写入全局 AGENTS.md(之前第 1 条「不要放」的约定以当前用户意愿为准);本机环境细节(GPU/集群/Tailscale/各语言运行时等)只沉淀在 `AGENTS.local.md`,不写进入库文件。