# Deterministic Capture — P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make strata's deterministic capture inbox safe to ship default-on — wire the read-side promote-and-clear loop, fix the two reproduced cursor data-loss bugs, and stop the inbox from leaking secrets.

**Architecture:** The hook (`hooks/strata-capture-guard.mjs`) is refactored so its pure helpers are exported and unit-testable, then the cursor scan is made byte-exact and chunk-bounded (no skip-ahead, no UTF-8 drift), keyed per-transcript, with secret redaction at write. The read-side contract (promote → clear) is defined once in `skills/strata/SKILL.md` and referenced by the three commands; `/strata:init` scaffolds a git-ignored inbox.

**Tech Stack:** Pure Node ESM (`node:fs`, `node:path`, `node:crypto`, `node:url`), `node:test` for unit tests, bash for the lint/scaffold gates.

## Global Constraints

- Pure Node, no dependencies; runs identically on Windows/macOS/Linux (use `path.join`, byte-offset cursor, no shell assumptions). — verbatim from ADR-0011 / design §2
- The hook must NEVER throw past its guards, block, or stall the host: any error → `process.exit(0)` with no output; silent no-op outside a `.strata/` project; no stdout on a successful `PostToolUse`. — design §10
- New text files are LF (`.gitattributes` enforces `* text=auto eol=lf`).
- `tests/lint.sh` and `tests/scaffold-check.sh` must both end in `PASS` before any commit that touches their surface.
- `skills/strata/SKILL.md` must stay ≤350 lines (lint §3) and keep the canonical strings `bug | improvement | debt | task | feature | initiative`, `open | in-progress | parked | resolved | wont-fix`, `high | med | low`, `success | failure` intact (lint §4).
- The inbox is transient scratch: git-ignored by default, redacted at write, triaged at promote. Nothing raw reaches durable memory (reconciles SKILL §2 "Never store"). — design §5
- Stub schema is fixed and identical on both agents: `{ ts, event, tool, signal, command, snippet, h }`. — design §3

---

### Task 1: Make the hook testable (export pure helpers + guarded main)

Refactor only — no behavior change. Wrap the run loop in a `main()` called only when the script is the entry point, and `export` the pure helpers so tests can import them.

**Files:**
- Modify: `hooks/strata-capture-guard.mjs` (add `export` to helpers; add a `pathToFileURL` main-guard at the bottom)
- Create: `tests/capture-guard.test.mjs`
- Modify: `tests/lint.sh` (run the node tests in the §2c block)

**Interfaces:**
- Produces (named exports, used by Tasks 2–4): `failureSignal(text, isError) -> string|null`, `resultText(r) -> string`, `stubHash(stub) -> string`, `scanChunk(windowBuf, start) -> {text, newOffset}`, `redact(s) -> string`, `cursorPath(root, transcriptPath) -> string`.

- [ ] **Step 1: Write the failing test** — `tests/capture-guard.test.mjs`

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as guard from '../hooks/strata-capture-guard.mjs'

