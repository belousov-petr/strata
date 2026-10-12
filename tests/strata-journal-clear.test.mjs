import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { gitProject, tmpDir, scaffold, run, runJson, rm, read, write, issue, git } from './helpers.mjs'
import { significantWords, wordIndex } from '../skills/strata/scripts/lib/words.mjs'
import { proveEntry, wordsNeeded } from '../skills/strata/scripts/lib/proof.mjs'

const JOURNAL = '.strata/inbox/journal.jsonl'
const ROUTED = '.strata/inbox/journal.routed.jsonl'

function add(dir, kind, title, extra = []) {
  const r = runJson(['journal', 'add', '--kind', kind, '--title', title, ...extra], { cwd: dir })
  assert.equal(r.status, 0, r.stderr)
  return r.json.entry.id
}

test('title words: four letters or more, no stopwords, prefix match, half and at least two', () => {
  assert.deepEqual(significantWords('Use the new queue: it stalls when <redacted> is set'), ['queue', 'stalls'])
  assert.deepEqual(significantWords('Queue-stalls', 'src/queue'), ['queue', 'stalls'])
  assert.equal(wordsNeeded(1), 2)
  assert.equal(wordsNeeded(3), 2)
  assert.equal(wordsNeeded(5), 3)
  const index = wordIndex('The worker stalled twice. Queues drain slowly.')
  assert.equal(proveEntry({ title: 'Queue stall drains' }, index).by, 'tree', 'queue, stall and drain all start a word')
  assert.equal(proveEntry({ title: 'Queue latency budget exceeded nightly' }, index).by, null, 'one of four words is not enough')
  assert.equal(proveEntry({ title: 'Queue' }, index).by, null, 'one significant word can never be proven by text')
  assert.equal(proveEntry({ title: 'Anything', filed: '.strata/docs/x.md' }, null).by, 'filed')
})

test('entries with a filed path clear, including those save appended to their issue', () => {
  const dir = gitProject()
  issue(dir, { id: '20261003-01', slug: 'probe', status: 'in-progress', what: 'Flaky probe' })
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'issue')
  add(dir, 'runbook', 'Deploy steps', ['--filed', '.strata/docs/ops/deploy.md'])
  add(dir, 'finding', 'Seen again', ['--refs', '20261003-01', '--route', 'append'])
  assert.equal(run(['save', '--prepare'], { cwd: dir }).status, 0)
  // Commit everything, so only the filed paths can prove the entries.
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'save')
  const r = runJson(['journal', 'clear', '--all'], { cwd: dir })
  assert.equal(r.status, 0, r.stdout)
  assert.equal(r.json.cleared, 2)
  assert.equal(r.json.forced, 0)
  assert.equal(r.json.checked, true)
  assert.deepEqual(r.json.unproven, [])
  rm(dir)
})

test('an entry is proven by a new, untracked issue file that carries its title words', () => {
  const dir = gitProject()
  add(dir, 'finding', 'The nightly export stalls on large tenants')
  const ni = runJson(['new-issue', '--slug', 'export-stalls', '--title', 'Nightly export stalls for large tenants'], { cwd: dir })
  assert.equal(ni.status, 0, ni.stderr)
  assert.match(git(dir, 'status', '--porcelain'), /^\?\? \.strata\/issues\/20261003-01-export-stalls\.md$/m)
  const r = run(['journal', 'clear', '--all'], { cwd: dir })
  assert.equal(r.status, 0, r.stdout)
  assert.match(r.stdout, /^journal: cleared 1, 0 still pending\./)
  rm(dir)
})

test('an unproven entry is refused: the journal is unchanged and the command fails', () => {
  const dir = gitProject()
  add(dir, 'decision', 'Rotate the signing keys monthly')
  const id = add(dir, 'gotcha', 'Webhook retries double-charge customers')
  // A filed entry in the same batch does not rescue the other one.
  add(dir, 'runbook', 'Deploy steps', ['--filed', '.strata/docs/ops/deploy.md'])
  // An unrelated uncommitted change is not evidence.
  write(dir, '.strata/memory/project_state.md', read(dir, '.strata/memory/project_state.md') + '\nSigning notes moved.\n')
  const before = read(dir, JOURNAL)
  const r = run(['journal', 'clear', '--all'], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout, /nothing cleared\. 2 of 3 chosen entries show no sign of being filed/)
  assert.match(r.stdout, new RegExp(`- ${id} \\[gotcha\\] Webhook retries double-charge customers`))
  assert.match(r.stdout, /\[decision\] Rotate the signing keys monthly/)
  assert.match(r.stdout, /pass --force/)
  assert.equal(read(dir, JOURNAL), before)
  assert.ok(!fs.existsSync(path.join(dir, ROUTED)), 'nothing moved to the routed batch')
  const j = runJson(['journal', 'clear', '--all'], { cwd: dir })
  assert.equal(j.status, 1)
  assert.equal(j.json.refused, true)
  assert.equal(j.json.cleared, 0)
  assert.equal(j.json.kept, 3)
  assert.deepEqual(j.json.unproven.map((e) => e.kind), ['decision', 'gotcha'])
  rm(dir)
})

