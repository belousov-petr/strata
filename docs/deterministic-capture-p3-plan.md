# Deterministic Capture — P3 Implementation Plan (Codex adapter)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close P3 of ADR-0011 — make deterministic capture work on **Codex**, not just Claude, using the live-verified Codex hook + rollout schema; and correct the honesty surface (Codex plugin-bundled hooks are removed; Codex now does deterministic capture).

**Architecture:** `scanTranscript` already drains a Claude transcript. Add a parallel branch that recognises **Codex rollout** lines (`{type:"response_item", payload:{type:"function_call"|"function_call_output"}}`) and detects a failed shell command via the deterministic `Process exited with code N` marker in `function_call_output.output`, correlating output→command by `call_id`. Add a silent `Stop` drain (Codex's per-turn analogue of Claude's `SessionEnd`). `handlePostToolUse` already works on Codex unchanged (Codex normalises `tool_name` to `"Bash"` and uses `tool_input.command`), so only defensive widening is needed. Finally reconcile the docs honestly.

**Tech Stack:** Pure Node ESM, `node:test` (+ `node:fs/os/path` in tests), bash lint/scaffold gates.

## Verified facts (live Codex build, gpt-5.5, 2026-06-20 — see memory `codex-hooks-verified`)

- Codex hooks: config-file only (`~/.codex/hooks.json` / `<repo>/.codex/hooks.json`); `hooks` feature stable+true, **`plugin_hooks` REMOVED** (plugins cannot ship hooks).
- Events: SessionStart, PreToolUse, PostToolUse, PreCompact, **Stop** (per-turn; carries `transcript_path` + `stop_hook_active`). **No SessionEnd.** `transcript_path` is non-null on every event and points at the rollout.
- PostToolUse(Bash): `tool_name:"Bash"`, `tool_input:{command}`, `tool_response`: plain STRING (raw output, **no exit code / no is_error**) → signature-only detection.
- Rollout (`~/.codex/sessions/**/rollout-*.jsonl`): line `{type, payload, timestamp}`; `function_call` `{name:"exec_command", arguments:JSON{cmd}, call_id}` + `function_call_output` `{call_id, output}`; output has `Process exited with code N` (verified failed=2, rg-no-match=1, success=0).

## Global Constraints

- Pure Node, no deps, cross-platform; the hook NEVER throws past its guards, blocks, or stalls; silent no-op outside `.strata/`; no stdout on a successful `PostToolUse`; **`SessionEnd` AND `Stop` are silent drains (no nudge, no stdout)**.
- `scanTranscript` must handle BOTH schemas (Claude `message.content[]` tool_result AND Codex rollout `response_item`/`function_call_output`) on the same per-transcript cursor, without false-detecting one as the other.
- Codex rollout detection is exit-code-deterministic (`Process exited with code [1-9]`), so it also captures BENIGN non-zero exits (grep/rg/test no-match). That is accepted raw-evidence noise — gitignored, deduped, triaged at promote — and must be DOCUMENTED honestly, not hidden.
- New text files LF. No secret-shaped literals (gitleaks) — assemble fixtures from fragments.
- `node --check` clean; `node --test tests/capture-guard.test.mjs` green; `bash tests/lint.sh` LINT PASS; `bash tests/scaffold-check.sh` SCAFFOLD PASS; `hooks/codex-hooks.sample.json` valid JSON.
- Stub schema unchanged `{ts,event,tool,signal,command,snippet,h}`; `tool` now also takes `exec_command`, `event` also takes `Stop`.

---

### Task 1: Parse Codex rollout lines + add the exit-code signature

Teach `scanTranscript` to detect failed Codex shell calls, and add the deterministic exit-code signature.

**Files:**
- Modify: `hooks/strata-capture-guard.mjs` (`FAIL_SIGNATURES`; `scanTranscript` line loop; `handlePostToolUse` guard)
- Modify: `tests/capture-guard.test.mjs` (Codex-rollout integration tests)

- [ ] **Step 1: Write the failing tests** — append to `tests/capture-guard.test.mjs` (reuses the `tmpRoot`/`writeTranscript`/`inboxLines` helpers):

