# 经验沉淀(dsh-setup)

> 这里记录对用户级全局配置(主要是 `~/.dsh/AGENTS.md`)的每次修改:改了什么、为什么、怎么改最顺手。
> 每次改动定稿后追加一条,方便以后照此办理。

## 1. 沙箱权限与 GCM(全局 AGENTS.md `## Work Rules` 新增两条英文规则)

**背景**

- GCM(Git Credential Manager)只有在 full access 沙箱模式下才能读取系统凭据;受限模式(如 `workspace-write`)下 `git push` 会失败,这是权限问题,不是 git 配置问题。
- workspace-write 模式下修改工作区外文件(如全局 AGENTS.md)会被 sandbox 拒绝;按用户约定,可原样重试一次带 `danger-full-access` 的命令,由用户批准。

**最终写入全局文件的内容**(英文,`## Work Rules` 末尾):

```text
- When an operation is denied or fails because of sandbox permissions while in a restricted mode (e.g.
  `workspace-write`), you may retry that exact operation once with full access
  (`danger-full-access`) plus a one-line justification, pending user approval. Reserve this for
  permission-caused failures; do not use it to retry unrelated errors.
- GCM (Git Credential Manager) can read system credentials only under full access; in restricted
  modes `git push` may fail because GCM cannot access credentials. Treat such failures as
  permission-related rather than git misconfiguration.
```

**讨论定下的规矩(以后照此写)**

- 全局 AGENTS.md 一律用英文;它是 DeepSeek Harness 用户级通用规则,**不属于**「Local environment」,不要放进那一节。
- 措辞用「当 X 时可以 Y」,不要写成「只有 X 才 Y」或「只要 X 就 Y」的硬性规则。
- 改全局文件前先在仓库把内容讨论定稿并记录到本文件,再直接改全局文件;不做仓库→全局的同步流程。

**初稿教训**

- 第一版写成中文、作为独立小节放在 `Local environment (Windows 11)` 后面,被否;定稿改为英文并并入 `## Work Rules`。

## 2. 弃用 `<thinking>` 文本标签,改用原生 thinking 通道(全局 AGENTS.md 规则区改写)

**背景**

- 旧规则要求把过程写进 `<thinking>` 文本标签,但 dsh 只折叠原生 reasoning block,不剥离文本标签,标签原样进入可见输出和会话记录,观感上就是碎碎念。
- "prefer using `<thinking>`" 这类措辞让模型每个工具结果后都倾向写标签,出现频率变高。
- 正确路径:分析走 API 层原生 reasoning 通道(thinking),UI 自动折叠;文本里不再提 `<thinking>`。

**最终写入全局文件的内容**(英文,改动四处):

```text
# Visible Reply Rules 中:
- Process belongs in the thinking (reasoning) channel, not in visible text.

# 原 ## `<thinking>` Usage Rules 整节替换为:
## Thinking Rules
- Reason in the native thinking channel; the UI folds it automatically.
- When no analysis is needed, give the result directly.
- Streaming output cannot be deleted after the fact, so these rules must be followed from the very first sentence.

# Work Rules 首条合并为:
- After a tool result returns, give the visible conclusion directly; reason in the thinking channel when judgment is needed. ...

# Example 正确示例删掉 <thinking> 行,只留结论句。
```

**讨论定下的规矩(以后照此写)**

- 全局 AGENTS.md 惜字如金:不加"禁止 XML 标签"之类的反面说明,不加体积限制(≤N 行),不写规则定位声明;只正面说"过程走 thinking 通道"。
- 同类规则合并一处,删掉重复条目(原 Work Rules 里有两条重复的 thinking 规则)。
- 用户明确否掉的写法不要残留:体积限制、弱约束声明、标签禁令均被否。

## 3. 提问规则改写 + 删除 streaming 一句(全局 AGENTS.md 两处改动)

**背景**

- 旧规则 "If the next step is unclear, stop and ask" 的 "stop" 措辞太硬,且没说明为什么该问。
- 用户的意图:多提问用户比从代码和环境中找信息更高效;这不是 benchmark 模式,不需要过度自主思考,要信任用户。
- "Streaming output cannot be deleted after the fact..." 是设计层面的解释,对模型没有可执行的新指令,删除。

**最终写入全局文件的内容**(英文):

```text
# Thinking Rules 删去第三条:
- Streaming output cannot be deleted after the fact, so these rules must be followed from the very first sentence.

# Work Rules 第二条改写为:
- When unsure, ask the user — it is usually more efficient than digging through code
  and the environment. This is not benchmark mode; there is no need to investigate
  everything autonomously. Trust the user. Do not repeat similar tool calls.
```

**讨论定下的规矩(以后照此写)**

- 提问类规则不写 "stop and ask" 这种命令式停下,写成「问比查更高效 + 信任用户」的理由式措辞。
- 规则里不保留解释性/设计层面的话(如 streaming 不可撤回),只留可执行指令。
- 改全局文件前先给 diff 草案,用户确认后再动手,不要直接改。

## 4. 本机(Linux)首次创建全局 AGENTS.md + 反转「Local environment 不放全局」约定

**背景**

