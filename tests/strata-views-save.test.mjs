import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { gitProject, run, runJson, rm, read, write, issue, learning, git } from './helpers.mjs'

function tableRows(text) { return text.split('\n').filter((l) => /^\| \[/.test(l)) }

test('a fresh scaffold has no view drift and passes check', () => {
  const dir = gitProject()
  assert.equal(run(['views', '--check'], { cwd: dir }).status, 0)
  const c = runJson(['check'], { cwd: dir })
  assert.equal(c.status, 0, JSON.stringify(c.json.findings))
  rm(dir)
})

test('views render in a fixed order and keep the project header', () => {
  const dir = gitProject({ name: 'Acme' })
  issue(dir, { id: '20261003-02', slug: 'b', status: 'in-progress', severity: 'low', area: 'api', what: 'Low one' })
  issue(dir, { id: '20261003-01', slug: 'a', status: 'in-progress', severity: 'high', area: 'api', what: 'High one' })
  issue(dir, { id: '20261003-03', slug: 'c', status: 'in-progress', severity: 'med', area: 'ui', what: 'Med | piped' })
  issue(dir, { id: '20261001-01', slug: 'o1', status: 'open', severity: 'med', area: 'ui', what: 'Open ui' })
  issue(dir, { id: '20261001-02', slug: 'o2', status: 'open', severity: 'high', area: 'api', what: 'Open api' })
  issue(dir, { id: '20261001-03', slug: 'o3', status: 'open', severity: 'low', area: '', what: 'No area' })
  issue(dir, { id: '20261002-01', slug: 'p', status: 'parked', area: 'x', what: 'Later', revive: 'when the vendor ships v2' })
  issue(dir, { id: '20261002-02', slug: 'r', status: 'resolved', area: 'x', what: 'Done' })
  assert.equal(run(['views'], { cwd: dir }).status, 0)

  const active = read(dir, '.strata/issues/ACTIVE.md')
  assert.ok(active.startsWith('# Active issues — Acme\n'), 'project header kept')
  assert.deepEqual(tableRows(active), [
    '| [20261003-01](20261003-01-a.md) | bug | high | api | High one |',
    '| [20261003-03](20261003-03-c.md) | bug | med | ui | Med \\| piped |',
    '| [20261003-02](20261003-02-b.md) | bug | low | api | Low one |',
  ])
  const open = read(dir, '.strata/issues/OPEN.md')
  const heads = open.split('\n').filter((l) => l.startsWith('### '))
  assert.deepEqual(heads, ['### api', '### ui', '### (no area)'])
  assert.match(read(dir, '.strata/issues/PARKED.md'), /\| \[20261002-01\]\(20261002-01-p\.md\) \| Later \| when the vendor ships v2 \|/)
  assert.ok(!active.includes('20261002-02') && !open.includes('20261002-02'))

  // Idempotent: a second run changes nothing.
  const again = runJson(['views'], { cwd: dir }).json
  assert.ok(again.views.every((v) => v.state === 'current'), JSON.stringify(again.views))
  rm(dir)
})

test('MEMORY.md gets the hot subset and keeps its live pointers; INDEX lists every learning', () => {
  const dir = gitProject()
  const pointers = read(dir, '.strata/memory/MEMORY.md').split('## Rules by trigger')[0]
  learning(dir, { slug: 'zeta', trigger: 'when shipping', hot: true })
  learning(dir, { slug: 'alpha', trigger: 'before a migration', hot: true })
  learning(dir, { slug: 'quiet', trigger: 'when renaming a column', hot: false })
  run(['views'], { cwd: dir })
  const mem = read(dir, '.strata/memory/MEMORY.md')
  assert.ok(mem.startsWith(pointers))
  const rows = mem.split('\n').filter((l) => /^\| (before|when)/.test(l))
  assert.deepEqual(rows, ['| before a migration | [alpha](learnings/alpha.md) |', '| when shipping | [zeta](learnings/zeta.md) |'])
  const idx = read(dir, '.strata/memory/learnings/INDEX.md')
  assert.match(idx, /\| when renaming a column \| — \| failure \| \[quiet\.md\]\(quiet\.md\) \|/)
  rm(dir)
})

test('check reports vocabulary, duplicate ids, parked triggers, broken links and drift', () => {
  const dir = gitProject()
  issue(dir, { id: '20261003-01', slug: 'a', type: 'chore', severity: 'medium' })
  issue(dir, { id: '20261003-01', slug: 'b' })
  issue(dir, { id: '20261003-02', slug: 'c', status: 'parked' })
  write(dir, '.strata/docs/reference/paths.md', '# Paths\n\nSee [the map](../architecture/missing.md) and `[not a link](nope.md)`.\n')
  learning(dir, { slug: 'bad', trigger: 'before x', origin: 'luck', hot: 'maybe' })
  const r = runJson(['check'], { cwd: dir })
  assert.equal(r.status, 1)
  const codes = r.json.findings.map((f) => f.code)
  for (const c of ['issue-bad-type', 'issue-bad-severity', 'duplicate-id', 'parked-no-revive', 'broken-link', 'learning-bad-origin', 'learning-bad-hot', 'view-drift']) {
    assert.ok(codes.includes(c), `expected ${c} in ${codes.join(',')}`)
  }
  assert.equal(r.json.findings.filter((f) => f.code === 'broken-link').length, 1, 'inline code is not a link')
  rm(dir)
})

test('check enforces the MEMORY.md and project_state.md budgets', () => {
  const dir = gitProject()
  write(dir, '.strata/memory/project_state.md', Array.from({ length: 210 }, (_, i) => `line ${i}`).join('\n') + '\n')
  const r = runJson(['check'], { cwd: dir })
  assert.ok(r.json.findings.some((f) => f.code === 'budget-state'))
  rm(dir)
})

test('save --prepare archives closed issues with index rows, rolls sessions, regenerates views', () => {
  const dir = gitProject()
  issue(dir, { id: '20261001-01', slug: 'fixed', status: 'resolved', what: 'Fixed it' })
  issue(dir, { id: '20261001-02', slug: 'nope', status: 'wont-fix', what: 'Not doing it' })
  issue(dir, { id: '20261001-03', slug: 'live', status: 'open', what: 'Still open' })
  const state = ['---', 'name: State', 'description: x', '---', '',
    '## WHERE WE LEFT OFF (session 5, current)', 'five', '',
    '## WHERE WE LEFT OFF (session 4, last completed)', 'four', '',
    '## Session 3', 'three', '',
    '## Session 2', 'two', '',
    '## Notes', 'kept', ''].join('\n')
  write(dir, '.strata/memory/project_state.md', state)
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'work')
  // The resolve happens in this save, so the file is dirty when it moves.
  write(dir, '.strata/issues/20261001-01-fixed.md', read(dir, '.strata/issues/20261001-01-fixed.md') + '\n**Resolution:** done.\n')

  const dry = runJson(['save', '--prepare', '--dry-run'], { cwd: dir }).json
  assert.ok(dry.changed.some((c) => c.startsWith('move .strata/issues/20261001-01-fixed.md')))
  assert.ok(fs.existsSync(path.join(dir, '.strata/issues/20261001-01-fixed.md')), 'dry run writes nothing')

  const res = runJson(['save', '--prepare'], { cwd: dir }).json
  assert.ok(res.changed.some((c) => /carries uncommitted edits/.test(c)))
  assert.ok(fs.existsSync(path.join(dir, '.strata/issues/archive/20261001-01-fixed.md')))
  assert.match(read(dir, '.strata/issues/archive/20261001-01-fixed.md'), /Resolution:\*\* done/)
  assert.ok(fs.existsSync(path.join(dir, '.strata/issues/archive/20261001-02-nope.md')))
  const idx = read(dir, '.strata/issues/archive/INDEX.md')
  assert.match(idx, /\| \[20261001-01\]\(20261001-01-fixed\.md\) \| resolved \| 2026-10-03 \| Fixed it \|/)
  assert.match(idx, /\| \[20261001-02\]\(20261001-02-nope\.md\) \| wont-fix \|/)
  assert.match(git(dir, 'status', '--porcelain'), /R {2}\.strata\/issues\/20261001-02-nope\.md -> \.strata\/issues\/archive\/20261001-02-nope\.md/)

  const ps = read(dir, '.strata/memory/project_state.md')
  assert.match(ps, /session 5/)
  assert.match(ps, /session 4/)
  assert.ok(!/## Session 3/.test(ps) && !/## Session 2/.test(ps))
  assert.match(ps, /## Notes\nkept/)
  const rolled = read(dir, '.strata/memory/archive/2026-10-sessions-2-3.md')
  assert.match(rolled, /## Session 3\nthree/)
  assert.match(rolled, /## Session 2\ntwo/)
  assert.match(read(dir, '.strata/memory/archive/ARCHIVE.md'), /\| `2026-10-sessions-2-3\.md` \| Sessions 2, 3 rolled from project_state\.md on 2026-10-03 \|/)
  assert.match(read(dir, '.strata/issues/OPEN.md'), /20261001-03/)

  const again = runJson(['save', '--prepare'], { cwd: dir }).json
  assert.deepEqual(again.changed, [], 'a re-run with no new work changes nothing')
  assert.equal(runJson(['check'], { cwd: dir }).status, 0)
  rm(dir)
})

test('save --prepare lists pending captures and parked triggers as judgment items', () => {
  const dir = gitProject()
  issue(dir, { id: '20261002-01', slug: 'p', status: 'parked', revive: 'when v2 ships' })
  run(['journal', 'add', '--kind', 'decision', '--title', 'Use the row merge'], { cwd: dir })
  const r = run(['save', '--prepare'], { cwd: dir })
  assert.match(r.stdout, /Pending captures: 1 \(1 decision\)/)
  assert.match(r.stdout, /20261002-01 \(when v2 ships\)/)
  rm(dir)
})

test('generated_views: external leaves the views to the project', () => {
  const dir = gitProject()
  write(dir, '.strata/MANIFEST.md', read(dir, '.strata/MANIFEST.md').replace('layout_version: 3\n', 'layout_version: 3\ngenerated_views: external\n'))
  write(dir, '.strata/issues/ACTIVE.md', '# Custom\n\nRendered elsewhere.\n')
  issue(dir, { id: '20261003-01', status: 'in-progress' })
  const r = runJson(['views'], { cwd: dir }).json
  assert.equal(r.external, true)
  assert.equal(read(dir, '.strata/issues/ACTIVE.md'), '# Custom\n\nRendered elsewhere.\n')
  assert.ok(!runJson(['check'], { cwd: dir }).json.findings.some((f) => f.code === 'view-drift'))
  rm(dir)
})
