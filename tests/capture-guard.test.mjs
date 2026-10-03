import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as guard from '../hooks/strata-capture-guard.mjs'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const hookPath = fileURLToPath(new URL('../hooks/strata-capture-guard.mjs', import.meta.url))

test('module exports the pure helpers and does not run main on import', () => {
  assert.equal(typeof guard.failureSignal, 'function')
  assert.equal(typeof guard.resultText, 'function')
  assert.equal(typeof guard.redact, 'function')
  assert.equal(guard.failureSignal('npm ERR! boom', false), 'npm ERR!')
  assert.equal(guard.failureSignal('all good', false), null)
})

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

test('stubHash distinguishes failures that share a trailing tail', () => {
  const tail = 'x'.repeat(300)
  const a = guard.stubHash({ signal: 'Exit code 1', command: 'a', snippet: 'rootCauseA' + tail })
  const b = guard.stubHash({ signal: 'Exit code 1', command: 'b', snippet: 'rootCauseB' + tail })
  assert.notEqual(a, b)
})

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

function runHook(payload, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv }
  if (!('STRATA_FAILURE_NUDGE' in extraEnv)) delete env.STRATA_FAILURE_NUDGE
  // A nested Node process otherwise inherits the test runner's internal context
  // and reports through the parent instead of behaving like a CLI entry point.
  delete env.NODE_TEST_CONTEXT
  return spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env,
  })
}

test('PreCompact entry point drains failures without emitting an invalid response', () => {
  const root = tmpRoot()
  const tp = writeTranscript(root, [
    { message: { content: [{ type: 'tool_result', is_error: true, content: 'build did not complete' }] } },
  ])
  const got = runHook({
    session_id: 'precompact-test',
    transcript_path: tp,
    cwd: root,
    hook_event_name: 'PreCompact',
    trigger: 'manual',
    custom_instructions: '',
  })
  assert.ifError(got.error)
  assert.equal(got.status, 0)
  assert.equal(got.stdout, '')
  assert.equal(got.stderr, '')
  assert.equal(inboxLines(root).length, 1)
  fs.rmSync(root, { recursive: true, force: true })
})

test('SessionStart entry point still emits its supported context response', () => {
  const root = tmpRoot()
  const got = runHook({
    session_id: 'session-start-test',
    transcript_path: path.join(root, 'transcript.jsonl'),
    cwd: root,
    hook_event_name: 'SessionStart',
    source: 'startup',
  })
  assert.ifError(got.error)
  assert.equal(got.status, 0)
  assert.equal(got.stderr, '')
  const output = JSON.parse(got.stdout)
  assert.equal(output.continue, true)
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.match(output.hookSpecificOutput.additionalContext, /pending-capture journal/)
  fs.rmSync(root, { recursive: true, force: true })
})

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

test('scanTranscript ignores a text signature from a successful NON-Bash tool_result', () => {
  const root = tmpRoot()
  const tp = writeTranscript(root, [
    { message: { content: [{ type: 'tool_use', id: 'u1', name: 'Read' }] } },
    { message: { content: [{ type: 'tool_result', tool_use_id: 'u1', is_error: false, content: 'Traceback (most recent call last): printed by a file we read' }] } },
  ])
  assert.equal(guard.scanTranscript(root, tp, 'PreCompact'), 0)
  fs.rmSync(root, { recursive: true, force: true })
})

