import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { gitProject, tmpDir, scaffold, run, runJson, rm, read, issue, write, git } from './helpers.mjs'

test('the first issue of the day is -01 and the file comes from the template', () => {
  const dir = gitProject()
  const r = runJson(['new-issue', '--slug', 'Queue Stalls!', '--type', 'bug', '--severity', 'high', '--area', 'src/queue', '--title', 'The queue stalls under load'], { cwd: dir }).json
  assert.equal(r.id, '20261003-01')
  assert.equal(r.file, '.strata/issues/20261003-01-queue-stalls.md')
  const t = read(dir, r.file)
  assert.match(t, /^---\nid: 20261003-01\ntype: bug\nstatus: open\nseverity: high\narea: src\/queue\ncreated: 2026-10-03\n---/)
  assert.ok(!/revive-when/.test(t))
  assert.match(t, /\*\*What:\*\* The queue stalls under load/)
  assert.equal(runJson(['check'], { cwd: dir }).json.findings.filter((f) => f.path.includes('20261003-01')).length, 0)
  rm(dir)
})

test('ids used only on another branch are skipped', () => {
  const dir = gitProject()
  git(dir, 'checkout', '-q', '-b', 'other')
  issue(dir, { id: '20261003-01', slug: 'a' })
  issue(dir, { id: '20261003-02', slug: 'b' })
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'other branch issues')
  git(dir, 'checkout', '-q', 'main')
  assert.ok(!fs.existsSync(path.join(dir, '.strata/issues/20261003-02-b.md')))
  assert.equal(run(['new-issue', '--slug', 'x', '--dry-run'], { cwd: dir }).stdout.trim(), '20261003-03')
  rm(dir)
})

test('ids in another worktree\'s uncommitted files are skipped', () => {
  const base = tmpDir()
  const main = path.join(base, 'main')
  fs.mkdirSync(main)
  git(main, 'init', '-q')
  scaffold(main)
  git(main, 'add', '-A'); git(main, 'commit', '-q', '-m', 'init')
  const wt = path.join(base, 'wt')
  git(main, 'worktree', 'add', '-q', '-b', 'feat', wt)
  issue(wt, { id: '20261003-04', slug: 'wip' }) // never committed
  assert.equal(run(['new-issue', '--slug', 'x', '--dry-run'], { cwd: main }).stdout.trim(), '20261003-05')
  rm(base)
})

test('two allocations in a row never hand out the same id, and gaps are not reused', () => {
  const dir = gitProject()
  issue(dir, { id: '20261003-01', slug: 'a' })
  issue(dir, { id: '20261003-03', slug: 'c' })
  const a = runJson(['new-issue', '--slug', 'one'], { cwd: dir }).json.id
  fs.rmSync(path.join(dir, `.strata/issues/${a}-one.md`)) // the reservation still holds
  const b = runJson(['new-issue', '--slug', 'two'], { cwd: dir }).json.id
  assert.equal(a, '20261003-04')
  assert.equal(b, '20261003-05')
  rm(dir)
})

test('a dated id from yesterday does not count for today', () => {
  const dir = gitProject()
  issue(dir, { id: '20261002-07', slug: 'old' })
  assert.equal(run(['new-issue', '--slug', 'x', '--dry-run'], { cwd: dir }).stdout.trim(), '20261003-01')
  rm(dir)
})

test('next-adr scans the decisions folder, other branches and reservations', () => {
  const dir = gitProject()
  write(dir, '.strata/docs/decisions/ADR-0001-first.md', '# ADR-0001\n')
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'adr 1')
  git(dir, 'checkout', '-q', '-b', 'other')
  write(dir, '.strata/docs/decisions/ADR-0002-second.md', '# ADR-0002\n')
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'adr 2')
  git(dir, 'checkout', '-q', 'main')
  assert.equal(runJson(['next-adr'], { cwd: dir }).json.adr, 'ADR-0003')
  assert.equal(runJson(['next-adr'], { cwd: dir }).json.adr, 'ADR-0004', 'the first call reserved 0003')
  rm(dir)
})

test('next-adr falls back to a root docs/decisions folder', () => {
  const dir = tmpDir()
  scaffold(dir)
  fs.rmSync(path.join(dir, '.strata/docs/decisions'), { recursive: true })
  write(dir, 'docs/decisions/ADR-0041-x.md', '# x\n')
  const r = runJson(['next-adr', '--dry-run'], { cwd: dir }).json
  assert.equal(r.adr, 'ADR-0042')
  assert.equal(r.dir, 'docs/decisions')
  rm(dir)
})
