# Deterministic Capture — P2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close P2 of ADR-0011: add an unconditional non-blocking end-of-session evidence drain, make transcript-scan failure-detection precise (no false positives from successful non-Bash tools; catch Windows shell errors), and extend secret redaction to GitHub fine-grained PATs.

**Architecture:** Extract the cursor-based transcript scan in `handlePreCompact` into a shared `scanTranscript(root, tp, event)` reused by both `PreCompact` and a new `SessionEnd` handler (so a session that ends without compaction still drains, sharing the per-transcript cursor so nothing double-logs). Then make the scan correlate each `tool_result` back to its originating `tool_use` so a text signature is only trusted from Bash (or unknown) origins. Finally add two pattern lines (Windows not-recognized signatures; `github_pat_` redaction).

**Tech Stack:** Pure Node ESM (`node:fs/path/crypto/url`, `node:os` in tests), `node:test`, bash lint/scaffold gates.

## Global Constraints

- Pure Node, no dependencies, cross-platform (`path.join`, byte cursor, no shell assumptions). — ADR-0011 / design §2
- The hook must NEVER throw past its guards, block, or stall: any error → `process.exit(0)` with no output; silent no-op outside a `.strata/` project; no stdout on a successful `PostToolUse`.
- **`SessionEnd` is a SILENT evidence drain:** Claude's `SessionEnd` is fire-and-forget and does NOT support `hookSpecificOutput.additionalContext` (verified against code.claude.com/docs/en/hooks, 2026-06-20), so the `SessionEnd` path runs the scan and exits 0 with NO output (no nudge). It carries `transcript_path` + `cwd`; it is skipped only on a hard `kill -9`. — research finding
- `PreCompact` and `SessionEnd` MUST share the per-transcript cursor + dedupe so a session that both compacted and ended does not double-log.
- New text files are LF.
- `node --check hooks/strata-capture-guard.mjs` clean; `node --test tests/capture-guard.test.mjs` green; `bash tests/lint.sh` ends `LINT PASS`; `bash tests/scaffold-check.sh` ends `SCAFFOLD PASS`.
- This repo has a gitleaks pre-commit hook — assemble secret-shaped test fixtures from fragments (`'github'+'_pat_'+'A1b2…'`), never inline a literal token.
- Stub schema unchanged: `{ ts, event, tool, signal, command, snippet, h }`; `event` now also takes the value `SessionEnd`.

---

### Task 1: Extract `scanTranscript` and add the non-blocking `SessionEnd` drain

Refactor the scan core out of `handlePreCompact` into a shared `scanTranscript(root, tp, event)`, add a `SessionEnd` handler that reuses it, wire `SessionEnd` in `hooks.json` as a silent drain, and document it.

**Files:**
- Modify: `hooks/strata-capture-guard.mjs` (extract `scanTranscript`; thin `handlePreCompact`; add `handleSessionEnd`; `main()` dispatch + silent SessionEnd exit; header comment)
- Modify: `hooks/hooks.json` (add `SessionEnd` block)
- Modify: `hooks/README.md` (add SessionEnd to the events list)
- Modify: `tests/capture-guard.test.mjs` (integration tests with a temp transcript)

**Interfaces:**
- Produces: `scanTranscript(root, tp, event) -> number` (logged count; writes stubs + advances the per-transcript cursor). Consumed by `handlePreCompact`, `handleSessionEnd`, and Task 2.

- [ ] **Step 1: Write the failing tests** — append to `tests/capture-guard.test.mjs`:

```js
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-test-'))
  fs.mkdirSync(path.join(root, '.strata'), { recursive: true })
  return root
}
function writeTranscript(root, lines) {
  const tp = path.join(root, 'transcript.jsonl')
  fs.writeFileSync(tp, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return tp
}
function inboxLines(root) {
  try {
    return fs.readFileSync(path.join(root, '.strata', 'inbox', 'captures.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch { return [] }
}

test('scanTranscript (SessionEnd) logs a failed tool_result and stamps the event', () => {
  const root = tmpRoot()
  const tp = writeTranscript(root, [
    { message: { content: [{ type: 'tool_result', is_error: true, content: 'ELIFECYCLE build failed' }] } },
  ])
  const n = guard.scanTranscript(root, tp, 'SessionEnd')
  const got = inboxLines(root)
  assert.equal(n, 1)
  assert.equal(got.length, 1)
  assert.equal(got[0].event, 'SessionEnd')
  fs.rmSync(root, { recursive: true, force: true })
})

test('PreCompact then SessionEnd on the same transcript do not double-log (shared cursor)', () => {
  const root = tmpRoot()
  const tp = writeTranscript(root, [
    { message: { content: [{ type: 'tool_result', is_error: true, content: 'npm ERR! boom' }] } },
  ])
  const a = guard.scanTranscript(root, tp, 'PreCompact')
  const b = guard.scanTranscript(root, tp, 'SessionEnd')
  assert.equal(a, 1)
  assert.equal(b, 0)
  assert.equal(inboxLines(root).length, 1)
  fs.rmSync(root, { recursive: true, force: true })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/capture-guard.test.mjs`
