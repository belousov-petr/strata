import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { gitProject, run, runJson, rm, read, write, issue, learning, git, cleanEnv } from './helpers.mjs'

// Merge without throwing on conflicts; return git's status and output.
function tryMerge(dir, branch) {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', 'merge', '--no-edit', branch], { cwd: dir, encoding: 'utf8', env: cleanEnv() })
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

function commitAll(dir, msg) { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg) }

function setupRepo() {
  const dir = gitProject()
  const s = run(['setup'], { cwd: dir })
  assert.equal(s.status, 0, s.stderr)
  commitAll(dir, 'setup')
  return dir
}

test('setup installs the attributes block and the local driver, idempotently', () => {
  const dir = gitProject()
  write(dir, '.gitattributes', '* text=auto\n')
  const first = runJson(['setup'], { cwd: dir }).json
  assert.equal(first.gitattributes, 'appended')
  assert.equal(first.mergeDriver, 'installed')
  const attrs = read(dir, '.gitattributes')
  assert.ok(attrs.startsWith('* text=auto\n'))
  assert.match(attrs, /\.strata\/issues\/ACTIVE\.md merge=strata-views/)
  assert.match(git(dir, 'config', '--local', '--get', 'merge.strata-views.driver'), /strata\.mjs" views --merge-driver %O %A %B %P$/)
  const second = runJson(['setup'], { cwd: dir }).json
  assert.equal(second.gitattributes, 'current')
  assert.equal(second.mergeDriver, 'current')
  assert.equal(read(dir, '.gitattributes'), attrs)
  rm(dir)
})

test('parallel branches that each add an issue merge without a conflict', () => {
  const dir = setupRepo()
  git(dir, 'checkout', '-q', '-b', 'a')
  issue(dir, { id: '20261003-01', slug: 'from-a', status: 'in-progress', severity: 'low', what: 'From branch a' })
  run(['views'], { cwd: dir })
  commitAll(dir, 'a: issue')
  git(dir, 'checkout', '-q', 'main')
  issue(dir, { id: '20261003-02', slug: 'from-main', status: 'in-progress', severity: 'high', what: 'From main' })
  run(['views'], { cwd: dir })
  commitAll(dir, 'main: issue')

  const m = tryMerge(dir, 'a')
  assert.equal(m.status, 0, m.out)
  const active = read(dir, '.strata/issues/ACTIVE.md')
  assert.ok(!active.includes('<<<<<<<'))
  const rows = active.split('\n').filter((l) => l.startsWith('| ['))
  assert.deepEqual(rows.map((l) => l.slice(0, 15)), ['| [20261003-02]', '| [20261003-01]'])
  assert.equal(run(['views', '--check'], { cwd: dir }).status, 0, 'the merged view equals a fresh render')
  rm(dir)
})

test('a row removed on one side and added on the other merges by rows', () => {
  const dir = setupRepo()
  issue(dir, { id: '20261001-01', slug: 'old', status: 'open', area: 'api', what: 'Old open item' })
  run(['views'], { cwd: dir })
  commitAll(dir, 'base issue')
  git(dir, 'checkout', '-q', '-b', 'a')
  issue(dir, { id: '20261001-01', slug: 'old', status: 'resolved', area: 'api', what: 'Old open item' })
  run(['views'], { cwd: dir })
  commitAll(dir, 'a: resolve')
  git(dir, 'checkout', '-q', 'main')
  issue(dir, { id: '20261003-05', slug: 'new', status: 'open', area: 'api', what: 'New open item' })
  run(['views'], { cwd: dir })
  commitAll(dir, 'main: new')
  const m = tryMerge(dir, 'a')
  assert.equal(m.status, 0, m.out)
  const open = read(dir, '.strata/issues/OPEN.md')
  assert.match(open, /20261003-05/)
  assert.ok(!open.includes('20261001-01'))
  rm(dir)
})

test('MEMORY.md merges table rows and hand-written pointers together', () => {
  const dir = setupRepo()
  git(dir, 'checkout', '-q', '-b', 'a')
  learning(dir, { slug: 'from-a', trigger: 'before deploying', hot: true })
  write(dir, '.strata/memory/MEMORY.md', read(dir, '.strata/memory/MEMORY.md').replace('nothing in progress yet.', 'one item in progress (from a).'))
  run(['views'], { cwd: dir })
  commitAll(dir, 'a')
  git(dir, 'checkout', '-q', 'main')
  learning(dir, { slug: 'from-main', trigger: 'after a release', hot: true })
  run(['views'], { cwd: dir })
  commitAll(dir, 'main')
  const m = tryMerge(dir, 'a')
  assert.equal(m.status, 0, m.out)
  const mem = read(dir, '.strata/memory/MEMORY.md')
  assert.match(mem, /one item in progress \(from a\)/)
  const rows = mem.split('\n').filter((l) => /\]\(learnings\//.test(l))
  assert.deepEqual(rows, ['| after a release | [from-main](learnings/from-main.md) |', '| before deploying | [from-a](learnings/from-a.md) |'])
  for (const f of ['CLAUDE.md', 'AGENTS.md']) {
    const t = read(dir, f)
    assert.ok(!t.includes('<<<<<<<'), `${f} merged`)
    assert.ok(t.indexOf('from-main.md') < t.indexOf('from-a.md'), `${f} rules sorted by trigger`)
  }
  assert.equal(run(['views', '--check'], { cwd: dir }).status, 0)
  rm(dir)
})

test('without the local driver git falls back to a plain text merge', () => {
  const dir = setupRepo()
  git(dir, 'config', '--local', '--remove-section', 'merge.strata-views')
  assert.ok(runJson(['check'], { cwd: dir }).json.findings.some((f) => f.code === 'merge-driver-missing'))
  git(dir, 'checkout', '-q', '-b', 'a')
  issue(dir, { id: '20261003-01', slug: 'x', status: 'in-progress' })
  run(['views'], { cwd: dir })
  commitAll(dir, 'a')
  git(dir, 'checkout', '-q', 'main')
  issue(dir, { id: '20261003-02', slug: 'y', status: 'in-progress' })
  run(['views'], { cwd: dir })
  commitAll(dir, 'main')
  const m = tryMerge(dir, 'a')
  assert.notEqual(m.status, 0)
  assert.match(read(dir, '.strata/issues/ACTIVE.md'), /<<<<<<< /)
  rm(dir)
})

test('save --prepare refreshes a driver line that points at an old plugin path', () => {
  const dir = setupRepo()
  git(dir, 'config', '--local', 'merge.strata-views.driver', 'node "/old/plugin/0.1.0/strata.mjs" views --merge-driver %O %A %B %P')
  const r = runJson(['save', '--prepare'], { cwd: dir }).json
  assert.ok(r.changed.some((c) => /merge driver path/.test(c)))
  assert.ok(!git(dir, 'config', '--local', '--get', 'merge.strata-views.driver').includes('/old/plugin/'))
  rm(dir)
})

function makeExternal(dir) {
  write(dir, '.strata/MANIFEST.md', read(dir, '.strata/MANIFEST.md').replace(/^---\nlayout_version: 3\n/, '---\nlayout_version: 3\ngenerated_views: external\n'))
}

// A view in a project's own layout: its own header row and a column strata does not render.
const OWN_OPEN = '# Open backlog\n\n<!-- GENERATED by scripts/own_views.py; do not hand-edit -->\n\n| Id | Type | Sev | Area | What |\n|---|---|---|---|---|\n| `20261001-02` | bug | low | api | [Second](20261001-02-b.md) |\n| `20261001-01` | bug | high | db | [First](20261001-01-a.md) |\n'

function driveNoChange(dir) {
  for (const n of ['o', 'a', 'b']) write(dir, `merge-${n}.md`, OWN_OPEN)
  const r = run(['views', '--merge-driver', 'merge-o.md', 'merge-a.md', 'merge-b.md', '.strata/issues/OPEN.md'], { cwd: dir })
  return { status: r.status, out: read(dir, 'merge-a.md') }
}

test('external views: setup routes only the adapters through the driver', () => {
  const dir = gitProject()
  makeExternal(dir)
  assert.equal(run(['setup'], { cwd: dir }).status, 0)
  const attrs = read(dir, '.gitattributes')
  assert.match(attrs, /^\/CLAUDE\.md merge=strata-views$/m)
  assert.match(attrs, /^\/AGENTS\.md merge=strata-views$/m)
  assert.ok(!attrs.includes('.strata/issues/'), 'views stay on git\'s text merge')
  rm(dir)
})

test('external views: the driver leaves a project-format view to a plain text merge', () => {
  const dir = gitProject()
  const before = driveNoChange(dir)
  assert.notEqual(before.out, OWN_OPEN, 'a strata-owned project re-renders the view in strata\'s layout')
  makeExternal(dir)
  const after = driveNoChange(dir)
  assert.equal(after.status, 0)
  assert.equal(after.out, OWN_OPEN, 'an external project keeps its own layout byte for byte')
  rm(dir)
})

test('a merge keeps the adapters\' "N more hot rules" line', () => {
  const dir = gitProject()
  for (let i = 0; i < 27; i++) learning(dir, { slug: `r-${String(i).padStart(2, '0')}`, trigger: `before step ${String(i).padStart(2, '0')}`, hot: true })
  run(['hot-rules'], { cwd: dir })
  const claude = read(dir, 'CLAUDE.md')
  assert.match(claude, /^- 2 more hot rules: see /m)
  for (const n of ['o', 'a', 'b']) write(dir, `m-${n}.md`, claude)
  const r = run(['views', '--merge-driver', 'm-o.md', 'm-a.md', 'm-b.md', 'CLAUDE.md'], { cwd: dir })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(read(dir, 'm-a.md'), claude)
  rm(dir)
})
