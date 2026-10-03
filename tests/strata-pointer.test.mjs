import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { gitProject, tmpDir, run, runJson, rm, git } from './helpers.mjs'

function fakeClaude(projectDir) {
  const cfg = tmpDir('strata-claude-')
  const enc = path.resolve(projectDir).replace(/[^a-zA-Z0-9]/g, '-')
  const mem = path.join(cfg, 'projects', enc, 'memory')
  fs.mkdirSync(mem, { recursive: true })
  return { cfg, mem }
}

test('the pointer is written once with one index line, and other lines stay', () => {
  const dir = gitProject()
  const { cfg, mem } = fakeClaude(dir)
  fs.writeFileSync(path.join(mem, 'MEMORY.md'), '- [User role](user_role.md): the user is a maintainer\n')
  const env = { CLAUDE_CONFIG_DIR: cfg }
  const r = runJson(['pointer'], { cwd: dir, env }).json
  assert.deepEqual(r.dirs.map((d) => [d.pointer, d.index]), [['created', 'updated']])
  const idx = fs.readFileSync(path.join(mem, 'MEMORY.md'), 'utf8')
  assert.ok(idx.startsWith('- [User role](user_role.md): the user is a maintainer\n'))
  assert.equal(idx.split('\n').filter((l) => l.includes('(strata-pointer.md)')).length, 1)
  assert.match(fs.readFileSync(path.join(mem, 'strata-pointer.md'), 'utf8'), /type: reference/)
  const again = runJson(['pointer'], { cwd: dir, env }).json
  assert.deepEqual(again.dirs.map((d) => [d.pointer, d.index]), [['current', 'current']])
  assert.deepEqual(fs.readdirSync(mem).sort(), ['MEMORY.md', 'strata-pointer.md'])
  rm(dir); rm(cfg)
})

test('a worktree points from the main worktree\'s auto-memory folder', () => {
  const main = gitProject()
  const wt = main + '-wt'
  git(main, 'worktree', 'add', '-q', '-b', 'feat', wt)
  const { cfg, mem } = fakeClaude(main)
  const r = runJson(['pointer'], { cwd: wt, env: { CLAUDE_CONFIG_DIR: cfg } }).json
  assert.equal(r.dirs.length, 1)
  assert.equal(r.dirs[0].dir, mem)
  rm(wt); rm(main); rm(cfg)
})

test('no auto-memory folder means nothing is written and nothing is said by save', () => {
  const dir = gitProject()
  const cfg = tmpDir('strata-claude-')
  const r = runJson(['pointer'], { cwd: dir, env: { CLAUDE_CONFIG_DIR: cfg } }).json
  assert.deepEqual(r.dirs, [])
  assert.deepEqual(fs.readdirSync(cfg), [])
  const s = run(['save', '--prepare'], { cwd: dir, env: { CLAUDE_CONFIG_DIR: cfg } })
  assert.ok(!/auto-memory/.test(s.stdout))
  rm(dir); rm(cfg)
})

test('save --prepare writes the pointer, and the opt-out turns it off', () => {
  const dir = gitProject()
  const { cfg, mem } = fakeClaude(dir)
  const off = run(['save', '--prepare'], { cwd: dir, env: { CLAUDE_CONFIG_DIR: cfg, STRATA_AUTO_MEMORY_POINTER: '0' } })
  assert.ok(!/auto-memory/.test(off.stdout))
  assert.ok(!fs.existsSync(path.join(mem, 'strata-pointer.md')))
  const on = run(['save', '--prepare'], { cwd: dir, env: { CLAUDE_CONFIG_DIR: cfg } })
  assert.match(on.stdout, /Claude auto-memory pointer: strata-pointer\.md created/)
  assert.ok(fs.existsSync(path.join(mem, 'strata-pointer.md')))
  rm(dir); rm(cfg)
})
