// Shared helpers for the strata script: roots, files, git, args, dates, locks.
// Pure Node (node: modules only) so it runs the same on Windows, macOS and Linux.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The hook script is the one source of truth for redaction, root resolution and
// failure classification. Both always ship together (Claude plugin, Codex package,
// plain clone), so the script imports the hook's exported helpers.
let guardModule
try {
  guardModule = await import(new URL('../../../../hooks/strata-capture-guard.mjs', import.meta.url))
} catch (e) {
  throw new Error(
    'strata: could not load hooks/strata-capture-guard.mjs from the plugin folder. ' +
    'Reinstall or update the strata plugin. (' + (e && e.message) + ')'
  )
}
export const guard = guardModule

export const SCRIPT_PATH = fileURLToPath(new URL('../strata.mjs', import.meta.url))

export class UsageError extends Error {}

// --- arguments ---------------------------------------------------------------
// `--key value`, `--key=value`, `--flag`. Keys in `bools` never take a value;
// keys in `multi` collect every occurrence into an array.
export function parseArgs(argv, { bools = [], multi = [] } = {}) {
  const out = { _: [] }
  const b = new Set(bools)
  const m = new Set(multi)
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (tok === '--') { out._.push(...argv.slice(i + 1)); break }
    if (!tok.startsWith('--') || tok === '-') { out._.push(tok); continue }
    let key = tok.slice(2)
    let val
    const eq = key.indexOf('=')
    if (eq >= 0) { val = key.slice(eq + 1); key = key.slice(0, eq) }
    else if (b.has(key)) val = true
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) val = argv[++i]
    else val = true
    if (m.has(key)) (out[key] ||= []).push(val)
    else out[key] = val
  }
  return out
}

// --- roots -------------------------------------------------------------------
// project: nearest folder at/above cwd holding .strata/ (tracked files live here).
// shared: the main worktree's matching folder when it also holds .strata/
// (untracked scratch lives here: inbox, journal, cursors, state).
export function resolveRoots(cwd) {
  const r = guard.resolveRoots(path.resolve(cwd || process.cwd()))
  if (!r) {
    throw new UsageError(
      'strata: no .strata/ folder at or above ' + path.resolve(cwd || process.cwd()) +
      '. Run /strata:init (Codex: Skill(name=\'strata\', args=\'init\')) first.'
    )
  }
  return r
}

export function strataDir(root) { return path.join(root, '.strata') }

export function inboxDir(shared) { return path.join(shared, '.strata', 'inbox') }

// --- files -------------------------------------------------------------------
export function exists(p) { try { fs.accessSync(p); return true } catch { return false } }
export function isDir(p) { try { return fs.statSync(p).isDirectory() } catch { return false } }
export function isFile(p) { try { return fs.statSync(p).isFile() } catch { return false } }

export function readText(p) {
  try { return fs.readFileSync(p, 'utf8') } catch { return null }
}

// Normalize to LF for parsing; remember the file's own line ending for writing.
export function readLf(p) {
  const raw = readText(p)
  if (raw == null) return null
  return raw.replace(/\r\n/g, '\n')
}
export function eolOf(p) {
  const raw = readText(p)
  return raw && raw.includes('\r\n') ? '\r\n' : '\n'
}

// Write LF text, converting to the file's existing line ending. Atomic via
// temp file + rename. Returns true when the content changed.
export function writeText(p, lfText, { eol } = {}) {
  const useEol = eol || (exists(p) ? eolOf(p) : '\n')
  const data = useEol === '\r\n' ? lfText.replace(/\r?\n/g, '\r\n') : lfText
  const before = readText(p)
  if (before === data) return false
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.strata-tmp-${process.pid}`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, p)
  return true
}

// Same rule as the hook: an inbox created without an ignore file ignores itself.
export function ensureInboxDir(dir) { guard.ensureInbox(dir) }

export function toPosix(p) { return p.split(path.sep).join('/') }
export function relPosix(from, to) { return toPosix(path.relative(from, to)) }

// Walk a folder; `skip(name, full, isDirectory)` returns true to skip an entry.
export function walk(dir, skip = () => false, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (skip(e.name, full, e.isDirectory())) continue
    if (e.isDirectory()) walk(full, skip, out)
    else if (e.isFile()) out.push(full)
  }
  return out
}

// --- locks -------------------------------------------------------------------
function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

export function withLock(lockPath, fn) {
  const deadline = Date.now() + 5000
  let fd
  for (;;) {
    try { fd = fs.openSync(lockPath, 'wx'); break } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 10000) { fs.rmSync(lockPath, { force: true }); continue }
      } catch { /* vanished, retry */ }
      if (Date.now() > deadline) throw new Error('strata: lock is busy: ' + lockPath)
      sleepMs(25)
    }
  }
  try { return fn() } finally {
    try { fs.closeSync(fd) } catch { /* ignore */ }
    try { fs.rmSync(lockPath, { force: true }) } catch { /* ignore */ }
  }
}

// --- dates -------------------------------------------------------------------
// Local calendar date. STRATA_TODAY (YYYY-MM-DD) pins it for tests.
export function today() {
  const pinned = process.env.STRATA_TODAY
  if (pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned)) return pinned
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export function compactDate(isoDate) { return isoDate.replace(/-/g, '') }

// --- git ---------------------------------------------------------------------
// Git with an argument list (never a shell string). Strips inherited GIT_DIR and
// friends so a call made from inside a git hook acts on the intended repo.
export function gitEnv() {
  const env = { ...process.env }
  for (const k of Object.keys(env)) {
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|PREFIX|NAMESPACE)$/.test(k)) delete env[k]
  }
  env.GIT_OPTIONAL_LOCKS = '0'
  return env
}

export function git(cwd, args, { input } = {}) {
  const r = spawnSync('git', args, {
    cwd, encoding: 'utf8', env: gitEnv(), input, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
  })
  return { ok: r.status === 0, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error }
}

export function gitOut(cwd, args) {
  const r = git(cwd, args)
  return r.ok ? r.stdout.replace(/\r?\n$/, '') : null
}

export function inGit(cwd) { return gitOut(cwd, ['rev-parse', '--is-inside-work-tree']) === 'true' }

export function currentBranch(cwd) {
  const b = gitOut(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return b && b !== 'HEAD' ? b : null
}

// --- state file (shared root) ------------------------------------------------
export function statePath(shared) { return path.join(inboxDir(shared), 'state.json') }

export function readState(shared) {
  try { return JSON.parse(fs.readFileSync(statePath(shared), 'utf8')) || {} } catch { return {} }
}

export function updateState(shared, fn) {
  const dir = inboxDir(shared)
  ensureInboxDir(dir)
  return withLock(path.join(dir, '.state.lock'), () => {
    const cur = readState(shared)
    const next = fn(cur) || cur
    const tmp = statePath(shared) + `.tmp-${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n')
    fs.renameSync(tmp, statePath(shared))
    return next
  })
}

// --- output ------------------------------------------------------------------
export function print(s = '') { process.stdout.write(s.endsWith('\n') ? s : s + '\n') }

export function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}` }