- 本机 `~/.dsh/AGENTS.md` 之前不存在,用户想参考另一台已配置的 Windows 机上的写法建一个。
- Windows 机上的版本有一堆规则(Core Principles / Visible Reply Rules / Thinking Rules / Work Rules / Example / Local environment),用户说「其他的都没有什么用」,只保留 sandbox escalate + GCM 两条 Work Rules。
- 用户明确说 **Local environment 应该放到全局 agents.md**(与之前第 1 条定下的「全局 AGENTS.md 不属于 Local environment,不要放进那一节」的约定相反),以用户当前意愿为准。

**最终写入全局文件的内容**(英文,整体精简版):

- 只有两节:`## Work Rules`(两条:sandbox escalate、GCM)+ `## Local environment (Ubuntu 24.04)`。
- Local environment 小节按本机实际信息逐节填写(OS/GPU、网络、集群、各语言运行时、容器、虚拟化)。**具体值属于本机信息,只沉淀到 `AGENTS.local.md`,不写进入库文件**——开源前复查的教训,见第 6 条。

**讨论定下的规矩(以后照此写)**

- 「Local environment 该不该放进全局 AGENTS.md」这个问题:**以用户当前意愿为准**。本机用户明确说要放,那就放;别的机器不一定。之前第 1 条里的「不要放」是当时另一台 Windows 机的讨论结论,不普适。
- 首次新建流程:先 ssh 到已有配置的机器看一眼 → 收集本机环境信息 → 出草稿 → 用户确认 → 用 `danger-full-access` 写入 `~/.dsh/AGENTS.md`。
- 写完后 DSH 会自动加载(下一轮 system-reminder 就能看到),不需要重启 server。

## 5. VirtualBox 小节补 full-access 说明 + 禁止 agent 跑 vboxconfig

**背景**:原 VirtualBox 小节只有两行——版本 + 「vboxdrv 未加载,跑 `sudo /sbin/vboxconfig` 才能起 VM」。问题有二:

1. 没说 VirtualBox 命令需要 `danger-full-access` 沙箱权限——agent 在默认 workspace-write 下跑 VBoxManage 会被拒。
2. 措辞「VMs cannot start until ...」像在暗示 agent 去跑 vboxconfig——但这是用户手动做的系统配置事,agent 不该碰。

**修改**:
- 加一行:VirtualBox commands require `danger-full-access` sandbox mode.
- 把 vboxdrv 那句改写为:「module may not be loaded; if VMs fail to start, the user must run `sudo /sbin/vboxconfig` manually — agents should not attempt this themselves.」——明确是用户手动操作,agent 不要尝试。

**措辞规矩**:
- 环境能力类信息,如果 agent 不能自己搞定,一定要写清楚「谁来做 / agent 做不做」,不要只写事实让模型自己猜。
- 涉及权限升级的工具/命令,单独列一条 require 什么 sandbox mode,和 GCM 那条对应。

## 6. 开源前隐私自查:入库文件内容级禁本机信息 + commit 身份用公开 GitHub 身份(2026-09-23)

**背景**

- 打算把本仓库开源到 GitHub,推之前做了一遍隐私复查,在已跟踪文件、未提交文件和全部历史提交里翻出多类本机/个人信息:
  - git 作者身份是公司真名 + 公司邮箱(13 个历史提交全中);
  - 入库文档(`AGENTS.md` 经验记录、`docs/experience.md` 第 4 条)里有本机用户名、Tailscale 主机名+IP、另一台 Windows 机的 `user@ip`、以及 GPU/集群/运行时版本等整段本机环境;
  - 待提交的新插件 README 里有绝对 home 路径、另一私有仓库的路径、「本机 Chrome profile 名」;
  - 代码注释里有公司内部数据样本(箱号/船名)当例子。
- 根因:以前的约定只管到**文件名级**(哪些文件不入库),没管到**内容级**(入库文件里写了什么)。

**处理**

- 本机信息从入库文件撤出,沉淀到 `AGENTS.local.md`(gitignore);experience.md 第 4 条只留决策与措辞规矩,具体值全部移除。
- 待提交文件里的绝对路径改占位符/相对路径(`$HOME`、`<repo-root>`);公司数据样本例子换中性示例。
- `.gitignore` 补 `.tmp/` 与 `*.bak` / `*.bak-*`(临时产物与备份文件)。
- 历史:公司身份污染了全部提交 → 先把待提交改动落一个 commit,再 `git rebase -i --root`(`GIT_SEQUENCE_EDITOR` 把第 2 行起全改 `fixup`)合成单 commit,`git commit --amend --reset-author` 换成公开 GitHub 身份;旧历史只留在私有 remote,不推公开仓库。
- GitHub 身份:`ssh -T git@github.com` 回显的用户名;邮箱用 `26936672+sun603@users.noreply.github.com`(GitHub「Keep my email addresses private」设置给的 noreply 形式),避免真实邮箱进公开历史。注意该设置只覆盖 web 端操作,命令行提交必须在 git 里显式设置 noreply 邮箱。

**定稿的规矩(已写入 `AGENTS.md`「本机 vs 共享」与「维护约定」)**

- 入库文件内容级禁本机信息:用户名、主机名、Tailscale/内网 IP、绝对 home 路径、公司内网域名、公司内部数据样本,一律占位符化;本机细节只进 `AGENTS.local.md`。
- 提交前 `git grep` 扫当前树 + `git grep $(git rev-list --all)` 扫历史;`git status --ignored` 确认本地文件仍被挡住。
- commit 作者用公开 GitHub 身份(仓库级 local config);公司身份不进公开历史。
