import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { gitProject, run, runJson, rm, read, write, cleanEnv, repoRoot } from './helpers.mjs'
import { parseFrontmatter } from '../skills/strata/scripts/lib/frontmatter.mjs'
import { globToRegex, pathTokens, patchPaths, buildTriggerIndex, matchLessons, subjectOf, indexPath } from '../skills/strata/scripts/lib/triggers.mjs'
import { lessonsFor } from '../hooks/strata-lesson-trigger.mjs'

const hookPath = path.join(repoRoot, 'hooks', 'strata-lesson-trigger.mjs')

function lesson(dir, slug, { trigger = 'before something', match, paths, text = 'Do it the safe way. Then go on.' } = {}) {
  const fm = [`trigger: ${trigger}`, 'origin: failure']
  if (match) fm.push('match:', ...match.map((m) => `  - '${m}'`))
  if (paths) fm.push('paths:', ...paths.map((p) => `  - '${p}'`))
  return write(dir, `.strata/memory/learnings/${slug}.md`, `---\n${fm.join('\n')}\n---\n\n**Lesson:** ${text}\n`)
}

function runHook(payload, env = {}) {
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [hookPath], { input: JSON.stringify(payload), encoding: 'utf8', env: cleanEnv(env) })
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', ms: Date.now() - t0 }
}

const bash = (dir, command, extra = {}) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: dir, session_id: 's1', ...extra })
const edit = (dir, file, tool = 'Edit') => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { file_path: file }, cwd: dir, session_id: 's1' })
const NOREPEAT = { STRATA_LESSON_REPEAT_MINUTES: '0' }

test('frontmatter reads block and inline lists', () => {
  const fm = parseFrontmatter("---\ntrigger: x\nmatch:\n  - 'pgrep\\s+-f'\n  - \"git push\"\npaths: ['**/*.ps1', scripts/*.sh]\norigin: failure\n---\nbody").data
  assert.deepEqual(fm.match, ['pgrep\\s+-f', 'git push'])
  assert.deepEqual(fm.paths, ['**/*.ps1', 'scripts/*.sh'])
  assert.equal(fm.origin, 'failure')
})

test('globs: relative, any-folder file names, braces, trailing slash', () => {
  const t = (g, p) => new RegExp(globToRegex(g)).test(p)
  assert.ok(t('*.ps1', 'scripts/deploy.ps1'))
  assert.ok(t('**/*.ps1', 'deploy.ps1'))
  assert.ok(!t('scripts/*.sh', 'scripts/sub/a.sh'))
  assert.ok(t('scripts/**/*.sh', 'scripts/sub/a.sh'))
  assert.ok(t('src/{api,ui}/*.ts', 'src/ui/x.ts'))
  assert.ok(!t('src/{api,ui}/*.ts', 'src/db/x.ts'))
  assert.ok(t('.strata/issues/', '.strata/issues/20261010-01-x.md'))
  assert.ok(t('./docs/*.md', 'docs/a.md'))
})

test('path tokens and patch headers are pulled out of a command', () => {
  assert.deepEqual(pathTokens('cat "docs/a b.md" && grep -r foo src/ --include=*.ts | head'), ['docs/a b.md', 'src/'])
  assert.deepEqual(pathTokens('curl https://example.com/x.json -o out.json'), ['out.json'])
  assert.deepEqual(patchPaths('*** Begin Patch\n*** Update File: src/a.ts\n@@\n*** Add File: b.md\n*** End Patch'), ['src/a.ts', 'b.md'])
})

test('views compile match: and paths: into a git-ignored index; check reports bad patterns', () => {
  const dir = gitProject()
  lesson(dir, 'pgrep-self', { trigger: 'before waiting on a background process', match: ['pgrep\\s+-f'], text: 'Never wait on pgrep -f with your own pattern. It matches the waiter itself.' })
  lesson(dir, 'plain', { trigger: 'when nothing matches' })
  lesson(dir, 'broken', { match: ['(unclosed'] })
  const v = runJson(['views'], { cwd: dir }).json
  assert.equal(v.triggers.rules, 1)
  const idx = JSON.parse(fs.readFileSync(indexPath(dir), 'utf8'))
  assert.deepEqual(idx.rules.map((r) => r.file), ['.strata/memory/learnings/pgrep-self.md'])
  assert.equal(idx.rules[0].lesson, 'Never wait on pgrep -f with your own pattern.')
  assert.equal(spawnSync('git', ['status', '--porcelain', '--', '.strata/inbox'], { cwd: dir, encoding: 'utf8', env: cleanEnv() }).stdout, '', 'the index is git-ignored')
  const c = runJson(['check'], { cwd: dir }).json
  const bad = c.findings.filter((f) => f.code === 'learning-bad-match')
  assert.equal(bad.length, 1)
  assert.match(bad[0].path, /broken\.md/)
  rm(dir)
})

