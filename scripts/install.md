# install 脚本模板

`scripts/` 下的安装脚本是**本机生成**的文件(gitignore 掉了 `*.ps1` / `*.sh` / `*.cmd`),
本文件是它们的权威模板。需要时直接复制下方对应的代码块,保存为:

- Windows → `scripts\install.ps1`
- Linux / macOS → `scripts/install.sh`

## 两类插件,两套纳管逻辑

| 类别 | 源码在哪 | 安装方式 | 注册方式 |
|---|---|---|---|
| **自有插件**(`plugins/<包名>/`) | 本仓库 | 农场 symlink → 仓库目录 | profile 的 `cordis.patch.yml` insert 行 |
| **第三方插件**(`third-party.json` 声明——**本机配置,已 gitignore 不入库**) | npm registry(不入库、不钉版本) | 官方 `dsh plugin --profile <p> add <name>@<tag>`(dsh 自动调和 profile package.json 的 `dsh.profile.bundles`) | bundles 层 + 包自带 patch |

第三方插件的升级节奏:install.sh 默认模式与 `--check` 会对比「已装版本 vs registry dist-tag」并报告;确认要升时(先看一眼 manifest 里 `repo` 指向的上游 CHANGELOG/releases),跑 `--update` 一键升级,重启 dsh server 生效。

### third-party.json 格式(本地文件,示例;不入库)

```json
{
  "plugins": [
    { "name": "@some-author/dsh-some-plugin", "tag": "latest",
      "repo": "https://github.com/some-author/dsh-some-plugin",
      "note": "一句话用途/注意事项(如:升级后需重启生效)" }
  ]
}
```

用哪些第三方插件属于本机配置,仓库不代定;新机器自建此文件后,install.sh 会按清单补装并调和 bundles。

## 备用 profile(web-safe)

不加载任何插件的「原版 web」:仅 in-box 模板 bundles(`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`),零第三方、零自有 insert 行。用途:安装/升级插件后 web profile 起不来时,`dsh --profile web-safe` 拉一个干净服务做修复或逃生。install.sh 默认模式**缺则一次性创建、存在即不碰**(保持原始;想重建就删目录重跑);往 web-safe 装插件会被脚本直接拒绝。

## 用法(Linux / macOS)

```bash
bash scripts/install.sh                                  # web profile:装全部自有插件 + 确保第三方在位 + 确保 web-safe 备用 + 版本报告
bash scripts/install.sh headless --dry-run
bash scripts/install.sh web --only dsh-web-ui-addons     # 只装清单内的自有插件(逗号分隔包名)
bash scripts/install.sh web --check                      # 只查第三方版本(只读,无副作用)
bash scripts/install.sh web --update                     # 第三方按 channel 升级(--dry-run 可预览)
```

## 要点

- **改完任何插件(自有或第三方)后必须重启 dsh server 生效**(web profile 的 HMR 默认禁用)。
- **Windows PowerShell 5.x** 读取无 BOM 的 UTF-8 文件按 ANSI 解码,非 ASCII 注释会吞掉下一行代码,所以 `install.ps1` 必须保持纯 ASCII。
- 农场链接路径存在但不是链接(真实目录)时,脚本拒绝覆盖并报错,需手动处理。
- 链接目标用 `readlink -f` 解析后的真实路径,仓库被 clone 到任何位置都可用。
- 若未来 dsh 的 web 模板新增 in-box bundle,同步更新 `ensure_fallback_profile` 里的 bundle 列表(对齐 dsh-app-boot 的 `PROFILE_TEMPLATES.web`)。
- 空 profile 的 `cordis.patch.yml` 末尾是流式数组 `[]`,直接追加块序列会得到非法 YAML——脚本会先把 `[]` 行删掉(注释保留)再追加 insert 行。
- 自有插件包名若为 scoped(`@scope/name`),农场链接会建 `<农场>/@scope/` 子目录(脚本自动 mkdir -p);目录结构需与包名一致(`plugins/@scope/name/`)。当前仓库暂无此类插件。
- 不要手工往 profile 里塞第三方包:统一走 `dsh plugin` 命令,让 bundles 调和逻辑保持一致;manifest 里 `tag` 是 npm dist-tag(`latest` 即不钉版本)。

