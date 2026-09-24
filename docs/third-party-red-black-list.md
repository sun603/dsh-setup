# 第三方插件红黑榜(试用后抛弃记录)

> 记录**装过又抛弃**的第三方 dsh 插件:为什么抛弃、重新评估的前提、清理要点。
> 目的:避免重复试错;给「要不要再给一次机会」提供判据。
> 约束:本文件**入库**,禁含本机信息(用户名/主机名/IP/绝对 home 路径/内网域名/内部数据样本);
> 装机侧的过程细节只沉淀到 `AGENTS.local.md`,这里只留可迁移的结论。
> 评估与排障方法见 `third-party-review.md`;纳管机制见根目录 `AGENTS.md`「第三方插件纳管」。

## 条目格式

每条固定五段:**包名/版本/来源** → **试用与抛弃时间、用户决定(原话)** → **抛弃原因分类**(功能不符 / 上游缺陷 / 维护成本 / 安全边界)→ **重新评估的前提**(上游修什么才能再试)→ **清理要点**(除了 `dsh plugin remove` 还要手工清什么)。

---

## 1. use-opencode-local-provider@0.2.0

- **来源**:git 托管(`github:Payel-git-ol/use-opencode-local-provider`,锁 commit `c7f1e78`);npm 上无此包,只能走 github 协议。
- **试用**:2026-09 上旬;功能定位是把本机 opencode 的 agent 会话桥成 OpenAI 兼容 API,给 dsh 当模型路由用。
- **抛弃**:2026-09-18,用户拍板「opencode api 就在 opencode 里面用」。
- **原因分类**:功能定位错误(主因)+ 上游缺陷 + 安全边界。逐条(按重要性):
  1. **对 dsh 它不是一个 agent**:bridge 只回文本、无 tool_calls。拿它跑工具型会话 = 「模型说它做了,其实什么都没做」——这是定位级问题,不是调优问题。
  2. **每请求都被套进 opencode 的 build agent**,系统提示+工具目录固定吃掉约 4.5k prompt_tokens(单字测试实测),且每请求新建会话、跨请求不复用缓存。
  3. **同一个模型 slug,经 bridge 与经 TUI 的命运可以相反**(硬事实):bridge 把某 slug 秒判 `ModelUnavailableError`,用户在 TUI 新进程里用完全相同的 `{id, providerID, variant}` 正常出字。附带的教训:「catalog 条数对比」**不是**可靠的新鲜判据——catalog 按需懒加载,刚起的 serve  `/api/model` 可能返回 0 条,别照它下结论。
  4. **上游失败不往前传**:闷到 `streamTimeoutMs` 才回笼统 `502 upstream_error`,而错误码落在 dsh 的重试白名单里 → 一次失败要等两轮超时(实测一轮 4 分钟零产出)。
  5. **静默不 drain 这种坏法**:opencode 收下会话、打完三行进度(watcher backend / project copy refresh done / booting location services)就一步不停——无 loop、无 stream、无 ERROR、error 字段空、tokens 全 0;该 slug 元数据与能出字的模型毫无差别,成因未定论。
  6. **上游版本升级说废就废**:opencode 1.18.31 已删 `GET /api/permission` 与 `POST /api/permission/{id}/reply`(现回 SPA HTML),插件的自动批准永久失效。
  7. **双向无鉴权**:serve 与 bridge 之间没有任何认证(仅绑 loopback),威胁模型要先问清楚。
- **装机侧两个雷**:①npm 无此包只能 github 协议;②上游 `files: ["lib"]` 把 `cordis.patch.yml` 漏出安装产物,而 bundle 指着它 → 装上直接 ENOENT 起不来,须手工补回(**任何 add/update 重装都会再丢**)。
- **重新评估的前提**:opencode 侧恢复 permission 端点 + 插件改成透传 tool_calls 的真 agent 通道 + 上游失败前置 + 修 `files`。四条缺一就别再装。
- **清理要点**:`dsh plugin --profile <p> remove <name>` 之外,还要手工清四处:web 用户补丁层里为该插件加的定向 config 行与注释块、凭据库里的 API key 占位引用、隔离 workdir、`third-party.json` 条目。卸载后 `--dump-config` 复验 EXIT=0 且组合结果 0 处该插件名。bridge 端口会被**当前进程**继续监听到重启为止。

