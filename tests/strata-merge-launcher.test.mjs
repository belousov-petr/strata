import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { gitProject, run, runJson, rm, read, write, issue, git, cleanEnv, tmpDir, repoRoot } from './helpers.mjs'
import { launcherSource } from '../skills/strata/scripts/lib/setup.mjs'

// A plugin-cache path that an update has already removed.
const GONE = '/nowhere/.claude/plugins/cache/mkt/strata/0.1.1/skills/strata/scripts/strata.mjs'

function tryMerge(dir, branch, env = {}) {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', 'merge', '--no-edit', branch], { cwd: dir, encoding: 'utf8', env: cleanEnv(env) })
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
function commitAll(dir, msg) { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg) }
function launcherFile(dir) { return path.join(dir, '.git', 'strata', 'merge-driver.mjs') }

function setupRepo() {
  const dir = gitProject()
  assert.equal(run(['setup'], { cwd: dir }).status, 0)
  commitAll(dir, 'setup')
  return dir
}

// Two branches that each add an in-progress issue: only a row merge is clean.
function parallelIssues(dir) {
  git(dir, 'checkout', '-q', '-b', 'a')
  issue(dir, { id: '20261003-01', slug: 'from-a', status: 'in-progress', what: 'From a' })
  run(['views'], { cwd: dir })
  commitAll(dir, 'a')
  git(dir, 'checkout', '-q', 'main')
  issue(dir, { id: '20261003-02', slug: 'from-main', status: 'in-progress', what: 'From main' })
  run(['views'], { cwd: dir })
  commitAll(dir, 'main')
}

test('setup points git at a launcher in the git folder, not at a versioned plugin path', () => {
  const dir = setupRepo()
  const cmd = git(dir, 'config', '--local', '--get', 'merge.strata-views.driver')
  assert.ok(cmd.includes('/.git/strata/merge-driver.mjs"'), cmd)
  assert.ok(!cmd.includes('skills/strata/scripts/strata.mjs'), 'no plugin path in git config')
  assert.ok(fs.existsSync(launcherFile(dir)))
  assert.match(fs.readFileSync(launcherFile(dir), 'utf8'), /const RECORDED = ".*skills\/strata\/scripts\/strata\.mjs"/)
  assert.equal(runJson(['setup'], { cwd: dir }).json.mergeDriver, 'current')
  rm(dir)
})

test('after the recorded plugin folder is gone, the launcher finds the current install', () => {
  const dir = setupRepo()
  fs.writeFileSync(launcherFile(dir), launcherSource(GONE))
  const cfg = tmpDir('strata-claude-cfg-')
  write(cfg, 'plugins/installed_plugins.json', JSON.stringify({
    version: 2,
    plugins: { 'strata@mkt': [{ scope: 'user', installPath: repoRoot, version: '0.2.0', lastUpdated: '2026-10-10T00:00:00.000Z' }] },
  }))
  parallelIssues(dir)
  const m = tryMerge(dir, 'a', { CLAUDE_CONFIG_DIR: cfg })
  assert.equal(m.status, 0, m.out)
  const rows = read(dir, '.strata/issues/ACTIVE.md').split('\n').filter((l) => l.startsWith('| ['))
  assert.equal(rows.length, 2, 'rows from both branches, no conflict')
  rm(cfg)
  rm(dir)
})

test('with no install anywhere the launcher falls back to a plain text merge', () => {
  const dir = setupRepo()
  fs.writeFileSync(launcherFile(dir), launcherSource(GONE))
  // One side edits the view's header text, the other adds a row: plain text merges it.
  git(dir, 'checkout', '-q', '-b', 'a')
  write(dir, '.strata/issues/ACTIVE.md', read(dir, '.strata/issues/ACTIVE.md').replace('Loaded at `/strata:load`.', 'Loaded at `/strata:load`. Edited on a.'))
  commitAll(dir, 'a: header')
  git(dir, 'checkout', '-q', 'main')
  issue(dir, { id: '20261003-02', slug: 'm', status: 'in-progress', what: 'From main' })
  run(['views'], { cwd: dir })
  commitAll(dir, 'main: row')
  const m = tryMerge(dir, 'a')
  assert.equal(m.status, 0, m.out)
  assert.match(m.out, /no strata install found; merged \.strata\/issues\/ACTIVE\.md as plain text/)
  const active = read(dir, '.strata/issues/ACTIVE.md')
  assert.match(active, /Edited on a\./)
  assert.match(active, /20261003-02/)
  rm(dir)
})

test('status and check flag a driver that points at a removed file; setup repairs it', () => {
  const dir = setupRepo()
  git(dir, 'config', '--local', 'merge.strata-views.driver', `"${process.execPath.replace(/\\/g, '/')}" "${GONE}" views --merge-driver %O %A %B %P`)
  const st = run(['status'], { cwd: dir }).stdout
  assert.match(st, /Setup: the views merge driver points at a file that no longer exists \(\/nowhere\/.*strata\.mjs\)/)
  assert.ok(runJson(['check'], { cwd: dir }).json.findings.some((f) => f.code === 'merge-driver-broken'))
  assert.equal(runJson(['setup'], { cwd: dir }).json.mergeDriver, 'updated')
  assert.ok(!run(['status'], { cwd: dir }).stdout.includes('no longer exists'))
  rm(dir)
})
