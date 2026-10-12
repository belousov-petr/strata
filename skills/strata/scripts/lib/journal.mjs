// Pending-capture journal: `.strata/inbox/journal.jsonl` under the shared root.
// /strata:capture appends; /strata:save routes every entry into its store, then clears.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  guard, inboxDir, ensureInboxDir, withLock, currentBranch, inGit, UsageError, plural,
} from './core.mjs'
import { evidenceIndex, proveEntry } from './proof.mjs'

export const KINDS = ['decision', 'answer', 'finding', 'gotcha', 'learning', 'requirement', 'direction', 'runbook', 'note']
// `append`: /strata:save appends the entry to the issue named by its first ref
// as a dated update and marks it filed (ADR-0022).
export const ROUTES = ['append']

export function journalPaths(shared) {
  const dir = inboxDir(shared)
  return {
    dir,
    file: path.join(dir, 'journal.jsonl'),
    routed: path.join(dir, 'journal.routed.jsonl'),
    lock: path.join(dir, '.journal.lock'),
  }
}

function parseLines(text) {
  const out = []
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* skip a torn line */ }
  }
  return out
}

export function readJournal(shared) {
  try { return parseLines(fs.readFileSync(journalPaths(shared).file, 'utf8')) } catch { return [] }
}

function newId(now) {
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return `j-${stamp}-${crypto.randomBytes(2).toString('hex')}`
}

function clean(s, max) {
  if (s == null || s === true) return null
  const t = guard.redact(String(s)).replace(/\r\n/g, '\n').trim()
  if (!t) return null
  return max && t.length > max ? t.slice(0, max) : t
}

// Add one entry. `text` may come from --text or stdin (the caller resolves it).
export function addEntry({ project, shared }, opts) {
  const kind = String(opts.kind || '').toLowerCase()
  if (!KINDS.includes(kind)) {
    throw new UsageError(`strata journal add: --kind must be one of ${KINDS.join(', ')}`)
  }
  const text = clean(opts.text, 20000)
  let title = clean(opts.title, 200)
  if (!title && text) title = text.split('\n')[0].slice(0, 120)
  if (!title) throw new UsageError('strata journal add: give --title, or text on --text or stdin')
  const refs = []
  for (const r of [].concat(opts.ref || [], opts.refs || [])) {
    if (r === true) continue
    for (const part of String(r).split(',')) {
      const c = clean(part, 300)
      if (c && !refs.includes(c)) refs.push(c)
    }
  }
  let route = null
  if (opts.route != null && opts.route !== false) {
    route = String(opts.route).toLowerCase()
    if (!ROUTES.includes(route)) throw new UsageError(`strata journal add: --route must be one of ${ROUTES.join(', ')}`)
    if (!refs.length) throw new UsageError('strata journal add: --route append needs the issue id in --refs <issue-id>')
  }
  const now = new Date()
  const entry = {
    id: newId(now),
    ts: now.toISOString(),
    kind,
    title,
    text: text || null,
    lineage: clean(opts.lineage, 300),
    refs,
    route,
    filed: clean(opts.filed, 300),
    branch: currentBranch(project),
    worktree: path.resolve(project) === path.resolve(shared) ? null : path.basename(project),
  }
  const { dir, file, lock } = journalPaths(shared)
  ensureInboxDir(dir)
  withLock(lock, () => fs.appendFileSync(file, JSON.stringify(entry) + '\n'))
  return entry
}

// Remove entries (all, or by id). Cleared entries go to journal.routed.jsonl
// (last batch only) so a bad routing pass can be redone. Lines appended while
// the clear runs are kept.
//
// Each selected entry must show that it was filed (ADR-0028): a `filed` path,
// or its title's words in the uncommitted working tree. When one does not, the
// clear refuses and changes nothing, unless `force`. Outside git the check is
// skipped (`checked: false`).
export function clearEntries({ project, shared }, { ids, all, force = false } = {}) {
  const { dir, file, routed, lock } = journalPaths(shared)
  const want = new Set([].concat(ids || []).flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter(Boolean))
  if (!all && want.size === 0) throw new UsageError('strata journal clear: give --all or --id <id>')
  const checked = inGit(project || shared)
  const base = { cleared: 0, kept: 0, forced: 0, checked, unproven: [] }
  if (!fs.existsSync(file)) return base
  ensureInboxDir(dir)
  const picked = (e) => all || want.has(e.id)
  // Read the working tree before taking the lock: git can take a moment in a
  // big repository, and captures must not wait on it.
  const needTree = checked && readJournal(shared).some((e) => picked(e) && !e.filed)
  const index = needTree ? evidenceIndex(project || shared) : null
  return withLock(lock, () => {
    const raw = fs.readFileSync(file, 'utf8')
    const entries = parseLines(raw)
    const cleared = []
    const keep = []
    for (const e of entries) {
      if (picked(e)) cleared.push(e)
      else keep.push(e)
    }
    const unproven = checked
      ? cleared.filter((e) => !proveEntry(e, index).by).map((e) => ({ id: e.id, kind: e.kind, title: e.title }))
      : []
    if (unproven.length && !force) return { ...base, kept: entries.length, chosen: cleared.length, refused: true, unproven }
    if (cleared.length) fs.writeFileSync(routed, cleared.map((e) => JSON.stringify(e)).join('\n') + '\n')
    let body = keep.map((e) => JSON.stringify(e)).join('\n')
    if (body) body += '\n'
    // Keep anything appended after our read (a writer that skipped the lock).
    const now = fs.readFileSync(file, 'utf8')
    if (now.length > raw.length && now.startsWith(raw)) body += now.slice(raw.length)
    const tmp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, body)
    fs.renameSync(tmp, file)
    return { ...base, cleared: cleared.length, kept: keep.length, chosen: cleared.length, forced: unproven.length, unproven }
  })
}

