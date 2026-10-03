// Collision-free ids (ADR-0018). "Highest existing + 1" collides when parallel
// branches or worktrees each pick the next number. Before choosing, scan:
//   the project tree (issues/ and issues/archive/, file names and frontmatter ids)
//   every worktree of the repository (uncommitted files included)
//   recent local and remote-tracking branch tips (git for-each-ref + git ls-tree)
//   reservations in the shared state file (two sessions allocating at once)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  git, gitOut, inGit, today, compactDate, walk, readLf, writeText, exists,
  updateState, UsageError, relPosix,
} from './core.mjs'
import { parseFrontmatter } from './frontmatter.mjs'
import { TYPES, STATUSES, SEVERITIES } from './model.mjs'

const DAY = 24 * 3600

function gitTop(project) { return gitOut(project, ['rev-parse', '--show-toplevel']) }

// Paths of every worktree's copy of `relDir` (relative to the repo top).
function worktreeDirs(project, relDir) {
  const out = []
  const list = gitOut(project, ['worktree', 'list', '--porcelain'])
  if (!list) return out
  const top = gitTop(project)
  const sub = top ? path.relative(top, project) : ''
  for (const line of list.split('\n')) {
    const m = /^worktree (.+)$/.exec(line)
    if (!m) continue
    const dir = path.join(path.resolve(m[1]), sub, relDir)
    if (path.resolve(dir) !== path.resolve(path.join(project, relDir)) && exists(dir)) out.push(dir)
  }
  return out
}

// File names under `relDir` on every recent branch tip.
function refFileNames(project, relDir, sinceEpoch) {
  const names = []
  const refs = gitOut(project, ['for-each-ref', '--format=%(objectname) %(committerdate:unix) %(refname)', 'refs/heads', 'refs/remotes'])
  if (!refs) return names
  const seen = new Set()
  for (const line of refs.split('\n')) {
    const [obj, when] = line.split(' ')
    if (!obj || seen.has(obj) || Number(when) < sinceEpoch) continue
    seen.add(obj)
    const r = git(project, ['ls-tree', '-r', '--name-only', obj, '--', relDir.replace(/\\/g, '/') + '/'])
    if (r.ok) for (const p of r.stdout.split('\n')) if (p) names.push(p.split('/').pop())
  }
  return names
}

function dateEpoch(isoDate) { return Math.floor(new Date(`${isoDate}T00:00:00Z`).getTime() / 1000) }

// --- issues -------------------------------------------------------------------------
export function usedIssueNumbers(project, isoDate) {
  const prefix = compactDate(isoDate)
  const used = new Set()
  const take = (s) => {
    const m = /^(\d{8})-(\d+)/.exec(String(s || ''))
    if (m && m[1] === prefix) used.add(Number(m[2]))
  }
  const rel = path.join('.strata', 'issues')
  const scanDir = (dir) => {
    for (const f of walk(dir, (name, full, isDirectory) => !isDirectory && !name.endsWith('.md'))) {
      take(path.basename(f))
      const text = readLf(f)
      if (text && text.startsWith('---')) take(parseFrontmatter(text).data.id)
    }
  }
  scanDir(path.join(project, rel))
  if (inGit(project)) {
    for (const d of worktreeDirs(project, rel)) scanDir(d)
    for (const n of refFileNames(project, rel, dateEpoch(isoDate) - 2 * DAY)) take(n)
  }
  return used
}

function slugify(s) {
  const slug = String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '')
  return slug || 'item'
}

function pick(value, allowed, name, fallback) {
  if (value === undefined || value === true) return fallback
  const v = String(value).toLowerCase()
  if (!allowed.includes(v)) throw new UsageError(`strata new-issue: --${name} must be one of ${allowed.join(', ')}`)
  return v
}

function templateText(project) {
  const own = readLf(path.join(project, '.strata', 'issues', '_TEMPLATE.md'))
  if (own) return own
  return readLf(fileURLToPath(new URL('../../templates/issues/_TEMPLATE.md', import.meta.url))) || '---\n---\n'
}

function fillTemplate(tpl, fields, { title, keepRevive }) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(tpl)
  const body = m ? tpl.slice(m[0].length) : tpl
  const lines = (m ? m[1] : '').split('\n')
  const done = new Set()
  const out = []
  for (const line of lines) {
    const k = /^([A-Za-z0-9_-]+)\s*:/.exec(line)
    if (k && Object.prototype.hasOwnProperty.call(fields, k[1])) {
      out.push(`${k[1]}: ${fields[k[1]]}`)
      done.add(k[1])
    } else if (k && k[1] === 'revive-when' && !keepRevive) {
      continue
    } else {
      out.push(line)
    }
  }
  for (const [k, v] of Object.entries(fields)) if (!done.has(k)) out.push(`${k}: ${v}`)
  let b = body
  if (title) b = b.replace(/^\*\*What:\*\*.*$/m, `**What:** ${title.replace(/\$/g, '$$$$')}`)
  return `---\n${out.join('\n')}\n---\n${b.startsWith('\n') ? '' : '\n'}${b}`
}

