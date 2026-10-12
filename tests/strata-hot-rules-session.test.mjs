import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { gitProject, run, runJson, rm, read, write, learning, git, cleanEnv, hookPath, repoRoot } from './helpers.mjs'
import { withHotRules, parseSettings, CONTEXT_BUDGET } from '../hooks/strata-capture-guard.mjs'
import { POINTER, CAPTURE_RULE } from '../skills/strata/scripts/lib/adapters.mjs'

const HOT = '.strata/memory/HOT-RULES.md'
const lessonHook = path.join(repoRoot, 'hooks', 'strata-lesson-trigger.mjs')

function setKeys(dir, ...lines) {
  write(dir, '.strata/MANIFEST.md', read(dir, '.strata/MANIFEST.md').replace('layout_version: 3\n', `layout_version: 3\n${lines.join('\n')}\n`))
}
const inner = (text) => /<!-- strata:hot-rules:begin -->\n([\s\S]*?)\n<!-- strata:hot-rules:end -->/.exec(text)[1]

function hook(file, payload, env = {}) {
  const r = spawnSync(process.execPath, [file], { input: JSON.stringify(payload), encoding: 'utf8', env: cleanEnv(env) })
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}
function sessionStart(dir, env = {}, source = 'startup') {
  const r = hook(hookPath, { hook_event_name: 'SessionStart', cwd: dir, source, session_id: 's1' }, env)
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext
}
function inboxFiles(dir) {
  try { return fs.readdirSync(path.join(dir, '.strata/inbox')).sort() } catch { return [] }
}

function sessionProject() {
  const dir = gitProject()
  setKeys(dir, 'hot_rules: session')
  learning(dir, { slug: 'push-lint', trigger: 'before pushing to a shared branch', hot: true, lesson: 'Run the repo lint first. The hook only catches secrets.' })
  learning(dir, { slug: 'niche', trigger: 'when editing the legacy importer', hot: false })
  return dir
}

test('default mode is unchanged: the rules stay in the adapters and no HOT-RULES.md appears', () => {
  for (const key of [null, 'hot_rules: adapters']) {
    const dir = gitProject()
    if (key) setKeys(dir, key)
    learning(dir, { slug: 'push-lint', trigger: 'before pushing', hot: true, lesson: 'Run the lint first.' })
    const r = runJson(['views'], { cwd: dir }).json
    assert.deepEqual(r.hot.results.map((x) => x.file), ['CLAUDE.md', 'AGENTS.md'])
    assert.match(read(dir, 'CLAUDE.md'), /- \*\*Before pushing:\*\* Run the lint first\. \(\[rule\]\(\.strata\/memory\/learnings\/push-lint\.md\)\)/)
    assert.ok(!fs.existsSync(path.join(dir, HOT)))
    assert.ok(!sessionStart(dir).includes('Hot rules from strata'), 'SessionStart carries no rules in adapters mode')
    run(['setup'], { cwd: dir })
    assert.ok(!read(dir, '.gitattributes').includes('HOT-RULES.md'))
    assert.equal(runJson(['check'], { cwd: dir }).status, 0)
    rm(dir)
  }
})

test('session mode: one pointer line in both adapters, the whole block in HOT-RULES.md', () => {
  const dir = sessionProject()
  write(dir, 'CLAUDE.md', read(dir, 'CLAUDE.md') + '\n## My own notes\n\nKeep this exactly.\n')
  const before = read(dir, 'CLAUDE.md')
  const r = runJson(['views'], { cwd: dir }).json
  assert.deepEqual(r.hot.results.map((x) => [x.file, x.state]), [['CLAUDE.md', 'updated'], ['AGENTS.md', 'updated'], [HOT, 'created']])
  for (const a of ['CLAUDE.md', 'AGENTS.md']) assert.equal(inner(read(dir, a)), POINTER, a)
  const strip = (s) => s.replace(/<!-- strata:hot-rules:begin -->[\s\S]*<!-- strata:hot-rules:end -->/, '')
  assert.equal(strip(read(dir, 'CLAUDE.md')), strip(before), 'text outside the markers is untouched')
  const hot = read(dir, HOT)
  assert.ok(hot.startsWith('<!-- strata:hot-rules:begin -->\n## Hot rules from strata\n'))
  assert.ok(hot.includes(CAPTURE_RULE))
  assert.match(hot, /- \*\*Before pushing to a shared branch:\*\* Run the repo lint first\. \(\[rule\]\(learnings\/push-lint\.md\)\)\n<!-- strata:hot-rules:end -->\n$/)
  assert.ok(!hot.includes('legacy importer'))
  assert.equal(runJson(['views'], { cwd: dir }).json.hot.results.every((x) => x.state === 'current'), true, 'a re-run changes nothing')
  rm(dir)
})

