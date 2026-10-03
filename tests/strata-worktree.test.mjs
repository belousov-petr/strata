import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpDir, scaffold, git, run, runJson, rm, write, hookPath, cleanEnv } from './helpers.mjs'
import * as guard from '../hooks/strata-capture-guard.mjs'

function repoWithWorktree() {
  const base = tmpDir()
  const main = path.join(base, 'main')
  fs.mkdirSync(main)
  git(main, 'init', '-q')
  scaffold(main)
  git(main, 'add', '-A')
  git(main, 'commit', '-q', '-m', 'init')
  const wt = path.join(base, 'wt')
  git(main, 'worktree', 'add', '-q', '-b', 'feat', wt)
  return { base, main, wt }
}

function hook(payload) {
  return spawnSync(process.execPath, [hookPath], { input: JSON.stringify(payload), encoding: 'utf8', env: cleanEnv() })
}

test('a linked worktree resolves its shared root to the main worktree, like git does', () => {
  const { base, main, wt } = repoWithWorktree()
  const r = runJson(['where'], { cwd: wt }).json
  assert.equal(r.project, wt)
  assert.equal(r.shared, main)
  const common = git(wt, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  assert.equal(path.resolve(path.dirname(common)), path.resolve(main))
  assert.deepEqual(guard.gitTopAndMain(path.join(wt, '.strata')), { top: wt, main })
  rm(base)
})

test('journal entries from any worktree land in the main worktree journal', () => {
  const { base, main, wt } = repoWithWorktree()
  assert.equal(run(['journal', 'add', '--kind', 'note', '--title', 'from the worktree'], { cwd: wt }).status, 0)
  assert.equal(run(['journal', 'add', '--kind', 'note', '--title', 'from main'], { cwd: main }).status, 0)
  const entries = runJson(['journal', 'list'], { cwd: main }).json.entries
  assert.deepEqual(entries.map((e) => e.title), ['from the worktree', 'from main'])
  assert.equal(entries[0].worktree, 'wt')
  assert.equal(entries[0].branch, 'feat')
  assert.ok(!fs.existsSync(path.join(wt, '.strata/inbox/journal.jsonl')))
  // Removing the worktree loses nothing.
  git(main, 'worktree', 'remove', '--force', wt)
  assert.equal(runJson(['journal', 'list'], { cwd: main }).json.entries.length, 2)
  rm(base)
})

test('the hook writes a worktree session\'s captures to the main worktree inbox', () => {
  const { base, main, wt } = repoWithWorktree()
  const tp = path.join(base, 'transcript.jsonl')
  fs.writeFileSync(tp, JSON.stringify({ message: { content: [
    { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } },
  ] } }) + '\n' + JSON.stringify({ message: { content: [
    { type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Exit code 1\nnpm test failed' },
  ] } }) + '\n')
  const r = hook({ hook_event_name: 'PreCompact', cwd: wt, transcript_path: tp })
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
  assert.ok(fs.existsSync(path.join(main, '.strata/inbox/captures.jsonl')))
  assert.ok(!fs.existsSync(path.join(wt, '.strata/inbox/captures.jsonl')))
  rm(base)
})

test('a main worktree without .strata/ falls back to the worktree itself', () => {
  const base = tmpDir()
  const main = path.join(base, 'main')
  fs.mkdirSync(main)
  git(main, 'init', '-q')
  write(main, 'README.md', '# x\n')
  git(main, 'add', '-A')
  git(main, 'commit', '-q', '-m', 'init')
  const wt = path.join(base, 'wt')
  git(main, 'worktree', 'add', '-q', '-b', 'strata', wt)
  scaffold(wt)
  const r = runJson(['where'], { cwd: wt }).json
  assert.equal(r.shared, wt)
  rm(base)
})

test('a .strata/ in a subfolder maps to the same subfolder of the main worktree', () => {
  const base = tmpDir()
  const main = path.join(base, 'main')
  fs.mkdirSync(path.join(main, 'pkg'), { recursive: true })
  git(main, 'init', '-q')
  scaffold(path.join(main, 'pkg'))
  git(main, 'add', '-A')
  git(main, 'commit', '-q', '-m', 'init')
  const wt = path.join(base, 'wt')
  git(main, 'worktree', 'add', '-q', '-b', 'feat', wt)
  const r = runJson(['where'], { cwd: path.join(wt, 'pkg') }).json
  assert.equal(r.project, path.join(wt, 'pkg'))
  assert.equal(r.shared, path.join(main, 'pkg'))
  rm(base)
})

test('outside git the project root is the shared root', () => {
  const dir = tmpDir()
  scaffold(dir)
  const r = runJson(['where'], { cwd: dir }).json
  assert.equal(r.shared, dir)
  rm(dir)
})
