import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { gitProject, run, runJson, rm, read, write, git } from './helpers.mjs'

const STATE = '.strata/memory/project_state.md'

function setKey(dir, line) {
  write(dir, '.strata/MANIFEST.md', read(dir, '.strata/MANIFEST.md').replace('layout_version: 3\n', `layout_version: 3\n${line}\n`))
}

// The shape the Paperclip project writes: no "session N" anywhere.
const PAPERCLIP = ['---', 'name: State', 'description: x', '---', '',
  '## CURRENT, Sunday 2026-10-11: release checks', 'now', '',
  '## LAST COMPLETED — 2026-10-06 to 10-10 brief repair', 'last', '',
  '## Standing notes', 'kept', '',
  '## LAST COMPLETED — 2026-09-28 to 10-03 roster move', 'older', ''].join('\n')

test('session_heading rolls every matching block after the first two, named by the first date', () => {
  const dir = gitProject()
  setKey(dir, "session_heading: '^(CURRENT|LAST COMPLETED)\\b'")
  write(dir, STATE, PAPERCLIP)
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'state')

  const dry = runJson(['save', '--prepare', '--dry-run'], { cwd: dir }).json
  assert.ok(dry.changed.includes('roll 1 session block (LAST COMPLETED — 2026-09-28 to 10-03 roster move) from project_state.md -> .strata/memory/archive/2026-10-sessions-2026-09-28.md (+ ARCHIVE.md row)'), JSON.stringify(dry.changed))
  assert.equal(read(dir, STATE), PAPERCLIP, 'dry run writes nothing')

  runJson(['save', '--prepare'], { cwd: dir })
  const ps = read(dir, STATE)
  assert.match(ps, /## CURRENT, Sunday 2026-10-11/)
  assert.match(ps, /## LAST COMPLETED — 2026-10-06/)
  assert.match(ps, /## Standing notes\nkept/)
  assert.ok(!ps.includes('roster move') && !ps.includes('older'))
  const rolled = read(dir, '.strata/memory/archive/2026-10-sessions-2026-09-28.md')
  assert.match(rolled, /^# Sessions from project_state\.md\n\nRolled out of `project_state\.md` by `\/strata:save` on 2026-10-03\.\n\n## LAST COMPLETED — 2026-09-28 to 10-03 roster move\nolder\n$/)
  assert.match(read(dir, '.strata/memory/archive/ARCHIVE.md'), /\| `2026-10-sessions-2026-09-28\.md` \| 1 session block rolled from project_state\.md on 2026-10-03: LAST COMPLETED — 2026-09-28 to 10-03 roster move \|/)

  const again = runJson(['save', '--prepare'], { cwd: dir }).json
  assert.ok(!again.changed.some((c) => c.startsWith('roll ')), 'a re-run rolls nothing')
  assert.equal(runJson(['check'], { cwd: dir }).status, 0)
  rm(dir)
})

test('session_heading is case-insensitive and falls back to today when the rolled headings carry no date', () => {
  const dir = gitProject()
  setKey(dir, "session_heading: '^(current|last completed)'")
  write(dir, STATE, ['## Current', 'a', '', '## Last completed', 'b', '', '## Last completed, earlier', 'c', '', '## Last completed, much earlier', 'd', ''].join('\n'))
  const res = runJson(['save', '--prepare'], { cwd: dir }).json
  assert.ok(res.changed.some((c) => c.startsWith('roll 2 session blocks (Last completed, earlier; Last completed, much earlier)')), JSON.stringify(res.changed))
  assert.match(read(dir, '.strata/memory/archive/2026-10-sessions-2026-10-03.md'), /## Last completed, earlier\nc\n\n## Last completed, much earlier\nd\n$/)
  assert.equal(read(dir, STATE), '## Current\na\n\n## Last completed\nb\n')
  rm(dir)
})

test('without session_heading these headings never roll', () => {
  const dir = gitProject()
  write(dir, STATE, PAPERCLIP)
  const res = runJson(['save', '--prepare'], { cwd: dir }).json
  assert.ok(!res.changed.some((c) => c.startsWith('roll ')))
  assert.equal(read(dir, STATE), PAPERCLIP)
  rm(dir)
})

test('an invalid session_heading is a check error, and save skips rolling with a judgment line', () => {
  const dir = gitProject()
  setKey(dir, "session_heading: '^(CURRENT|LAST COMPLETED'")
  write(dir, STATE, PAPERCLIP)
  const chk = runJson(['check'], { cwd: dir })
  assert.equal(chk.status, 1)
  assert.ok(chk.json.findings.some((f) => f.code === 'manifest-session-heading' && f.level === 'error'), JSON.stringify(chk.json.findings))
  const res = runJson(['save', '--prepare'], { cwd: dir }).json
  assert.ok(!res.changed.some((c) => c.startsWith('roll ')))
  assert.ok(res.judgment.some((j) => /^session_heading in MANIFEST\.md is not a valid regular expression, so no sessions were rolled\./.test(j)), JSON.stringify(res.judgment))
  assert.equal(read(dir, STATE), PAPERCLIP)
  assert.ok(!fs.existsSync(path.join(dir, '.strata/memory/archive/2026-10-sessions-2026-09-28.md')))
  rm(dir)
})

test('a pattern in double quotes loses its \\b, and check says to use single quotes', () => {
  const dir = gitProject()
  setKey(dir, 'session_heading: "^(CURRENT|LAST COMPLETED)\\b"')
  const chk = runJson(['check'], { cwd: dir })
  const f = chk.json.findings.find((x) => x.code === 'manifest-session-heading')
  assert.ok(f, JSON.stringify(chk.json.findings))
  assert.match(f.detail, /single quotes/)
  rm(dir)
})