```js
test('scanTranscript detects a failed Codex exec_command via the rollout exit-code marker', () => {
  const root = tmpRoot()
  const tp = writeTranscript(root, [
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: JSON.stringify({ cmd: 'ls /nope', workdir: '/x' }) } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: "ls: cannot access '/nope'\nProcess exited with code 2\n" } },
  ])
  const n = guard.scanTranscript(root, tp, 'PreCompact')
  const got = inboxLines(root)
  assert.equal(n, 1)
  assert.equal(got[0].tool, 'exec_command')
  assert.match(got[0].command, /ls \/nope/)        // correlated by call_id
  assert.match(got[0].signal, /Process exited with code 2/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('scanTranscript does not log a successful Codex exec_command (exit 0)', () => {
  const root = tmpRoot()
  const tp = writeTranscript(root, [
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'c2', arguments: JSON.stringify({ cmd: 'ls /tmp' }) } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c2', output: 'tmp listing…\nProcess exited with code 0\n' } },
  ])
  assert.equal(guard.scanTranscript(root, tp, 'PreCompact'), 0)
  fs.rmSync(root, { recursive: true, force: true })
})

test('failureSignal matches the Codex Process-exited marker for non-zero only', () => {
  assert.match(guard.failureSignal('blah\nProcess exited with code 1', false), /Process exited with code 1/)
  assert.equal(guard.failureSignal('ok\nProcess exited with code 0', false), null)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/capture-guard.test.mjs`
Expected: the Codex tests FAIL — the rollout lines are not recognised (0 logged) and the exit-code marker isn't a signature yet.

- [ ] **Step 3: Add the exit-code signature** — in `hooks/strata-capture-guard.mjs`, add to the `FAIL_SIGNATURES` array (after the Windows `The term` entry):

```js
  /Process exited with code [1-9]\d*/,
```

- [ ] **Step 4: Add the Codex rollout branch** — in `scanTranscript`, replace the `const toolNameById = new Map()` line with both maps, and add the Codex handling inside the per-line loop right after the existing Claude `tool_result` inner loop (still inside `for (const line ...)`):

```js
  const toolNameById = new Map()
  const callCmdById = new Map()
```

…and after the existing `for (const blk of blocks) { if (blk?.type !== 'tool_result') … }` loop body, still inside the line loop, add:

```js
    // Codex rollout line: {type:'response_item', payload:{type:'function_call'|'function_call_output', …}}
    const cp = o.type === 'response_item' && o.payload && typeof o.payload === 'object' ? o.payload : null
    if (cp && cp.type === 'function_call' && cp.call_id) {
      let cmd = ''
      try { cmd = JSON.parse(cp.arguments).cmd || '' } catch { cmd = '' }
      callCmdById.set(cp.call_id, cmd)
    } else if (cp && cp.type === 'function_call_output') {
      const t = typeof cp.output === 'string' ? cp.output : resultText(cp.output)
      const sig = failureSignal(t, false) // Codex rollout has no is_error; signatures incl. the exit-code marker
      if (sig && appendStub(root, {
        ts: o.timestamp || nowIso(), event, tool: 'exec_command', signal: sig,
        command: redact(String(callCmdById.get(cp.call_id) || '').replace(/\s+/g, ' ').slice(0, 300)),
        snippet: redact(String(t).slice(-MAX_SNIPPET)),
      })) logged++
    }
```

- [ ] **Step 5: Widen `handlePostToolUse` defensively** — change its tool guard so a Codex build that sends the raw tool name still works (verified Codex sends `"Bash"`, but be safe):

```js
  const tool = payload.tool_name || payload.toolName
  if (tool && tool !== 'Bash' && tool !== 'exec_command') return 0
```

and set the stub's `tool` field to the real tool: change `tool: 'Bash',` to `tool: tool || 'Bash',`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/capture-guard.test.mjs`
Expected: PASS (all). `node --check hooks/strata-capture-guard.mjs` silent.

- [ ] **Step 7: Commit**

```bash
git add hooks/strata-capture-guard.mjs tests/capture-guard.test.mjs
git commit -m "feat(hook): parse Codex rollout function_call_output for deterministic capture"
```

---

### Task 2: Silent `Stop` drain + Codex sample config

Codex has no `SessionEnd`; its per-turn `Stop` (which carries `transcript_path`) is the drain. Add a silent `Stop` handler and wire the Codex sample to fire `PostToolUse` + `PreCompact` + `Stop`.

**Files:**
- Modify: `hooks/strata-capture-guard.mjs` (`handleStop`; `main()` dispatch + silent exit; header comment)
- Modify: `hooks/codex-hooks.sample.json` (add PostToolUse + Stop)
- Modify: `tests/capture-guard.test.mjs` (Stop event-stamp test)

- [ ] **Step 1: Write the failing test** — append to `tests/capture-guard.test.mjs`:

