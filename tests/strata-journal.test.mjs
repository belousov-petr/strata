import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { gitProject, run, runJson, rm, git } from './helpers.mjs'

test('journal add, list, clear round trip', () => {
  const dir = gitProject()
  const a = run(['journal', 'add', '--kind', 'decision', '--title', 'Drain the queue first', '--lineage', 'supersedes ADR-0002', '--ref', 'src/queue.ts'], { cwd: dir })
  assert.equal(a.status, 0, a.stderr)
  assert.match(a.stdout, /\+1 decision/)
  const b = run(['journal', 'add', '--kind', 'gotcha', '--text', '-'], { cwd: dir, input: 'Windows git config wants forward slashes.\nSecond line.\n' })
  assert.equal(b.status, 0, b.stderr)

  const list = runJson(['journal', 'list'], { cwd: dir }).json
  assert.equal(list.entries.length, 2)
  assert.equal(list.entries[0].kind, 'decision')
  assert.equal(list.entries[0].lineage, 'supersedes ADR-0002')
  assert.deepEqual(list.entries[0].refs, ['src/queue.ts'])
  assert.equal(list.entries[1].title, 'Windows git config wants forward slashes.')
  assert.match(list.entries[1].text, /Second line/)

  const status = run(['status'], { cwd: dir })
  assert.match(status.stdout, /Pending captures: 2 \(1 decision, 1 gotcha\)/)

  const cleared = runJson(['journal', 'clear', '--id', list.entries[0].id], { cwd: dir }).json
  assert.deepEqual(cleared, { cleared: 1, kept: 1 })
  const routed = fs.readFileSync(path.join(dir, '.strata/inbox/journal.routed.jsonl'), 'utf8')
  assert.match(routed, /Drain the queue first/)
  assert.equal(runJson(['journal', 'list'], { cwd: dir }).json.entries.length, 1)
  assert.equal(run(['journal', 'clear', '--all'], { cwd: dir }).status, 0)
  assert.equal(runJson(['journal', 'list'], { cwd: dir }).json.entries.length, 0)
  rm(dir)
})

test('journal redacts secret-shaped values before they reach disk', () => {
  const dir = gitProject()
  // Assembled from fragments so no literal credential sits in the repo.
  const tok = 'gh' + 'p_' + 'Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2'
  const pw = 'hunter2' + 'longsecret'
  const r = run(['journal', 'add', '--kind', 'finding', '--title', `token ${tok}`, '--text', `password=${pw} in the log`], { cwd: dir })
  assert.equal(r.status, 0, r.stderr)
  const raw = fs.readFileSync(path.join(dir, '.strata/inbox/journal.jsonl'), 'utf8')
  assert.ok(!raw.includes(tok))
  assert.ok(!raw.includes(pw))
  assert.match(raw, /<redacted>/)
  rm(dir)
})

test('journal rejects an unknown kind and a missing title', () => {
  const dir = gitProject()
  assert.equal(run(['journal', 'add', '--kind', 'musing', '--title', 'x'], { cwd: dir }).status, 2)
  assert.equal(run(['journal', 'add', '--kind', 'note'], { cwd: dir }).status, 2)
  rm(dir)
})

test('journal records a filed entry and stays out of git', () => {
  const dir = gitProject()
  run(['journal', 'add', '--kind', 'runbook', '--title', 'Deploy steps', '--filed', '.strata/docs/ops/deploy.md'], { cwd: dir })
  const e = runJson(['journal', 'list'], { cwd: dir }).json.entries[0]
  assert.equal(e.filed, '.strata/docs/ops/deploy.md')
  const st = spawnGitStatus(dir)
  assert.equal(st, '', 'the journal must never show up as an untracked file')
  rm(dir)
})

test('an inbox folder created without an ignore file ignores itself', () => {
  const dir = gitProject()
  fs.rmSync(path.join(dir, '.strata/inbox'), { recursive: true, force: true })
  run(['journal', 'add', '--kind', 'note', '--title', 'x'], { cwd: dir })
  assert.equal(fs.readFileSync(path.join(dir, '.strata/inbox/.gitignore'), 'utf8'), '*\n')
  // The scaffolded ignore file was deleted from the work tree, so git reports
  // that deletion, but nothing new appears.
  assert.ok(!/^\?\?/m.test(spawnGitStatus(dir)))
  rm(dir)
})

test('the script explains what to do outside a strata project', () => {
  const r = run(['status'], { cwd: path.parse(process.cwd()).root })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /strata:init/)
})

function spawnGitStatus(dir) { return git(dir, 'status', '--porcelain') }
