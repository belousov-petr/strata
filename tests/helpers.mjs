// Test helpers: throwaway strata projects, a git wrapper with a clean
// environment, and a runner for the strata script.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const repoRoot = fileURLToPath(new URL('..', import.meta.url))
export const scriptPath = path.join(repoRoot, 'skills', 'strata', 'scripts', 'strata.mjs')
export const hookPath = path.join(repoRoot, 'hooks', 'strata-capture-guard.mjs')
const TPL = path.join(repoRoot, 'skills', 'strata', 'templates')

// Strip GIT_* (a test run from inside a git hook must never touch the outer
// repo) and the node:test context (so a child behaves like a CLI entry point).
export function cleanEnv(extra = {}) {
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k]
  delete env.NODE_TEST_CONTEXT
  delete env.STRATA_FAILURE_NUDGE
  delete env.STRATA_AUTO_MEMORY_POINTER
  env.GIT_AUTHOR_NAME = 'strata-test'
  env.GIT_AUTHOR_EMAIL = 'strata-test@example.invalid'
  env.GIT_COMMITTER_NAME = 'strata-test'
  env.GIT_COMMITTER_EMAIL = 'strata-test@example.invalid'
  env.GIT_CONFIG_NOSYSTEM = '1'
  // Ignore the developer's global git config (hooks, signing, autocrlf) so tests
  // behave the same on every machine and in CI.
  env.GIT_CONFIG_GLOBAL = emptyGlobalConfig()
  // Never touch the developer's real Claude folder (auto-memory pointer).
  env.CLAUDE_CONFIG_DIR = emptyClaudeDir()
  delete env.CLAUDE_CODE_PROJECT_DIR_NAME
  return { ...env, ...extra }
}

let globalCfg
function emptyGlobalConfig() {
  if (!globalCfg) {
    globalCfg = path.join(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'strata-gitcfg-'))), 'gitconfig')
    fs.writeFileSync(globalCfg, '[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n')
  }
  return globalCfg
}

let claudeDir
function emptyClaudeDir() {
  if (!claudeDir) claudeDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'strata-claude-home-')))
  return claudeDir
}

// realpath.native expands Windows 8.3 short names (RUNNER~1), which git never
// writes into a worktree's .git file, so paths compare equal on every OS.
export function tmpDir(prefix = 'strata-test-') {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
}

export function rm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* Windows may hold a handle briefly */ }
}

export function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
    cwd, encoding: 'utf8', env: cleanEnv(),
  })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`)
  return r.stdout.trim()
}

// Copy the scaffold templates the way /strata:init does (code project).
export function scaffold(dir, { name = 'Test Project', date = '2026-10-03' } = {}) {
  const copy = (rel, dest = rel) => {
    const src = path.join(TPL, rel)
    const to = path.join(dir, dest)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    const text = fs.readFileSync(src, 'utf8').replaceAll('{{PROJECT_NAME}}', name).replaceAll('{{INIT_DATE}}', date)
    fs.writeFileSync(to, text)
  }
  copy('AGENTS.md', 'AGENTS.md')
  copy('CLAUDE.md', 'CLAUDE.md')
  copy('MANIFEST.md', '.strata/MANIFEST.md')
  for (const f of ['MEMORY.md', 'project_state.md']) copy(`memory/${f}`, `.strata/memory/${f}`)
  for (const f of ['INDEX.md', '_TEMPLATE.md']) copy(`memory/learnings/${f}`, `.strata/memory/learnings/${f}`)
  for (const f of ['ARCHIVE.md', 'action_log.md']) copy(`memory/archive/${f}`, `.strata/memory/archive/${f}`)
  for (const f of ['README.md', '_TEMPLATE.md', 'ACTIVE.md', 'OPEN.md', 'PARKED.md']) copy(`issues/${f}`, `.strata/issues/${f}`)
  copy('issues/archive/INDEX.md', '.strata/issues/archive/INDEX.md')
  copy('inbox/.gitignore', '.strata/inbox/.gitignore')
  copy('docs/ARCHITECTURE.md', '.strata/docs/ARCHITECTURE.md')
  for (const d of ['product', 'architecture', 'decisions', 'reference', 'ops']) copy(`docs/${d}/README.md`, `.strata/docs/${d}/README.md`)
  return dir
}

// A scaffolded project inside a fresh git repo with one commit.
export function gitProject(opts = {}) {
  const dir = tmpDir()
  git(dir, 'init', '-q')
  scaffold(dir, opts)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

export function run(args, { cwd, env = {}, input } = {}) {
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd, encoding: 'utf8', input, env: cleanEnv({ STRATA_TODAY: '2026-10-03', ...env }),
  })
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

export function runJson(args, opts) {
  const r = run([...args, '--json'], opts)
  if (r.status !== 0 && !r.stdout.trim()) throw new Error(`strata ${args.join(' ')} failed: ${r.stderr}`)
  return { ...r, json: JSON.parse(r.stdout) }
}

export function write(dir, rel, text) {
  const p = path.join(dir, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
  return p
}

export function read(dir, rel) { return fs.readFileSync(path.join(dir, rel), 'utf8') }

export function issue(dir, { id, slug = 'item', type = 'bug', status = 'open', severity = 'med', area = 'src', what = 'Something', revive, archive = false }) {
  const fm = [`id: ${id}`, `type: ${type}`, `status: ${status}`, `severity: ${severity}`, `area: ${area}`, 'created: 2026-10-03']
  if (revive) fm.push(`revive-when: ${revive}`)
  const rel = `.strata/issues/${archive ? 'archive/' : ''}${id}-${slug}.md`
  return write(dir, rel, `---\n${fm.join('\n')}\n---\n\n**What:** ${what}\n\n**Why:** because.\n`)
}

export function learning(dir, { slug, trigger, origin = 'failure', hot, lesson = 'Do the thing first. It avoids the other thing.' }) {
  const fm = [`trigger: ${trigger}`, `origin: ${origin}`]
  if (hot !== undefined) fm.push(`hot: ${hot}`)
  return write(dir, `.strata/memory/learnings/${slug}.md`, `---\n${fm.join('\n')}\n---\n\n**Lesson:** ${lesson}\n`)
}