export function formatClear(res) {
  const lines = []
  if (!res.checked) lines.push('journal: not a git repository, so the check that each entry was filed is skipped.')
  if (res.refused) {
    lines.push(`journal: nothing cleared. ${res.unproven.length} of ${res.chosen} chosen ${res.chosen === 1 ? 'entry shows' : 'entries show'} no sign of being filed:`)
    for (const e of res.unproven) lines.push(`- ${e.id} [${e.kind}] ${e.title}`)
    lines.push('An entry counts as filed when it carries a filed path, or when at least half of its title words, and at least two, ' +
      'appear in uncommitted changes under .strata/ or docs/. File each one into its store and clear again, or pass --force to clear them anyway.')
    return lines.join('\n')
  }
  let line = `journal: cleared ${res.cleared}, ${res.kept} still pending.`
  if (res.forced) line += ` ${res.forced === 1 ? '1 of them was' : `${res.forced} of them were`} cleared with --force although ${res.forced === 1 ? 'it showed' : 'they showed'} no sign of being filed.`
  if (res.cleared) line += ' The cleared batch is kept in journal.routed.jsonl until the next clear.'
  lines.push(line)
  return lines.join('\n')
}

// Mark entries filed: `filed` maps entry id -> the file it landed in.
export function markFiled({ shared }, filed) {
  const { dir, file, lock } = journalPaths(shared)
  if (!Object.keys(filed).length || !fs.existsSync(file)) return 0
  ensureInboxDir(dir)
  return withLock(lock, () => {
    const raw = fs.readFileSync(file, 'utf8')
    let n = 0
    const out = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let e
      try { e = JSON.parse(line) } catch { out.push(line); continue }
      if (Object.prototype.hasOwnProperty.call(filed, e.id) && !e.filed) { e.filed = filed[e.id]; n++ }
      out.push(JSON.stringify(e))
    }
    let body = out.join('\n') + (out.length ? '\n' : '')
    const now = fs.readFileSync(file, 'utf8')
    if (now.length > raw.length && now.startsWith(raw)) body += now.slice(raw.length)
    const tmp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, body)
    fs.renameSync(tmp, file)
    return n
  })
}

export function kindCounts(entries) {
  const m = new Map()
  for (const e of entries) m.set(e.kind, (m.get(e.kind) || 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
}

export function journalSummaryLine(entries) {
  if (!entries.length) return 'Pending captures: none.'
  const kinds = kindCounts(entries).map(([k, n]) => `${n} ${k}`).join(', ')
  return `Pending captures: ${entries.length} (${kinds}). /strata:save routes them into their stores.`
}

export function formatEntries(entries, { file } = {}) {
  if (!entries.length) return 'No pending captures.'
  const lines = [`${plural(entries.length, 'pending capture')}${file ? ` in ${file}` : ''}:`, '']
  const p = (n) => String(n).padStart(2, '0')
  entries.forEach((e, i) => {
    const d = new Date(e.ts)
    const when = Number.isNaN(d.getTime()) ? '' :
      `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    lines.push(`${i + 1}. [${e.kind}] ${e.title}  (${e.id}, ${when}${e.branch ? `, ${e.branch}` : ''})`)
    const meta = []
    if (e.lineage) meta.push(`lineage: ${e.lineage}`)
    if (e.refs && e.refs.length) meta.push(`refs: ${e.refs.join(', ')}`)
    if (e.route) meta.push(`route: ${e.route}`)
    if (e.filed) meta.push(`filed: ${e.filed}`)
    if (meta.length) lines.push(`   ${meta.join(' · ')}`)
    if (e.text && e.text !== e.title) {
      for (const t of e.text.split('\n')) lines.push(`   ${t}`)
    }
  })
  return lines.join('\n')
}
