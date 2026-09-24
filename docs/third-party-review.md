# 第三方插件评估与排障(dsh-setup)

> 记录第三方 dsh 插件的**评估方法、装后验证清单、实测问题模式**。
> 目标:装任何第三方插件前照清单过一遍;装挂了照问题模式查,不从零排查。
> 约束:本文件**入库**,禁含本机信息(用户名/主机名/IP/绝对 home 路径/内网域名/内部数据样本);
> 路径一律写 `$DSH_HOME`、`<repo-root>` 这类占位符,本机细节只沉淀到 `AGENTS.local.md`。
> 抛弃的插件另见 `third-party-red-black-list.md`;机制与命令见根目录 `AGENTS.md`「第三方插件纳管」。

## 1. 装前评估清单

按顺序过;任何一项答不上来,先补齐再装。

### 1.1 来源与分发形态

- **npm 发布**优先:版本可查、dist-tag 可追 CHANGELOG、`dsh plugin --profile <p> add <name>@<tag>` 一把到位。
- **git 托管**(`github:owner/repo#ref&path:/sub`)是 npm 无包时的退路,但要额外验证**安装时构建**(见 §3.1)——很多仓库的发布流程是「先 build 再 publish」,git 路径不构建,装上去直接缺 `lib/`。
- 看 `repository`/`homepage` 是否与包名对得上;顺手看 README 的安装命令是否就是你要执行的那条(上游文档写错也会带崩用户)。

### 1.2 包完整性(对着 package.json 逐项核)

- `dsh.bundle.patch` 声明的文件**必须在 `files` 白名单里**。经典坑:上游写 `files: ["lib"]` 而 patch 是 `./cordis.patch.yml` → tarball 里没有它 → 装上启动即 ENOENT(§3.3)。
- `dsh.client.platform: "web"` + `exports["./client"]` 成对出现;浏览器半边缺一个都进不了 boot 图。
- `main` 指向的 `lib/index.js` 对 git 源同样受 §3.1 影响。
- 发布 tarball 与 git 仓内容可能**不同步**(版本号、文件增删都可能);以你要装的那条来源的实际内容为准。

### 1.3 依赖与 peer 对齐

- 运行时的 `@deepseek-ai/*`(cordis、dsh-client-*、dsh-host-webserver 等)由 DSH 安装自身提供(农场解析),**不是**装进 profile 的;装之前先确认农场里这些包存在且链接不悬空(§3.5)。
- peer 区间用 prerelease 语义时**不跨 tuple 匹配**:`^0.1.0-rc.5` 匹配不到 `0.1.2-rc.1`。pnpm 的 "missing peer" 警告先分清是「真缺」还是「区间错位」,后者一般仍能跑,前者才要管。
- 裸依赖(代理、JWT、HTTP 客户端这类)确认会随包装进 profile 的 node_modules。

### 1.4 安装机制(沙箱与构建)

- git 托管包首次 `add` 大概率撞 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`:pnpm 要求把**它打印的那条精确 key** 加进 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`,再原样重跑。key 含 resolved commit hash,main 前移后 key 会变。
- 放行 prepare 只是第一关;prepack/verify 链缺 build 是第二关(§3.1)。
- 往 profile 目录(`$DSH_HOME/profiles/<p>/`)写东西在受限沙箱下要 full access;提前规划,别来回试。

### 1.5 客户端平台兼容(boot 图视角)

- 插件 client bundle 的**外部 require 词**必须落在平台 seed 或 boot 图行里。实证判据:提取该 bundle 的 `require("...")` 集合,确认它 ⊆ 一个**正在跑的**同平台插件 client 的 require 集合(在跑的证明 seed 覆盖)。
- `dsh.client.inject` 里列的包名**不是图行时浏览器侧直接跳过、宿主侧不解析**——inject 缺失通常无害,别被它吓到;真正致命的是 bundle 里真实 `require` 的词没有着落。
- 协议要点:client bundle 只 `load()` 注册工厂,物化在首次 import;`require` 的顺序 seed → 已物化 → 已注册工厂,miss 就抛(运行时镜像构建期的 purity gate)。

### 1.6 host 端 API 兼容