---

## install.sh(保存为 `scripts/install.sh`)

以下为当前权威版本(2026-09 与本机实装同步):

```bash
#!/usr/bin/env bash
# install.sh - install / update the dsh plugin environment managed by this repo.
#
# Two logics (see AGENTS.md):
#   * self-authored plugins under plugins/: source lives in this repo;
#     installed as a symlink into the shared module farm plus an insert row
#     in the profile's cordis.patch.yml.
#   * third-party plugins declared in third-party.json (machine-local
#     config, gitignored): installed as npm
#     packages into the profile through the official "dsh plugin" command
#     (which reconciles dsh.profile.bundles automatically). Not vendored,
#     not pinned: --check reports registry updates, --update applies them.
#
# Usage:
#   bash scripts/install.sh                                  # web profile: install all own plugins + ensure third-party + version report
#   bash scripts/install.sh headless --dry-run
#   bash scripts/install.sh web --only dsh-web-ui-addons     # restrict own-plugin installation by package name
#   bash scripts/install.sh web --check                      # third-party version check (read-only)
#   bash scripts/install.sh web --update                     # update third-party plugins to their channel
#
# Restart the dsh server afterwards (web profile HMR is disabled by default).

set -euo pipefail

usage() {
  grep '^#' "$0" | grep -v '^#!' | sed 's/^# \{0,1\}//'
}

die() { echo "install.sh: $*" >&2; exit 1; }

PROFILE="web"
DRY_RUN=0
MODE="install"
ONLY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)    usage; exit 0 ;;
    --dry-run|-n) DRY_RUN=1 ;;
    --check|-c)   MODE="check" ;;
    --update|-u)  MODE="update" ;;
    --only)       shift; ONLY="${1:-}"; if [[ -z "$ONLY" ]]; then die "--only needs a comma-separated package list"; fi ;;
    --only=*)     ONLY="${1#*=}" ;;
    -*)           die "unknown option: $1" ;;
    *)            PROFILE="$1" ;;
  esac
  shift
done

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGINS_DIR="$REPO_ROOT/plugins"
THIRD_PARTY_FILE="$REPO_ROOT/third-party.json"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
FARM_DIR="$DSH_HOME/profiles/node_modules"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
FALLBACK_PROFILE="web-safe"
FALLBACK_DIR="$DSH_HOME/profiles/$FALLBACK_PROFILE"

echo "== dsh plugin installer =="
echo "repo:    $REPO_ROOT"
echo "profile: $PROFILE ($PROFILE_DIR)"
if [[ $DRY_RUN -eq 1 ]]; then echo "mode:    $MODE (dry-run)"; else echo "mode:    $MODE"; fi
echo ""

if [[ ! -d "$PROFILE_DIR" ]]; then
  die "profile not found: $PROFILE_DIR (start 'dsh --profile $PROFILE' once first)"
fi

get_package_name() {
  node -e "console.log((require(process.argv[1]).name)||'')" "$1" 2>/dev/null || true
}

# ---- self-authored plugins: farm symlink + cordis.patch.yml insert row ----

ensure_link() {
  local link="$1" target="$2"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  link : dry-run (would symlink $link -> $target)"
    return
  fi
  if [[ -e "$link" || -L "$link" ]]; then
    if [[ ! -L "$link" ]]; then
      die "exists but is not a symlink - handle it manually: $link"
    fi
    rm "$link"
  fi
  mkdir -p "$(dirname "$link")"
  ln -s "$target" "$link"
  echo "  link : symlink ready ($link -> $target)"
}

ensure_patch_row() {
  local id="$1"
  if [[ -f "$PATCH_FILE" ]] && grep -qE "^[[:space:]]*- id:[[:space:]]*${id}[[:space:]]*$" "$PATCH_FILE"; then
    echo "  patch: ok (row for $id already present)"
    return
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  patch: dry-run (row for $id would be inserted)"
    return
  fi
  # A fresh profile patch doc is the flow array []; appending a block sequence
  # after it would make the YAML invalid - drop the [] line first (comments stay).
  if [[ -f "$PATCH_FILE" ]] && grep -qE '^[[:space:]]*\[\][[:space:]]*$' "$PATCH_FILE"; then
    sed -i.dsh-tmp -E 's/^[[:space:]]*\[\][[:space:]]*$//' "$PATCH_FILE"
    rm -f "$PATCH_FILE.dsh-tmp"
  fi
  {
    printf '\n'
    printf '# Managed by %s/scripts/install.sh\n' "$REPO_ROOT"
    printf '%s\n' '- insert:'
    printf '%s\n' "    - id: $id"
    printf '%s\n' "      name: $id"
  } >> "$PATCH_FILE"
  echo "  patch: row inserted ($id)"
}

own_install() {
  if [[ ! -d "$PLUGINS_DIR" ]]; then
    die "plugins directory not found: $PLUGINS_DIR"
  fi
  local found=0
  local dir pkg_file pkg_name
  for dir in "$PLUGINS_DIR"/*/; do
    [[ -d "$dir" ]] || continue
    pkg_file="$dir/package.json"
    if [[ ! -f "$pkg_file" ]]; then
      echo "skip: $dir (no package.json)"
      continue
    fi
    pkg_name="$(get_package_name "$pkg_file")"
    if [[ -z "$pkg_name" ]]; then
      echo "skip: $dir (package.json without name)"
      continue
    fi
    if [[ -n "$ONLY" && ",$ONLY," != *",$pkg_name,"* ]]; then
      echo "plugin: $pkg_name (skipped: not in --only list)"
      echo ""
      continue
    fi
    found=1
    echo "plugin: $pkg_name ($dir)"
    ensure_link "$FARM_DIR/$pkg_name" "$(readlink -f "$dir")"
    ensure_patch_row "$pkg_name"
    echo ""
  done
  if [[ $found -eq 0 ]]; then
    echo "warning: no own plugins installed this run (see skips above)"
  fi
}

# ---- pristine fallback profile (web-safe) ----
#
# A vanilla twin of the web profile: in-box template bundles only, zero plugins.
# When the working profile fails to boot after a plugin install/upgrade, start
# "dsh --profile web-safe" to get a clean server for repair or recovery.
# Created once and never touched afterwards (stays pristine); delete the
# directory manually to regenerate. If a future dsh ships more in-box web
# bundles, update the list below to match PROFILE_TEMPLATES.web.

ensure_fallback_profile() {
  local manifest="$FALLBACK_DIR/package.json"
  if [[ -f "$manifest" ]]; then
    echo "fallback: $FALLBACK_PROFILE present ($FALLBACK_DIR) - untouched (pristine by design)"
    return
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "fallback: would create $FALLBACK_PROFILE at $FALLBACK_DIR (in-box web bundles, no plugins)"
    return
  fi
  mkdir -p "$FALLBACK_DIR"
  {
    printf '{\n'
    printf '  "name": "dsh-profile-%s",\n' "$FALLBACK_PROFILE"
    printf '  "private": true,\n'
    printf '  "dependencies": {},\n'
    printf '  "dsh": {\n'
    printf '    "profile": {\n'
    printf '      "bundles": [\n'
    printf '        "@deepseek-ai/dsh-base",\n'
    printf '        "@deepseek-ai/dsh-web-app"\n'
    printf '      ]\n'
    printf '    }\n'
    printf '  }\n'
    printf '}\n'
  } > "$manifest"
  {
    printf '# Your patch layer for this dsh profile, applied after every bundle layer:\n'
    printf '# a top-level YAML array of loader patch entries (id-targeted config\n'
    printf '# overrides, disables, and insert lists; `!!js` expressions allowed.\n'
    printf '[]\n'
  } > "$FALLBACK_DIR/cordis.patch.yml"
  {
    printf 'packages:\n'
    printf '  - .\n'
    printf '\n'
    printf 'nodeLinker: hoisted\n'
    printf 'autoInstallPeers: false\n'
  } > "$FALLBACK_DIR/pnpm-workspace.yaml"
  echo "fallback: $FALLBACK_PROFILE created at $FALLBACK_DIR (in-box web bundles only)"
}

# ---- third-party plugins: third-party.json + official dsh plugin CLI ----

thirdparty_entries() {
  [[ -f "$THIRD_PARTY_FILE" ]] || return 0
  node -e '
    const m = require(process.argv[1]);
    for (const p of (m.plugins || []))
      console.log([p.name, p.tag || "latest", p.repo || "", p.note || ""].join("\t"));
  ' "$THIRD_PARTY_FILE"
}

installed_version() {
  local name="$1" pkg
  for pkg in "$PROFILE_DIR/node_modules/$name/package.json" "$FARM_DIR/$name/package.json"; do
    if [[ -f "$pkg" ]]; then
      node -e "console.log(require(process.argv[1]).version||'')" "$pkg"
      return 0
    fi
  done
  echo ""
}

registry_version() {
  npm view "$1" "dist-tags.$2" --json --loglevel=error 2>/dev/null | tr -d '"' || true
}

dsh_plugin_add() {
  command -v dsh >/dev/null 2>&1 || die "dsh CLI not found on PATH - cannot manage third-party plugins"
  dsh plugin --profile "$PROFILE" add "$1"
}

thirdparty_ensure() {
  if [[ ! -f "$THIRD_PARTY_FILE" ]]; then
    echo "third-party: no manifest at $THIRD_PARTY_FILE (machine-local config; format in AGENTS.md) - nothing to ensure"
    return 0
  fi
  local name tag repo note inst
  while IFS=$'\t' read -r name tag repo note; do
    [[ -n "$name" ]] || continue
    inst="$(installed_version "$name")"
    if [[ -n "$inst" ]]; then
      echo "third-party: $name installed ($inst)"
      continue
    fi
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "third-party: $name MISSING - would run: dsh plugin --profile $PROFILE add \"$name@$tag\""
      continue
    fi
    echo "third-party: $name missing - installing $name@$tag"
    dsh_plugin_add "$name@$tag"
  done < <(thirdparty_entries)
  echo ""
}

thirdparty_check() {
  if [[ ! -f "$THIRD_PARTY_FILE" ]]; then
    echo "third-party: no manifest at $THIRD_PARTY_FILE (machine-local config; format in AGENTS.md)"
    return 0
  fi
  local name tag repo note inst reg status
  echo "third-party versions (profile: $PROFILE, registry: $(npm config get registry 2>/dev/null || echo '?')):"
  while IFS=$'\t' read -r name tag repo note; do
    [[ -n "$name" ]] || continue
    inst="$(installed_version "$name")"
    reg="$(registry_version "$name" "$tag")"
    if [[ -z "$inst" ]]; then
      status="NOT INSTALLED - run: bash scripts/install.sh $PROFILE"
    elif [[ -z "$reg" ]]; then
      status="registry lookup failed for dist-tag '$tag'"
    elif [[ "$inst" == "$reg" ]]; then
      status="up to date"
    else
      status="UPDATE AVAILABLE - review repo changelog, then: bash scripts/install.sh $PROFILE --update"
    fi
    printf '  %-34s installed=%-9s %s=%-9s %s\n' "$name" "${inst:-none}" "$tag" "${reg:-?}" "$status"
    if [[ -n "$repo" ]]; then printf '    repo: %s\n' "$repo"; fi
    if [[ -n "$note" ]]; then printf '    note: %s\n' "$note"; fi
  done < <(thirdparty_entries)
  echo ""
}

thirdparty_update() {
  [[ -f "$THIRD_PARTY_FILE" ]] || die "third-party manifest not found: $THIRD_PARTY_FILE"
  local name tag repo note inst reg
  while IFS=$'\t' read -r name tag repo note; do
    [[ -n "$name" ]] || continue
    reg="$(registry_version "$name" "$tag")"
    if [[ -z "$reg" ]]; then
      echo "skip $name: cannot read registry dist-tag '$tag'" >&2
      continue
    fi
    inst="$(installed_version "$name")"
    if [[ -n "$inst" && "$inst" == "$reg" ]]; then
      echo "$name: already at $reg"
      continue
    fi
    if [[ $DRY_RUN -eq 1 ]]; then
      if [[ -n "$inst" ]]; then
        echo "$name: would update $inst -> $reg  (dsh plugin --profile $PROFILE add \"$name@$tag\")"
      else
        echo "$name: would install $reg  (dsh plugin --profile $PROFILE add \"$name@$tag\")"
      fi
      continue
    fi
    echo "$name: ${inst:-new install} -> $reg"
    dsh_plugin_add "$name@$tag"
  done < <(thirdparty_entries)
  echo ""
}

case "$MODE" in
  check)  thirdparty_check ;;
  update) thirdparty_update ;;
  install)
    if [[ "$PROFILE" == "$FALLBACK_PROFILE" ]]; then
      die "$FALLBACK_PROFILE is the pristine fallback profile - do not install plugins into it"
    fi
    own_install
    thirdparty_ensure
    ensure_fallback_profile
    thirdparty_check
    ;;
  *) die "internal: unknown mode $MODE" ;;
esac

echo "== done =="
if [[ "$MODE" != check ]]; then
  echo "Restart your dsh server for changes to take effect:"
  echo "  dsh --profile $PROFILE"
  echo "If $PROFILE ever fails to boot after a plugin change, start the pristine fallback:"
  echo "  dsh --profile $FALLBACK_PROFILE"
fi
if [[ $DRY_RUN -eq 1 ]]; then echo "(--dry-run: nothing was modified)"; fi
```

