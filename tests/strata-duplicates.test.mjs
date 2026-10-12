import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gitProject, run, runJson, rm, issue, write } from './helpers.mjs'

function backlog(dir) {
  issue(dir, { id: '20261001-01', slug: 'queue-stalls', status: 'open', area: 'src/queue', what: 'Queue stalls under load' })
  issue(dir, { id: '20261001-02', slug: 'login-slow', status: 'in-progress', area: 'web', what: 'Login page is slow' })
  issue(dir, { id: '20261001-03', slug: 'worker-queue', status: 'parked', area: 'workers', what: 'Worker drains the queue too late', revive: 'when v2 ships' })
  issue(dir, { id: '20261001-04', slug: 'queue-stalls-old', status: 'resolved', area: 'src/queue', what: 'Queue stalls under load, old' })
  issue(dir, { id: '20261001-05', slug: 'queue-stalls-gone', status: 'open', area: 'src/queue', what: 'Queue stalls under load', archive: true })
  issue(dir, { id: '20261001-06', slug: 'queue-stalls-no', status: 'rejected', area: 'src/queue', what: 'Queue stalls again' })
}

test('new-issue lists open issues that share two or more words, closed and archived ones left out', () => {
  const dir = gitProject()
  backlog(dir)
  const r = runJson(['new-issue', '--slug', 'queue-stall-deploy', '--title', 'Queue stalls after a deploy', '--area', 'src/queue'], { cwd: dir })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.duplicates, [{
    id: '20261001-01', file: '.strata/issues/20261001-01-queue-stalls.md', title: 'Queue stalls under load', status: 'open', shared: ['queue', 'stalls'],
  }])
  // Text mode: the id line stays alone on stdout; the advice goes to stderr.
  const t = run(['new-issue', '--slug', 'queue-stall-again', '--title', 'Queue stalls after a deploy'], { cwd: dir })
  assert.equal(t.stdout.trim().split('\n').length, 1)
  assert.equal(t.stderr, [
    'Possible duplicates among the open issues. If one fits, fold the new evidence into it and delete .strata/issues/20261003-02-queue-stall-again.md.',
    '- 20261003-01 [open] Queue stalls after a deploy · queue, stalls, deploy, stall',
    '- 20261001-01 [open] Queue stalls under load · queue, stalls',
    '',
  ].join('\n'), 'the issue filed a moment ago comes first; the new file never lists itself')
  rm(dir)
})

test('the hint works with --dry-run and never blocks', () => {
  const dir = gitProject()
  backlog(dir)
  const d = run(['new-issue', '--slug', 'queue-drain', '--title', 'Worker queue drains late', '--dry-run'], { cwd: dir })
  assert.equal(d.status, 0)
  assert.equal(d.stdout.trim(), '20261003-01', 'stdout is still only the id')
  assert.match(d.stderr, /fold the new evidence into it instead of filing a new issue\./)
  assert.match(d.stderr, /\n- 20261001-03 \[parked\] Worker drains the queue too late · worker, drains, queue, late\n$/)
  const j = runJson(['new-issue', '--slug', 'queue-drain', '--title', 'Worker queue drains late', '--dry-run'], { cwd: dir }).json
  assert.equal(j.dryRun, true)
  assert.deepEqual(j.duplicates.map((x) => x.id), ['20261001-03'], '20261001-01 shares only queue')
  assert.deepEqual(j.duplicates[0].shared, ['worker', 'drains', 'queue', 'late'])
  rm(dir)
})

test('one shared word is not a duplicate, and at most five are listed', () => {
  const dir = gitProject()
  backlog(dir)
  const none = runJson(['new-issue', '--slug', 'login-button', '--title', 'Button colour on login', '--dry-run'], { cwd: dir })
  assert.deepEqual(none.json.duplicates, [], 'only login is shared with 20261001-02')
  assert.equal(run(['new-issue', '--slug', 'login-button', '--title', 'Button colour on login', '--dry-run'], { cwd: dir }).stderr, '')
  for (let n = 10; n < 17; n++) issue(dir, { id: `20261002-${n}`, slug: `cache-miss-${n}`, what: `Cache misses on shard ${n}` })
  write(dir, '.strata/issues/20261002-30-cache/notes.md', '---\ntitle: notes\n---\n\nCache misses, shard notes.\n')
  const many = runJson(['new-issue', '--slug', 'cache-miss', '--title', 'Cache misses on the shard', '--dry-run'], { cwd: dir }).json
  assert.deepEqual(many.duplicates.map((x) => x.id), ['20261002-10', '20261002-11', '20261002-12', '20261002-13', '20261002-14'],
    'five, by shared words then id; notes without an id in a sub-folder are not issues')
  rm(dir)
})