test('the hook returns the matching lesson for a Bash command and stays silent otherwise', () => {
  const dir = gitProject()
  lesson(dir, 'pgrep-self', { trigger: 'before waiting on a background process', match: ['pgrep\\s+-f'], text: 'Never wait on pgrep -f with your own pattern. It matches the waiter itself.' })
  run(['views'], { cwd: dir })
  const hit = runHook(bash(dir, 'while pgrep -f "my-job" >/dev/null; do sleep 5; done'), NOREPEAT)
  assert.equal(hit.status, 0)
  const out = JSON.parse(hit.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined, 'never a permission decision')
  assert.equal(out.hookSpecificOutput.updatedInput, undefined, 'never changes the call')
  assert.match(out.hookSpecificOutput.additionalContext, /Before waiting on a background process:\*\* Never wait on pgrep -f with your own pattern\. \(\.strata\/memory\/learnings\/pgrep-self\.md\)/)
  const miss = runHook(bash(dir, 'ls -la'), NOREPEAT)
  assert.equal(miss.status, 0)
  assert.equal(miss.stdout, '', 'silent when nothing matches')
  rm(dir)
})

test('paths: fire for Edit, Write, MultiEdit and for paths named in a Bash command', () => {
  const dir = gitProject()
  lesson(dir, 'registry', { trigger: 'after changing a skill file', paths: ['skills/**/SKILL.md'], text: 'Refresh the skill registry after you merge skill files.' })
  run(['views'], { cwd: dir })
  for (const tool of ['Edit', 'Write', 'MultiEdit']) {
    const r = runHook(edit(dir, path.join(dir, 'skills', 'x', 'SKILL.md'), tool), NOREPEAT)
    assert.match(r.stdout, /registry\.md/, tool)
  }
  assert.match(runHook(bash(dir, 'git mv skills/a/SKILL.md skills/b/SKILL.md'), NOREPEAT).stdout, /registry\.md/)
  assert.equal(runHook(edit(dir, path.join(dir, 'README.md')), NOREPEAT).stdout, '')
  // Codex: apply_patch carries the files in the patch text.
  const codex = { hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: skills/x/SKILL.md\n*** End Patch' }, cwd: dir }
  assert.match(runHook(codex, NOREPEAT).stdout, /registry\.md/)
  rm(dir)
})

test('at most three lessons, in file order', () => {
  const dir = gitProject()
  for (const s of ['a', 'b', 'c', 'd']) lesson(dir, `push-${s}`, { trigger: `before push ${s}`, match: ['git push'] })
  run(['views'], { cwd: dir })
  const ctx = JSON.parse(runHook(bash(dir, 'git push origin main'), NOREPEAT).stdout).hookSpecificOutput.additionalContext
  assert.deepEqual(ctx.split('\n').filter((l) => l.startsWith('- ')).map((l) => /push-(\w)\.md/.exec(l)[1]), ['a', 'b', 'c'])
  rm(dir)
})

test('a lesson is not repeated in the same session within the repeat window', () => {
  const dir = gitProject()
  lesson(dir, 'push', { match: ['git push'] })
  run(['views'], { cwd: dir })
  const p = bash(dir, 'git push')
  const t = Date.parse('2026-10-10T10:00:00Z')
  assert.ok(lessonsFor(p, { env: {}, now: t }))
  assert.equal(lessonsFor(p, { env: {}, now: t + 5 * 60000 }), null, 'suppressed within 30 minutes')
  assert.ok(lessonsFor({ ...p, session_id: 's2' }, { env: {}, now: t + 5 * 60000 }), 'another session sees it')
  assert.ok(lessonsFor(p, { env: {}, now: t + 31 * 60000 }), 'shown again after the window')
  assert.ok(lessonsFor(p, { env: { STRATA_LESSON_REPEAT_MINUTES: '0' }, now: t + 32 * 60000 }))
  rm(dir)
})

test('off switch, non-strata folders and garbage input stay silent and exit 0', () => {
  const dir = gitProject()
  lesson(dir, 'push', { match: ['git push'] })
  run(['views'], { cwd: dir })
  assert.equal(runHook(bash(dir, 'git push'), { STRATA_LESSON_TRIGGERS: '0' }).stdout, '')
  const outside = fs.mkdtempSync(path.join(path.dirname(dir), 'plain-'))
  assert.equal(runHook(bash(outside, 'git push')).stdout, '')
  const g = spawnSync(process.execPath, [hookPath], { input: 'not json{', encoding: 'utf8', env: cleanEnv() })
  assert.equal(g.status, 0)
  assert.equal(g.stdout, '')
  rm(outside)
  rm(dir)
})

test('a stale or missing index is rebuilt by the hook once', () => {
  const dir = gitProject()
  lesson(dir, 'push', { match: ['git push'] })
  assert.ok(!fs.existsSync(indexPath(dir)), 'no index before views')
  assert.match(runHook(bash(dir, 'git push'), NOREPEAT).stdout, /push\.md/)
  assert.ok(fs.existsSync(indexPath(dir)), 'the hook wrote it')
  lesson(dir, 'rebase', { match: ['git rebase'] })
  assert.match(runHook(bash(dir, 'git rebase main'), NOREPEAT).stdout, /rebase\.md/, 'a new learning is picked up without strata views')
  rm(dir)
})

test('the hook is fast: one call well under the host timeout, matching is cheap', () => {
  const dir = gitProject()
  for (let i = 0; i < 60; i++) lesson(dir, `l${String(i).padStart(2, '0')}`, { match: [`tool-${i}\\b`], paths: [`area${i}/**`] })
  run(['views'], { cwd: dir })
  runHook(bash(dir, 'echo warm'), NOREPEAT)
  const r = runHook(bash(dir, 'tool-42 --flag area42/x.txt'), NOREPEAT)
  assert.match(r.stdout, /l42\.md/)
  assert.ok(r.ms < 2000, `hook took ${r.ms} ms`)
  const index = buildTriggerIndex(dir)
  const subject = subjectOf(bash(dir, 'tool-59 area59/a/b.c'), dir)
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < 100; i++) matchLessons(index, subject)
  const perCall = Number(process.hrtime.bigint() - t0) / 1e6 / 100
  assert.ok(perCall < 20, `matching took ${perCall} ms per call`)
  rm(dir)
})

