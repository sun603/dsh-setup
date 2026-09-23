// dsh-web-ui-addons host half (static web plugin).
// Registers the HTTP endpoint /api/dsh-web-ui-addons/open-in-vscode that
// launches a new VS Code window on the current session's project directory.
const name = "dsh-web-ui-addons";
const inject = ["webServer", "timer"];

function apply(ctx) {
  const subprocess = ctx.get("subprocess");
  const agents = ctx.get("agents");
  const sandboxPolicy = ctx.get("sandboxPolicy");
  if (subprocess === undefined || agents === undefined || sandboxPolicy === undefined) {
    console.log("dsh-web-ui-addons: required host services missing", {
      subprocess: !!subprocess,
      agents: !!agents,
      sandboxPolicy: !!sandboxPolicy,
    });
    return;
  }

  const readCwd = (agent) => {
    if (!agent || !agent.session || !agent.session.header) return undefined;
    const cwd = agent.session.header.cwd;
    return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined;
  };

  const envVal = (env, name) => {
    if (!env) return undefined;
    try {
      const entry = env.get(name);
      return entry && typeof entry.value === "string" && entry.value.length > 0 ? entry.value : undefined;
    } catch {
      return undefined;
    }
  };

  async function openVscode(sessionId) {
    let project = sessionId ? readCwd(agents.get(sessionId)) : undefined;
    if (!project) project = readCwd(agents.currentInitiator());
    if (!project && typeof sandboxPolicy.workspaceRoot === "string") project = sandboxPolicy.workspaceRoot;
    if (!project) return { ok: false, error: "无法确定当前项目路径" };

    const candidates = [];
    const pushCandidate = (p) => {
      if (typeof p === "string" && p.length > 0) candidates.push(p);
    };
    try {
      const resolved = await subprocess.resolveExecutable("code");
      if (typeof resolved === "string" && resolved.length > 0) {
        const sep = Math.max(resolved.lastIndexOf("\\"), resolved.lastIndexOf("/"));
        const base = sep >= 0 ? resolved.slice(sep + 1).toLowerCase() : resolved.toLowerCase();
        if (base === "code.exe") pushCandidate(resolved);
        else if (sep > 0) pushCandidate(resolved.slice(0, sep) + "\\..\\Code.exe");
      }
    } catch {}
    const env = ctx.get("launchEnvironment");
    const localAppData = envVal(env, "LOCALAPPDATA") || (envVal(env, "USERPROFILE") ? envVal(env, "USERPROFILE") + "\\AppData\\Local" : undefined);
    pushCandidate((localAppData || "") + "\\Programs\\Microsoft VS Code\\Code.exe");
    pushCandidate((envVal(env, "ProgramFiles") || "C:\\Program Files") + "\\Microsoft VS Code\\Code.exe");
    pushCandidate((envVal(env, "ProgramFiles(x86)") || "C:\\Program Files (x86)") + "\\Microsoft VS Code\\Code.exe");

    let codeExe;
    for (const candidate of candidates) {
      try {
        const verified = await subprocess.resolveExecutable(candidate);
        if (typeof verified === "string" && verified.length > 0) {
          codeExe = verified;
          break;
        }
      } catch {}
    }
    if (!codeExe) return { ok: false, error: "未找到 VS Code 可执行文件 (Code.exe)" };

    const handle = subprocess.spawn({
      argv: [codeExe, "--new-window", project],
      cwd: project,
      stdio: { stdin: "ignore", stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
      graceMs: 5000,
    });
    const outcome = await Promise.race([
      handle.done.then(() => "exited", () => "failed"),
      ctx.timeout(1200).then(() => "running"),
    ]);
    if (outcome !== "running") {
      return { ok: false, error: outcome === "failed" ? "启动 VS Code 失败" : "VS Code 启动后立即退出" };
    }
    return { ok: true, project, codeExe };
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: "/api/dsh-web-ui-addons/open-in-vscode",
        handler: async (req, res) => {
          try {
            if (req.method !== "GET" && req.method !== "POST") {
              res.writeHead(405);
              res.end();
              return;
            }
            const url = new URL(req.url ?? "/", "http://localhost");
            const sessionId = url.searchParams.get("sessionId") ?? undefined;
            const result = await openVscode(sessionId);
            res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(result));
          } catch (err) {
            res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
        },
      }),
    "dsh-web-ui-addons: open-in-vscode route",
  );
}

export { apply, inject, name };