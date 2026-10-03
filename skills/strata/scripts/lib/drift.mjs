// Docs and decision drift (ADR-0018): commits since the last save that no
// decision record, doc, issue, learning, changelog or pending capture mentions.
//
// The save marker is the commit recorded by the last `save --prepare` in the
// shared state file; when that is missing or no longer an ancestor of HEAD, the
// last commit that touched project_state.md; with neither, the last 20 commits.

import path from 'node:path'
import { git, gitOut, inGit, walk, readLf, readState, updateState, exists, currentBranch } from './core.mjs'
import { readIssues } from './model.mjs'
import { readJournal } from './journal.mjs'

const MAX_COMMITS = 200
const CORPUS_CAP = 32 * 1024 * 1024

function sub(project) {
  const top = gitOut(project, ['rev-parse', '--show-toplevel'])
  return { top: top ? path.resolve(top) : project, rel: top ? path.relative(path.resolve(top), project).split(path.sep).join('/') : '' }
}

export function saveMarker(roots) {
  const { project, shared } = roots
  const st = readState(shared)
  const c = st.last_save && st.last_save.commit
  if (c && git(project, ['merge-base', '--is-ancestor', c, 'HEAD']).ok) return { commit: c, source: 'last save' }
  const { rel } = sub(project)
  const ps = (rel ? rel + '/' : '') + '.strata/memory/project_state.md'
  const last = gitOut(project, ['log', '-1', '--format=%H', '--', ps])
  if (last) return { commit: last, source: 'last commit touching project_state.md' }
  return null
}

export function recordSaveMarker(roots) {
  const head = gitOut(roots.project, ['rev-parse', 'HEAD'])
  if (!head) return null
  updateState(roots.shared, (st) => {
    st.last_save = { commit: head, at: new Date().toISOString(), branch: currentBranch(roots.project) }
    return st
  })
  return head
}

function corpus(project, shared, top) {
  const parts = []
  let size = 0
  const addText = (t) => { if (t && size < CORPUS_CAP) { parts.push(t); size += t.length } }
  const addDir = (dir) => {
    for (const f of walk(dir, (name, full, isDirectory) => (isDirectory ? name === 'node_modules' || name === '.git' || name === 'inbox' : !name.endsWith('.md')))) {
      if (size >= CORPUS_CAP) break
      addText(readLf(f))
    }
  }
  addDir(path.join(project, '.strata', 'docs'))
  addDir(path.join(project, '.strata', 'issues'))
  addDir(path.join(project, '.strata', 'memory', 'learnings'))
  for (const d of new Set([path.join(project, 'docs'), path.join(top, 'docs')])) if (exists(d)) addDir(d)
  for (const f of new Set([path.join(project, 'CHANGELOG.md'), path.join(top, 'CHANGELOG.md')])) addText(readLf(f))
  for (const e of readJournal(shared)) addText([e.title, e.text, e.lineage, ...(e.refs || [])].filter(Boolean).join('\n'))
  return parts.join('\n').toLowerCase()
}

function decisionNumbers(project, top) {
  const nums = new Set()
  for (const d of [path.join(project, '.strata', 'docs', 'decisions'), path.join(top, 'docs', 'decisions')]) {
    for (const f of walk(d, () => false)) {
      const m = /^ADR-(\d{3,})/i.exec(path.basename(f))
      if (m) nums.add(Number(m[1]))
    }
  }
  return nums
}

function mergeBranch(subject) {
  let m = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(subject)
  if (m) return m[1]
  m = /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject)
  if (m) return m[1]
  return null
}