test('check passes after views and reports drift when HOT-RULES.md or an adapter is stale', () => {
  const dir = sessionProject()
  assert.equal(run(['setup'], { cwd: dir }).status, 0)
  assert.match(read(dir, '.gitattributes'), /^\.strata\/memory\/HOT-RULES\.md merge=strata-views$/m)
  run(['views'], { cwd: dir })
  const ok = runJson(['check'], { cwd: dir })
  assert.equal(ok.status, 0, JSON.stringify(ok.json.findings))
  learning(dir, { slug: 'new-rule', trigger: 'before a release', hot: true })
  const stale = runJson(['check'], { cwd: dir })
  assert.equal(stale.status, 1)
  assert.deepEqual(stale.json.findings.filter((f) => f.code === 'hot-rules-drift').map((f) => f.path), [HOT])
  assert.match(run(['status'], { cwd: dir }).stdout, /\.strata\/memory\/HOT-RULES\.md \(hot-rules block\)/)
  run(['views'], { cwd: dir })
  // An adapter that still carries the full block is drift in session mode.
  write(dir, 'AGENTS.md', read(dir, 'AGENTS.md').replace(POINTER, '## Hot rules from strata\n\n- old rules'))
  assert.deepEqual(runJson(['check'], { cwd: dir }).json.findings.filter((f) => f.code === 'hot-rules-drift').map((f) => f.path), ['AGENTS.md'])
  const sp = runJson(['save', '--prepare'], { cwd: dir }).json
  assert.ok(sp.changed.some((c) => c.includes('AGENTS.md (hot rules)')))
  assert.equal(runJson(['check'], { cwd: dir }).status, 0)
  rm(dir)
})

test('check: a bad hot_rules or agent_env value is an error, and a missing attributes line a warning', () => {
  const dir = gitProject()
  setKeys(dir, 'hot_rules: sessions', 'agent_env: [GOOD_NAME, bad-name]')
  const c = runJson(['check'], { cwd: dir }).json.findings
  assert.ok(c.some((f) => f.code === 'manifest-hot-rules' && f.level === 'error'))
  assert.ok(c.some((f) => f.code === 'manifest-agent-env' && /'bad-name'/.test(f.detail)))
  assert.ok(!fs.existsSync(path.join(dir, HOT)) && !runJson(['views'], { cwd: dir }).json.hot.results.some((x) => x.file === HOT), 'an unknown mode works as adapters')
  const s = gitProject()
  run(['setup'], { cwd: s })
  setKeys(s, 'hot_rules: session')
  run(['views'], { cwd: s })
  assert.ok(runJson(['check'], { cwd: s }).json.findings.some((f) => f.code === 'merge-driver-hot-rules' && f.level === 'warn'))
  run(['setup'], { cwd: s })
  assert.ok(!runJson(['check'], { cwd: s }).json.findings.some((f) => f.code === 'merge-driver-hot-rules'))
  rm(s)
  rm(dir)
})