Expected: FAIL — `guard.scanTranscript is not a function`.

- [ ] **Step 3: Extract `scanTranscript`** — in `hooks/strata-capture-guard.mjs`, replace the entire `handlePreCompact` function (currently the function from `function handlePreCompact(root, payload) {` through its closing `}`) with this extracted core + two thin wrappers:

```js
// Shared transcript-tail scan used by PreCompact and SessionEnd: cursor-based,
// chunk-bounded, per-transcript. Logs stubs for failed tool_results not yet
// captured; `event` is stamped on each stub. The shared per-transcript cursor
// means PreCompact + SessionEnd on one session never double-log.
export function scanTranscript(root, tp, event) {
  const cursorFile = cursorPath(root, tp)
  let size = 0
  try { size = fs.statSync(tp).size } catch { return 0 }

  let cur = { offset: 0, headHash: '' }
  try { cur = JSON.parse(fs.readFileSync(cursorFile, 'utf8')) } catch { /* fresh */ }
  const curHead = headHash(readHead(tp, 512))
  let start = typeof cur.offset === 'number' ? cur.offset : 0
  if (cur.headHash && cur.headHash !== curHead) start = 0 // file replaced in place
  if (start > size) start = 0                              // truncated/rotated

  const end = Math.min(size, start + MAX_SCAN_BYTES)        // bounded chunk, NO skip-ahead
  let windowBuf = Buffer.alloc(0)
  const len = Math.max(0, end - start)
  if (len > 0) {
    try {
      const fd = fs.openSync(tp, 'r')
      try { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, start); windowBuf = b }
      finally { fs.closeSync(fd) }
    } catch { return 0 }
  }

  const { text: scanned, newOffset } = scanChunk(windowBuf, start)

  let logged = 0
  for (const line of scanned.split('\n')) {
    if (!line.trim()) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    const blocks = Array.isArray(o.message?.content) ? o.message.content : []
    for (const blk of blocks) {
      if (blk?.type !== 'tool_result') continue
      const t = typeof blk.content === 'string' ? blk.content : resultText(blk.content) || resultText(o.toolUseResult)
      const sig = failureSignal(t, blk.is_error === true)
      if (!sig) continue
      if (appendStub(root, {
        ts: o.timestamp || nowIso(), event, tool: 'tool_result', signal: sig,
        command: '', snippet: redact(String(t).slice(-MAX_SNIPPET)),
      })) logged++
    }
  }

  try { writeCursorAtomic(cursorFile, { transcriptPath: tp, offset: newOffset, headHash: curHead }) } catch { /* best effort */ }
  return logged
}

// PreCompact: drain the transcript tail before compaction.
function handlePreCompact(root, payload) {
  const tp = payload.transcript_path || payload.transcriptPath
  if (!tp || !fs.existsSync(tp)) return 0
  return scanTranscript(root, tp, 'PreCompact')
}

// SessionEnd: the UNCONDITIONAL end-of-session drain — catches the "real work,
// no compaction, then quit" case PreCompact misses. Fire-and-forget (no nudge).
function handleSessionEnd(root, payload) {
  const tp = payload.transcript_path || payload.transcriptPath
  if (!tp || !fs.existsSync(tp)) return 0
  return scanTranscript(root, tp, 'SessionEnd')
}
```

- [ ] **Step 4: Wire `SessionEnd` into `main()`** — in `main()`, change the dispatch block and the early-exit block to:

```js
    let logged = 0
    if (event === 'PostToolUse') logged = handlePostToolUse(root, payload)
    else if (event === 'PreCompact') logged = handlePreCompact(root, payload)
    else if (event === 'SessionEnd') logged = handleSessionEnd(root, payload)

    // SessionEnd is a silent drain (Claude's SessionEnd does not support
    // additionalContext); PostToolUse speaks only when it logged a failure.
    if (event === 'SessionEnd') process.exit(0)
    if (event === 'PostToolUse' && logged === 0) process.exit(0)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/capture-guard.test.mjs`
Expected: PASS (the two new integration tests + all existing). `node --check hooks/strata-capture-guard.mjs` silent.

- [ ] **Step 6: Wire `hooks.json`** — add a `SessionEnd` entry (same shape as `PreCompact`, no matcher) inside the `"hooks"` object:

```json
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/strata-capture-guard.mjs\"",
            "timeout": 10
          }
        ]
      }
    ],
```