```js
test('scanTranscript stamps the Stop event (Codex per-turn drain)', () => {
  const root = tmpRoot()
  const tp = writeTranscript(root, [
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 's1', arguments: JSON.stringify({ cmd: 'false' }) } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 's1', output: 'Process exited with code 1\n' } },
  ])
  assert.equal(guard.scanTranscript(root, tp, 'Stop'), 1)
  assert.equal(inboxLines(root)[0].event, 'Stop')
  fs.rmSync(root, { recursive: true, force: true })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/capture-guard.test.mjs`
Expected: PASS already for the assertion that `scanTranscript(…, 'Stop')` returns 1 (scanTranscript is event-agnostic) — so this test GREEN-confirms the event param. If it is already green, proceed; the behavioral change is the `main()` dispatch (next steps), which the black-box smoke in Step 6 verifies.

- [ ] **Step 3: Add `handleStop`** — in `hooks/strata-capture-guard.mjs`, after `handleSessionEnd`:

```js
// Stop: Codex has no SessionEnd; its per-turn Stop is the drain (carries
// transcript_path). Silent, non-blocking — scans the rollout tail, never blocks.
function handleStop(root, payload) {
  const tp = payload.transcript_path || payload.transcriptPath
  if (!tp || !fs.existsSync(tp)) return 0
  return scanTranscript(root, tp, 'Stop')
}
```

- [ ] **Step 4: Wire `main()`** — change the dispatch + silent-exit blocks:

```js
    let logged = 0
    if (event === 'PostToolUse') logged = handlePostToolUse(root, payload)
    else if (event === 'PreCompact') logged = handlePreCompact(root, payload)
    else if (event === 'SessionEnd') logged = handleSessionEnd(root, payload)
    else if (event === 'Stop') logged = handleStop(root, payload)

    // SessionEnd and Stop are silent drains (no additionalContext path);
    // PostToolUse speaks only when it logged a failure.
    if (event === 'SessionEnd' || event === 'Stop') process.exit(0)
    if (event === 'PostToolUse' && logged === 0) process.exit(0)
```

- [ ] **Step 5: Update the Codex sample** — rewrite `hooks/codex-hooks.sample.json` so its `hooks` object wires `SessionStart`, `PostToolUse` (matcher `Bash`), `PreCompact`, and `Stop` (each running the script via `command` + `commandWindows`). Keep the existing `_comment` guidance and the absolute-path placeholder pattern; add `PostToolUse` (with `"matcher": "Bash"`) and `Stop` blocks mirroring the existing entries. Ensure it stays valid JSON.

- [ ] **Step 6: Header + black-box smoke + gates**

Update the `strata-capture-guard.mjs` top header comment: the deterministic capture now covers Codex too (PostToolUse signatures + a rollout parser for PreCompact/Stop), not "nudge-only".

Black-box smoke (Stop is silent, drains a Codex rollout):
```bash
T=$(mktemp -d); mkdir -p "$T/.strata"
printf '%s\n' '{"type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"k","arguments":"{\"cmd\":\"false\"}"}}' '{"type":"response_item","payload":{"type":"function_call_output","call_id":"k","output":"Process exited with code 1\n"}}' > "$T/rollout.jsonl"
OUT=$(printf '{"hook_event_name":"Stop","cwd":"%s","transcript_path":"%s"}' "$T" "$T/rollout.jsonl" | node hooks/strata-capture-guard.mjs)
echo "Stop stdout (must be empty): [$OUT]"
echo "inbox stub:"; cat "$T/.strata/inbox/captures.jsonl"; rm -rf "$T"
```
Expected: `[]` empty stdout; one stub (`tool:"exec_command"`, signal `Process exited with code 1`).

Run: `node --test tests/capture-guard.test.mjs && bash tests/lint.sh | tail -1 && node -e "JSON.parse(require('fs').readFileSync('hooks/codex-hooks.sample.json','utf8'))" && echo "codex sample valid"`
Expected: tests pass; `LINT PASS`; `codex sample valid`.

- [ ] **Step 7: Commit**

```bash
git add hooks/strata-capture-guard.mjs hooks/codex-hooks.sample.json tests/capture-guard.test.mjs
git commit -m "feat(hook): silent Codex Stop drain + sample wires PostToolUse/PreCompact/Stop"
```

---

### Task 3: Reconcile the honesty surface (Codex is deterministic now; plugin_hooks removed)

Correct the over/under-claims now that Codex deterministic capture is verified and shipped.