test('--force clears unproven entries and says how many were forced', () => {
  const dir = gitProject()
  add(dir, 'decision', 'Rotate the signing keys monthly')
  add(dir, 'runbook', 'Deploy steps', ['--filed', '.strata/docs/ops/deploy.md'])
  const r = run(['journal', 'clear', '--all', '--force'], { cwd: dir })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /cleared 2, 0 still pending\. 1 of them was cleared with --force although it showed no sign of being filed\./)
  assert.equal(read(dir, JOURNAL), '')
  assert.match(read(dir, ROUTED), /Rotate the signing keys/)
  rm(dir)
})

test('--id checks only the chosen entries; added lines in a tracked file count as evidence', () => {
  const dir = gitProject()
  const proven = add(dir, 'finding', 'Cache warmup misses tenant shards')
  const other = add(dir, 'decision', 'Rotate the signing keys monthly')
  write(dir, '.strata/memory/project_state.md', read(dir, '.strata/memory/project_state.md') + '\n- Found: the cache warmup skips some tenant shards after a deploy.\n')
  const ok = runJson(['journal', 'clear', '--id', proven], { cwd: dir })
  assert.equal(ok.status, 0, ok.stdout)
  assert.equal(ok.json.cleared, 1)
  assert.equal(ok.json.kept, 1)
  const left = runJson(['journal', 'list'], { cwd: dir }).json.entries
  assert.deepEqual(left.map((e) => e.id), [other])
  const no = runJson(['journal', 'clear', '--id', other], { cwd: dir })
  assert.equal(no.status, 1)
  assert.deepEqual(no.json.unproven.map((e) => e.id), [other])
  // Committed text is not evidence: commit the state and the proven words go away.
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'state')
  const again = add(dir, 'finding', 'Cache warmup misses tenant shards again')
  assert.equal(run(['journal', 'clear', '--id', again], { cwd: dir }).status, 1)
  rm(dir)
})

test('the journal itself never proves an entry, even when the inbox is not ignored', () => {
  const dir = gitProject()
  fs.rmSync(path.join(dir, '.strata/inbox/.gitignore'))
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'no inbox ignore')
  fs.mkdirSync(path.join(dir, '.strata/inbox'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.strata/inbox/.gitignore'), '')
  add(dir, 'gotcha', 'Webhook retries double-charge customers')
  assert.match(git(dir, 'status', '--porcelain'), /\.strata\/inbox\//, 'the journal shows up as untracked')
  assert.equal(run(['journal', 'clear', '--all'], { cwd: dir }).status, 1)
  rm(dir)
})

test('outside git the check is skipped with a one-line warning', () => {
  const dir = tmpDir()
  scaffold(dir)
  add(dir, 'decision', 'Rotate the signing keys monthly')
  const r = run(['journal', 'clear', '--all'], { cwd: dir })
  assert.equal(r.status, 0, r.stdout)
  const lines = r.stdout.trim().split('\n')
  assert.equal(lines.length, 2)
  assert.match(lines[0], /not a git repository, so the check that each entry was filed is skipped/)
  assert.match(lines[1], /cleared 1, 0 still pending/)
  assert.equal(runJson(['journal', 'clear', '--all'], { cwd: dir }).json.checked, false)
  rm(dir)
})

test('a project in a subfolder also counts the repository docs folder', () => {
  const top = tmpDir()
  git(top, 'init', '-q')
  const app = path.join(top, 'app')
  fs.mkdirSync(app)
  scaffold(app)
  write(top, 'docs/README.md', '# Docs\n')
  write(top, 'src/notes.md', '# Notes\n')
  git(top, 'add', '-A'); git(top, 'commit', '-q', '-m', 'init')
  const id = add(app, 'runbook', 'Restore the billing replica from snapshot')
  write(top, 'src/notes.md', '# Notes\n\nRestore the billing replica from the nightly snapshot.\n')
  assert.equal(run(['journal', 'clear', '--id', id], { cwd: app }).status, 1, 'text outside .strata/ and docs/ is not evidence')
  write(top, 'docs/ops/billing-replica.md', '# Restore the billing replica\n\nFrom the latest snapshot.\n')
  const r = run(['journal', 'clear', '--id', id], { cwd: app })
  assert.equal(r.status, 0, r.stdout)
  rm(top)
})
