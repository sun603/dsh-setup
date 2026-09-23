# Bug: `dsh --profile web` crashes on boot with `ENOSPC: file watchers reached` (VS Code exhausted the inotify watch budget)

**Component:** dsh web profile startup (`@deepseek-ai/dsh-host-webserver` + plugins using chokidar, e.g. `@linxin666/dsh-web-all` skin-center)
**Version observed:** `@deepseek-ai/*` web profile, systemd user service `dsh-web.service` (`dsh --profile web`, GUI at http://127.0.0.1:3080), Ubuntu 24.04, Node v24.14.0
**Severity:** major — web profile cannot start at all; masked by a secondary `EADDRINUSE` symptom

## Symptom

After a reboot, `journalctl --user -u dsh-web` shows the service crash-looping. The process boots, prints the URL line, then dies:

```
dsh web: http://127.0.0.1:3080/?token=...
Error: ENOSPC: System limit for number of file watchers reached, watch '~/.dsh/skin-center-active.json'
    at ... node_modules/chokidar/esm/handler.js ...
  code: 'ENOSPC', errno: -28, syscall: 'watch'
```

Later attempts show a *different*, misleading error — `listen EADDRINUSE 127.0.0.1:3080`. That was because the operator had manually started `dsh --profile web-safe` on the same port as an escape hatch. **`EADDRINUSE` is a red herring here**: freeing the port alone does not help — web crashes again on the next `ENOSPC` the instant it needs a file watch. The `web-safe` profile survives precisely because it loads zero plugins, opens almost no watchers, and therefore is not subject to the exhausted budget.

## Root cause

Linux caps inotify watches **per real-UID** (`fs.inotify.max_user_watches`, here `65536`). Something under uid 1000 had already consumed essentially the entire budget, so when the web profile's skin-center plugin tried to add its first watch it got `ENOSPC` and the process aborted during boot.

A `/proc/*/fdinfo` attribution scan pinned the consumers (all uid 1000, none dsh):

| watches | process | what it is |
|---:|---|---|
| 39318 | `code` (VS Code extension-host node utility) | desktop VS Code, recursive workspace watch |
| 25652 | `vscode-server` (Remote-SSH server MainThread) | remote server, recursive watch of the remote workspace |
| ~64970 | **these two combined** | ≈ the full 65536 cap |

For reference, `dsh --profile web-safe` itself held only ~15. VS Code by default recursively watches every file under the opened folders; with `node_modules`, `~/.dsh/profiles/*/node_modules` (the shared module farm), `~/.nvm`, etc., two VS Code instances saturate `max_user_watches`. dsh is the victim, not the cause.

## How to tell `ENOSPC` is the real cause (not `EADDRINUSE`)

`inotify_add_watch` returning `ENOSPC` on the very *first* watch is the decisive signal — it means the per-user budget is already at the cap. The inotify quota is per real-UID, so a probe run from an agent session shares the exact budget the `web` process is fighting for:

```bash
python3 - <<'PY'
import ctypes, os, errno
libc = ctypes.CDLL("libc.so.6", use_errno=True)
fd = libc.inotify_init1(0)
os.makedirs("/tmp/inotify-probe", exist_ok=True)
r = libc.inotify_add_watch(fd, b"/tmp/inotify-probe", 0x100)  # IN_CREATE
print("OK — watch budget has headroom" if r >= 0
      else f"errno {ctypes.get_errno()} ({errno.errorcode[ctypes.get_errno()]}) — budget exhausted")
libc.close(fd); os.rmdir("/tmp/inotify-probe")
PY
```

`ENOSPC` here = `max_user_watches` exhausted (the boot-killing case). `EMFILE` from `inotify_init1` = `max_user_instances` exhausted (a different, secondary limit — not this incident's blocker).

## Fix

Two layers. **A is the immediate unblock; B is the durable anti-recurrence.** Both are needed — A alone leaves VS Code able to refill the budget again on the next session.

### A. Free the budget now

The 65k holders were leftover background VS Code processes (desktop not in use but still resident, plus a dead Remote-SSH server). Closing/reloading VS Code drops the count immediately (here 65364 → 260, after which `add_watch` succeeds and web can boot). To kill stray VS Code processes without touching dsh / the current session (note the `dsh` / `web-safe` / `dsh-setup` exclusion guard):

```bash
targets=()
for pid in $(ls /proc | grep -E '^[0-9]+$'); do
  cmd=$(tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null); exe=$(readlink /proc/$pid/exe 2>/dev/null)
  case "$cmd$exe" in *bin/dsh*|*"profile web-safe"*|*dsh-setup*|*start-dsh*) continue;; esac
  case "$exe" in *VSCode-linux-x64*) targets+=("$pid"); continue;; esac
  case "$cmd" in *".vscode-server"*) targets+=("$pid");; esac
done
printf '%s\n' "${targets[@]}" | sort -un | xargs -r kill -TERM
```

Attribution (who holds the watches) uses the same `/proc/*/fdinfo` scan:

```bash
for info in /proc/[0-9]*/fdinfo/*; do
  n=$(grep -c '^inotify' "$info" 2>/dev/null); [ "${n:-0}" -gt 0 ] || continue
  pid=${info#/proc/}; pid=${pid%%/*}; echo "$pid $n"
done | awk '{s[$1]+=$2} END{for(p in s) print s[p], p}' | sort -nr | head -20
```

### B. Stop VS Code refilling the budget (settings.json, `files.watcherExclude`)

Added to **both** the local and the remote-server settings (note: a user `files.watcherExclude` **overrides** the built-in default, so it must be a superset — the block below already includes the node_modules/.git defaults plus the dsh-relevant trees):

- `~/.config/Code/User/settings.json` (desktop VS Code)
- `~/.vscode-server/data/Machine/settings.json` (Remote-SSH server; machine settings scope — watcherExclude placed here is the one the server actually applies to the remote workspace)

```jsonc
"files.watcherExclude": {
    "**/node_modules/**": true,
    "**/.git/objects/**": true,
    "**/.dsh/**": true,
    "**/.nvm/**": true,
    "**/dist/**": true,
    "**/.vscode-server/**": true
}
```

Editing the files does **not** retroactively free watches held by already-running processes — VS Code must reload the window (or the server must restart) to re-initialize its watchers under the new excludes.

### C. (Optional) raise the cap for headroom

Not required after B, but reasonable on a dev box running VS Code + dsh + k3s + node watchers:

```bash
printf 'fs.inotify.max_user_watches=524288\nfs.inotify.max_user_instances=512\n' \
  | sudo tee /etc/sysctl.d/99-inotify.conf && sudo sysctl --system
```

## Recovery / cutover note

Because `web-safe` and `web` both target port **3080**, the escape-hatch instance blocks the real service from binding even after the watch fix. To validate without killing the working session, boot web on a spare port first:

```bash
HOME=/home/<user> dsh --profile web --port 3081 --no-open \
  --trusted-host <tailscale-ip> --patch /path/to/extra.patch.yml
```

If it stays up (no `ENOSPC`), the diagnosis holds; then stop `web-safe` and `systemctl --user restart dsh-web`. The unit is `Restart=always` / `RestartSec=5`, so once the port frees and the watch budget is healthy it self-heals on the next tick.

## Lessons

- When a plugin-boot crash is followed by `EADDRINUSE` on a later attempt, check the **first** failure — a rescue instance on the same port turns a real startup crash into a misleading port conflict.
- inotify budgets are per-UID and machine-global: a totally unrelated app (VS Code) can break dsh web. Profile crash logs are the right starting point; the actual culprit often lives in another process.
- A web-safe zero-plugin profile is an excellent inotify differential: it boots while the plugin profile crashes → the crash is in the plugins' watcher demand, not the core server.
