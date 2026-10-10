import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { gitProject, runJson, rm, read, write, issue, git } from './helpers.mjs'

const README = [
  '# Closed work',
  '',
  'Everything we finished, newest last.',
  '',
  '| Issue | Title | Outcome | Closed on | Notes |',
  '|---|---|---|---|---|',
  '| [20260901-01](20260901-01-old.md) | An old one | resolved | 2026-09-02 | — |',
  '',
  'Grep this folder for more.',
  '',
].join('\n')

function setManifestKey(dir, line) {
  write(dir, '.strata/MANIFEST.md', read(dir, '.strata/MANIFEST.md').replace('layout_version: 3\n', `layout_version: 3\n${line}\n`))
}

test('archive_index in the MANIFEST sends rows to that file only, in its own columns', () => {
  const dir = gitProject()
  write(dir, '.strata/issues/archive/README.md', README)
  setManifestKey(dir, 'archive_index: README.md')
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'readme index')
  const indexBefore = read(dir, '.strata/issues/archive/INDEX.md')
  issue(dir, { id: '20261003-01', slug: 'done', status: 'resolved', what: 'Done now' })
  const res = runJson(['save', '--prepare'], { cwd: dir }).json
  assert.ok(res.changed.includes('append 1 row to .strata/issues/archive/README.md'), JSON.stringify(res.changed))
  const after = read(dir, '.strata/issues/archive/README.md')
  const lines = after.split('\n')
  const at = lines.indexOf('| [20261003-01](20261003-01-done.md) | Done now | resolved | 2026-10-03 |  |')
  assert.ok(at > 0, after)
  assert.equal(lines[at - 1], '| [20260901-01](20260901-01-old.md) | An old one | resolved | 2026-09-02 | — |', 'appended right after the last row')
  assert.ok(after.endsWith('Grep this folder for more.\n'), 'text after the table is kept')
  assert.equal(read(dir, '.strata/issues/archive/INDEX.md'), indexBefore, 'INDEX.md is not touched')
  rm(dir)
})

test('without the key, an existing README.md archive table is detected', () => {
  const dir = gitProject()
  fs.rmSync(path.join(dir, '.strata/issues/archive/INDEX.md'))
  write(dir, '.strata/issues/archive/README.md', README)
  issue(dir, { id: '20261003-02', slug: 'x', status: 'wont-fix', what: 'Not now' })
  runJson(['save', '--prepare'], { cwd: dir })
  assert.match(read(dir, '.strata/issues/archive/README.md'), /\| \[20261003-02\]\(20261003-02-x\.md\) \| Not now \| wont-fix \| 2026-10-03 \|/)
  assert.ok(!fs.existsSync(path.join(dir, '.strata/issues/archive/INDEX.md')), 'no INDEX.md is created')
  rm(dir)
})

test('a README.md without a table does not capture the rows; INDEX.md stays the default', () => {
  const dir = gitProject()
  write(dir, '.strata/issues/archive/README.md', '# Archive\n\nClosed issues live here.\n')
  issue(dir, { id: '20261003-03', slug: 'y', status: 'resolved', what: 'Fixed' })
  runJson(['save', '--prepare'], { cwd: dir })
  assert.equal(read(dir, '.strata/issues/archive/README.md'), '# Archive\n\nClosed issues live here.\n')
  assert.match(read(dir, '.strata/issues/archive/INDEX.md'), /\| \[20261003-03\]\(20261003-03-y\.md\) \| resolved \| 2026-10-03 \| Fixed \|/)
  rm(dir)
})

test('check rejects an archive_index that is not a file name in the archive folder', () => {
  const dir = gitProject()
  setManifestKey(dir, 'archive_index: ../OPEN.md')
  const c = runJson(['check'], { cwd: dir }).json
  assert.ok(c.findings.some((f) => f.code === 'manifest-archive-index'))
  rm(dir)
})