test('scanTranscript trusts is_error false over failure words in Bash output (ADR-0017)', () => {
  const root = tmpRoot()
  const tp = writeTranscript(root, [
    { message: { content: [{ type: 'tool_use', id: 'u2', name: 'Bash' }] } },
    { message: { content: [{ type: 'tool_result', tool_use_id: 'u2', is_error: false, content: 'ELIFECYCLE could not complete' }] } },
  ])
  assert.equal(guard.scanTranscript(root, tp, 'PreCompact'), 0)
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

test('failureSignal catches Windows cmd/PowerShell not-recognized errors but not benign prose', () => {
  assert.ok(guard.failureSignal("'foo' is not recognized as an internal or external command", false))
  assert.ok(guard.failureSignal("The term 'foo' is not recognized as the name of a cmdlet", false))
  assert.equal(guard.failureSignal('the file format is not recognized here', false), null)
  assert.ok(guard.failureSignal("The term 'foo' is not recognized", false)) // second regex only (no cmdlet suffix)
})

test('redact masks a GitHub fine-grained PAT (github_pat_)', () => {
  const pat = 'github' + '_pat_' + 'A1b2C3d4E5f6G7h8I9j0K1'
  assert.ok(!guard.redact('git clone https://' + pat + '@github.com/x').includes(pat))
})

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
  assert.equal(got[0].signal, 'exit code 2')
  assert.equal(got[0].category, 'failure')
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

// --- 0.1.0: status first, categories, quiet by default (ADR-0017) ------------

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

function counts(root) {
  return guard.summarizeStubs(inboxLines(root))
}

test('recorded Claude session: only real failures count as failures', () => {
  const root = tmpRoot()
  const tp = path.join(root, 'claude-session.jsonl')
  fs.copyFileSync(fixture('claude-session.jsonl'), tp)
  guard.scanTranscript(root, tp, 'PreCompact')
  const sum = counts(root)
  assert.deepEqual(sum.counts, { failure: 3, policy: 4, 'tool-error': 2, interrupted: 1 })
  assert.equal(sum.repeated.length, 1)
  assert.equal(sum.repeated[0].command, 'npm test')
  assert.equal(sum.repeated[0].count, 2)
  const cmds = inboxLines(root).map((x) => x.command)
  assert.ok(!cmds.some((c) => c.startsWith('grep -n')), 'a successful grep of the hook source is not a failure')
  assert.ok(!cmds.includes('cat logs/last-run.log'), 'a successful cat of a traceback is not a failure')
  assert.ok(!cmds.includes('grep -rn TODO src/'), 'grep with no matches is a success')
  fs.rmSync(root, { recursive: true, force: true })
})

test('recorded Codex rollout: exit codes decide, refusals are policy', () => {
  const root = tmpRoot()
  const tp = path.join(root, 'codex-rollout.jsonl')
  fs.copyFileSync(fixture('codex-rollout.jsonl'), tp)
  guard.scanTranscript(root, tp, 'Stop')
  const got = inboxLines(root)
  assert.deepEqual(got.map((x) => [x.command, x.category, x.signal]), [
    ['rg -n "Permission denied" src', 'failure', 'exit code 1'],
    ['ls /nope', 'failure', 'exit code 2'],
    ['rm -rf dist', 'policy', 'rejected by user'],
  ])
  fs.rmSync(root, { recursive: true, force: true })
})

test('Claude PostToolUse is a success even when stdout holds failure words', () => {
  const root = tmpRoot()
  const got = runHook({
    hook_event_name: 'PostToolUse', cwd: root, tool_name: 'Bash', tool_use_id: 'toolu_a',
    tool_input: { command: 'grep -n "Permission denied" hooks/strata-capture-guard.mjs' },
    tool_response: { stdout: 'Exit code 1\nbash: x: Permission denied\nnpm ERR! code 1\n', stderr: '', interrupted: false, isImage: false },
  })
  assert.equal(got.status, 0)
  assert.equal(got.stdout, '')
  assert.equal(inboxLines(root).length, 0)
  fs.rmSync(root, { recursive: true, force: true })
})

test('Codex PostToolUse (no status) uses the strict line-anchored fallback', () => {
  const root = tmpRoot()
  runHook({ hook_event_name: 'PostToolUse', cwd: root, tool_name: 'Bash', tool_input: { command: 'pyhton x.py' }, tool_response: 'bash: line 1: pyhton: command not found\n' })
  runHook({ hook_event_name: 'PostToolUse', cwd: root, tool_name: 'Bash', tool_input: { command: 'grep -n denied src/hook.mjs' }, tool_response: "src/hook.mjs:12:  /\\bPermission denied\\b/,\nsrc/hook.mjs:13:  /(^|\\n)fatal: /,\n" })
  const got = inboxLines(root)
  assert.equal(got.length, 1)
  assert.equal(got[0].category, 'failure')
  assert.match(got[0].signal, /command not found/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('PostToolUseFailure logs a failure quietly; the nudge is opt-in', () => {
  const root = tmpRoot()
  const payload = {
    hook_event_name: 'PostToolUseFailure', cwd: root, tool_name: 'Bash', tool_use_id: 'toolu_f1',
    tool_input: { command: 'npm test' }, error: "Exit code 1\nError: Cannot find module 'express'", is_interrupt: false,
  }
  const quiet = runHook(payload)
  assert.equal(quiet.status, 0)
  assert.equal(quiet.stdout, '')
  const got = inboxLines(root)
  assert.equal(got.length, 1)
  assert.deepEqual([got[0].category, got[0].signal, got[0].command, got[0].tuid], ['failure', 'Exit code 1', 'npm test', 'toolu_f1'])

  const loud = runHook({ ...payload, tool_use_id: 'toolu_f2' }, { STRATA_FAILURE_NUDGE: '1' })
  const o = JSON.parse(loud.stdout)
  assert.equal(o.hookSpecificOutput.hookEventName, 'PostToolUseFailure')
  assert.match(o.hookSpecificOutput.additionalContext, /strata:capture/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('an interrupted call is counted as interrupted and never nudges', () => {
  const root = tmpRoot()
  const r = runHook({ hook_event_name: 'PostToolUseFailure', cwd: root, tool_name: 'Bash', tool_use_id: 'toolu_i', tool_input: { command: 'sleep 100' }, error: 'aborted', is_interrupt: true }, { STRATA_FAILURE_NUDGE: '1' })
  assert.equal(r.stdout, '')
  assert.equal(inboxLines(root)[0].category, 'interrupted')
  fs.rmSync(root, { recursive: true, force: true })
})

test('the live event and the transcript scan agree on one stub per tool_use_id', () => {
  const root = tmpRoot()
  runHook({ hook_event_name: 'PostToolUseFailure', cwd: root, tool_name: 'Bash', tool_use_id: 'toolu_same', tool_input: { command: 'make' }, error: 'Exit code 2\nmake: *** [all] Error 1' })
  const tp = writeTranscript(root, [
    { message: { content: [{ type: 'tool_use', id: 'toolu_same', name: 'Bash', input: { command: 'make' } }] } },
    { message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_same', is_error: true, content: 'Exit code 2\nmake: *** [all] Error 1' }] } },
  ])
  assert.equal(guard.scanTranscript(root, tp, 'SessionEnd'), 0)
  assert.equal(inboxLines(root).length, 1)
  fs.rmSync(root, { recursive: true, force: true })
})

test('SessionStart reports pending captures and inbox counts', () => {
  const root = tmpRoot()
  fs.mkdirSync(path.join(root, '.strata', 'inbox'), { recursive: true })
  fs.writeFileSync(path.join(root, '.strata', 'inbox', 'journal.jsonl'), '{"id":"j1","kind":"decision","title":"x"}\n{"id":"j2","kind":"note","title":"y"}\n')
  runHook({ hook_event_name: 'PostToolUseFailure', cwd: root, tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'npm test' }, error: 'Exit code 1' })
  const o = JSON.parse(runHook({ hook_event_name: 'SessionStart', cwd: root, source: 'startup' }).stdout)
  assert.match(o.hookSpecificOutput.additionalContext, /2 pending captures in the journal; inbox: 1 capture: 1 failure\./)
  fs.rmSync(root, { recursive: true, force: true })
})

test('stubs written before 0.1.0 (no category) are read as failure or policy', () => {
  assert.equal(guard.stubCategory({ signal: 'Exit code 1', snippet: 'boom' }), 'failure')
  assert.equal(guard.stubCategory({ signal: 'is_error', snippet: 'Permission for this action was denied by the Claude Code auto mode classifier.' }), 'policy')
})

test('classify follows status before text', () => {
  assert.equal(guard.classify({ tool: 'Bash', text: 'Exit code 1', isError: false }), null)
  assert.equal(guard.classify({ tool: 'Bash', text: 'all fine', exitCode: 3 }).category, 'failure')
  assert.equal(guard.classify({ tool: 'Read', text: 'File does not exist.', isError: true }).category, 'tool-error')
  assert.equal(guard.classify({ tool: 'Bash', text: 'x', isError: true, interrupted: true }).category, 'interrupted')
  assert.equal(guard.classify({ tool: 'Bash', text: 'ok\n  fatal: indented, not a git error' }), null)
})

test('a result whose tool_use precedes the scan window is classified from its own shape', () => {
  const root = tmpRoot()
  const tp = writeTranscript(root, [
    // A Read result (no stdout) that prints a traceback, with no is_error: not a failure.
    { toolUseResult: { file: { filePath: '/work/app/log.txt' } }, message: { content: [{ type: 'tool_result', tool_use_id: 'gone1', content: 'Traceback (most recent call last):\n  File "x.py"' }] } },
    // A Bash failure whose tool_use is out of the window: still a failure.
    { toolUseResult: { stdout: '', stderr: 'boom', interrupted: false }, message: { content: [{ type: 'tool_result', tool_use_id: 'gone2', is_error: true, content: 'Exit code 2\nboom' }] } },
  ])
  assert.equal(guard.scanTranscript(root, tp, 'PreCompact'), 1)
  const got = inboxLines(root)
  assert.equal(got[0].category, 'failure')
  assert.equal(got[0].tool, 'Bash')
  fs.rmSync(root, { recursive: true, force: true })
})