---

## install.ps1(保存为 `scripts\install.ps1`)

> ⚠️ **ps1 落后于 sh 模板**:仅覆盖自有插件的「junction + patch 行」最小流程,
> 未实现 `--only` / `--check` / `--update` / 第三方纳管 / `[]` 修复。
> 以 sh 为准;需要 Windows 增强版时按上文行为自行同步,并保持纯 ASCII。

```powershell
# install.ps1 - Install/update all dsh web plugins from this repo.
#
# Note: keep this file pure ASCII. Windows PowerShell 5.x reads BOM-less
# UTF-8 as ANSI, so non-ASCII comments can swallow the following line.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1            # install into the web profile
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Profile headless
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -DryRun    # show what would happen
#
# For every directory under plugins\ that has a package.json:
#   1. Create a junction at $DshHome\profiles\node_modules\<name> pointing at
#      the plugin directory (the shared module fallback farm; each profile
#      reaches it through Node's parent-directory walk).
#   2. Inject a loader row into $DshHome\profiles\<Profile>\cordis.patch.yml
#      (skipped when the id is already present; idempotent).
#   3. Restart the dsh server afterwards (web profile HMR is disabled by default).

param(
  [string]$Profile = "web",
  [string]$DshHome = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if ($DshHome -eq "") { $DshHome = Join-Path $HOME ".dsh" }
$repoRoot = Split-Path -Parent $PSScriptRoot
$pluginsDir = Join-Path $repoRoot "plugins"
$profileDir = Join-Path $DshHome "profiles\$Profile"
$farmDir = Join-Path (Join-Path $DshHome "profiles") "node_modules"
$patchFile = Join-Path $profileDir "cordis.patch.yml"

Write-Host "== dsh plugin installer =="
Write-Host "repo:    $repoRoot"
Write-Host "profile: $Profile ($profileDir)"
Write-Host ""

if (-not (Test-Path $pluginsDir)) { throw "plugins directory not found: $pluginsDir" }
if (-not (Test-Path $profileDir)) { throw "profile not found: $profileDir (start 'dsh --profile $Profile' once first)" }

function Get-PackageName([string]$dir) {
  $pkgJson = Join-Path $dir "package.json"
  if (-not (Test-Path $pkgJson)) { return $null }
  $pkg = Get-Content $pkgJson -Raw | ConvertFrom-Json
  if (-not $pkg.name) { return $null }
  return [string]$pkg.name
}

function Ensure-Junction([string]$link, [string]$target) {
  if (Test-Path $link) {
    $item = Get-Item $link -Force
    if ($item.LinkType -ne "Junction") { throw "exists but is not a junction - handle it manually: $link" }
    cmd /c "rmdir `"$link`"" | Out-Null
  }
  cmd /c "mklink /J `"$link`" `"$target`" 2>&1" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "failed to create junction $link -> $target" }
  return "junction ready"
}