test('SessionStart hands the rules to the session in session mode, on every source', () => {
  const dir = sessionProject()
  run(['views'], { cwd: dir })
  for (const source of ['startup', 'resume', 'clear', 'compact']) {
    const ctx = sessionStart(dir, {}, source)
    assert.match(ctx, /pending-capture journal/)
    assert.match(ctx, /\n\n## Hot rules from strata\n/)
    assert.ok(ctx.includes(CAPTURE_RULE))
    assert.match(ctx, /- \*\*Before pushing to a shared branch:\*\* Run the repo lint first\. \(\[rule\]\(\.strata\/memory\/learnings\/push-lint\.md\)\)$/, 'links point from the project root')
    assert.ok(!ctx.includes('strata:hot-rules:begin'))
  }
  // Without the file the hook renders the rules itself.
  fs.rmSync(path.join(dir, HOT))
  assert.match(sessionStart(dir), /\(\[rule\]\(\.strata\/memory\/learnings\/push-lint\.md\)\)$/)
  rm(dir)
})

test('the SessionStart budget: at most 9,500 characters, whole rule lines, then a count line', () => {
  const dir = gitProject()
  setKeys(dir, 'hot_rules: session')
  const long = 'x'.repeat(150)
  for (let i = 0; i < 25; i++) {
    const n = String(i).padStart(2, '0')
    learning(dir, { slug: `rule-${n}`, trigger: `before step ${n} ${long}`, hot: true, lesson: `Step ${n} needs care ${'y'.repeat(190)}. More text.` })
  }
  run(['views'], { cwd: dir })
  const file = read(dir, HOT)
  const ruleLines = file.split('\n').filter((l) => l.startsWith('- **')).map((l) => l.replace(/\]\(learnings\//, '](.strata/memory/learnings/'))
  assert.equal(ruleLines.length, 25)
  const ctx = sessionStart(dir)
  assert.ok(ctx.length <= 9500, `${ctx.length} characters`)
  const shown = ctx.split('\n').filter((l) => l.startsWith('- **'))
  assert.ok(shown.length > 5 && shown.length < 25, `${shown.length} rules shown`)
  for (const l of shown) assert.ok(ruleLines.includes(l), 'every rule line is whole')
  assert.equal(ctx.split('\n').pop(), `- ${25 - shown.length} more hot rules in .strata/memory/HOT-RULES.md`)
  rm(dir)
})

test('withHotRules: everything when it fits, whole lines and the count when it does not', () => {
  const rules = ['## Hot rules from strata', '', 'Capture rule.', '', ...Array.from({ length: 10 }, (_, i) => `- **Rule ${i}:** ${'z'.repeat(80)} ([rule](.strata/memory/learnings/r${i}.md))`)].join('\n')
  assert.equal(withHotRules('Base.', rules), `Base.\n\n${rules}`)
  const cut = withHotRules('Base.', rules, 400)
  assert.ok(cut.length <= 400)
  assert.ok(cut.startsWith('Base.\n\n## Hot rules from strata\n\nCapture rule.\n\n- **Rule 0:**'))
  const lines = cut.split('\n')
  const n = lines.filter((l) => l.startsWith('- **')).length
  assert.equal(lines.pop(), `- ${10 - n} more hot rules in .strata/memory/HOT-RULES.md`)
  assert.equal(withHotRules('Base.', null), 'Base.')
  assert.equal(CONTEXT_BUDGET, 9500)
})

test('agent_env silences both hooks and nothing reaches the inbox; an empty value does not', () => {
  const dir = sessionProject()
  setKeys(dir, 'agent_env: [PAPERCLIP_AGENT_ID, PAPERCLIP_RUN_ID]')
  write(dir, '.strata/memory/learnings/push-guard.md', "---\ntrigger: before git push\norigin: failure\nmatch:\n  - 'git push'\n---\n\n**Lesson:** Pull first.\n")
  run(['views'], { cwd: dir })
  fs.rmSync(path.join(dir, '.strata/inbox/lesson-triggers.json'), { force: true })
  const before = inboxFiles(dir)
  const failure = { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'Exit code 1\nfailed', cwd: dir, tool_use_id: 't1' }
  const pre = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: dir, session_id: 's1' }
  const agent = { PAPERCLIP_RUN_ID: 'run-42', STRATA_FAILURE_NUDGE: '1' }
  for (const [file, payload] of [[hookPath, failure], [hookPath, { hook_event_name: 'SessionStart', cwd: dir, source: 'startup' }], [lessonHook, pre]]) {
    const r = hook(file, payload, agent)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '', `${path.basename(file)} ${payload.hook_event_name} is silent`)
    assert.equal(r.stderr, '')
  }
  assert.deepEqual(inboxFiles(dir), before, 'nothing written to the inbox')

  const human = { PAPERCLIP_RUN_ID: '', PAPERCLIP_AGENT_ID: '' }
  assert.equal(hook(hookPath, failure, human).status, 0)
  assert.ok(fs.readFileSync(path.join(dir, '.strata/inbox/captures.jsonl'), 'utf8').includes('npm test'), 'an empty value does not silence the guard')
  assert.match(sessionStart(dir, human), /Hot rules from strata/)
  assert.match(hook(lessonHook, pre, human).stdout, /push-guard\.md/, 'nor the lesson trigger')
  rm(dir)
})

test('agent_env is read as an inline list, a block list or a single name', () => {
  assert.deepEqual(parseSettings('---\nagent_env: [A_ID, "B_ID"]  # agents\nhot_rules: Session\n---\n'), { agent_env: ['A_ID', 'B_ID'], hot_rules: 'Session' })
  assert.deepEqual(parseSettings('---\nagent_env:\n  - A_ID\n\n  - \'B_ID\'\nlayout_version: 3\n---\n'), { agent_env: ['A_ID', 'B_ID'] })
  assert.deepEqual(parseSettings('---\nagent_env: A_ID\n---\n'), { agent_env: 'A_ID' })
  assert.deepEqual(parseSettings('no frontmatter'), {})
})

test('two branches that each add a hot rule merge HOT-RULES.md by rows', () => {
  const dir = gitProject()
  setKeys(dir, 'hot_rules: session')
  assert.equal(run(['setup'], { cwd: dir }).status, 0)
  run(['views'], { cwd: dir })
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'session mode')
  git(dir, 'checkout', '-q', '-b', 'a')
  learning(dir, { slug: 'from-a', trigger: 'before a', hot: true })
  run(['views'], { cwd: dir })
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'a')
  git(dir, 'checkout', '-q', 'main')
  learning(dir, { slug: 'from-main', trigger: 'before main', hot: true })
  run(['views'], { cwd: dir })
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'main')
  const m = spawnSync('git', ['-c', 'core.autocrlf=false', 'merge', '--no-edit', 'a'], { cwd: dir, encoding: 'utf8', env: cleanEnv() })
  assert.equal(m.status, 0, (m.stdout || '') + (m.stderr || ''))
  const hot = read(dir, HOT)
  assert.match(hot, /learnings\/from-a\.md/)
  assert.match(hot, /learnings\/from-main\.md/)
  for (const a of ['CLAUDE.md', 'AGENTS.md']) assert.equal(inner(read(dir, a)), POINTER)
  assert.equal(run(['views', '--check'], { cwd: dir }).status, 0, 'the merge equals a fresh render')
  rm(dir)
})
