// loop-output-guard — detect repetitive/looping assistant output in real time
// and abort the run. Host-only static web plugin (no client half).
import { randomUUID } from "node:crypto";
//
// Detection: fixed-size sliding window over streamed visible text
// (text-delta chunks only). Every ACTIVATE_CHARS of new output, hash the
// last WINDOW_CHARS and look for any MIN_REPEAT_LEN-char substring occurring
// more than (MIN_REPEAT_COUNT - 1) times. On hit: cancel the agent's current
// phase (stops the stream mid-flight) and append a visible note to the
// session so both the GUI and the next model turn see why it stopped.

// Hardcoded thresholds (tune here, then restart dsh server).
const WINDOW_CHARS = 1024; // fixed detection window size (chars)
const ACTIVATE_CHARS = 1024; // run detection once per this many new chars
const MIN_REPEAT_LEN = 16; // minimum repeated substring length (chars)
const MIN_REPEAT_COUNT = 6; // require count > 5 (i.e. at least 6 occurrences)
// A loop repeats a fragment densely and consecutively. Require the distance
// between neighboring occurrences to stay under this cap (chars); a term
// merely mentioned several times across a long turn has gaps far larger and
// must NOT count as looping.
const MAX_REPEAT_GAP = 64;
// A repetition must DOMINATE the window to count as a loop: the fragment(s)
// must occupy at least this fraction of the detection window. Structured or
// labelled content (a list of items that share a short prefix/suffix, e.g.
// "REC-2024-11-05-A" / "REC-2024-11-05-B") repeats a token densely but sparsely
// across varied lines; a real output loop spews near-identical text that fills
// the window. 7 x 18-char suffix in a 1024 window => ~12%, below this threshold.
const MIN_REPEAT_COVERAGE = 0.2;

// Rolling hash params. MOD is a prime below 2^24 so h * BASE stays well
// inside Number's safe integer range; collisions are verified exactly below,
// so this is only a candidate finder, not a decision basis.
const HASH_BASE = 257;
const HASH_MOD = 16777213;

const name = "loop-output-guard";

