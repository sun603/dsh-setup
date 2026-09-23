# Bug: opening a session with very long assistant messages freezes the browser tab

**Component:** dsh web UI (conversation view)
**Version observed:** `@deepseek-ai/*` 0.1.1-rc.2 (web profile, `dsh --profile web`, GUI at http://127.0.0.1:3080)
**Severity:** major — a completed session becomes effectively unopenable

## Symptom

Opening a specific completed session (id `session-aaee6b14-8729-4ca2-b13c-11db81b6d05c`, cwd `D:\code\dt-agent-workspace`) in the web UI makes the tab freeze for a long time ("一开就卡"). Smaller sessions open fine.

## What the session data looks like

Persisted JSONL log per session (`sessions/<project>/<session-id>/session.jsonl.zstd`, frame 0 = header line, following frames = event lines):

- Decompressed size: **8 208 287 bytes (~8.2 MB)**, **10 448 event records**.
- Two assistant replies dominate the log (~2.4 MB together, ~30 % of the whole log):

| event | seq | content | size |
|---|---|---|---|
| `assistant/chunk` | 151226 (turn 1 step 42) | `data.chunk.block.text` | 704 260 chars |
| `assistant/message` | 151227 (turn 1 step 42) | `data.message.content[0].text` | 713 029 chars (`usage.outputTokens` 131 085) |
| `assistant/chunk` | ~10293 (later turn) | `data.chunk.block.text` | 489 083 chars |
| `assistant/message` | ~10296 | `data.message.content[0].text` | 499 184 chars |

- The rest are normal-size events (tool calls/results, step/turn boundaries; largest tool result ~61 KB). No images in the log.

So the core problem data is: **single assistant text blocks of 0.5–0.7 MB (~90–130 K output tokens) stored and rendered verbatim.**

## Client-side observations (in `@deepseek-ai/dsh-client-ui-conversation` lib/client.js)

1. **Conversation rendering is fully eager and unvirtualized.** On open the whole event log is projected client-side into chat nodes (assistant/tool/step/turn definitions); no virtualizer/overscan anywhere in the client bundles or the web dist assets (`dsh-web-frontend/dist/assets/*`).
2. **Assistant text is unbounded.** `AssistantMarkdown` renders every `text` block via `MarkdownText` with `block.text` verbatim. The only length cap in the UI is `boundedText` / `MAX_CHARS = 2e4` and it is applied to structured JSON/source/context fields only — never to assistant markdown text.
3. **Code highlighting is synchronous on the main thread.** The web bundle includes shiki (`codeToHtml`/`codeToTokens`); a code block is full-tokenized before display is capped at 16 lines (`maxLines = 16`). A 0.7 MB markdown reply containing large code blocks therefore means markdown parse + full shiki tokenization + huge DOM construction in one synchronous main-thread shot.

Net effect: opening this session builds a very large DOM (hundreds of thousands of nodes incl. two 0.5–0.7 MB markdown renderings) synchronously → the tab freezes; on weaker machines it may stay frozen for tens of seconds or effectively forever.

## Suggested directions (for the maintainers)

- Cap/shorten very long assistant text blocks in the UI with a "show more" affordance, reusing the existing 20 K-char truncation pattern (`boundedText`/`json.truncated`).
- Add windowed rendering (virtualization) for long conversations — `@tanstack/virtual-core` is already in the dependency tree.
- Consider bounding synchronous shiki work (size-capped tokenization) for huge code blocks.

## Repro

1. `dsh --profile web`, open the session above in the GUI → tab freezes.
2. Minimal synthetic repro: create a session log whose single `assistant/message` event contains a text block of ~700 KB (e.g. a long code dump) in the same JSONL/zstd layout, then open it.

Environment: Windows 11, dsh server 0.1.1-rc.2, local GUI only (no proxy involved).