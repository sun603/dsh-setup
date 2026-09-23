window.__ModuleLoader__.load({
	id: "dsh-web-ui-addons",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		// ---------------------------------------------------------------------------
		// Shared styling for the session-header buttons and the collapse-all icon.
		// ---------------------------------------------------------------------------
		const tagId = "dsh-web-ui-addons/action.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-web-ui-addons";
			tag.dataset.pluginCss = tagId;
			tag.textContent = ".uwx{display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;cursor:pointer;white-space:nowrap;transition:background-color .15s ease,color .15s ease,border-color .15s ease}.uwx:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}.uwx:disabled{opacity:.6;cursor:default}.uwx-done{color:var(--dsw-alias-state-success-primary)}.uwx-error{color:var(--dsw-alias-state-error-primary)}.uwx-collapse{width:28px;height:28px;border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer;flex:none}.uwx-collapse:hover{background:var(--dsw-alias-interactive-bg-hover)}";
			document.head.appendChild(tag);
		}

		// Styles for the VS Code open-mode settings popover (separate tag so an
		// already-injected first tag never keeps the page on stale rules).
		const tagIdPop = "dsh-web-ui-addons/vscode-pop.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagIdPop) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-web-ui-addons";
			tag.dataset.pluginCss = tagIdPop;
			tag.textContent = ".uwx-wrap{position:relative;display:inline-flex;gap:4px;align-items:center}.uwx-caret{padding:0 6px}.uwx-dd{position:absolute;top:calc(100% + 6px);right:0;z-index:1000;display:flex;flex-direction:column;min-width:200px;padding:4px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.18);text-align:left;white-space:nowrap}.uwx-dd-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer}.uwx-dd-item:hover{background:var(--dsw-alias-bg-layer-2)}.uwx-dd-item[aria-checked=true]{color:var(--dsw-alias-state-success-primary)}.uwx-dd-sep{height:1px;margin:4px 0;background:var(--dsw-alias-border-l1)}.uwx-dd-foot{padding:4px 8px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4;white-space:normal}";
			document.head.appendChild(tag);
		}

		// Settings page styles. Kept minimal so it blends with the shipped settings
		// layout (headings, group cards, labelled inputs, hint text).
		const tagIdSet = "dsh-web-ui-addons/settings.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagIdSet) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-web-ui-addons";
			tag.dataset.pluginCss = tagIdSet;
			tag.textContent = ".uwx-set{padding:4px 2px 96px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:22px}.uwx-set-head{display:flex;flex-direction:column;gap:4px;padding-bottom:10px;border-bottom:1px solid var(--dsw-alias-border-l1)}.uwx-set-title{margin:0;font-size:17px;font-weight:600;line-height:1.4}.uwx-set-desc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:1.6}.uwx-set-group{display:flex;flex-direction:column;gap:0}.uwx-set-group h3{margin:0 0 10px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}.uwx-set-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.uwx-set-row:last-child{border-bottom:none}.uwx-set-label{flex:0 1 auto;min-width:0;max-width:45%}.uwx-set-label-main{font-size:13.5px;line-height:1.5;color:var(--dsw-alias-label-primary)}.uwx-set-label-sub{margin-top:3px;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.uwx-set-ctrl{flex:0 0 auto;min-width:0;display:flex;flex-direction:column;gap:6px;align-items:flex-end}.uwx-set-radios{display:flex;flex-direction:column;gap:6px;align-items:flex-end}.uwx-set-radio{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;line-height:1.5;padding:2px 0;color:var(--dsw-alias-label-primary);white-space:nowrap}.uwx-set-radio input{margin:0;accent-color:var(--dsw-alias-state-success-primary)}.uwx-set-input{min-width:220px;padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;font-family:var(--dsw-alias-font-mono,ui-monospace,monospace);outline:none;transition:border-color .15s ease}.uwx-set-input:focus{border-color:var(--dsw-alias-state-success-primary)}.uwx-set-hint{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.55;text-align:right}.uwx-set-hint code{font-size:11px;padding:1px 5px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);font-family:var(--dsw-alias-font-mono,ui-monospace,monospace)}";
			document.head.appendChild(tag);
		}

		// ---------------------------------------------------------------------------
		// Clipboard helper (shared by the copy buttons and the injected menu items).
		// ---------------------------------------------------------------------------
		function copyText(text) {
			if (navigator.clipboard && navigator.clipboard.writeText) {
				return navigator.clipboard.writeText(text).then(() => true, () => false);
			}
			try {
				const ta = document.createElement("textarea");
				ta.value = text;
				ta.style.position = "fixed";
				ta.style.opacity = "0";
				document.body.appendChild(ta);
				ta.select();
				const ok = document.execCommand("copy");
				document.body.removeChild(ta);
				return Promise.resolve(ok);
			} catch {
				return Promise.resolve(false);
			}
		}

		// ---------------------------------------------------------------------------
		// Session-header button: copy the current Session ID.
		// ---------------------------------------------------------------------------
		function CopySessionIdAction(props) {
			const sessionId = props.sessionId;
			const [state, setState] = react.useState("idle");

			react.useEffect(() => {
				if (state !== "done" && state !== "error") return;
				const timer = setTimeout(() => setState("idle"), 1800);
				return () => clearTimeout(timer);
			}, [state]);

			const onClick = () => {
				if (state === "pending" || !sessionId) return;
				setState("pending");
				copyText(String(sessionId)).then((ok) => setState(ok ? "done" : "error"));
			};

			const title = "复制 Session ID";
			const label = state === "pending" ? "复制中…" : state === "done" ? "已复制" : state === "error" ? "复制失败" : "复制 ID";
			const cls = "uwx" + (state === "done" ? " uwx-done" : "") + (state === "error" ? " uwx-error" : "");

			return react.createElement(
				"button",
				{
					type: "button",
					className: cls,
					onClick,
					title,
					"aria-label": title,
					disabled: state === "pending",
				},
				label,
			);
		}

		// ---------------------------------------------------------------------------
		// Session-header button: open the current project in VS Code.
		//
		// Trigger is browser-side via the vscode:// protocol handler, so the editor
		// that opens lives on whichever machine the *browser* runs on:
		//  - local:  vscode://file/<abs path>
		//  - remote: vscode://vscode-remote/ssh-remote+<alias><abs path>
		//    (local VS Code + Remote-SSH dials the dsh server itself, independent
		//     of any dsh port forwarding)
		// The browser cannot tell "direct localhost access" apart from an `ssh -L`
		// tunnel (both show a loopback hostname), so mode is a tri-state setting
		// (auto / local / remote) and tunnels need an explicit "remote" choice.
		// Mode + alias are per-browser settings in localStorage — where the browser
		// sits is not a property of the server, so they must not live server-side.
		// The host endpoint /api/dsh-web-ui-addons/open-in-vscode is kept as-is but
		// no longer called from here.
		// ---------------------------------------------------------------------------
		const VSCODE_CFG_KEY = "dsh-web-ui-addons.vscode.v1";

		function readVscodeConfig() {
			const cfg = { mode: "auto", alias: "" };
			let raw = null;
			try {
				raw = localStorage.getItem(VSCODE_CFG_KEY);
			} catch {}
			if (raw !== null) {
				try {
					const parsed = JSON.parse(raw);
					if (parsed && typeof parsed === "object") {
						if (parsed.mode === "local" || parsed.mode === "remote" || parsed.mode === "auto") cfg.mode = parsed.mode;
						if (typeof parsed.alias === "string") cfg.alias = parsed.alias.trim();
					}
				} catch {}
			}
			return cfg;
		}

		function writeVscodeConfig(cfg) {
			try {
				localStorage.setItem(VSCODE_CFG_KEY, JSON.stringify(cfg));
			} catch {}
		}

		// ---------------------------------------------------------------------------
		// Composer Enter/Ctrl+Enter preference.
		//
		// The shipped composer submits on plain Enter and breaks the line on
		// Shift+Enter; Ctrl/Cmd+Enter is the "accelerated" submit chord. When this
		// preference is enabled, plain Enter is retargeted to a line break and only
		// Ctrl/Cmd+Enter submits — useful when Enter-as-send keeps misfiring.
		// Stored per-browser in localStorage (like the VS Code mode): where the
		// browser sits is not a server property.
		// ---------------------------------------------------------------------------
		const ENTER_CFG_KEY = "dsh-web-ui-addons.enter.v1";

		function readEnterConfig() {
			const cfg = { ctrlEnterSend: false };
			let raw = null;
			try {
				raw = localStorage.getItem(ENTER_CFG_KEY);
			} catch {}
			if (raw !== null) {
				try {
					const parsed = JSON.parse(raw);
					if (parsed && typeof parsed === "object" && typeof parsed.ctrlEnterSend === "boolean") {
						cfg.ctrlEnterSend = parsed.ctrlEnterSend;
					}
				} catch {}
			}
			return cfg;
		}

		function writeEnterConfig(cfg) {
			try {
				localStorage.setItem(ENTER_CFG_KEY, JSON.stringify(cfg));
			} catch {}
		}

		// Live value consumed by the keydown interceptor and the settings page.
		let currentEnterConfig = readEnterConfig();

		function setEnterSendEnabled(enabled) {
			currentEnterConfig = { ctrlEnterSend: Boolean(enabled) };
			writeEnterConfig(currentEnterConfig);
		}

		const isLoopbackHost = (host) =>
			host === "localhost" || host === "::1" || host === "[::1]" || host.startsWith("127.");

		const browserHostname = () => String((globalThis.location && globalThis.location.hostname) || "").toLowerCase();

		// Guess the client (browser-side) OS family from navigator.platform / userAgent.
		// Returns "win" / "mac" / "linux" / "unknown".
		function detectClientOS() {
			const nav = globalThis.navigator;
			if (!nav) return "unknown";
			const p = (nav.platform || "").toLowerCase();
			const ua = (nav.userAgent || "").toLowerCase();
			if (p.includes("win") || ua.includes("windows")) return "win";
			if (p.includes("mac") || ua.includes("mac os")) return "mac";
			if (p.includes("linux") || ua.includes("linux") || p.includes("unix") || p.includes("bsd")) return "linux";
			return "unknown";
		}

		// Guess the server OS family from a filesystem path (cwd style).
		// Windows paths start with a drive letter (C:\ or C:/) or contain backslashes;
		// everything else is treated as unix (Linux / macOS / WSL posix path).
		function detectServerOSFromPath(path) {
			if (typeof path !== "string" || path.length === 0) return "unknown";
			if (/^[A-Za-z]:[\\/]/.test(path)) return "win";
			if (path.includes("\\") && !path.startsWith("/")) return "win";
			return "unix";
		}

		function normalizePathForUrl(p) {
			let s = String(p).replace(/\\/g, "/");
			if (/^[A-Za-z]:\//.test(s)) s = s.charAt(0).toLowerCase() + s.slice(1);
			while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
			if (!s.startsWith("/")) s = "/" + s;
			return s;
		}

		function vscodeWillGoRemote(cfg, cwd) {
			if (cfg.mode === "remote") return true;
			if (cfg.mode !== "auto") return false;
			const host = browserHostname();
			// Non-loopback address → definitely remote.
			if (!isLoopbackHost(host)) return true;
			// Loopback: could be direct local access or an ssh -L tunnel.
			// Heuristic: if the server OS (guessed from cwd path) differs from the
			// client OS, the page must be coming from a remote machine — the local
			// filesystem wouldn't have alien-style paths.
			const serverOS = detectServerOSFromPath(cwd);
			const clientOS = detectClientOS();
			if (serverOS !== "unknown" && clientOS !== "unknown") {
				const clientWin = clientOS === "win";
				const serverWin = serverOS === "win";
				if (clientWin !== serverWin) return true;
			}
			return false;
		}

		function buildVscodeUrl(cwd, cfg) {
			const alias = String(cfg.alias || "").trim();
			const remote = vscodeWillGoRemote(cfg, cwd);
			if (remote && alias === "") {
				return {
					error: cfg.mode === "auto"
						? "自动判定为远程访问,但尚未配置 SSH 别名(在下方设置中填写)"
						: "远程模式需要 SSH 别名,须与本机 ~/.ssh/config 的 Host 一致(在下方设置中填写)",
				};
			}
			const path = normalizePathForUrl(cwd);
			return { remote, url: remote ? "vscode://vscode-remote/ssh-remote+" + alias + path : "vscode://file" + path };
		}

		function OpenInVscodeAction(props) {
			const sessionId = props.sessionId;
			const getCwd = props.getCwd;
			const [state, setState] = react.useState("idle");
			const [message, setMessage] = react.useState("");
			const [cfg, setCfg] = react.useState(readVscodeConfig);
			const [open, setOpen] = react.useState(false);
			const wrapRef = react.useRef(null);

			react.useEffect(() => {
				if (state !== "done" && state !== "error") return;
				const timer = setTimeout(() => setState("idle"), state === "error" ? 3600 : 2200);
				return () => clearTimeout(timer);
			}, [state]);

			// Re-read config when the dropdown reopens — the settings page may
			// have changed alias/mode behind the button's back.
			react.useEffect(() => {
				if (open) setCfg(readVscodeConfig());
			}, [open]);

			react.useEffect(() => {
				if (!open) return;
				const onDown = (e) => {
					if (wrapRef.current !== null && !wrapRef.current.contains(e.target)) setOpen(false);
				};
				const onKey = (e) => {
					if (e.key === "Escape") setOpen(false);
				};
				document.addEventListener("mousedown", onDown, true);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("mousedown", onDown, true);
					document.removeEventListener("keydown", onKey);
				};
			}, [open]);

			const setMode = (mode) => {
				const next = Object.assign({}, cfg, { mode });
				setCfg(next);
				writeVscodeConfig(next);
				setOpen(false);
			};

			const onClick = () => {
				const cwd = getCwd ? getCwd(sessionId) : "";
				if (!cwd) {
					setMessage("无法获取当前会话的工作目录");
					setState("error");
					return;
				}
				const built = buildVscodeUrl(cwd, cfg);
				if (built.error) {
					setMessage(built.error);
					setState("error");
					return;
				}
				try {
					globalThis.location.href = built.url;
					setMessage(built.url);
					setState("done");
				} catch (err) {
					setMessage(String((err && err.message) || err));
					setState("error");
				}
			};

			const remote = vscodeWillGoRemote(cfg, getCwd ? getCwd(sessionId) : "");
			const modeText =
				cfg.mode === "auto" ? "自动" : remote ? "远程 SSH" : "本地";
			const title = state === "done"
				? "已交给本机 VS Code:" + message
				: state === "error"
					? "打开失败:" + message
					: "在 VS Code 中打开当前项目(" + modeText + ",▾ 切换模式;完整设置见左侧设置)";
			const label = state === "done" ? "已唤起" : state === "error" ? "失败" : "VS Code";
			const cls = "uwx" + (state === "done" ? " uwx-done" : "") + (state === "error" ? " uwx-error" : "");

			const modeItems = [
				{ key: "auto", label: "自动(本机访问=本地,其它=远程)" },
				{ key: "local", label: "本地 VS Code" },
				{ key: "remote", label: "远程 SSH(VS Code Remote-SSH)" },
			];

			return react.createElement(
				"span",
				{ className: "uwx-wrap", ref: wrapRef },
				react.createElement("button", { type: "button", className: cls, onClick, title, "aria-label": title }, label),
				react.createElement(
					"button",
					{
						type: "button",
						className: "uwx uwx-caret",
						onClick: () => setOpen((v) => !v),
						title: "切换 VS Code 打开模式(完整设置见左侧设置页)",
						"aria-label": "切换 VS Code 打开模式",
						"aria-haspopup": "menu",
						"aria-expanded": open,
					},
					"▾",
				),
				open
					? react.createElement(
							"span",
							{ className: "uwx-dd", role: "menu" },
							modeItems.map((item) =>
								react.createElement(
									"span",
									{
										key: item.key,
										className: "uwx-dd-item",
										role: "menuitemradio",
										"aria-checked": cfg.mode === item.key ? "true" : "false",
										onClick: () => setMode(item.key),
									},
									cfg.mode === item.key ? "●" : "○",
									item.label,
								),
							),
							react.createElement("span", { className: "uwx-dd-sep" }),
							react.createElement(
								"span",
								{ className: "uwx-dd-foot" },
								"SSH 别名等完整配置在左侧「设置 → UI 增强」中。",
							),
						)
					: null,
			);
		}

		// ---------------------------------------------------------------------------
		// Settings page (注册到左侧设置页的「UI 增强」section)。
		//
		// 客户端设置全部存 localStorage(按浏览器),因为「浏览器在哪台机器」决定
		// 了 VS Code 打开模式 / SSH 别名,和服务端无关。
		// ---------------------------------------------------------------------------
		function UiAddonsSettingsPage(props) {
			const [cfg, setCfg] = react.useState(readVscodeConfig);
			const [enterOn, setEnterOn] = react.useState(() => currentEnterConfig.ctrlEnterSend);
			const [saved, setSaved] = react.useState(false);
			const getCwd = props && props.getCwd;

			const update = (patch) => {
				const next = Object.assign({}, cfg, patch);
				setCfg(next);
				writeVscodeConfig(next);
				setSaved(true);
				clearTimeout(update._t);
				update._t = setTimeout(() => setSaved(false), 1400);
			};

			const cwd = getCwd ? getCwd() : "";
			const remote = vscodeWillGoRemote(cfg, cwd);

			return react.createElement(
				"div",
				{ className: "uwx-set" },
				react.createElement(
					"div",
					{ className: "uwx-set-head" },
					react.createElement("h2", { className: "uwx-set-title" }, "UI 增强"),
					react.createElement(
						"p",
						{ className: "uwx-set-desc" },
						"dsh-web-ui-addons 的客户端设置。所有设置仅保存在当前浏览器(localStorage),与服务端无关。",
					),
				),

				react.createElement(
					"div",
					{ className: "uwx-set-group" },
					react.createElement("h3", null, "输入发送方式"),
					react.createElement(
						"div",
						{ className: "uwx-set-row" },
						react.createElement(
							"div",
							{ className: "uwx-set-label" },
							react.createElement("div", { className: "uwx-set-label-main" }, "用 Ctrl+Enter 发送"),
							react.createElement(
								"div",
								{ className: "uwx-set-label-sub" },
								"开启后:Enter 仅换行,Ctrl+Enter(或 macOS ⌘+Enter)发送;关闭后恢复 Enter 直接发送(默认)。",
							),
						),
						react.createElement(
							"div",
							{ className: "uwx-set-ctrl" },
							react.createElement(
								"label",
								{ className: "uwx-set-radio" },
								react.createElement("input", {
									type: "checkbox",
									checked: enterOn,
									onChange: (e) => {
										const v = e.target.checked;
										setEnterOn(v);
										setEnterSendEnabled(v);
										setSaved(true);
										clearTimeout(update._t);
										update._t = setTimeout(() => setSaved(false), 1400);
									},
								}),
								enterOn ? "已开启(Ctrl+Enter 发送)" : "关闭(Enter 发送)",
							),
							react.createElement(
								"span",
								{ className: "uwx-set-hint" },
								saved ? "已保存" : "立即生效,无需重启",
							),
						),
					),
				),

				react.createElement(
					"div",
					{ className: "uwx-set-group" },
					react.createElement("h3", null, "VS Code 打开方式"),
					react.createElement(
						"div",
						{ className: "uwx-set-row" },
						react.createElement(
							"div",
							{ className: "uwx-set-label" },
							react.createElement("div", { className: "uwx-set-label-main" }, "打开模式"),
							react.createElement(
								"div",
								{ className: "uwx-set-label-sub" },
								"「自动」按浏览器地址判断;用 ssh -L 转发时地址看似本机,请手动选「远程 SSH」。",
							),
						),
						react.createElement(
							"div",
							{ className: "uwx-set-ctrl" },
							react.createElement(
								"div",
								{ className: "uwx-set-radios" },
								react.createElement(
									"label",
									{ className: "uwx-set-radio" },
									react.createElement("input", {
										type: "radio", name: "uwx-vscode-mode",
										checked: cfg.mode === "auto",
										onChange: () => update({ mode: "auto" }),
									}),
									"自动",
								),
								react.createElement(
									"label",
									{ className: "uwx-set-radio" },
									react.createElement("input", {
										type: "radio", name: "uwx-vscode-mode",
										checked: cfg.mode === "local",
										onChange: () => update({ mode: "local" }),
									}),
									"本地 VS Code",
								),
								react.createElement(
									"label",
									{ className: "uwx-set-radio" },
									react.createElement("input", {
										type: "radio", name: "uwx-vscode-mode",
										checked: cfg.mode === "remote",
										onChange: () => update({ mode: "remote" }),
									}),
									"远程 SSH (Remote-SSH)",
								),
							),
						),
					),
					react.createElement(
						"div",
						{ className: "uwx-set-row" },
						react.createElement(
							"div",
							{ className: "uwx-set-label" },
							react.createElement("div", { className: "uwx-set-label-main" }, "SSH 别名"),
							react.createElement(
								"div",
								{ className: "uwx-set-label-sub" },
								"与本机 ~/.ssh/config 的 Host 一致",
							),
						),
						react.createElement(
							"div",
							{ className: "uwx-set-ctrl" },
							react.createElement("input", {
								type: "text",
								className: "uwx-set-input",
								placeholder: "my-server",
								value: cfg.alias,
								autoComplete: "off",
								spellCheck: false,
								onChange: (e) => update({ alias: e.target.value }),
							}),
							react.createElement(
								"span",
								{ className: "uwx-set-hint" },
								"当前判定: ",
								react.createElement("code", null,
									remote ? "ssh-remote+" + (cfg.alias.trim() || "(缺别名)") : "本地",
								),
								saved ? " · 已保存" : "",
							),
						),
					),
				),
			);
		}

		// ---------------------------------------------------------------------------
		// Sidebar row-menu augmentation.
		//
		// The shipped workspace browser (dsh-client-ui-workspace) hardcodes its row
		// menus (workspace ellipsis = rename/delete; session ellipsis = rename/fork/
		// archive) with no extension slot, so we extend them at runtime:
		//  1. capture clicks on the row ellipsis buttons;
		//  2. read the owning row's React fiber props (group.cwd / node.id);
		//  3. when the portaled [role=menu] appears, clone the existing item chrome
		//     and append "复制工作区路径" / "复制 Session ID" as a real menuitem.
		// ---------------------------------------------------------------------------
		const INJECT_ATTR = "data-uwx-injected";
		let pendingMenu = null;

		function fiberFrom(el) {
			const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
			return key ? el[key] : null;
		}

		function readRowData(row) {
			let fiber = fiberFrom(row);
			let guard = 0;
			while (fiber && guard++ < 80) {
				const type = fiber.type;
				const props = fiber.memoizedProps;
				const name = typeof type === "function" ? type.name : "";
				if (props) {
					if (name === "ProjectRowItem" && props.group && typeof props.group.cwd === "string") {
						return { kind: "workspace", value: props.group.cwd };
					}
					if (name === "SessionNodeItem" && props.node && typeof props.node.id === "string") {
						return { kind: "session", value: props.node.id };
					}
					if (name === "" && props.node && typeof props.node.id === "string" && typeof props.node.title === "string") {
						return { kind: "session", value: props.node.id };
					}
				}
				fiber = fiber.return;
			}
			return null;
		}

		const COPY_GLYPH = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5.2" y="5.2" width="7.6" height="7.6" rx="1.6"></rect><path d="M10.8 5.2V4.4A1.6 1.6 0 0 0 9.2 2.8H4.4A1.6 1.6 0 0 0 2.8 4.4v4.8a1.6 1.6 0 0 0 1.6 1.6h.8"></path></svg>';

		function injectIntoMenu(menu, data) {
			const viewport = menu.querySelector('[role="presentation"]') || menu;
			if (viewport.querySelector("[" + INJECT_ATTR + '="1"]') !== null) return true;
			const items = Array.prototype.slice.call(viewport.querySelectorAll('[role="menuitem"]'));
			if (items.length === 0) return false;

			const template = items[0];
			const wrap = document.createElement("div");
			if (template.parentElement !== null) wrap.className = template.parentElement.className;
			wrap.setAttribute(INJECT_ATTR, "1");

			const btn = document.createElement("button");
			btn.type = "button";
			btn.setAttribute("role", "menuitem");
			btn.className = template.className;

			const iconSpan = document.createElement("span");
			const iconRef = template.firstElementChild;
			if (iconRef !== null) iconSpan.className = iconRef.className;
			iconSpan.innerHTML = COPY_GLYPH;

			const labelSpan = document.createElement("span");
			const spans = Array.prototype.slice.call(template.querySelectorAll("span"));
			const labelRef = spans.find((s) => s.textContent && s.textContent.trim() !== "" && !s.querySelector("svg")) || template.lastElementChild;
			if (labelRef !== null) labelSpan.className = labelRef.className;
			const labelText = data.kind === "workspace" ? "复制工作区路径" : "复制 Session ID";
			labelSpan.textContent = labelText;

			btn.appendChild(iconSpan);
			btn.appendChild(labelSpan);
			wrap.appendChild(btn);

			if (data.kind === "workspace" && items.length > 1) {
				viewport.insertBefore(wrap, items[items.length - 1].parentElement);
			} else {
				viewport.appendChild(wrap);
			}

			btn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				copyText(String(data.value)).then((ok) => {
					if (labelSpan.isConnected) labelSpan.textContent = ok ? "已复制" : "复制失败";
					setTimeout(() => {
						if (labelSpan.isConnected) labelSpan.textContent = labelText;
					}, 1000);
					setTimeout(() => {
						document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
					}, 0);
				});
			});
			return true;
		}

		function startMenuAugmentation() {
			if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => {};

			const onCaptureClick = (e) => {
				if (!(e.target instanceof Element)) return;
				const btn = e.target.closest("button[aria-label]");
				if (btn === null) return;
				const aria = btn.getAttribute("aria-label") || "";
				// zh: 工作区“x”的操作 / 会话“x”的操作; en: Workspace/Session actions for x
				if (!/的操作$/.test(aria) && !/actions for/.test(aria)) return;
				const row = btn.closest('[role="treeitem"]');
				if (row === null) return;
				const data = readRowData(row);
				if (data !== null && typeof data.value === "string" && data.value !== "") {
					pendingMenu = { data, at: Date.now() };
				}
			};
			document.addEventListener("click", onCaptureClick, true);

			const observer = new MutationObserver((records) => {
				if (pendingMenu === null || Date.now() - pendingMenu.at > 2000) {
					pendingMenu = null;
					return;
				}
				for (const record of records) {
					for (const node of record.addedNodes) {
						if (node.nodeType !== 1) continue;
						const menu = node.nodeType === 1 && node.matches && node.matches('[role="menu"]') ? node : (node.querySelector ? node.querySelector('[role="menu"]') : null);
						if (menu === null) continue;
						const data = pendingMenu === null ? null : pendingMenu.data;
						if (data === null) continue;
						const text = menu.textContent || "";
						if (data.kind === "workspace" && !/删除|Delete/.test(text)) continue;
						if (data.kind === "session" && !/分叉|Fork|归档|Archive/.test(text)) continue;
						if (injectIntoMenu(menu, data)) pendingMenu = null;
					}
				}
			});
			observer.observe(document.body, { childList: true, subtree: true });

			return () => {
				document.removeEventListener("click", onCaptureClick, true);
				observer.disconnect();
				pendingMenu = null;
			};
		}

		// ---------------------------------------------------------------------------
		// Workspace-browser header button: collapse every expanded workspace group.
		// The shipped header (search + view options) has no extension slot, so the
		// button is injected next to the header and follows its hidden state.
		// ---------------------------------------------------------------------------
		const COLLAPSE_DATA = "data-uwx-collapse-all";

		function collapseIconSvg() {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("width", "16");
			svg.setAttribute("height", "16");
			svg.setAttribute("viewBox", "0 0 16 16");
			svg.setAttribute("fill", "none");
			svg.setAttribute("stroke", "currentColor");
			svg.setAttribute("stroke-width", "1.5");
			svg.setAttribute("stroke-linecap", "round");
			svg.setAttribute("stroke-linejoin", "round");
			const p1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
			p1.setAttribute("d", "M4 3.5l4 4 4-4");
			const p2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
			p2.setAttribute("d", "M4 8.5l4 4 4-4");
			svg.append(p1, p2);
			return svg;
		}

		function collapseAllWorkspaces() {
			const area = document.querySelector('[class$="listArea"]') || document;
			const rows = area.querySelectorAll('[role="treeitem"][aria-expanded="true"]');
			if (rows.length === 0) {
				console.log("[dsh-web-ui-addons] no expanded workspace groups");
				return;
			}
			for (const row of rows) row.click();
			console.log("[dsh-web-ui-addons] collapsed " + rows.length + " workspace group(s)");
		}

		function startCollapseAllInjection() {
			if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => {};
			let header = null;
			let headerObserver = null;
			let warned = false;

			function makeButton() {
				const btn = document.createElement("button");
				btn.type = "button";
				btn.setAttribute(COLLAPSE_DATA, "1");
				btn.setAttribute("aria-label", "折叠所有工作区");
				btn.title = "折叠所有工作区";
				btn.style.flex = "none";
				const ref = document.querySelector('[class*="headerActions"] [class$="iconButton"], [class*="headerActions"] button');
				btn.className = ref ? ref.className : "uwx-collapse";
				btn.appendChild(collapseIconSvg());
				btn.addEventListener("click", collapseAllWorkspaces);
				return btn;
			}

			function syncHidden(btn, headerEl) {
				const hidden = Array.prototype.some.call(headerEl.classList, (c) => c.indexOf("headerActionsHidden") !== -1);
				btn.style.display = hidden ? "none" : "";
			}

			function ensure() {
				header = document.querySelector('[class*="headerActions"]');
				if (!header || !header.parentElement) {
					if (!warned) {
						console.warn("[dsh-web-ui-addons] workspace header container not found; collapse button not injected (product UI may have changed)");
						warned = true;
					}
					return;
				}
				warned = false;
				let btn = document.querySelector("[" + COLLAPSE_DATA + "]");
				if (!btn) btn = makeButton();
				if (btn.parentElement !== header.parentElement) {
					header.parentElement.insertBefore(btn, header.nextSibling);
				}
				syncHidden(btn, header);
				if (headerObserver === null) {
					headerObserver = new MutationObserver(() => {
						const b = document.querySelector("[" + COLLAPSE_DATA + "]");
						if (b) syncHidden(b, header);
					});
				}
				headerObserver.disconnect();
				headerObserver.observe(header, { attributes: true, attributeFilter: ["class"] });
			}

			const bootObserver = new MutationObserver(() => { ensure(); });
			bootObserver.observe(document.body, { childList: true, subtree: true });
			ensure();

			return () => {
				bootObserver.disconnect();
				if (headerObserver) headerObserver.disconnect();
				const b = document.querySelector("[" + COLLAPSE_DATA + "]");
				if (b) b.remove();
			};
		}

		// ---------------------------------------------------------------------------
		// Think-module double-click collapse.
		//
		// An expanded thinking ("思考") block renders a long body far below its
		// disclosure row, so collapsing it normally means scrolling back up to the
		// row to click it. Here, a double-click inside the expanded body collapses the
		// block instead of starting a text selection. The block is the shipped
		// ReasoningRow: root = [data-variant="think"] with a data-expanded attribute
		// only while open; its toggle is the [data-disclosure-row] (role="button").
		// ---------------------------------------------------------------------------
		function startThinkDoubleClickCollapse() {
			if (typeof document === "undefined") return () => {};

			const thinkRootFrom = (target) => {
				if (!(target instanceof Element)) return null;
				const root = target.closest('[data-variant="think"]');
				if (root === null || !root.hasAttribute("data-expanded")) return null;
				// Leave the disclosure row alone: its own single click already toggles.
				if (target.closest('[data-disclosure-row]') !== null) return null;
				return root;
			};

			const clearSelection = () => {
				const sel = window.getSelection ? window.getSelection() : null;
				if (sel !== null && !sel.isCollapsed) sel.removeAllRanges();
			};

			// Kill the browser's word-selection on the second press of a double
			// click inside an expanded think body (the selection would otherwise be
			// committed before the dblclick event fires).
			const onMouseDown = (e) => {
				if (e.detail !== 2) return;
				if (thinkRootFrom(e.target) !== null) e.preventDefault();
			};

			const onDoubleClick = (e) => {
				const root = thinkRootFrom(e.target);
				if (root === null) return;
				e.preventDefault();
				clearSelection();
				const toggle =
					root.querySelector('[data-disclosure-row][role="button"]') ||
					root.querySelector('[data-disclosure-row]') ||
					root.querySelector('button[aria-expanded]');
				if (toggle !== null) toggle.click();
			};

			document.addEventListener("mousedown", onMouseDown, true);
			document.addEventListener("dblclick", onDoubleClick, true);
			return () => {
				document.removeEventListener("mousedown", onMouseDown, true);
				document.removeEventListener("dblclick", onDoubleClick, true);
			};
		}

		// ---------------------------------------------------------------------------
		// Composer Enter→newline / Ctrl+Enter→send interception.
		//
		// When the "Ctrl+Enter 发送" preference is on, plain Enter must insert a
		// line break instead of submitting. The composer's own keymap already maps
		// Shift+Enter to a line break, so we consume the plain Enter on the way
		// down (document capture phase fires before React/Lexical) and re-deliver
		// it as a synthetic Shift+Enter. That keeps Lexical's editor state
		// consistent — no direct DOM mutation. Ctrl/Cmd+Enter is left untouched so
		// it keeps its shipped submit meaning.
		// ---------------------------------------------------------------------------
		function startEnterKeyInterceptor() {
			if (typeof document === "undefined") return () => {};

			const composerFrom = (target) => {
				if (!(target instanceof Element)) return null;
				const el = target.closest ? target.closest('[data-composer-input="true"]') : null;
				if (el === null) return null;
				return el.isContentEditable ? el : null;
			};

			const onKeyDown = (e) => {
				if (!currentEnterConfig.ctrlEnterSend) return;
				if (e.key !== "Enter") return;
				// Only the plain, unmodified Enter is retargeted to a line break.
				if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
				// IME composition: Enter confirms the composition; keep it.
				if (e.isComposing || e.keyCode === 229) return;
				const el = composerFrom(e.target);
				if (el === null) return;
				// When the "/" or "@" trigger menu is open, Enter must pick the
				// highlighted suggestion instead of inserting a line break.
				if (document.querySelector('[data-trigger-menu]') !== null) return;

				// Consume the real Enter before React/Lexical turn it into a submit.
				e.preventDefault();
				e.stopPropagation();

				// Re-deliver as Shift+Enter so the editor inserts a line break
				// through its own Lexical pipeline.
				const next = new KeyboardEvent("keydown", {
					key: "Enter",
					code: "Enter",
					shiftKey: true,
					bubbles: true,
					cancelable: true,
					composed: true,
				});
				el.dispatchEvent(next);
			};

			document.addEventListener("keydown", onKeyDown, true);
			return () => document.removeEventListener("keydown", onKeyDown, true);
		}

		// ---------------------------------------------------------------------------
		// Plugin registration.
		// ---------------------------------------------------------------------------
		const inject = ["slots", "sessions"];
		function apply(ctx) {
			// Session cwd reader for the browser-side vscode:// URL builder. The
			// path stays the *server-side* absolute path — that is exactly what
			// both vscode://file (same machine) and vscode-remote (Remote-SSH)
			// expect.
			const getCwd = (sessionId) => {
				try {
					const snapshot = ctx.sessions.list.getSnapshot();
					const own = sessionId !== undefined ? snapshot.byId[sessionId] : undefined;
					const current = snapshot.current !== undefined ? snapshot.byId[snapshot.current] : undefined;
					const cwd = (own && own.cwd) || (current && current.cwd) || "";
					return typeof cwd === "string" ? cwd : "";
				} catch {
					return "";
				}
			};
			const vscodeGroup = (props) => react.createElement(OpenInVscodeAction, Object.assign({}, props, { getCwd }));
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "dsh-web-ui-addons-vscode",
				order: 10
			}, vscodeGroup));
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "dsh-web-ui-addons-copy-id",
				order: 20
			}, CopySessionIdAction));
			const settingsPage = (props) => react.createElement(UiAddonsSettingsPage, Object.assign({}, props, {
				getCwd: () => {
					try {
						const snapshot = ctx.sessions.list.getSnapshot();
						const cur = snapshot.current !== undefined ? snapshot.byId[snapshot.current] : undefined;
						return (cur && cur.cwd) || "";
					} catch { return ""; }
				},
			}));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-web-ui-addons",
				order: 50,
				label: "UI 增强"
			}, settingsPage));
			ctx.effect(() => startMenuAugmentation());
			ctx.effect(() => startCollapseAllInjection());
			ctx.effect(() => startThinkDoubleClickCollapse());
			ctx.effect(() => startEnterKeyInterceptor());
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});