export function newIssue(roots, opts = {}) {
  const { project, shared } = roots
  if (!opts.slug && !opts.title) throw new UsageError('strata new-issue: give --slug <slug> (or --title)')
  const isoDate = opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : today()
  const prefix = compactDate(isoDate)
  const used = usedIssueNumbers(project, isoDate)
  const fields = {
    type: pick(opts.type, TYPES, 'type', 'task'),
    status: pick(opts.status, STATUSES, 'status', 'open'),
    severity: pick(opts.severity, SEVERITIES, 'severity', 'med'),
  }
  const slug = slugify(opts.slug || opts.title)

  const allocate = (state) => {
    const reserved = (state.issue_reservations || []).filter((r) => String(r.id).startsWith(prefix + '-'))
    for (const r of reserved) used.add(Number(String(r.id).split('-')[1]))
    const n = used.size ? Math.max(...used) + 1 : 1 // never reuse a number, even a gap
    return `${prefix}-${String(n).padStart(2, '0')}`
  }

  let id
  if (opts.dryRun) {
    let st = {}
    try { st = JSON.parse(fs.readFileSync(path.join(shared, '.strata', 'inbox', 'state.json'), 'utf8')) } catch { /* none */ }
    id = allocate(st)
    return { id, file: null, dryRun: true }
  }
  updateState(shared, (st) => {
    id = allocate(st)
    const cutoff = Date.now() - 7 * DAY * 1000
    st.issue_reservations = [...(st.issue_reservations || []).filter((r) => Date.parse(r.at) > cutoff), { id, at: new Date().toISOString(), slug }]
    return st
  })
  const file = path.join(project, '.strata', 'issues', `${id}-${slug}.md`)
  const text = fillTemplate(templateText(project), {
    id, ...fields, area: opts.area && opts.area !== true ? String(opts.area) : '', created: isoDate,
    ...(fields.status === 'parked' && opts.revive && opts.revive !== true ? { 'revive-when': String(opts.revive) } : {}),
  }, { title: opts.title && opts.title !== true ? String(opts.title) : '', keepRevive: fields.status === 'parked' })
  writeText(file, text, { eol: '\n' })
  return { id, file: relPosix(project, file) }
}

// --- decision records -----------------------------------------------------------------
export function decisionsDir(project, explicit) {
  if (explicit && explicit !== true) return String(explicit)
  const inStrata = path.join('.strata', 'docs', 'decisions')
  if (exists(path.join(project, inStrata))) return inStrata
  if (exists(path.join(project, 'docs', 'decisions'))) return path.join('docs', 'decisions')
  return inStrata
}

export function nextAdr(roots, { dir, dryRun = false } = {}) {
  const { project, shared } = roots
  const rel = decisionsDir(project, dir)
  const used = new Set()
  const take = (name) => { const m = /^ADR-(\d{3,})/i.exec(String(name || '')); if (m) used.add(Number(m[1])) }
  const scan = (d) => { try { for (const n of fs.readdirSync(d)) take(n) } catch { /* none */ } }
  scan(path.join(project, rel))
  if (inGit(project)) {
    for (const d of worktreeDirs(project, rel)) scan(d)
    for (const n of refFileNames(project, rel, Math.floor(Date.now() / 1000) - 30 * DAY)) take(n)
  }
  const allocate = (st) => {
    for (const r of st.adr_reservations || []) if (r.dir === rel.replace(/\\/g, '/')) used.add(Number(r.number))
    let n = used.size ? Math.max(...used) + 1 : 1
    while (used.has(n)) n++
    return n
  }
  let n
  if (dryRun) {
    let st = {}
    try { st = JSON.parse(fs.readFileSync(path.join(shared, '.strata', 'inbox', 'state.json'), 'utf8')) } catch { /* none */ }
    n = allocate(st)
  } else {
    updateState(shared, (st) => {
      n = allocate(st)
      const cutoff = Date.now() - 30 * DAY * 1000
      st.adr_reservations = [...(st.adr_reservations || []).filter((r) => Date.parse(r.at) > cutoff), { number: n, dir: rel.replace(/\\/g, '/'), at: new Date().toISOString() }]
      return st
    })
  }
  return { adr: `ADR-${String(n).padStart(4, '0')}`, number: n, dir: rel.replace(/\\/g, '/') }
}