test('module exports the pure helpers and does not run main on import', () => {
  assert.equal(typeof guard.failureSignal, 'function')
  assert.equal(typeof guard.resultText, 'function')
  assert.equal(typeof guard.redact, 'function')
  assert.equal(guard.failureSignal('npm ERR! boom', false), 'npm ERR!')
  assert.equal(guard.failureSignal('all good', false), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/capture-guard.test.mjs`
Expected: FAIL — `failureSignal` is not exported (`undefined is not a function`), or the import hangs/exits because the IIFE runs on import.

- [ ] **Step 3: Make the change** — in `hooks/strata-capture-guard.mjs`:
  1. Add `export` to each pure helper declaration: `export function failureSignal(...)`, `export function resultText(...)`, `export function stubHash(...)`. (Leave `MAX_SNIPPET` etc. as module consts.)
  2. Add the import near the top: `import { pathToFileURL } from 'node:url'`.
  3. Rename the trailing `;(async () => { ... })()` IIFE into a named `async function main() { ... }` (same body).
  4. At the very bottom, gate it:

```js
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/capture-guard.test.mjs`
Expected: PASS (1 test). The process exits cleanly (no hang), proving `main()` did not run on import.

- [ ] **Step 5: Wire the node tests into the lint gate** — in `tests/lint.sh`, inside the §2c hook block (after the `Claude hooks.json wires the guard script` check, before §3), add:

```bash
if command -v node >/dev/null 2>&1 && [ -f tests/capture-guard.test.mjs ]; then
  if node --test tests/capture-guard.test.mjs >/dev/null 2>&1; then
    ok "capture-guard unit tests pass"
  else
    fail "capture-guard unit tests failed (run: node --test tests/capture-guard.test.mjs)"
  fi
fi
```

- [ ] **Step 6: Run the gate + commit**

Run: `node --check hooks/strata-capture-guard.mjs && bash tests/lint.sh | tail -3`
Expected: `node --check` silent (valid); lint ends `LINT PASS`.

```bash
git add hooks/strata-capture-guard.mjs tests/capture-guard.test.mjs tests/lint.sh
git commit -m "refactor(hook): export pure helpers + guard main for unit tests"
```

---

### Task 2: Fix the PreCompact cursor data-loss (byte-exact, chunk-bounded, per-transcript)

Replace the destructive skip-ahead and decoded-string offset math with a pure `scanChunk` that advances only over bytes it actually scanned, anchored on real newline boundaries; key the cursor per transcript and write it atomically; reset on in-place file replacement.

**Files:**
- Modify: `hooks/strata-capture-guard.mjs` (add `scanChunk`, `cursorPath`, `readHead`, `headHash`, `writeCursorAtomic`; rewrite `handlePreCompact`; remove the old single `.cursor.json` logic)
- Modify: `tests/capture-guard.test.mjs` (add cursor tests)

**Interfaces:**
- Consumes: `MAX_SCAN_BYTES` (existing const, keep at `512 * 1024`).
- Produces: `scanChunk(windowBuf: Buffer, start: number) -> {text: string, newOffset: number}`, `cursorPath(root, transcriptPath) -> string`.

- [ ] **Step 1: Write the failing tests** — append to `tests/capture-guard.test.mjs`:

```js
import { Buffer } from 'node:buffer'

test('scanChunk computes the next offset from raw bytes, not the decoded string', () => {
  // "xé\nabc\n" is 8 bytes (é = 2 bytes); the old code overshot to 10.
  const buf = Buffer.from('xé\nabc\n', 'utf8')
  const r = guard.scanChunk(buf, 0)
  assert.equal(r.text, 'xé\nabc\n')
  assert.equal(r.newOffset, 8)
})

test('scanChunk resumes from a mid-file line boundary', () => {
  const full = Buffer.from('xé\nabc\ndef\n', 'utf8') // 12 bytes
  const r = guard.scanChunk(full.subarray(8), 8)
  assert.equal(r.text, 'def\n')
  assert.equal(r.newOffset, 12)
})

test('scanChunk never emits U+FFFD when the window ends mid-multibyte-char', () => {
  // "ab\n" + first byte of "é": the partial trailing char is after the last \n
  const buf = Buffer.concat([Buffer.from('ab\n', 'utf8'), Buffer.from([0xc3])])
  const r = guard.scanChunk(buf, 0)
  assert.equal(r.text, 'ab\n')
  assert.equal(r.newOffset, 3)
  assert.ok(!r.text.includes('�'))
})

test('scanChunk holds the offset when there is no complete line yet', () => {
  const r = guard.scanChunk(Buffer.from('no newline', 'utf8'), 5)
  assert.equal(r.text, '')
  assert.equal(r.newOffset, 5) // no bytes consumed → nothing skipped
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/capture-guard.test.mjs`
Expected: FAIL — `guard.scanChunk is not a function`.

- [ ] **Step 3: Add the helpers** — in `hooks/strata-capture-guard.mjs`, after `resultText`:

```js
// Scan a raw byte window for whole lines. `start` is a byte offset that is
// always a line boundary (0, or a previous newOffset). Returns the decoded
// whole-line text and the next offset, computed from RAW BYTES so a window
// ending mid-multibyte-char never corrupts the offset or inserts U+FFFD.
export function scanChunk(windowBuf, start) {
  const lastNl = windowBuf.lastIndexOf(0x0a) // '\n'
  if (lastNl < 0) return { text: '', newOffset: start } // no complete line yet
  const consumed = lastNl + 1
  return { text: windowBuf.subarray(0, consumed).toString('utf8'), newOffset: start + consumed }
}

function readHead(tp, n) {
  try {
    const fd = fs.openSync(tp, 'r')
    try { const b = Buffer.alloc(n); const r = fs.readSync(fd, b, 0, n, 0); return b.subarray(0, r) }
    finally { fs.closeSync(fd) }
  } catch { return Buffer.alloc(0) }
}

function headHash(buf) {
  return crypto.createHash('sha1').update(buf.subarray(0, 512)).digest('hex').slice(0, 12)
}

export function cursorPath(root, transcriptPath) {
  const id = crypto.createHash('sha1').update(String(transcriptPath)).digest('hex').slice(0, 12)
  return path.join(root, '.strata', 'inbox', `.cursor.${id}.json`)
}

function writeCursorAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(obj))
  fs.renameSync(tmp, file)
}
```

- [ ] **Step 4: Rewrite `handlePreCompact`** — replace the whole existing function body with:

```js
function handlePreCompact(root, payload) {
  const tp = payload.transcript_path || payload.transcriptPath
  if (!tp || !fs.existsSync(tp)) return 0
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
        ts: o.timestamp || nowIso(), event: 'PreCompact', tool: 'tool_result', signal: sig,
        command: '', snippet: redact(String(t).slice(-MAX_SNIPPET)),
      })) logged++
    }
  }

  try { writeCursorAtomic(cursorFile, { transcriptPath: tp, offset: newOffset, headHash: curHead }) } catch { /* best effort */ }
  return logged
}
```

Note: `redact(...)` is added in Task 3; until then it is undefined. Implement Task 3 before running the hook end-to-end, or temporarily drop the `redact(` wrapper. (Subagent-driven execution does Task 3 next, so leave it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/capture-guard.test.mjs`
Expected: PASS (the 4 new scanChunk tests + Task 1's test). `node --check hooks/strata-capture-guard.mjs` silent.

- [ ] **Step 6: Commit**

```bash
git add hooks/strata-capture-guard.mjs tests/capture-guard.test.mjs
git commit -m "fix(hook): byte-exact, chunk-bounded, per-transcript PreCompact cursor"
```

---

### Task 3: Redact secrets at write

Mask common secret shapes in `command` and `snippet` before any stub is written, on both the PostToolUse and PreCompact paths.

**Files:**
- Modify: `hooks/strata-capture-guard.mjs` (add `redact`; apply it in `handlePostToolUse`; it is already referenced in `handlePreCompact` from Task 2)
- Modify: `tests/capture-guard.test.mjs` (add redaction tests)

**Interfaces:**
- Produces: `redact(s: string) -> string` (idempotent; returns non-strings unchanged).

- [ ] **Step 1: Write the failing tests** — append to `tests/capture-guard.test.mjs`:

```js
test('redact masks tokens, keys, and password assignments; leaves clean text alone', () => {
  // Assemble secret-shaped inputs from fragments so no literal credential is
  // committed — the repo's gitleaks pre-commit hook scans test files too.
  const ghToken = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2'
  const awsKey = 'AKIA' + 'I0SF0DNN7EXAMPLE'
  const secret = 'hunter2' + 'secretvalue'
  assert.match(guard.redact(`curl -H "Authorization: Bearer ${ghToken}" u`), /<redacted>/)
  assert.ok(!guard.redact(`export AWS=${awsKey}`).includes(awsKey))
  assert.ok(!guard.redact(`psql password=${secret} host`).includes(secret))
  assert.equal(guard.redact('error TS2304: cannot find name foo'), 'error TS2304: cannot find name foo')
  assert.equal(guard.redact(undefined), undefined)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/capture-guard.test.mjs`
Expected: FAIL — `guard.redact is not a function`.

- [ ] **Step 3: Add `redact`** — in `hooks/strata-capture-guard.mjs`, after `resultText`:

```js
// Best-effort masking of common secret shapes before a stub is written.
// Defense in depth on top of gitignoring the inbox; never blocks on a miss.
export function redact(s) {
  if (typeof s !== 'string' || !s) return s
  return s
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '$1<redacted>')                                  // AWS access key id
    .replace(/\bgh[posru]_[A-Za-z0-9]{20,}\b/g, 'gh<redacted>')                               // GitHub tokens
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '<redacted-jwt>') // JWT
    .replace(/((?:authorization|bearer|api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*)(\S{6,})/gi, '$1<redacted>')
    .replace(/(Bearer\s+)([A-Za-z0-9._-]{12,})/g, '$1<redacted>')
}
```

- [ ] **Step 4: Apply it on the PostToolUse path** — in `handlePostToolUse`, change the stub fields so command and snippet are redacted:

```js
const command = redact(String(input.command || '').replace(/\s+/g, ' ').slice(0, 300))
return appendStub(root, {
  ts: nowIso(), event: 'PostToolUse', tool: 'Bash', signal: sig,
  command, snippet: redact(text.slice(-MAX_SNIPPET)),
}) ? 1 : 0
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/capture-guard.test.mjs`
Expected: PASS (all tests). `node --check hooks/strata-capture-guard.mjs` silent.

- [ ] **Step 6: Black-box smoke test (real stdin → real inbox)**

Run:
```bash
T=$(mktemp -d); mkdir -p "$T/.strata"
TOK="gh""p_""A1b2C3d4E5f6G7h8I9j0K1l2"   # assembled so no literal token is committed
printf '{"hook_event_name":"PostToolUse","cwd":"%s","tool_name":"Bash","tool_input":{"command":"deploy --token=%s"},"tool_response":{"is_error":true,"stdout":"npm ERR! failed"}}' "$T" "$TOK" \
  | node hooks/strata-capture-guard.mjs >/dev/null
cat "$T/.strata/inbox/captures.jsonl"; rm -rf "$T"
```
Expected: one JSON line whose `command` shows `--token=<redacted>` (no `ghp_…`), `signal` is `npm ERR!`.

- [ ] **Step 7: Commit**

```bash
git add hooks/strata-capture-guard.mjs tests/capture-guard.test.mjs
git commit -m "feat(hook): redact secrets in command/snippet before writing stubs"
```

---

### Task 4: Fix the stubHash collision

Hash over the command plus the head AND tail of the snippet so two distinct failures that share a generic trailing 200 chars no longer collide (and the second is no longer silently dropped).

**Files:**
- Modify: `hooks/strata-capture-guard.mjs` (`stubHash`)
- Modify: `tests/capture-guard.test.mjs` (collision test)

- [ ] **Step 1: Write the failing test** — append to `tests/capture-guard.test.mjs`:

```js
test('stubHash distinguishes failures that share a trailing tail', () => {
  const tail = 'x'.repeat(300)
  const a = guard.stubHash({ signal: 'Exit code 1', command: 'a', snippet: 'rootCauseA' + tail })
  const b = guard.stubHash({ signal: 'Exit code 1', command: 'b', snippet: 'rootCauseB' + tail })
  assert.notEqual(a, b)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/capture-guard.test.mjs`
Expected: FAIL — the two hashes are equal (collision) under the old tail-only hash.

- [ ] **Step 3: Rewrite `stubHash`**

```js
export function stubHash(stub) {
  const snip = stub.snippet || ''
  const basis = [stub.signal || '', stub.command || '', snip.slice(0, 200), snip.slice(-200)].join('|')
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 12)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/capture-guard.test.mjs`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add hooks/strata-capture-guard.mjs tests/capture-guard.test.mjs
git commit -m "fix(hook): hash command + head/tail so distinct failures don't collide"
```

---

### Task 5: Scaffold a git-ignored inbox in `/strata:init`

Give `/strata:init` an inbox directory with a `.gitignore` that ignores its contents but keeps the directory, so the inbox is transient scratch by default.

**Files:**
- Create: `skills/strata/templates/inbox/.gitignore`
- Modify: `skills/strata/SKILL.md` (§8 init table — add the inbox row)
- Modify: `commands/init.md` (mention the inbox scaffold in its report, if it lists created paths)
- Modify: `skills/strata/templates/MANIFEST.md` (structural overview — add the inbox line)
- Modify: `tests/scaffold-check.sh` (copy + assert the inbox)

- [ ] **Step 1: Create the template** — `skills/strata/templates/inbox/.gitignore`:

```gitignore
# Deterministic capture inbox — transient raw-evidence scratch (strata).
# Auto-logged tool failures land here; /strata:capture and /strata:save
# promote the real ones to issues/learnings, then clear this dir.
# Ignored by default: raw stubs can contain stack traces or secrets.
*
!.gitignore
```

- [ ] **Step 2: Add the failing scaffold assertion** — in `tests/scaffold-check.sh`, add to the `expected=(...)` array a new entry:

```bash
  ".strata/inbox/.gitignore"
```

and add the copy step alongside the other `cp` lines (after the issues copy):

```bash
mkdir -p "$T/.strata/inbox"
cp "$TPL/inbox/.gitignore" "$T/.strata/inbox/.gitignore"
```

- [ ] **Step 3: Run scaffold-check to verify it fails first (assertion before the cp)**

If you add the `expected` entry before the `cp`, run: `bash tests/scaffold-check.sh | grep inbox`
Expected: `FAIL: missing from scaffold: .strata/inbox/.gitignore` — then add the `cp` from Step 2 and re-run.

- [ ] **Step 4: Wire init docs** — in `skills/strata/SKILL.md` §8 "Fresh files to write" table, add a row:

```markdown
| `templates/inbox/.gitignore` | `.strata/inbox/.gitignore` | always |
```

In `commands/init.md`, if it enumerates created paths in its report block, add `- .strata/inbox/ (git-ignored capture scratch)`.

In `skills/strata/templates/MANIFEST.md` structural overview (the code block around the `issues/` line), add:

```
    ├── inbox/                     transient capture scratch (git-ignored; promoted by capture/save)
```

- [ ] **Step 5: Run both gates**

Run: `bash tests/scaffold-check.sh | tail -2 && bash tests/lint.sh | tail -2`
Expected: `SCAFFOLD PASS` and `LINT PASS`.

- [ ] **Step 6: Commit**

```bash
git add skills/strata/templates/inbox/.gitignore skills/strata/SKILL.md commands/init.md skills/strata/templates/MANIFEST.md tests/scaffold-check.sh
git commit -m "feat(init): scaffold a git-ignored .strata/inbox/ for capture scratch"
```

---

### Task 6: Define the inbox read-side contract once in `SKILL.md`

Add the single source of truth for the inbox lifecycle (schema, promote, clear) and wire the three existing sections (§5 capture, §6 save, §7 load) to reference it. Keep SKILL.md ≤350 lines.

**Files:**
- Modify: `skills/strata/SKILL.md`

- [ ] **Step 1: Add the contract subsection** — after §5 "Immediate capture", insert a new subsection `### 5a. Inbox — deterministic capture backstop`:

```markdown
### 5a. Inbox — deterministic capture backstop

The capture-guard hook (ADR-0011) auto-logs failed tool results to
`.strata/inbox/captures.jsonl` the moment they happen, so evidence survives
compaction without the agent acting. Each line is one redacted raw stub
`{ts, event, tool, signal, command, snippet, h}` — **raw evidence, not finished
memory.** The inbox is git-ignored transient scratch.

**Promote-and-clear (the read side, deterministic — no extra agent turn):**
- `/strata:capture` and `/strata:save`: read `.strata/inbox/captures.jsonl`,
  fold each real failure into an issue/learning (dedup against the backlog,
  drop secrets/stack-traces per §2), then **truncate** `captures.jsonl` and
  delete `.strata/inbox/.cursor.*.json`.
- `/strata:load`: report the un-promoted count in the orientation.
- A typo or already-known failure is dropped, not promoted. Promotion is the
  authoritative dedup; the hook's append-time window is only a first pass.
```

- [ ] **Step 2: Reference it from §5, §6, §7** — make these edits in `SKILL.md`:
  - End of §5 "Immediate capture": add a sentence — `The hook may have pre-logged failures to the inbox; promote them per §5a.`
  - §6 "A — Scan", in the `issue events` bullet: append — `; promote un-promoted inbox stubs (§5a) and clear the inbox`.
  - §6 "D — Execute": add `clear inbox (truncate captures.jsonl + drop cursor files)` to the ordered list, before "regenerate all views".
  - §7 "Present ≤6 lines": change the list to include `· inbox count` (e.g. `…fired parked-triggers · inbox un-promoted count · drift`).

- [ ] **Step 3: Verify budgets + canonical strings hold**

Run: `wc -l skills/strata/SKILL.md && bash tests/lint.sh | tail -3`
Expected: line count ≤350; lint ends `LINT PASS` (canonical states/types still present, internal links OK).

- [ ] **Step 4: Verify the contract is actually present (closes the council's "unwired" gap)**

Run: `grep -c "inbox" skills/strata/SKILL.md`
Expected: ≥4 (was 0 — this is the read-side that both councils found missing).

- [ ] **Step 5: Commit**

```bash
git add skills/strata/SKILL.md
git commit -m "docs(skill): define the inbox promote-and-clear contract (§5a)"
```

---

### Task 7: Wire the commands to the contract + add a lint guard against re-opening the gap

The commands delegate rules to the skill, so they get thin pointers. Add a lint assertion so the read-side claim can never again be asserted by the hook/README without the commands backing it.

**Files:**
- Modify: `commands/load.md`, `commands/capture.md`, `commands/save.md`
- Modify: `tests/lint.sh` (new §2d guard)

- [ ] **Step 1: Edit the commands** (pointers only — rules stay in the skill):
  - `commands/load.md` §5 orientation block: add a line `**Inbox:** <n> un-promoted (auto-logged failures), or "none"`.
  - `commands/load.md` §2 "Load shallow → deep": add `5. \`.strata/inbox/captures.jsonl\` — count only (do not bulk-read); promote per the skill §5a.`
  - `commands/capture.md` §2 "Gather just enough context": add a bullet `- \`.strata/inbox/captures.jsonl\` — fold any matching auto-logged failure into this capture, then clear it (skill §5a)`.
  - `commands/save.md` §3 "Issue events" bullet: append `; promote un-promoted \`.strata/inbox/\` stubs and clear the inbox (skill §5a)`.
  - `commands/save.md` §4 preview block: add a group `PROMOTED (from inbox):` with an example line `- .strata/issues/<id>-<slug>.md  ← from inbox stub (failure: <signal>)`.

- [ ] **Step 2: Write the failing lint guard** — in `tests/lint.sh`, after the §2c hook block, add §2d:

```bash
# 2d. Read-side coherence: if the hook/README advertise the inbox promote-and-clear
# loop, the commands + skill that execute it must actually mention the inbox.
for f in "$SKILL_DIR/SKILL.md" commands/load.md commands/capture.md commands/save.md; do
  if grep -qiF "inbox" "$f"; then
    ok "$f references the capture inbox"
  else
    fail "$f does not wire the inbox read-side (hook/README claim it does)"
  fi
done
```

- [ ] **Step 3: Run the gate to verify it now passes**

Run: `bash tests/lint.sh | grep -i inbox`
Expected: four `ok:` lines (SKILL.md from Task 6, plus load/capture/save). No `FAIL`.

- [ ] **Step 4: Full gate**

Run: `bash tests/lint.sh | tail -3`
Expected: `LINT PASS`.

- [ ] **Step 5: Commit**

```bash
git add commands/load.md commands/capture.md commands/save.md tests/lint.sh
git commit -m "feat(commands): wire inbox promote-and-clear + lint guard for the read side"
```

---

### Task 8: Reconcile `hooks/README.md` with reality + full-suite green

Now that the read side is wired, the README may describe it honestly; soften the Codex claims that the council flagged as unverified (full Codex adapter is P3).

**Files:**
- Modify: `hooks/README.md`

- [ ] **Step 1: Edit `hooks/README.md`**
  - The "The inbox" section already states promote-and-clear; add `(wired in /strata:capture, /strata:save, /strata:load — see SKILL.md §5a)` so the claim points at the now-real contract.
  - Add one line under cross-platform notes: `The inbox is git-ignored by default and stubs are redacted at write; do not commit raw inbox files.`
  - In the Codex callout, change "deterministic capture is Claude-Code-only for now" to: `the PostToolUse auto-log ports to Codex (Claude-compatible hook schema); the PreCompact transcript scan needs a Codex rollout parser — tracked as P3 in docs/deterministic-capture-design.md.`
  - Soften the `commandWindows` claim: append `(verify the field name against current Codex docs before relying on it).`

- [ ] **Step 2: Run the full suite**

Run: `node --test tests/capture-guard.test.mjs && bash tests/lint.sh | tail -2 && bash tests/scaffold-check.sh | tail -2`
Expected: node tests PASS; `LINT PASS`; `SCAFFOLD PASS`.

- [ ] **Step 3: Manual end-to-end check of the whole loop**

Run:
```bash
T=$(mktemp -d); mkdir -p "$T/.strata"
# a failure is logged...
printf '{"hook_event_name":"PostToolUse","cwd":"%s","tool_name":"Bash","tool_input":{"command":"go test ./..."},"tool_response":{"is_error":false,"stdout":"ELIFECYCLE build failed"}}' "$T" \
  | node hooks/strata-capture-guard.mjs >/dev/null
echo "inbox after failure:"; cat "$T/.strata/inbox/captures.jsonl"
# ...a successful command logs nothing and prints nothing
OUT=$(printf '{"hook_event_name":"PostToolUse","cwd":"%s","tool_name":"Bash","tool_input":{"command":"echo ok"},"tool_response":{"is_error":false,"stdout":"all good"}}' "$T" | node hooks/strata-capture-guard.mjs)
echo "success output is empty: [$OUT]"
rm -rf "$T"
```
Expected: one stub line (signal `ELIFECYCLE`); the success call prints `[]` (empty) and adds no second line.

- [ ] **Step 4: Commit**

```bash
git add hooks/README.md
git commit -m "docs(hook): align README with the wired read-side + honest Codex scope"
```

---

## P1 done — definition of done

- `node --test tests/capture-guard.test.mjs` green: scanChunk byte-exactness (no overshoot, no skip, no U+FFFD), redaction, stubHash distinctness.
- `bash tests/lint.sh` and `bash tests/scaffold-check.sh` both PASS, including the new §2d read-side guard and the inbox scaffold assertion.
- A failed Bash command lands a **redacted** stub; a successful one stays silent; `.strata/inbox/` is git-ignored; the cursor is per-transcript and never advances over unscanned bytes.
- `/strata:{load,capture,save}` + `SKILL.md` §5a wire promote-and-clear; the hook/README no longer claim a contract no command implements.

**After P1:** flip ADR-0011 status `accepted → implemented`, update the index row, then proceed to P2 (SessionEnd scan once the event is verified, signature correlation + Windows signatures) and P3 (Codex PostToolUse adapter + verify-on-target).

## Self-review

- **Spec coverage:** design §12 P1 items → ① read-side loop = Tasks 6–7; ② secret boundary = Tasks 3 (redact) + 5 (gitignore scaffold); ③ cursor data-loss + concurrency = Task 2 (scanChunk + per-transcript cursor + atomic write + headHash reset). Plus the reproduced `stubHash` bug (design §6) = Task 4, and the testability prerequisite = Task 1, and doc reconciliation (design §12) = Task 8. No P1 item unmapped.
- **Placeholder scan:** every code step shows complete code; every test step shows the assertion and the exact run command + expected result. No "TBD"/"add error handling"/"similar to".
- **Type consistency:** `scanChunk(windowBuf, start) -> {text, newOffset}`, `redact(s) -> string`, `stubHash(stub) -> string`, `cursorPath(root, transcriptPath) -> string` are defined in Tasks 2/3/4 and used with those exact names in `handlePreCompact`/`handlePostToolUse`. The cursor file pattern `.cursor.*.json` is consistent across Task 2 (write), §5a (clear), and Task 7 (commands).