- 插件 `inject` 声明的服务名必须在当前 dsh 里存在;`ctx.<service>` 属性访问走「fiber 上行 + isolate 边界」,**跨分支取不到**(§3.2 的坑即源于此)。
- 已知雷区:`ctx.connection.rpc.handle()` 在全部已发布 dsh 版本上必崩(§3.2);`webServer.register` 直注册是安全的。
- 装前可静态扫一遍构建产物 `lib/*.js` 的 import 清单:只应出现相对路径、node 内置、vendor 目录和已装裸依赖;出现意料之外的 `@deepseek-ai/*` value import 就要去农场核实。

## 2. 装后验证清单(按序执行,全绿再重启)

1. **安装退出码 0**,且 profile package.json 的 `dsh.profile.bundles` 被自动调和进该包名(dsh 按已装状态调和)。
2. **node_modules 产物完整**:`files` 声明的每个条目都在(cordis.patch.yml、lib/、vendor/ 等)。
3. **`dsh --profile <p> --dump-config` EXIT=0**,输出里能查到该 bundle 的补丁行(`- id: <包名>`)。
4. **host 入口运行时可导入**:在 profile 目录跑 node,动态 import 插件的 `lib/index.js`,确认导出 `name`/`inject`/`apply` 齐全。
5. **依赖解析**:裸依赖在 profile node_modules;`@deepseek-ai/*` 能从插件目录 `require.resolve` 到农场目标。
6. **client require 词 ⊆ 在跑插件集合**(§1.5 的实证)。
7. **诊断实例另端口启动**(不扰当前 GUI):`dsh --profile <p> --no-open --port <N>` → 完整启动、boot log 末尾出现带 token 的 URL。
8. **端点端到端**:从 boot log 取 token → `curl -c jar "http://127.0.0.1:<N>/?token=..."` 换 cookie → 打插件的 HTTP/RPC 端点,拿到业务响应(不是 404/连接错误)。
9. 全绿后再由用户重启正式 server;**不要**为了验证去杀在跑的服务。

## 3. 问题模式(实测案例)

### 3.1 git 托管安装路径缺构建 → prepack FATAL(`lib/client.js not found`)

- **现象**:`dsh plugin add "github:...#ref&path:/sub"` 先撞 allowBuilds,放行后 prepack 报 `FATAL: .../lib/client.js not found — run pnpm build first`,安装失败。
- **根因**:包内 `prepack` 只跑校验脚本(如 verify-client-boundary),没有 `prepare`/build 步骤;npm 发布 tarball 自带预构建 `lib/`,而 pnpm 装 git 托管包时只跑 prepack 不构建。
- **解法(本地构建链)**:clone 仓库 → 根目录 `pnpm install && pnpm run build`(若插件 vendor 了 core,必须先构建根)→ 插件目录 `pnpm install && pnpm run build`(prebuild 通常自动 vendor)→ `pnpm pack` 得到 tarball → `dsh plugin --profile <p> add "file:<tarball 绝对路径>"`。
- **代价**:profile 的依赖记录是本地 tarball 路径(机器相关);升级 = 重跑构建链换 tarball。
- **判真伪**:对比 npm 已发布 tarball 与 git 源码的文件集差异,确认 main 到底比发布版多/少什么,再决定装哪条。

### 3.2 `ctx.connection.rpc.handle()` 必崩(`cannot get property "webServer" without inject`)

- **现象**:插件树加载到某插件即崩,堆栈落在 `dsh-client-connection` 的 `HostConnectionService.register` → `owner.effect(() => owner.webServer.register(route))`。
- **根因**:`owner` 是 connection 插件**自己的基础 ctx**;该插件只静态注入 `credentials`,`webServer` 是它 apply 里动态注入进**子 ctx** 的;`ctx.webServer` 属性访问沿 fiber 上行,被 isolate 边界挡住 → 取不到。in-box 插件无人用此 API,所以 latent。
- **影响面**:任何调 `ctx.connection.rpc.handle()` 的第三方插件,在**全部已发布 dsh 版本**上都会崩(逐版核对过 0.1.2-rc.1 / 0.1.5-rc.2 / 0.1.5-rc.3 / 0.1.7-rc.1,同一行坏代码)。
- **修法**:把该行改为 `owner.get("webServer")`——`ctx.get()` 读 app 全局 service store,无 inject 要求(dsh-client-modules 自己也这么用);补丁写在 dsh 安装内的 `dsh-client-connection/lib/index.js`,**dsh 核心升级会冲掉,需重打**。改前留 .bak,改后按 §2 全链验证。
- **教训**:第三方插件「能用官方机制」不等于「官方机制没 bug」;堆栈落在核心包时要敢怀疑核心。

