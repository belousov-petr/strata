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
