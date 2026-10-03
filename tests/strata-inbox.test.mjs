import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitProject, run, runJson, rm } from './helpers.mjs'
import * as guard from '../hooks/strata-capture-guard.mjs'

const fixture = fileURLToPath(new URL('./fixtures/claude-session.jsonl', import.meta.url))

test('inbox summary counts by category and lists only repeated failures', () => {
  const dir = gitProject()
  const tp = path.join(dir, '..', path.basename(dir) + '-session.jsonl')
  fs.copyFileSync(fixture, tp)
  guard.scanTranscript(dir, tp, 'PreCompact')
  const r = runJson(['inbox', 'summary'], { cwd: dir }).json
  assert.deepEqual(r.counts, { failure: 3, policy: 4, 'tool-error': 2, interrupted: 1 })
  assert.equal(r.repeated.length, 1)
  const text = run(['inbox', 'summary'], { cwd: dir }).stdout
  assert.match(text, /Inbox: 10 captures: 3 failures \(1 repeated\), 4 policy refusals, 2 tool errors, 1 interrupted\./)
  assert.match(text, /2x {2}npm test {2}\[Exit code 1\]/)
  assert.ok(!/pyhton/.test(text), 'a one-off typo is counted, not listed')
  const status = run(['status'], { cwd: dir }).stdout
  assert.match(status, /Pending captures: none\.\nInbox: 10 captures/)
  fs.rmSync(tp, { force: true })
  rm(dir)
})

test('inbox clear keeps live cursors so cleared failures are not logged again', () => {
  const dir = gitProject()
  const tp = path.join(dir, '..', path.basename(dir) + '-session2.jsonl')
  fs.copyFileSync(fixture, tp)
  guard.scanTranscript(dir, tp, 'PreCompact')
  const cursor = guard.cursorPath(dir, tp)
  assert.ok(fs.existsSync(cursor))
  // A stale cursor whose transcript is gone gets pruned.
  const stale = path.join(dir, '.strata/inbox/.cursor.0123456789ab.json')
  fs.writeFileSync(stale, JSON.stringify({ transcriptPath: path.join(dir, 'gone.jsonl'), offset: 0 }))
  const c = runJson(['inbox', 'clear'], { cwd: dir }).json
  assert.equal(c.cleared, 10)
  assert.equal(c.pruned, 1)
  assert.ok(fs.existsSync(cursor), 'the live cursor survives')
  assert.equal(guard.scanTranscript(dir, tp, 'SessionEnd'), 0)
  assert.equal(runJson(['inbox', 'summary'], { cwd: dir }).json.total, 0)
  fs.rmSync(tp, { force: true })
  rm(dir)
})

test('save --prepare reports inbox counts as a judgment item', () => {
  const dir = gitProject()
  const tp = path.join(dir, '..', path.basename(dir) + '-session3.jsonl')
  fs.copyFileSync(fixture, tp)
  guard.scanTranscript(dir, tp, 'PreCompact')
  const r = run(['save', '--prepare', '--dry-run'], { cwd: dir })
  assert.match(r.stdout, /Inbox: 10 captures: 3 failures \(1 repeated\).*Repeated: 2x npm test\./)
  fs.rmSync(tp, { force: true })
  rm(dir)
})
