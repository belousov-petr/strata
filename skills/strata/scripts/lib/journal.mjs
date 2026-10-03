// Pending-capture journal: `.strata/inbox/journal.jsonl` under the shared root.
// /strata:capture appends; /strata:save routes every entry into its store, then clears.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  guard, inboxDir, ensureInboxDir, withLock, currentBranch, UsageError, plural,
} from './core.mjs'

export const KINDS = ['decision', 'answer', 'finding', 'gotcha', 'learning', 'requirement', 'direction', 'runbook', 'note']

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
  for (const r of [].concat(opts.ref || [])) {
    const c = clean(r, 300)
    if (c) refs.push(c)
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
export function clearEntries({ shared }, { ids, all } = {}) {
  const { dir, file, routed, lock } = journalPaths(shared)
  if (!fs.existsSync(file)) return { cleared: 0, kept: 0 }
  ensureInboxDir(dir)
  const want = new Set([].concat(ids || []).flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter(Boolean))
  if (!all && want.size === 0) throw new UsageError('strata journal clear: give --all or --id <id>')
  return withLock(lock, () => {
    const raw = fs.readFileSync(file, 'utf8')
    const entries = parseLines(raw)
    const cleared = []
    const keep = []
    for (const e of entries) {
      if (all || want.has(e.id)) cleared.push(e)
      else keep.push(e)
    }
    if (cleared.length) fs.writeFileSync(routed, cleared.map((e) => JSON.stringify(e)).join('\n') + '\n')
    let body = keep.map((e) => JSON.stringify(e)).join('\n')
    if (body) body += '\n'
    // Keep anything appended after our read (a writer that skipped the lock).
    const now = fs.readFileSync(file, 'utf8')
    if (now.length > raw.length && now.startsWith(raw)) body += now.slice(raw.length)
    const tmp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, body)
    fs.renameSync(tmp, file)
    return { cleared: cleared.length, kept: keep.length }
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
    if (e.filed) meta.push(`filed: ${e.filed}`)
    if (meta.length) lines.push(`   ${meta.join(' · ')}`)
    if (e.text && e.text !== e.title) {
      for (const t of e.text.split('\n')) lines.push(`   ${t}`)
    }
  })
  return lines.join('\n')
}
