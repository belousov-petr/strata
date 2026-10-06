import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gitProject, run, runJson, rm, read, write, learning } from './helpers.mjs'

test('a fresh scaffold has a current hot-rules block in both adapters', () => {
  const dir = gitProject()
  const r = runJson(['hot-rules', '--check'], { cwd: dir })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.results.map((x) => x.state), ['current', 'current'])
  rm(dir)
})

test('hot learnings land between the markers and nothing outside changes', () => {
  const dir = gitProject()
  write(dir, 'CLAUDE.md', read(dir, 'CLAUDE.md') + '\n## My own notes\n\nKeep this exactly.\n')
  const before = read(dir, 'CLAUDE.md')
  learning(dir, { slug: 'push-lint', trigger: 'before pushing to a shared branch', hot: true, lesson: 'Run the repo lint first. The hook only catches secrets.' })
  learning(dir, { slug: 'niche', trigger: 'when editing the legacy importer', hot: false })
  assert.equal(run(['hot-rules', '--check'], { cwd: dir }).status, 1)
  assert.equal(run(['hot-rules'], { cwd: dir }).status, 0)
  const after = read(dir, 'CLAUDE.md')
  assert.match(after, /- \*\*Before pushing to a shared branch:\*\* Run the repo lint first\. \(\[rule\]\(\.strata\/memory\/learnings\/push-lint\.md\)\)/)
  assert.ok(!after.includes('legacy importer'), 'hot: false learnings stay out')
  const strip = (s) => s.replace(/<!-- strata:hot-rules:begin -->[\s\S]*<!-- strata:hot-rules:end -->/, '')
  assert.equal(strip(after), strip(before))
  assert.match(read(dir, 'AGENTS.md'), /push-lint\.md/)
  assert.equal(run(['hot-rules', '--check'], { cwd: dir }).status, 0)
  rm(dir)
})

test('an adapter without markers is left alone unless --install', () => {
  const dir = gitProject()
  write(dir, 'CLAUDE.md', '# Hand-written\n\nNo markers here.\n')
  learning(dir, { slug: 'a', trigger: 'before a', hot: true })
  run(['hot-rules'], { cwd: dir })
  assert.equal(read(dir, 'CLAUDE.md'), '# Hand-written\n\nNo markers here.\n')
  run(['hot-rules', '--install'], { cwd: dir })
  const t = read(dir, 'CLAUDE.md')
  assert.ok(t.startsWith('# Hand-written\n\nNo markers here.\n\n<!-- strata:hot-rules:begin -->'))
  assert.match(t, /a\.md/)
  rm(dir)
})

test('projects with no hot flag keep every learning (graceful default)', () => {
  const dir = gitProject()
  learning(dir, { slug: 'one', trigger: 'before one' })
  learning(dir, { slug: 'two', trigger: 'before two' })
  run(['hot-rules'], { cwd: dir })
  const t = read(dir, 'CLAUDE.md')
  assert.match(t, /one\.md/)
  assert.match(t, /two\.md/)
  rm(dir)
})

test('the block respects its budget and says how many more there are', () => {
  const dir = gitProject()
  for (let i = 0; i < 30; i++) learning(dir, { slug: `rule-${String(i).padStart(2, '0')}`, trigger: `before step ${String(i).padStart(2, '0')}`, hot: true })
  const r = runJson(['hot-rules'], { cwd: dir }).json
  assert.equal(r.total, 30)
  assert.equal(r.shown, 25)
  assert.equal(r.overflow, 5)
  assert.match(read(dir, 'CLAUDE.md'), /- 5 more hot rules: see/)
  rm(dir)
})

test('CRLF adapters keep CRLF line endings', () => {
  const dir = gitProject()
  write(dir, 'AGENTS.md', read(dir, 'AGENTS.md').replace(/\n/g, '\r\n'))
  learning(dir, { slug: 'crlf', trigger: 'before crlf', hot: true })
  run(['hot-rules'], { cwd: dir })
  const t = read(dir, 'AGENTS.md')
  assert.match(t, /crlf\.md/)
  assert.ok(!/[^\r]\n/.test(t), 'every newline stays CRLF')
  rm(dir)
})

test('a lesson wrapped over several lines reaches the block as a whole sentence', () => {
  const dir = gitProject()
  write(dir, '.strata/memory/learnings/wrapped.md', '---\ntrigger: before a long lesson\norigin: failure\nhot: true\n---\n\n**Lesson:** Stop only when you can name the mechanism, the line,\nthe path or the arithmetic that produces the number. Then fix it.\n\n**Why:** more text.\n')
  run(['hot-rules'], { cwd: dir })
  assert.match(read(dir, 'CLAUDE.md'), /- \*\*Before a long lesson:\*\* Stop only when you can name the mechanism, the line, the path or the arithmetic that produces the number\. \(\[rule\]/)
  rm(dir)
})

test('a learning with no Lesson line shows its title without the heading marker', () => {
  const dir = gitProject()
  write(dir, '.strata/memory/learnings/titled.md', '---\ntrigger: before a titled rule\norigin: failure\nhot: true\n---\n\n# Check the live config, not the issue that described it\n\nLong story.\n')
  run(['hot-rules'], { cwd: dir })
  const t = read(dir, 'CLAUDE.md')
  assert.match(t, /- \*\*Before a titled rule:\*\* Check the live config, not the issue that described it \(\[rule\]/)
  assert.ok(!t.includes(':** #'), 'no heading marker in the block')
  rm(dir)
})

test('twenty-five realistic rules all fit, and an overlong trigger is shortened', () => {
  const dir = gitProject()
  const long = 'before reading any file or generated runtime tree that may hold credentials, such as shell profiles, environment files, service unit environment targets, nested tool homes or managed shell snapshots'
  const lesson = 'Never print the matching lines, because the output lands in a saved transcript that other tools read later and a printed value has to be rotated. Count matches instead.'
  for (let i = 0; i < 25; i++) learning(dir, { slug: `rule-${String(i).padStart(2, '0')}`, trigger: `${long} ${String(i).padStart(2, '0')}`, hot: true, lesson })
  const r = runJson(['hot-rules'], { cwd: dir }).json
  assert.equal(r.total, 25)
  assert.equal(r.shown, 25)
  assert.equal(r.overflow, 0)
  const lines = read(dir, 'CLAUDE.md').split('\n').filter((l) => l.startsWith('- **'))
  assert.equal(lines.length, 25)
  for (const l of lines) assert.ok(/^- \*\*[^*]{1,160}:\*\*/.test(l) && l.includes('…:**'), 'trigger shortened to 160 characters')
  rm(dir)
})