### 3.3 `files` 白名单漏 `cordis.patch.yml` → 装上 ENOENT 起不来

- **现象**:安装成功,但 web profile 起不来,报补丁文件不存在。
- **根因**:上游 `files: ["lib"]`,而 `dsh.bundle.patch: "./cordis.patch.yml"` 在白名单外。
- **解法**:装后立刻按 §2.2 核对 files 清单;缺文件就从仓库对应版本取回补进 node_modules(注意:**任何 add/update 重装都会再丢**,要写进 note)。
- **预防**:§1.2 装前就能看出来。

### 3.4 peer 版本区间错位(prerelease 不跨 tuple)

- **现象**:`pnpm peers check` 一堆 missing peer,但功能正常。
- **根因**:`^0.1.0-rc.5` 只匹配 `0.1.0-rc.*`,不匹配 `0.1.2-rc.1`;peer 由农场按名提供,版本对不上只是警告。
- **判据**:警告里同一服务多个 wanted 版本、且农场里包存在 → 错位,一般无害;农场里包不存在 → 真缺,要处理(§3.5)。

### 3.5 dsh 升级后农场链接悬空

- **现象**:`$DSH_HOME/profiles/node_modules/@deepseek-ai/<pkg>` symlink 存在但目标不存在(`readlink -f` 解析出的路径 `-e` 为假)。
- **根因**:农场链接建于旧版 dsh,升级后 dsh 内部 node_modules 布局/包集变化,旧链接变悬空。
- **影响**:通常无害——宿主按包名解析时落到新 dsh 自带的树;但**依赖具体路径的诊断会误判**。
- **处理**:`readlink` 逐个验目标存在性;悬空的确认没有消费者(§1.5/§1.6 的 require 词核对)即可无视,别急着补链接。

### 3.6 「把 agent 客户端桥成模型 API」类插件的通用判据

以后遇到「给某 agent CLI 套个 bridge 暴露成 OpenAI 兼容 API」的第三方插件,直接照下面判(实测教训,详见黑名单):

1. bridge 只回文本、无 tool_calls → 对 dsh 它**不是 agent**,工具型会话会「模型说它做了,其实什么都没做」。
2. 每次请求被套进上游 agent 的固定 persona,系统提示+工具目录吃掉几千 prompt_tokens,且每请求新建会话、不复用缓存。
3. 同一模型 slug 经 bridge 与经原装客户端**命运可以相反**(一边秒判不可用,一边正常出字);「catalog 条数」不是可靠的新鲜判据(懒加载,刚起的实例可能返回 0 条)。
4. 上游失败不往前传:闷到超时才回笼统错误,且错误码落在 dsh 重试白名单里 → 一次失败等两轮超时。
5. 静默不 drain:收下请求、打几行进度就停,无 stream 无 error,tokens 全 0——这种坏法最难排查,遇到直接放弃。
6. 上游版本升级随时可能删掉插件依赖的端点(如 permission 授权端点),自动批准类功能说废就废。
7. 这类 serve/bridge 通常双向无鉴权(仅绑 loopback),装之前问清楚威胁模型。

## 4. 排障手法(速查)

- **搜 dsh 自身源码**:内置 grep 工具在 `@deepseek-ai` npm 树里会整片漏匹配(同 pattern 报 0 命中),改用系统 `grep -rn`;本机可能没有 `rg`,别把「command not found」当成「无匹配」。
- **会话日志**:`$DSH_HOME/sessions/<项目目录>/<session-id>/session.v3.jsonl.zstd`,用 `zstd -dc` CLI 解;node 的 zstd API 只解第一帧,会把多帧日志误判成「空的」。项目目录名以 `--` 开头,传给 ls/find 要当心。
- **每次 bash 调用都是新 shell 且 /tmp 私有**,跨调用传文件要落工作区(如 `<repo-root>/.tmp/`)。
- **诊断实例**:`dsh --profile <p> --no-open --port <N>` 另起端口,不扰当前 GUI;启动日志末尾有带 token 的 URL,可直接换 cookie 打端点;验完 kill,注意 `pkill -f` 的模式别匹配到执行命令自己(用字符类绕过)。
- **升级后排障**:升级 dsh 核心后 web profile 起不来且报 `does not provide an export named ...`,崩的是 pnpm 装进 profile 的第三方包(编译时绑旧版核心 API),不是 junction 自有插件;应急用 web-safe profile。
