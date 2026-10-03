import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gitProject, run, runJson, rm, write, issue, git } from './helpers.mjs'

function commit(dir, msg) { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg) }

test('drift lists commits that no record mentions, and save moves the marker', () => {
  const dir = gitProject()
  write(dir, 'src/queue/drain.ts', 'export {}\n')
  commit(dir, 'feat: drain the queue')
  write(dir, '.strata/docs/decisions/ADR-0001-drain.md', '# ADR-0001: Drain first\n\nThe code lives in `src/queue/drain.ts`.\n')
  commit(dir, 'docs: record the drain decision')
  write(dir, 'src/other/util.ts', 'export {}\n')
  commit(dir, 'fix: tidy the util helper')
  issue(dir, { id: '20261003-01', slug: 'retry' })
  commit(dir, 'chore: file an issue')
  write(dir, 'src/billing/retry.ts', 'export {}\n')
  commit(dir, 'feat: retry billing (20261003-01)')
  git(dir, 'checkout', '-q', '-b', 'feat/payments-retry')
  write(dir, 'src/pay/x.ts', 'export {}\n')
  commit(dir, 'feat: pay')
  git(dir, 'checkout', '-q', 'main')
  git(dir, 'merge', '-q', '--no-ff', '-m', "Merge branch 'feat/payments-retry'", 'feat/payments-retry')
  write(dir, '.strata/issues/20261003-01-retry.md', '---\nid: 20261003-01\ntype: bug\nstatus: open\nseverity: med\narea: src\ncreated: 2026-10-03\n---\n\n**What:** See branch feat/payments-retry.\n')
  commit(dir, 'chore: note the branch')

  const r = runJson(['drift'], { cwd: dir }).json
  assert.equal(r.marker.source, 'last commit touching project_state.md')
  assert.deepEqual(r.drift.map((d) => d.subject), ['fix: tidy the util helper'])
  assert.equal(r.checked, 4, 'memory-only commits are skipped')

  const save = run(['save', '--prepare'], { cwd: dir })
  assert.match(save.stdout, /Drift list \(1 commit since the last save that no record mentions\):\n- [0-9a-f]{7} fix: tidy the util helper \(src\/other\/util\.ts\)/)
  const after = runJson(['drift'], { cwd: dir }).json
  assert.equal(after.marker.source, 'last save')
  assert.equal(after.drift.length, 0)
  rm(dir)
})

test('a pending journal entry counts as a reference', () => {
  const dir = gitProject()
  write(dir, 'lib/parser/core.ts', 'export {}\n')
  commit(dir, 'feat: parser')
  assert.equal(runJson(['drift'], { cwd: dir }).json.drift.length, 1)
  run(['journal', 'add', '--kind', 'decision', '--title', 'Parser rewrite', '--ref', 'lib/parser/core.ts'], { cwd: dir })
  assert.equal(runJson(['drift'], { cwd: dir }).json.drift.length, 0)
  rm(dir)
})