- [ ] **Step 7: Update docs** — in `hooks/README.md`, find the list of events the hook fires on (it lists `SessionStart`, `PostToolUse`, `PreCompact`) and add a `SessionEnd` bullet: a non-blocking, silent end-of-session drain that runs the same transcript scan so a session that ends without compaction still captures failures (no nudge — SessionEnd can't inject context; skipped only on a hard kill). In `hooks/strata-capture-guard.mjs`, update the top header comment that enumerates events to mention `SessionEnd`.

- [ ] **Step 8: Run the gates + commit**

Run: `node --test tests/capture-guard.test.mjs && bash tests/lint.sh | tail -1 && node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8'))" && echo "hooks.json valid"`
Expected: tests pass; `LINT PASS`; `hooks.json valid`.

```bash
git add hooks/strata-capture-guard.mjs hooks/hooks.json hooks/README.md tests/capture-guard.test.mjs
git commit -m "feat(hook): non-blocking SessionEnd drain via shared scanTranscript"
```

---

### Task 2: Correlate `tool_result` to its `tool_use` so signatures are Bash-scoped

Make `scanTranscript` track `tool_use` blocks by id and only trust a text signature when the originating tool is Bash (or unknown) — so a successful `Read`/`grep` whose output contains `Traceback`/`fatal:`/`panic:` is no longer logged as a failure. Explicit `is_error` still always counts.

**Files:**
- Modify: `hooks/strata-capture-guard.mjs` (`scanTranscript` line loop)
- Modify: `tests/capture-guard.test.mjs` (correlation tests)

**Interfaces:**
- Consumes: `scanTranscript` from Task 1, `failureSignal`, `resultText` (unchanged signatures).

- [ ] **Step 1: Write the failing tests** — append to `tests/capture-guard.test.mjs` (uses the `tmpRoot`/`writeTranscript`/`inboxLines` helpers from Task 1):

```js
test('scanTranscript ignores a text signature from a successful NON-Bash tool_result', () => {
  const root = tmpRoot()
  const tp = writeTranscript(root, [
    { message: { content: [{ type: 'tool_use', id: 'u1', name: 'Read' }] } },
    { message: { content: [{ type: 'tool_result', tool_use_id: 'u1', is_error: false, content: 'Traceback (most recent call last): printed by a file we read' }] } },
  ])
  assert.equal(guard.scanTranscript(root, tp, 'PreCompact'), 0)
  fs.rmSync(root, { recursive: true, force: true })
})

test('scanTranscript still logs a Bash failure detected only by signature (is_error false)', () => {
  const root = tmpRoot()
  const tp = writeTranscript(root, [
    { message: { content: [{ type: 'tool_use', id: 'u2', name: 'Bash' }] } },
    { message: { content: [{ type: 'tool_result', tool_use_id: 'u2', is_error: false, content: 'ELIFECYCLE could not complete' }] } },
  ])
  assert.equal(guard.scanTranscript(root, tp, 'PreCompact'), 1)
  fs.rmSync(root, { recursive: true, force: true })
})

test('scanTranscript logs an explicit is_error result regardless of tool', () => {
  const root = tmpRoot()
  const tp = writeTranscript(root, [
    { message: { content: [{ type: 'tool_use', id: 'u3', name: 'Read' }] } },
    { message: { content: [{ type: 'tool_result', tool_use_id: 'u3', is_error: true, content: 'nope' }] } },
  ])
  assert.equal(guard.scanTranscript(root, tp, 'PreCompact'), 1)
  fs.rmSync(root, { recursive: true, force: true })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/capture-guard.test.mjs`
Expected: the first test FAILS (returns 1, not 0 — the current code logs the non-Bash `Traceback`); the other two pass already.

- [ ] **Step 3: Add the correlation** — in `scanTranscript`, replace the per-line loop body (the `for (const line of scanned.split('\n'))` block) with:

```js
  const toolNameById = new Map()
  let logged = 0
  for (const line of scanned.split('\n')) {
    if (!line.trim()) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    const blocks = Array.isArray(o.message?.content) ? o.message.content : []
    for (const blk of blocks) {
      if (blk?.type === 'tool_use' && blk.id) toolNameById.set(blk.id, blk.name)
    }
    for (const blk of blocks) {
      if (blk?.type !== 'tool_result') continue
      const originTool = toolNameById.get(blk.tool_use_id)
      const t = typeof blk.content === 'string' ? blk.content : resultText(blk.content) || resultText(o.toolUseResult)
      // A text signature is only trusted from a Bash (or unknown-origin) result;
      // a known non-Bash tool that merely PRINTED a signature (e.g. a Read/grep
      // showing "Traceback") needs an explicit is_error to count.
      const allowText = originTool === undefined || originTool === 'Bash'
      const sig = allowText
        ? failureSignal(t, blk.is_error === true)
        : (blk.is_error === true ? 'is_error' : null)
      if (!sig) continue
      if (appendStub(root, {
        ts: o.timestamp || nowIso(), event, tool: 'tool_result', signal: sig,
        command: '', snippet: redact(String(t).slice(-MAX_SNIPPET)),
      })) logged++
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/capture-guard.test.mjs`
Expected: PASS (all, including the three new correlation tests). `node --check` silent.

- [ ] **Step 5: Commit**

```bash
git add hooks/strata-capture-guard.mjs tests/capture-guard.test.mjs
git commit -m "fix(hook): scope transcript text-signatures to Bash-origin tool_results"
```

---

### Task 3: Windows shell signatures + `github_pat_` redaction

Add the two Windows "not recognized" failure signatures (so a cmd/PowerShell missing-command failure is caught cross-platform) and extend `redact` to GitHub fine-grained PATs.

**Files:**
- Modify: `hooks/strata-capture-guard.mjs` (`FAIL_SIGNATURES`, `redact`)
- Modify: `tests/capture-guard.test.mjs` (signature + redaction tests)

- [ ] **Step 1: Write the failing tests** — append to `tests/capture-guard.test.mjs`:

```js
test('failureSignal catches Windows cmd/PowerShell not-recognized errors but not benign prose', () => {
  assert.ok(guard.failureSignal("'foo' is not recognized as an internal or external command", false))
  assert.ok(guard.failureSignal("The term 'foo' is not recognized as the name of a cmdlet", false))
  assert.equal(guard.failureSignal('the file format is not recognized here', false), null)
})

test('redact masks a GitHub fine-grained PAT (github_pat_)', () => {
  const pat = 'github' + '_pat_' + 'A1b2C3d4E5f6G7h8I9j0K1'
  assert.ok(!guard.redact('git clone https://' + pat + '@github.com/x').includes(pat))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/capture-guard.test.mjs`
Expected: FAIL — the Windows phrases return `null` (not in `FAIL_SIGNATURES` yet) and the `github_pat_` token is returned unmasked.

- [ ] **Step 3: Add the signatures** — in `hooks/strata-capture-guard.mjs`, add these two entries to the `FAIL_SIGNATURES` array (after the `panic:` line):

```js
  /\bis not recognized as (?:an internal or external command|the name of a cmdlet)/i,
  /\bThe term '[^']*' is not recognized\b/,
```

- [ ] **Step 4: Add the redaction** — in `redact`, add this replacement to the chain (after the `gh[posru]_` line):

```js
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, 'github_pat_<redacted>')
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/capture-guard.test.mjs`
Expected: PASS (all). `node --check` silent.

- [ ] **Step 6: Full suite + commit**

Run: `node --test tests/capture-guard.test.mjs && bash tests/lint.sh | tail -1 && bash tests/scaffold-check.sh | tail -1`
Expected: tests pass; `LINT PASS`; `SCAFFOLD PASS`.

```bash
git add hooks/strata-capture-guard.mjs tests/capture-guard.test.mjs
git commit -m "feat(hook): Windows not-recognized signatures + github_pat_ redaction"
```

---

## P2 done — definition of done

- `node --test tests/capture-guard.test.mjs` green incl. the new SessionEnd drain, shared-cursor no-double-log, Bash-scoped signature correlation (non-Bash false positive suppressed, Bash ELIFECYCLE still caught, explicit is_error always caught), Windows signatures, and `github_pat_` redaction.
- `hooks.json` fires `SessionEnd` and the script drains silently on it (no nudge, no stdout).
- `bash tests/lint.sh` LINT PASS and `bash tests/scaffold-check.sh` SCAFFOLD PASS.

**After P2:** the only remaining ADR-0011 scope is P3 (Codex `PostToolUse` adapter + verify-on-target on a live Codex build). Update ADR-0011's Consequences/status note to reflect P2 shipped.

## Self-review

- **Spec coverage:** design §12 P2 → SessionEnd scan = Task 1; signature correlation `tool_result`→Bash `tool_use` = Task 2; Windows signatures = Task 3; deferred Minor `github_pat_` = Task 3. (Cursor-file GC Minor stays deferred — §5a already deletes `.cursor.*.json` at promote; not re-addressed here, called out so it isn't silently dropped.) No P2 item unmapped.
- **Placeholder scan:** every code step shows the complete code; every test step shows the assertion + exact run command + expected result. No "TBD"/"handle edge cases"/"similar to".
- **Type consistency:** `scanTranscript(root, tp, event) -> number` is defined in Task 1 and consumed by `handlePreCompact`/`handleSessionEnd` (Task 1) and modified in place by Task 2; `failureSignal(text, isError)` and `redact(s)` keep their P1 signatures; the stub `event` field takes `PreCompact | SessionEnd | PostToolUse`. The `SessionEnd` silent-exit in `main()` is consistent with the "no stdout on a successful PostToolUse" pattern already there.
