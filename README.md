# dsh-setup — DeepSeek Harness 本地插件集

把插件代码托管在这个仓库里,通过 junction 链接 + profile 补丁注册到本机 dsh,
**多插件长期维护、可 git 共享**。

## 目录结构

```
dsh-setup/
├── plugins/
│   └── dsh-web-ui-addons/      # 一个插件 = plugins/ 下一个带 package.json 的包
│       ├── package.json         # name 即包名;dsh.client 声明浏览器端入口
│       └── lib/
│           ├── index.js         # host 端(cordis 插件,`export { apply, inject, name }`)
│           └── client.js        # 浏览器端 bundle(`window.__ModuleLoader__.load(...)`)
├── scripts/
│   └── install.ps1              # 本机一键安装脚本(已 gitignore,不入库,新环境按下方手动步骤安装)
└── README.md
```

## 插件怎么写

- **host 端 `lib/index.js`**:普通 Cordis 插件,`export { apply, inject, name }`。
  通过 `ctx.get('webServer')` 注册 HTTP 路由、`ctx.get('subprocess')` 跑进程等,
  所有 DSH 服务都能用(参考 `dsh-web-ui-addons`)。
- **client 端 `lib/client.js`**:浏览器 bundle,固定信封:

  ```js
  window.__ModuleLoader__.load({
    id: "<包名>",            // 必须等于 package.json 的 name
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      let react = require("react");
      // ... 插件代码,apply(ctx) 里用 ctx.slots.register 注册 UI ...
      exports.apply = apply;
      exports.inject = inject;
      return module.exports;
    }
  });
  ```

- **package.json 必填**:
  ```json
  {
    "name": "<包名>",
    "type": "module",
    "main": "lib/index.js",
    "exports": { ".": { "default": "./lib/index.js" }, "./client": { "default": "./lib/client.js" } },
    "dsh": { "client": { "platform": "web" } }
  }
  ```

## 安装 / 更新

> `scripts\install.ps1` / `scripts\install.sh` 是本机生成的安装脚本,已被 gitignore(生成模板见 `scripts/install.md`)。
> 新环境按下面的**手动步骤**操作即可(脚本本身做的就是这两件事,幂等)。

每个插件手动安装:

1. 建 junction 链接(junction 目标直接指向本仓库源码,改完代码重启即生效):

   ```powershell
   mklink /J "$HOME\.dsh\profiles\node_modules\<包名>" "<本仓库>\plugins\<包名>"
   ```

   `profiles\node_modules` 是 dsh 的**共享模块农场**——官方 `dsh-*` 包都链接在这里,每个 profile 通过 Node 的父目录向上查找解析到它。

2. 在 `~\.dsh\profiles\web\cordis.patch.yml` 追加注册行(已存在则跳过):

   ```yaml
   - insert:
       - id: <包名>
         name: <包名>
   ```

3. **重启 dsh server 生效**(web profile 的 HMR 默认禁用)。

> 若本机已有 `scripts\install.ps1`(本地文件,不入库),直接运行
> `powershell -ExecutionPolicy Bypass -File scripts\install.ps1` 即可完成 1、2 两步。

## 新增一个插件

1. 在 `plugins\` 下新建目录 `<新插件名>\`,按上面格式写 package.json + lib\index.js + lib\client.js
2. 重跑 `scripts\install.ps1`

## 卸载一个插件

1. 删除 `~\.dsh\profiles\web\cordis.patch.yml` 中对应的 `- insert:` 段
2. 删除 `~\.dsh\profiles\web\node_modules\<包名>` 链接
3. 重启 dsh server

## 常见问题

- **为什么用 junction 而不是把插件拷进 profile?**
  junction 让 dsh 直接看到本仓库的源码,`git pull` 更新后重启即生效,无需重复安装。
- **换机器怎么用?** clone 本仓库 → 按「安装 / 更新」的手动步骤逐个注册插件 → 重启 dsh。
- **多个 profile?** web 之外的 profile 用 `-Profile <名字>` 参数。
- **升级 dsh 后 web profile 起不来,报 `does not provide an export named ...`?**
  崩的是 **pnpm 装进 profile 的第三方包**(如 `dsh-image-gen`),不是本仓库的 junction 插件。
  它们编译时绑的是旧版核心 API,核心升级后导出被改名/删除就会 import 失败。
  典型例子:dsh `0.1.2-rc.1` 把 `@deepseek-ai/dsh-settings` 的顶层 `installSettingsSection()`
  换成了 `settings.installSection()`(v0.2.4 的 image-gen 因此崩,v0.4.1 已跟上)。
  修法:按「第三方插件纳管」升级到不再依赖旧 API 的版本(`bash scripts/install.sh web --update`,
  或只升这一个:`dsh plugin --profile web add dsh-image-gen@latest`;会写 `~\.dsh\profiles\<p>\`,沙箱下需 full access),重启 dsh server。
  暂时不想升就 `dsh plugin --profile web remove dsh-image-gen`;
  应急逃生用 `dsh --profile web-safe`(不加载任何插件的原版 web)。

## License

MIT,见 [LICENSE](LICENSE)。