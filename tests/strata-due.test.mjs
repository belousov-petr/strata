import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gitProject, run, runJson, rm, read, issue } from './helpers.mjs'
import { dateFromText, validDate } from '../skills/strata/scripts/lib/dates.mjs'

// STRATA_TODAY is pinned to 2026-10-03 by the test helpers.

function backlog(dir) {
  issue(dir, { id: '20261001-01', slug: 'a', status: 'parked', reviveOn: '2026-10-02', what: 'Recheck the vendor' })
  issue(dir, { id: '20261001-02', slug: 'b', status: 'parked', revive: 'on or after 2026-10-03', what: 'Plain date in the text' })
  issue(dir, { id: '20261001-03', slug: 'c', status: 'parked', reviveOn: '2026-10-08', what: 'Later' })
  issue(dir, { id: '20261001-04', slug: 'd', status: 'parked', revive: 'after 2026-10-20', what: 'Much later' })
  issue(dir, { id: '20261001-05', slug: 'e', status: 'parked', revive: 'when the vendor ships v2', what: 'Text trigger' })
  issue(dir, { id: '20261001-06', slug: 'f', status: 'open', due: '2026-10-01', what: 'Overdue fix' })
  issue(dir, { id: '20261001-07', slug: 'g', status: 'in-progress', due: '2026-10-03', what: 'Due today' })
  issue(dir, { id: '20261001-08', slug: 'h', status: 'open', due: '2026-10-30', what: 'Due late' })
  issue(dir, { id: '20261001-09', slug: 'i', status: 'resolved', due: '2026-09-01', what: 'Closed, ignored' })
}

test('plain-date revive-when texts count as dates; other texts do not', () => {
  assert.deepEqual(dateFromText('on or after 2026-10-12'), { date: '2026-10-12', strict: false })
  assert.deepEqual(dateFromText('after 2026-10-12.'), { date: '2026-10-12', strict: true })
  assert.deepEqual(dateFromText('2026-10-12'), { date: '2026-10-12', strict: false })
  assert.equal(dateFromText('after 2026-10-12 if the vendor answers'), null)
  assert.equal(dateFromText('on 2026-02-30'), null)
  assert.ok(validDate('2028-02-29'))
  assert.ok(!validDate('2026-13-01'))
})

test('status and save list reached dates and text triggers, and count the rest', () => {
  const dir = gitProject()
  backlog(dir)
  const st = run(['status'], { cwd: dir }).stdout
  assert.match(st, /Parked: revive date reached: 20261001-01 \(2026-10-02\), 20261001-02 \(2026-10-03\)\. check against this session: 20261001-05 \(when the vendor ships v2\)\. 2 wait for a later date \(next 2026-10-08\)\./)
  assert.match(st, /Due: overdue: 20261001-06 \(2026-10-01\)\. due today: 20261001-07\. 1 due later \(next 2026-10-30\)\./)
  assert.ok(!st.includes('20261001-03') && !st.includes('20261001-04'), 'future dates are counted, not listed')
  const json = runJson(['status'], { cwd: dir }).json
  assert.deepEqual(json.dated.reached.map((x) => x.id), ['20261001-01', '20261001-02'])
  assert.equal(json.dated.later, 2)

  const sp = runJson(['save', '--prepare', '--dry-run'], { cwd: dir }).json
  const j = sp.judgment.join('\n')
  assert.match(j, /parked: revive date reached, revive or re-park: 20261001-01 \(revive-on 2026-10-02\); 20261001-02 \(revive-when 2026-10-03\)/)
  assert.match(j, /parked: check each revive-when against this session: 20261001-05 \(when the vendor ships v2\)/)
  assert.match(j, /parked: 2 items wait for a later date \(next 2026-10-08\); strata due lists them/)
  assert.match(j, /due: 20261001-06 overdue since 2026-10-01; 20261001-07 due today/)
  assert.ok(!/20261001-03|20261001-04/.test(j))
  rm(dir)
})

test('strata due lists dated items in the next N days, passed dates first', () => {
  const dir = gitProject()
  backlog(dir)
  const r = runJson(['due'], { cwd: dir }).json
  assert.deepEqual(r.items.map((x) => [x.id, x.state]), [
    ['20261001-06', 'overdue'], ['20261001-01', 'reached'], ['20261001-02', 'reached'], ['20261001-07', 'today'], ['20261001-03', 'later'],
  ])
  assert.equal(r.beyond, 2)
  const text = run(['due', '--days', '30'], { cwd: dir }).stdout
  assert.match(text, /2026-10-30 {2}in 27 days/)
  assert.match(text, /2026-10-20 {2}in 17 days/)
  assert.equal(run(['due', '--days', 'x'], { cwd: dir }).status, 2)
  rm(dir)
})

test('PARKED shows a revive-on date; check accepts it and rejects bad dates', () => {
  const dir = gitProject()
  issue(dir, { id: '20261001-01', slug: 'a', status: 'parked', reviveOn: '2026-10-12', what: 'Dated only' })
  issue(dir, { id: '20261001-02', slug: 'b', status: 'open', due: '2026-10-32' })
  run(['views'], { cwd: dir })
  assert.match(read(dir, '.strata/issues/PARKED.md'), /\| \[20261001-01\]\(20261001-01-a\.md\) \| Dated only \| on or after 2026-10-12 \|/)
  const codes = runJson(['check'], { cwd: dir }).json.findings.map((f) => f.code)
  assert.ok(!codes.includes('parked-no-revive'), 'revive-on alone is a trigger')
  assert.ok(codes.includes('bad-date'))
  rm(dir)
})