function apply(ctx) {
  // Count NON-OVERLAPPING occurrences of `fragment` inside `text`, returning
  // their start positions. Overlap counting is wrong here: a single long run
  // (e.g. 24 spaces) would otherwise be tallied as (24-16+1)=9 separate
  // occurrences of its 16-char substrings, which is not "repetition" but the
  // same text counted many times.
  function occurrences(text, fragment) {
    const positions = [];
    let idx = -1;
    while ((idx = text.indexOf(fragment, idx + fragment.length)) !== -1) positions.push(idx);
    return positions;
  }

  // Candidate-finder: hash every MIN_REPEAT_LEN-char substring of `window`
  // (overlapping). A substring is a loop only when it occurs at least
  // MIN_REPEAT_COUNT times (exact-text verified, killing hash collisions)
  // AND all neighboring occurrences are at most MAX_REPEAT_GAP chars apart —
  // i.e. the fragment repeats densely/consecutively, not just several times
  // spread across unrelated text. Returns { sample, count, span } or null.
  function detectLoop(window) {
    const len = window.length;
    if (len < MIN_REPEAT_LEN) return null;

    let hash = 0;
    let power = 1;
    for (let i = 0; i < MIN_REPEAT_LEN; i++) {
      hash = (hash * HASH_BASE + window.charCodeAt(i)) % HASH_MOD;
      power = (power * HASH_BASE) % HASH_MOD;
    }
    const counts = new Map(); // hash -> { count, sample }
    counts.set(hash, { count: 1, sample: window.slice(0, MIN_REPEAT_LEN) });

    for (let i = MIN_REPEAT_LEN; i < len; i++) {
      // slide one char: drop window[i-len], append window[i]
      hash = ((hash * HASH_BASE + window.charCodeAt(i)) % HASH_MOD
        - (window.charCodeAt(i - MIN_REPEAT_LEN) * power) % HASH_MOD
        + HASH_MOD) % HASH_MOD;
      const entry = counts.get(hash);
      if (entry) {
        entry.count++;
      } else {
        counts.set(hash, { count: 1, sample: window.slice(i - MIN_REPEAT_LEN + 1, i + 1) });
      }
    }

    for (const entry of counts.values()) {
      if (entry.count < MIN_REPEAT_COUNT) continue;
      // Ignore whitespace-only fragments (e.g. indentation runs): they are
      // layout/formatting, not a semantic loop.
      if (/^\s+$/.test(entry.sample)) continue;
      const positions = occurrences(window, entry.sample);
      if (positions.length < MIN_REPEAT_COUNT) continue;
      // Coverage gate: the repeated chars must make up >= MIN_REPEAT_COVERAGE of
      // the window (else it's a recurring token in varied content, not a loop).
      if ((positions.length * MIN_REPEAT_LEN) / window.length < MIN_REPEAT_COVERAGE) continue;
      // Dense/periodic repetition: gap between any two neighboring
      // occurrences must be small. A scattered term fails this check.
      let dense = true;
      for (let i = 1; i < positions.length; i++) {
        if (positions[i] - positions[i - 1] > MAX_REPEAT_GAP) {
          dense = false;
          break;
        }
      }
      if (!dense) continue;
      const span = positions[positions.length - 1] + MIN_REPEAT_LEN - positions[0];
      return { sample: entry.sample, count: positions.length, span };
    }
    return null;
  }

  ctx.on("agent/created", ({ agent }) => {
    if (!agent || !agent.ctx) return;
    let recent = ""; // last WINDOW_CHARS seen (sliding tail)
    let pending = ""; // chars since the last activation
    let dead = false; // this agent already tripped the guard

    agent.ctx.on("session/event", (subject, event) => {
      if (dead) return;
      if (!event || typeof event !== "object") return;

      // Reset the rolling window at turn boundaries: a fresh turn must not
      // inherit repetition evidence from the previous one.
      if (event.type === "turn/start" || event.type === "turn/end") {
        recent = "";
        pending = "";
        return;
      }
      if (event.type !== "assistant/chunk") return;

      const chunk = event.data && event.data.chunk;
      if (!chunk || chunk.type !== "text-delta") return;
      const text = chunk.text;
      if (typeof text !== "string" || text.length === 0) return;

      pending += text;
      // Bound memory: a single giant chunk must not grow the buffer without bound.
      if (pending.length > ACTIVATE_CHARS + WINDOW_CHARS) {
        pending = pending.slice(-(ACTIVATE_CHARS + WINDOW_CHARS));
      }
      if (pending.length < ACTIVATE_CHARS) return;

      const windowText = (recent + pending).slice(-WINDOW_CHARS);
      const hit = detectLoop(windowText);
      if (hit) {
        dead = true;
        // Use logger.error (level 0): warn (level 2) is filtered out by the
        // default exporter level 1, so warnings never reach the console.
        ctx.logger.error(
          `loop-output-guard: ${subject && subject.id} repeated ${JSON.stringify(hit.sample)} x${hit.count} in last ${WINDOW_CHARS} chars; cancelling`
        );
        // Visible note. It MUST be appended asynchronously: this listener runs
        // synchronously while the session is publishing the current chunk, and
        // dsh-session rejects a reentrant append ("session append cannot
        // reenter while another append is being published"). Deferring to a
        // later tick escapes that guard. The message also needs a non-empty id.
        setTimeout(() => {
          try {
            subject.append(
              "user/message",
              {
                id: randomUUID(),
                role: "user",
                content: [{ type: "text", text: `[loop-output-guard] 检测到循环输出(片段 "${hit.sample}" 重复 ${hit.count} 次),本次输出已被终止。请勿继续重复相同内容。` }],
                source: { kind: "plugin", plugin: "loop-output-guard" }
              },
              { surfaceOp: "append" }
            );
            ctx.logger.error(`loop-output-guard: note appended to ${subject && subject.id}`);
          } catch (error) {
            ctx.logger.error(`loop-output-guard: note append failed: ${error && error.stack || String(error)}`);
          }
        }, 0);
        try {
          agent.cancel({ kind: "loop-output-guard", message: `repeated output fragment x${hit.count}` });
        } catch (error) {
          ctx.logger.error(`loop-output-guard: cancel failed: ${error && error.stack || String(error)}`);
        }
        return;
      }

      recent = windowText;
      pending = "";
    });
  });
}

export { apply, name };