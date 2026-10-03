// `strata check`: validate a strata project without writing anything.
// Errors fail the check (exit 1); warnings are reported only.

import fs from 'node:fs'
import path from 'node:path'
import { readLf, walk, relPosix, exists } from './core.mjs'
import { parseFrontmatter } from './frontmatter.mjs'
import {
  readIssues, readLearnings, TYPES, STATUSES, SEVERITIES, ORIGINS, TERMINAL, LIVE,
} from './model.mjs'
import { syncViews } from './views.mjs'
import { driverState, DRIVER } from './setup.mjs'

export const BUDGETS = { memory: 80, state: 200 }

function lineCount(text) {
  if (!text) return 0
  const t = text.endsWith('\n') ? text.slice(0, -1) : text
  return t.split('\n').length
}

// Relative markdown links outside code, resolved from the file's folder.
function brokenLinks(file) {
  const text = readLf(file)
  if (!text) return []
  const out = []
  let fence = false
  const lines = text.split('\n')
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue }
    if (fence) continue
    const plain = line.replace(/`[^`]*`/g, '')
    const re = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
    let m
    while ((m = re.exec(plain))) {
      let target = m[1].replace(/^<|>$/g, '')
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) continue
      if (/[<>{}]/.test(target)) continue // template placeholders
      target = target.split('#')[0].split('?')[0]
      if (!target) continue
      try { target = decodeURIComponent(target) } catch { /* keep raw */ }
      if (!exists(path.resolve(path.dirname(file), target))) out.push({ line: n + 1, target: m[1] })
    }
  }
  return out
}

export function runCheck(project) {
  const findings = []
  const add = (level, code, where, detail) => findings.push({ level, code, path: where, detail })
  const sd = path.join(project, '.strata')

  // 1. Layout stamp
  const manifest = readLf(path.join(sd, 'MANIFEST.md'))
  if (manifest == null) add('error', 'no-manifest', '.strata/MANIFEST.md', 'missing; run /strata:init')
  else {
    const fm = parseFrontmatter(manifest).data
    if (String(fm.layout_version || '') !== '3') {
      if (fm.strata_version) add('error', 'legacy-stamp', '.strata/MANIFEST.md', `strata_version: ${fm.strata_version}; migrate with MIGRATIONS.md Rung 3`)
      else add('error', 'layout-version', '.strata/MANIFEST.md', 'no layout_version: 3 in the frontmatter')
    }
  }

  // 2. Budgets
  const mem = readLf(path.join(sd, 'memory', 'MEMORY.md'))
  if (mem == null) add('error', 'no-memory-index', '.strata/memory/MEMORY.md', 'missing')
  else if (lineCount(mem) > BUDGETS.memory) add('error', 'budget-memory', '.strata/memory/MEMORY.md', `${lineCount(mem)} lines, over the ${BUDGETS.memory}-line budget; flag fewer learnings hot: true`)
  const state = readLf(path.join(sd, 'memory', 'project_state.md'))
  if (state != null && lineCount(state) > BUDGETS.state) add('error', 'budget-state', '.strata/memory/project_state.md', `${lineCount(state)} lines, over the ${BUDGETS.state}-line budget; roll old sessions (strata save --prepare)`)

  // 3. Issues
  const issues = readIssues(project, { includeArchive: true })
  const ids = new Map()
  for (const i of issues) {
    const where = relPosix(project, i.file)
    if (!i.frontmatter) {
      if (i.topLevel) add('error', 'issue-no-frontmatter', where, 'issue file without frontmatter')
      continue
    }
    if (!i.archived) {
      for (const k of ['id', 'type', 'status', 'severity']) if (!i[k]) add('error', 'issue-missing-field', where, `missing ${k}:`)
      for (const k of ['area', 'created']) if (!i[k]) add('warn', 'issue-missing-field', where, `missing ${k}:`)
    }
    if (i.type && !TYPES.includes(i.type)) add('error', 'issue-bad-type', where, `type '${i.type}' is not one of ${TYPES.join(' | ')}`)
    if (i.status && !STATUSES.includes(i.status)) add('error', 'issue-bad-status', where, `status '${i.status}' is not one of ${STATUSES.join(' | ')}`)
    if (i.severity && !SEVERITIES.includes(i.severity)) add('error', 'issue-bad-severity', where, `severity '${i.severity}' is not one of ${SEVERITIES.join(' | ')}`)
    if (i.id) {
      if (!/^\d{8}-\d{2,}$/.test(i.id) && !/^\d+$/.test(i.id)) add('warn', 'issue-id-format', where, `id '${i.id}' is neither YYYYMMDD-NN nor NNN`)
      else if (!path.basename(i.file).startsWith(i.id)) add('warn', 'issue-file-name', where, `file name does not start with its id ${i.id}`)
      if (!ids.has(i.id)) ids.set(i.id, [])
      ids.get(i.id).push(where)
    }
    if (i.status === 'parked' && !i.revive) add('error', 'parked-no-revive', where, 'parked without a revive-when: trigger')
    if (!i.archived && TERMINAL.includes(i.status)) add('warn', 'terminal-not-archived', where, `${i.status}; strata save --prepare moves it to issues/archive/`)
    if (i.archived && LIVE.includes(i.status)) add('warn', 'live-in-archive', where, `status ${i.status} inside issues/archive/`)
  }
  for (const [id, where] of ids) if (where.length > 1) add('error', 'duplicate-id', where.join(', '), `id ${id} is used by ${where.length} files`)

  // 4. Learnings
  for (const l of readLearnings(project)) {
    const where = relPosix(project, l.file)
    if (!l.frontmatter) { add('error', 'learning-no-frontmatter', where, 'learning without frontmatter'); continue }
    if (!l.trigger) add('error', 'learning-no-trigger', where, 'missing trigger:')
    if (!ORIGINS.includes(l.origin)) add('error', 'learning-bad-origin', where, `origin '${l.origin}' is not one of ${ORIGINS.join(' | ')}`)
    if (l.hot !== null && l.hot !== 'true' && l.hot !== 'false') add('error', 'learning-bad-hot', where, `hot '${l.hot}' must be true or false`)
  }

  // 5. Generated views and hot-rules blocks
  const v = syncViews(project, { check: true })
  for (const x of v.views) {
    if (x.state === 'stale') add('error', 'view-drift', x.file, 'differs from a fresh render; run strata views')
    if (x.state === 'no-table') add('warn', 'memory-no-table', x.file, 'no generated rules table found')
    if (x.state === 'missing') add('error', 'no-memory-index', x.file, 'missing')
  }
  for (const h of v.hot.results) if (h.state === 'stale') add('error', 'hot-rules-drift', h.file, 'hot-rules block differs from a fresh render; run strata views')

  // 6. Links inside .strata (archive links are history, so only warn there)
  const files = walk(sd, (name, full, isDirectory) => (isDirectory ? name === 'inbox' : !name.endsWith('.md')))
  for (const f of files) {
    const rel = relPosix(project, f)
    const cold = /\/archive\//.test('/' + rel)
    for (const b of brokenLinks(f)) add(cold ? 'warn' : 'error', 'broken-link', `${rel}:${b.line}`, `link target ${b.target} does not exist`)
  }

  // 7. Archive index completeness (cold, warn)
  const archiveDir = path.join(sd, 'memory', 'archive')
  const archiveIndex = readLf(path.join(archiveDir, 'ARCHIVE.md'))
  if (archiveIndex != null) {
    let names = []
    try { names = fs.readdirSync(archiveDir) } catch { /* none */ }
    for (const n of names.sort()) {
      if (n === 'ARCHIVE.md' || !n.endsWith('.md')) continue
      if (!archiveIndex.includes(n)) add('warn', 'archive-unindexed', `.strata/memory/archive/${n}`, 'not listed in ARCHIVE.md')
    }
  }

  // 8. Merge driver: committed .gitattributes names it, but git config is per clone.
  const attrs = readLf(path.join(project, '.gitattributes')) || ''
  if (attrs.includes(`merge=${DRIVER}`)) {
    const st = driverState(project)
    if (st.inGit && !st.configured) add('warn', 'merge-driver-missing', '.gitattributes', `this clone has no merge.${DRIVER}.driver; run strata setup once`)
  }

  const errors = findings.filter((f) => f.level === 'error').length
  return { ok: errors === 0, errors, warnings: findings.length - errors, findings }
}

export function formatCheck(res, { limit = 0 } = {}) {
  const head = res.ok
    ? `strata check: ok (${res.warnings} warning${res.warnings === 1 ? '' : 's'})`
    : `strata check: ${res.errors} error${res.errors === 1 ? '' : 's'}, ${res.warnings} warning${res.warnings === 1 ? '' : 's'}`
  const list = limit ? res.findings.slice(0, limit) : res.findings
  const lines = [head, ...list.map((f) => `  [${f.level}] ${f.path}: ${f.detail}`)]
  if (limit && res.findings.length > limit) lines.push(`  … ${res.findings.length - limit} more (run strata check)`)
  return lines.join('\n')
}