function Ensure-PatchRow([string]$id) {
  $content = ""
  if (Test-Path $patchFile) { $content = Get-Content $patchFile -Raw -Encoding UTF8 }
  $pattern = "(?m)^\s*- id:\s*" + [regex]::Escape($id) + "\s*$"
  if ($content -match $pattern) { return "ok (row already present)" }
  $row = @"

# Managed by $repoRoot\scripts\install.ps1
- insert:
    - id: $id
      name: $id
"@
  $content = $content.TrimEnd() + $row + "`n"
  if (-not $DryRun) { Set-Content -Path $patchFile -Value $content -Encoding UTF8 -NoNewline }
  return "row inserted"
}

$found = $false
if (-not (Test-Path $farmDir)) { New-Item -ItemType Directory -Path $farmDir -Force | Out-Null }
Get-ChildItem $pluginsDir -Directory | ForEach-Object {
  $pkgName = Get-PackageName $_.FullName
  if (-not $pkgName) { return }
  $found = $true
  Write-Host "plugin: $pkgName ($($_.FullName))"
  $realTarget = (Resolve-Path $_.FullName).Path
  $link = Join-Path $farmDir $pkgName
  if ($DryRun) {
    Write-Host "  link : dry-run"
    Write-Host "  patch: dry-run"
  } else {
    $j = Ensure-Junction $link $realTarget
    $p = Ensure-PatchRow $pkgName
    Write-Host "  link : $j"
    Write-Host "  patch: $p"
  }
  Write-Host ""
}

if (-not $found) { Write-Host "warning: no plugin directories with package.json under $pluginsDir" }

Write-Host "== done =="
Write-Host "Restart your dsh server for changes to take effect:"
Write-Host "  dsh --profile $Profile"
if ($DryRun) { Write-Host "(-DryRun: nothing was modified)" }
```

---

## 手动安装(没有脚本时的等价操作)

自有插件:

1. 建链接(junction / symlink):

   ```powershell
   # Windows
   mklink /J "$HOME\.dsh\profiles\node_modules\<包名>" "<本仓库>\plugins\<包名>"
   # Linux / macOS
   ln -s "<本仓库>/plugins/<包名>" "$HOME/.dsh/profiles/node_modules/<包名>"
   ```

2. 在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 追加(若文档是 `[]`,先把该行删除):

   ```yaml
   - insert:
       - id: <包名>
         name: <包名>
   ```

第三方插件:

   ```bash
   dsh plugin --profile <profile> add "<包名>@<tag>"     # 安装/升级,并自动调和 bundles
   dsh plugin --profile <profile> remove "<包名>"        # 卸载,自动离开 bundles
   npm view <包名> dist-tags.latest                       # 查最新版本
   ```

3. 重启 dsh server。