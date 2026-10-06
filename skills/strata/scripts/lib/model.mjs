// Reads the strata source records (issues, learnings) into plain objects.
// Views, checks, the hot-rules block and the save chores all start here.

import fs from 'node:fs'
import path from 'node:path'
import { parseFrontmatter, labelLine, labelParagraph, firstParagraph, firstHeading } from './frontmatter.mjs'
import { walk, relPosix, readLf } from './core.mjs'

export const ISSUE_VIEW_FILES = new Set(['ACTIVE.md', 'OPEN.md', 'PARKED.md', 'README.md', '_TEMPLATE.md', 'INDEX.md'])
export const LEARNING_SKIP = new Set(['INDEX.md', '_TEMPLATE.md', 'README.md'])

export const TYPES = ['bug', 'improvement', 'debt', 'task', 'feature', 'initiative']
export const STATUSES = ['open', 'in-progress', 'parked', 'resolved', 'wont-fix']
export const SEVERITIES = ['high', 'med', 'low']
export const ORIGINS = ['success', 'failure']
export const LIVE = ['open', 'in-progress', 'parked']
export const TERMINAL = ['resolved', 'wont-fix']

export function issuesDir(project) { return path.join(project, '.strata', 'issues') }
export function learningsDir(project) { return path.join(project, '.strata', 'memory', 'learnings') }

// Every issue-like file under issues/. `archived` marks files under archive/.
export function readIssues(project, { includeArchive = false } = {}) {
  const dir = issuesDir(project)
  const files = walk(dir, (name, full, isDirectory) => {
    if (isDirectory) return name === 'archive' && !includeArchive && path.dirname(full) === dir
    return !name.endsWith('.md') || ISSUE_VIEW_FILES.has(name) || name.startsWith('_')
  })
  const out = []
  for (const file of files) {
    const text = readLf(file)
    if (text == null) continue
    const fm = parseFrontmatter(text)
    const rel = relPosix(dir, file)
    const archived = rel.split('/')[0] === 'archive'
    const what = labelLine(fm.body, 'What') || firstHeading(fm.body) || path.basename(file, '.md').replace(/-/g, ' ')
    out.push({
      file, rel, archived, topLevel: !rel.includes('/'), frontmatter: fm.present,
      ...fm.data,
      id: fm.data.id || '', status: fm.data.status || '', type: fm.data.type || '',
      severity: fm.data.severity || '', area: fm.data.area || '', what,
      revive: fm.data['revive-when'] || '',
    })
  }
  return out
}

export function readLearnings(project) {
  const dir = learningsDir(project)
  let names = []
  try { names = fs.readdirSync(dir) } catch { return [] }
  const out = []
  for (const name of names.sort()) {
    if (!name.endsWith('.md') || LEARNING_SKIP.has(name)) continue
    const file = path.join(dir, name)
    const text = readLf(file)
    if (text == null) continue
    const fm = parseFrontmatter(text)
    const lesson = labelParagraph(fm.body, 'Lesson') || firstParagraph(fm.body)
    out.push({
      file, name, slug: name.replace(/\.md$/, ''), frontmatter: fm.present,
      trigger: fm.data.trigger || '', appliesWhen: fm.data['applies-when'] || '',
      origin: fm.data.origin || '', hot: Object.prototype.hasOwnProperty.call(fm.data, 'hot') ? String(fm.data.hot).trim().toLowerCase() : null,
      lesson,
    })
  }
  return out
}

// ADR-0015: once any learning carries a `hot:` flag, only `hot: true` ones are
// hot; until then every learning is (the graceful default).
export function hotSubset(learnings) {
  const flagged = learnings.some((l) => l.hot !== null)
  return flagged ? learnings.filter((l) => l.hot === 'true') : learnings.slice()
}

export function byTrigger(a, b) {
  const x = a.trigger.toLowerCase(); const y = b.trigger.toLowerCase()
  if (x !== y) return x < y ? -1 : 1
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

const SEV_RANK = { high: 0, med: 1, low: 2 }
export function sevRank(s) { return Object.prototype.hasOwnProperty.call(SEV_RANK, s) ? SEV_RANK[s] : 3 }

export function byIssueOrder(a, b) {
  const s = sevRank(a.severity) - sevRank(b.severity)
  if (s) return s
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0
}

export function byId(a, b) {
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0
}

// Markdown table cell: one line, pipes escaped, optionally shortened.
export function cell(v, max = 0) {
  let s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')
  if (max && s.length > max) s = s.slice(0, max - 1).trimEnd() + '…'
  return s
}

export function firstSentence(text, max = 220) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  const m = /^(.+?[.!?])(?=\s|$)/.exec(t)
  let s = m ? m[1] : t
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + '…'
  return s
}