## 2. @a9i5k4/dsh-anchored-monitor@0.3.1

- **来源**:npm 发布(registry dist-tag `latest`)。
- **试用**:2026-09 上旬;功能定位是锚定监控(把某个监控目标固定在 UI 上)。
- **抛弃**:2026-09-10,用户觉得没用。
- **原因分类**:功能不符——监控信息对本人没有决策价值,留着她只是噪音。
- **重新评估的前提**:出现明确的监控诉求(比如要长期盯某个指标)再考虑;否则不必。
- **清理要点**:`dsh plugin remove` 已清 bundles/deps、`third-party.json` 条目已删;但**当前运行的 server 仍加载着插件与其监控进程**,重启后彻底消失——卸第三方插件后记得提醒用户重启,别让孤儿进程看起来像「卸载失败」。

## 3. dsh-remote-web-gateway@0.2.3

- **来源**:git 托管(`github:AercherC/dsh-remote#main&path:/plugin`,锁 commit `2fcbda7`);npm 另有 0.2.2,与 main 有代码差异(main 的 core 多 pairing-long / web-compat,插件侧少一个 GitHub 登录模块)。
- **功能**:Cloudflare Quick Tunnel 把 DSH Web GUI 暴露到公网(手机/平板远程访问)+ 扫码/配对码配对 + 设备管理;tunnel 默认关闭,需用户在设置里手动开启;远程网关仅监听本机回环,公网请求必须先过认证。
- **试用**:2026-09-24 安装并**全链路验证通过**(boot 图就位;管理 RPC `status` 返回 available/enabled:false/phase:idle;workspace-browse 端点 200)。
- **抛弃**:2026-09-24 当天卸载,用户拍板「不行卸载了」。
- **原因分类**:维护成本——**功能本身可用,抛弃不是因为功能**,是因为装它、养它要连续绕两个上游坑:
  1. **git 安装路径缺构建**:上游 `prepack` 只跑客户端边界校验、没有 build 步骤,`dsh plugin add github:...` 规格必挂(`lib/client.js not found`);只能本地构建链(clone → 根 build → 插件 build → pack → `file:` tarball)安装,profile 依赖记录变成机器相关的本地路径。详见 `third-party-review.md` §3.1。
  2. **dsh 核心 latent bug**:插件的管理 RPC 走 `ctx.connection.rpc.handle()`,该 API 在全部已发布 dsh 版本上必崩,须给 dsh 安装内的 `dsh-client-connection` 打补丁(`owner.webServer` → `owner.get("webServer")`);**dsh 核心升级会冲掉补丁**,每次升级后要重打。详见 §3.2。
- **重新评估的前提**:上游给 prepack 补上 build(或加 prepare)、或 dsh 修掉 connection register 的 bug——两者任一修复,维护成本就降到「一条官方命令」的水平,值得重装。
- **清理要点**:`dsh plugin remove` + 还原核心补丁(删 .bak)+ 删 profile `pnpm-workspace.yaml` 里为该包加的 allowBuilds key + 删本地 tarball/clone/插件状态目录;最后 `--dump-config` 复验 + 诊断实例另端口启动验证,确认 profile 回到安装前状态。

---

## 附:从黑榜提炼的三条军规

1. **装第三方插件前先问「它坏了谁负责修」**:功能缺陷可以等上游,安装机制缺陷(§1.3 两个案例)意味着每次重装/升级都要人工补救,成本要提前算给用户。
2. **堆栈落在核心包时敢怀疑核心**:in-box 没人用的 API 就是没人验证过的 API(§3.2);逐版对比核心包源码能排除「版本错配」误判。
3. **卸载 = 卸代码 + 卸配置 + 卸进程 + 卸记录**:四样都清掉再复验(`--dump-config` + 另端口诊断启动),少一样都会在下次排障时浪费时间。