**Files:**
- Modify: `hooks/README.md`
- Modify: `docs/decisions/ADR-0011-deterministic-capture-inbox.md`

- [ ] **Step 1: Fix `hooks/README.md`**
  - The Codex callout currently says deterministic capture is Claude-only / honest-partial / "PostToolUse ports (P3)". Replace with the VERIFIED scope: Codex now does deterministic capture — `PostToolUse(Bash)` signature capture (no exit code in the payload, so signature-only) **plus** a rollout-format scan on `PreCompact`/`Stop` that detects failures deterministically by the `Process exited with code N` marker. State the two honest caveats: (a) Codex `PostToolUse` has no exit code, so a bare non-zero exit with terse output is caught only at the next rollout scan; (b) the rollout scan is exit-code-deterministic, so it also captures benign non-zero exits (grep/rg/test no-match) — low-value stubs that promotion drops.
  - In the enabling section: Codex hooks are **config-file only** (`~/.codex/hooks.json` or `<repo>/.codex/hooks.json`); update the wording that referenced plugin-bundled hooks — those are **removed** in current Codex (`codex features list` → `plugin_hooks: removed`). The sample now wires SessionStart + PostToolUse(Bash) + PreCompact + Stop.

- [ ] **Step 2: Fix `ADR-0011`**
  - Correct the line in the Decision that says "Codex now also documents plugin-bundled hooks (with trust review), which supersedes ADR-0010's constraint 2." Replace with: live verification (2026-06-20) shows `plugin_hooks` is **removed** in current Codex — so ADR-0010 constraint 2 STANDS (Codex hooks are config-file only); the manual `codex-hooks.sample.json` is the supported path.
  - Update the **Consequences P3 bullet** from future-tense to **shipped**: the Codex adapter (rollout `function_call_output` parser + `Process exited with code N` signature + silent `Stop` drain) and verify-on-target are done; `PostToolUse(Bash)` works unchanged (Codex normalises `tool_name`→`Bash`).
  - Update the **Status line**: P1+P2+P3 all shipped 2026-06-20 — ADR-0011 fully implemented.

- [ ] **Step 3: Full suite + commit**

Run: `node --test tests/capture-guard.test.mjs && bash tests/lint.sh | tail -1 && bash tests/scaffold-check.sh | tail -1`
Expected: tests pass; `LINT PASS`; `SCAFFOLD PASS`.

```bash
git add hooks/README.md docs/decisions/ADR-0011-deterministic-capture-inbox.md
git commit -m "docs: Codex deterministic capture verified+shipped; plugin_hooks removed; ADR-0011 P3 done"
```

---

## P3 done — definition of done

- `node --test` green incl. Codex rollout detection (failed exec_command → stub with correlated command + exit-code signal; success → none), the exit-code signature (non-zero only), and the Stop event-stamp.
- A `Stop` event drains a Codex rollout **silently** (no stdout); `codex-hooks.sample.json` wires PostToolUse(Bash) + PreCompact + Stop and is valid JSON.
- `hooks/README.md` + ADR-0011 describe Codex deterministic capture accurately (incl. the two caveats) and correct the plugin_hooks claim; ADR-0011 is fully implemented (P1+P2+P3).
- `bash tests/lint.sh` LINT PASS, `bash tests/scaffold-check.sh` SCAFFOLD PASS.

This completes ADR-0011 across Claude and Codex.

## Self-review

- **Spec coverage:** design §8 (Codex adapter) + §12 P3 → rollout `function_call_output` parser + exit-code signal = Task 1; Codex drain (Stop, since no SessionEnd) + sample config = Task 2; verify-on-target = DONE (live, memory `codex-hooks-verified`); honesty reconciliation (incl. plugin_hooks correction) = Task 3. The verify-on-target items from design §8 (tool_response carries failure output? transcript_path non-null at the drain? rollout line schema?) are all live-confirmed and recorded.
- **Placeholder scan:** every code step has complete code; tests show assertions + run command + expected result; no "TBD"/"handle edge cases".
- **Type consistency:** `scanTranscript(root, tp, event) -> number` (unchanged signature; gains a Codex branch + a `callCmdById` Map alongside `toolNameById`); `handleStop(root, payload) -> number` mirrors `handleSessionEnd`; the stub `tool` field takes `Bash | tool_result | exec_command`, `event` takes `PostToolUse | PreCompact | SessionEnd | Stop`. The `Process exited with code [1-9]` signature is consumed by both the Codex rollout branch and (harmlessly) the Claude path.