test('strata triggers shows which lessons fire for a command or a path', () => {
  const dir = gitProject()
  lesson(dir, 'push', { trigger: 'before pushing', match: ['(?i)GIT PUSH'] })
  lesson(dir, 'ps1', { trigger: 'when editing PowerShell', paths: ['*.ps1'] })
  const a = run(['triggers', '--command', 'git push'], { cwd: dir })
  assert.equal(a.status, 0, a.stderr)
  assert.match(a.stdout, /2 learnings with match: or paths:/)
  assert.match(a.stdout, /Before pushing/)
  const b = run(['triggers', '--path', 'tools/setup.ps1'], { cwd: dir })
  assert.match(b.stdout, /When editing PowerShell/)
  assert.match(run(['triggers', '--command', 'ls'], { cwd: dir }).stdout, /No learning fires/)
  rm(dir)
})

test('the plugin wires the lesson trigger for Claude and the Codex sample', () => {
  const claude = JSON.parse(read(repoRoot, 'hooks/hooks.json'))
  const pre = claude.hooks.PreToolUse[0]
  assert.match(pre.matcher, /Bash/)
  assert.match(pre.matcher, /Edit/)
  assert.match(pre.hooks[0].command, /strata-lesson-trigger\.mjs/)
  const codex = JSON.parse(read(repoRoot, 'hooks/codex-hooks.sample.json'))
  assert.match(codex.hooks.PreToolUse[0].matcher, /apply_patch/)
  assert.match(codex.hooks.PreToolUse[0].hooks[0].command, /strata-lesson-trigger\.mjs/)
})
