// Where /strata:save writes the row for an archived issue (ADR-0021).

import path from 'node:path'
import { readLf } from './core.mjs'
import { cell } from './model.mjs'
import { parseFrontmatter } from './frontmatter.mjs'

export const ARCHIVE_INDEX_HEAD = [
  '# Closed issues',
  '',
  'Resolved and wont-fix items, moved here by `/strata:save`. One row per item, in the order they closed. Grep this folder for history.',
  '',
  '| Id | Status | Closed | What |',
  '|---|---|---|---|',
]

// The archive index (ADR-0021): `archive_index:` in the MANIFEST frontmatter
// names it; otherwise an existing README.md or INDEX.md that already holds an
// archive table; otherwise INDEX.md. Rows go to that one file only.
export function archiveIndexFile(project) {
  const dir = path.join(project, '.strata', 'issues', 'archive')
  const fm = parseFrontmatter(readLf(path.join(project, '.strata', 'MANIFEST.md')) || '').data
  const named = String(fm.archive_index || '').trim()
  if (named && validArchiveIndexName(named)) return { file: path.join(dir, named), source: 'manifest' }
  for (const name of ['README.md', 'INDEX.md']) {
    const text = readLf(path.join(dir, name))
    if (text != null && findArchiveTable(text.split('\n'))) return { file: path.join(dir, name), source: 'detected' }
  }
  return { file: path.join(dir, 'INDEX.md'), source: 'default' }
}

export function validArchiveIndexName(name) {
  return /^[^/\\]+\.md$/i.test(name) && name !== '.md'
}

export const cellsOfRow = (l) => l.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map((c) => c.trim())
const ID_HEAD = /^(id|issue|item)$/i

// The table that lists closed issues: its header names an id column, or its
// rows link to item files. Returns { header, start, end } (line indexes, end
// exclusive) or null.
export function findArchiveTable(lines) {
  let found = null
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) continue
    let end = i + 2
    while (end < lines.length && /^\s*\|/.test(lines[end])) end++
    const header = cellsOfRow(lines[i])
    const linksItems = lines.slice(i + 2, end).some((l) => /\]\([^)]+\.md\)/.test(l))
    if (header.some((h) => ID_HEAD.test(h)) || linksItems) found = { header, start: i, end }
    i = end - 1
  }
  return found
}

// One row in the target table's own columns.
export function archiveRow(header, { id, file, status, closed, what }) {
  const link = `[${cell(id)}](${file})`
  let idCol = header.findIndex((h) => ID_HEAD.test(h))
  if (idCol < 0) idCol = 0
  return '| ' + header.map((h, n) => {
    const k = h.toLowerCase().replace(/[^a-z]/g, '')
    if (n === idCol) return link
    if (['status', 'state', 'outcome', 'resolution'].includes(k)) return cell(status)
    if (['closed', 'date', 'when', 'resolved', 'archived', 'closedon', 'done'].includes(k)) return closed
    if (['what', 'title', 'summary', 'description', 'subject', 'name'].includes(k)) return cell(what, 140)
    return ''
  }).join(' | ') + ' |'
}

