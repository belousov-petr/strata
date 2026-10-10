import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { gitProject, run, runJson, rm, issue, write } from './helpers.mjs'

function legacyWarnings(dir) {
  // Old-style ids and missing optional fields: warnings, not errors.
  for (let n = 1; n <= 4; n++) write(dir, `.strata/issues/old-${n}.md`, `---\nid: OLD-${n}\ntype: task\nstatus: open\nseverity: low\n---\n\n**What:** Legacy ${n}\n`)
  run(['views'], { cwd: dir })
}

test('check --baseline records the warnings; later runs show only new ones plus one count line', () => {
  const dir = gitProject()
  legacyWarnings(dir)
  const before = runJson(['check'], { cwd: dir }).json
  assert.ok(before.warnings >= 8, `expected legacy warnings, got ${before.warnings}`)

  const b = run(['check', '--baseline'], { cwd: dir })
  assert.equal(b.status, 0, b.stdout + b.stderr)
  assert.match(b.stdout, new RegExp(`baseline written: ${before.warnings} warnings in \\.strata/check-baseline\\.json`))
  const file = JSON.parse(fs.readFileSync(path.join(dir, '.strata/check-baseline.json'), 'utf8'))
  assert.equal(file.warnings.length, before.warnings)

  const quiet = run(['check'], { cwd: dir })
  assert.equal(quiet.status, 0)
  assert.match(quiet.stdout, /^strata check: ok \(0 warnings\)\n {2}\d+ known warnings not shown \(baselined in \.strata\/check-baseline\.json on 2026-10-03; strata check --all lists them\)\n$/)

  write(dir, '.strata/issues/old-5.md', '---\nid: OLD-5\ntype: task\nstatus: open\nseverity: low\n---\n\n**What:** New legacy\n')
  run(['views'], { cwd: dir })
  const fresh = runJson(['check'], { cwd: dir }).json
  assert.ok(fresh.findings.length >= 1 && fresh.findings.every((f) => /old-5\.md/.test(f.path)), JSON.stringify(fresh.findings))
  assert.equal(fresh.baselined, before.warnings)
  assert.equal(runJson(['check', '--all'], { cwd: dir }).json.baselined, 0)
  rm(dir)
})

test('errors are never baselined', () => {
  const dir = gitProject()
  issue(dir, { id: '20261003-01', slug: 'p', status: 'parked' }) // parked without a trigger: an error
  const b = run(['check', '--baseline'], { cwd: dir })
  assert.equal(b.status, 1)
  assert.match(b.stdout, /Errors are never baselined\. Fix these 2:\n {2}\[error\]/)
  const c = runJson(['check'], { cwd: dir })
  assert.equal(c.status, 1)
  assert.ok(c.json.findings.some((f) => f.code === 'parked-no-revive'))
  rm(dir)
})