export function driftList(roots, { since } = {}) {
  const { project, shared } = roots
  if (!inGit(project) || !gitOut(project, ['rev-parse', '--verify', '-q', 'HEAD'])) return { inGit: false, marker: null, checked: 0, drift: [] }
  const { top, rel } = sub(project)
  const marker = since ? { commit: since, source: '--since' } : saveMarker(roots)
  const args = ['log', '--first-parent', '-m', '--name-only', '--no-renames', `-n${marker ? MAX_COMMITS : 20}`,
    '--format=%x1e%H%x1f%P%x1f%s%x1f%b%x1f']
  args.push(marker ? `${marker.commit}..HEAD` : 'HEAD')
  const r = git(project, args)
  if (!r.ok) return { inGit: true, marker, checked: 0, drift: [], error: r.stderr.trim() }

  const strataPrefix = (rel ? rel + '/' : '') + '.strata/'
  const commits = []
  for (const rec of r.stdout.split('\x1e')) {
    if (!rec.trim()) continue
    const [sha, parents, subject, body, rest = ''] = rec.split('\x1f')
    const files = [...new Set(rest.split('\n').map((s) => s.trim()).filter(Boolean))]
    commits.push({ sha, short: sha.slice(0, 7), parents: parents.trim().split(/\s+/).filter(Boolean), subject: subject.trim(), body: body || '', files })
  }

  const text = corpus(project, shared, top)
  const ids = new Set(readIssues(project, { includeArchive: true }).map((i) => i.id).filter(Boolean))
  const adrs = decisionNumbers(project, top)
  const drift = []
  let checked = 0
  for (const c of commits) {
    const files = c.files.filter((f) => !f.startsWith(strataPrefix))
    if (!files.length) continue // memory-only commits are the saves themselves
    checked++
    const msg = `${c.subject}\n${c.body}`
    let referenced = false
    for (const m of msg.matchAll(/\b(\d{8}-\d{2,})\b/g)) if (ids.has(m[1])) referenced = true
    for (const m of msg.matchAll(/\bADR-(\d{3,})\b/gi)) if (adrs.has(Number(m[1]))) referenced = true
    if (!referenced && (text.includes(c.short.toLowerCase()) || text.includes(c.sha.toLowerCase()))) referenced = true
    const branch = c.parents.length > 1 ? mergeBranch(c.subject) : null
    if (!referenced && branch) {
      const b = branch.toLowerCase()
      const leaf = b.split('/').pop()
      if (text.includes(b) || (leaf.length >= 6 && text.includes(leaf))) referenced = true
    }
    if (!referenced) {
      for (const f of files) {
        const fl = f.toLowerCase()
        const rf = rel && fl.startsWith(rel.toLowerCase() + '/') ? fl.slice(rel.length + 1) : fl
        const parent = path.posix.dirname(rf)
        if (text.includes(fl) || text.includes(rf) || (parent.includes('/') && text.includes(parent))) { referenced = true; break }
      }
    }
    if (!referenced) drift.push({ sha: c.sha, short: c.short, subject: c.subject, files, merge: c.parents.length > 1, branch })
  }
  return { inGit: true, marker, checked, drift }
}

export function formatDrift(res, { limit = 15 } = {}) {
  if (!res.inGit) return 'drift: not a git repository with commits'
  const since = res.marker ? `since ${res.marker.commit.slice(0, 7)} (${res.marker.source})` : 'in the last 20 commits'
  if (!res.drift.length) return `drift: none. ${res.checked} commit${res.checked === 1 ? '' : 's'} ${since}, all mentioned by a record.`
  const lines = [`drift: ${res.drift.length} of ${res.checked} commit${res.checked === 1 ? '' : 's'} ${since} that no decision, doc, issue or learning mentions:`]
  for (const d of res.drift.slice(0, limit)) {
    const files = d.files.slice(0, 3).join(', ') + (d.files.length > 3 ? ` +${d.files.length - 3}` : '')
    lines.push(`  ${d.short} ${d.subject}${d.branch ? ` [${d.branch}]` : ''} (${files})`)
  }
  if (res.drift.length > limit) lines.push(`  … ${res.drift.length - limit} more`)
  return lines.join('\n')
}
