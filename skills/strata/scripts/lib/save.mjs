// `strata save --prepare`: every mechanical /strata:save step, then a report of
// what changed and what needs the agent's judgment. `--dry-run` changes nothing.

import fs from 'node:fs'
import path from 'node:path'
import { readLf, writeText, exists, relPosix, git, inGit, today, plural } from './core.mjs'
import { readIssues, TERMINAL, cell } from './model.mjs'
import { syncViews } from './views.mjs'
import { runCheck, BUDGETS } from './check.mjs'
import { readJournal, journalSummaryLine } from './journal.mjs'
import { inboxSummary } from './inbox.mjs'

// Extra steps registered by later modules (inbox summary, merge driver refresh,
// drift list, auto-memory pointer). Each gets (roots, ctx) and adds to ctx.
const extraSteps = []
export function registerSaveStep(step) { extraSteps.push(step) }

const ARCHIVE_INDEX_HEAD = [
  '# Closed issues',
  '',
  'Resolved and wont-fix items, moved here by `/strata:save`. One row per item, in the order they closed. Grep this folder for history.',
  '',
  '| Id | Status | Closed | What |',
  '|---|---|---|---|',
]

// --- 1. archive terminal issues ---------------------------------------------------
function trackedState(project, file) {
  if (!inGit(project)) return { tracked: false, unmerged: false }
  const rel = relPosix(project, file)
  const tracked = git(project, ['ls-files', '--error-unmatch', '--', rel]).ok
  const st = git(project, ['status', '--porcelain', '--', rel]).stdout
  const code = st.slice(0, 2)
  const unmerged = /^(DD|AU|UD|UA|DU|AA|UU)$/.test(code)
  return { tracked, unmerged, dirty: st.trim().length > 0 }
}

function archiveIssues(project, ctx) {
  const issues = readIssues(project).filter((i) => i.frontmatter && TERMINAL.includes(i.status) && i.topLevel)
  if (!issues.length) return
  const archiveDir = path.join(project, '.strata', 'issues', 'archive')
  const indexFile = path.join(archiveDir, 'INDEX.md')
  let index = readLf(indexFile)
  const rows = []
  for (const i of issues) {
    const st = trackedState(project, i.file)
    const from = relPosix(project, i.file)
    if (st.unmerged) { ctx.judgment.push(`skipped ${from}: it has an unresolved merge conflict`); continue }
    const dest = path.join(archiveDir, path.basename(i.file))
    if (exists(dest)) { ctx.judgment.push(`skipped ${from}: issues/archive/${path.basename(i.file)} already exists`); continue }
    const note = st.dirty ? ' (carries uncommitted edits; commit them with this save)' : ''
    ctx.changed.push(`move ${from} -> issues/archive/ (${i.status})${note}`)
    if (!ctx.dryRun) {
      fs.mkdirSync(archiveDir, { recursive: true })
      if (st.tracked) {
        const r = git(project, ['mv', '--', from, relPosix(project, dest)])
        if (!r.ok) fs.renameSync(i.file, dest)
      } else {
        fs.renameSync(i.file, dest)
      }
    }
    const id = i.id || path.basename(i.file, '.md')
    if (!index || !index.includes(`[${id}](`)) rows.push(`| [${cell(id)}](${path.basename(i.file)}) | ${cell(i.status)} | ${today()} | ${cell(i.what, 140)} |`)
  }
  if (rows.length) {
    ctx.changed.push(`append ${plural(rows.length, 'row')} to .strata/issues/archive/INDEX.md`)
    if (!ctx.dryRun) {
      const base = index == null ? ARCHIVE_INDEX_HEAD.join('\n') + '\n' : (index.endsWith('\n') ? index : index + '\n')
      writeText(indexFile, base + rows.join('\n') + '\n')
    }
  }
}

// --- 2. roll old sessions out of project_state.md -----------------------------------
export function sessionBlocks(lines) {
  const heads = []
  lines.forEach((l, n) => { if (/^##\s/.test(l)) heads.push(n) })
  const blocks = []
  heads.forEach((start, k) => {
    const end = k + 1 < heads.length ? heads[k + 1] : lines.length
    const m = /\bsession\s+#?(\d+)\b/i.exec(lines[start])
    blocks.push({ start, end, session: m ? Number(m[1]) : null, head: lines[start] })
  })
  return blocks
}

function rollSessions(project, ctx) {
  const file = path.join(project, '.strata', 'memory', 'project_state.md')
  const text = readLf(file)
  if (text == null) return
  const lines = text.split('\n')
  const blocks = sessionBlocks(lines).filter((b) => b.session !== null)
  if (blocks.length <= 2) {
    const total = text.endsWith('\n') ? lines.length - 1 : lines.length
    if (total > BUDGETS.state && blocks.length === 0) ctx.judgment.push('project_state.md is over budget and has no numbered session headings to roll; trim it by hand')
    return
  }
  const keep = new Set(blocks.map((b) => b.session).sort((a, b) => b - a).slice(0, 2))
  const roll = blocks.filter((b) => !keep.has(b.session))
  const nums = roll.map((b) => b.session).sort((a, b) => a - b)
  const lo = nums[0]; const hi = nums[nums.length - 1]
  const month = today().slice(0, 7)
  const name = `${month}-sessions-${lo === hi ? lo : `${lo}-${hi}`}.md`
  const archiveFile = path.join(project, '.strata', 'memory', 'archive', name)
  ctx.changed.push(`roll ${plural(roll.length, 'session')} (${nums.join(', ')}) from project_state.md -> .strata/memory/archive/${name} (+ ARCHIVE.md row)`)
  if (ctx.dryRun) return
  const rolledText = roll.sort((a, b) => a.start - b.start)
    .map((b) => lines.slice(b.start, b.end).join('\n').replace(/\n+$/, '')).join('\n\n') + '\n'
  const existing = readLf(archiveFile)
  const head = `# Sessions ${lo === hi ? lo : `${lo} to ${hi}`}\n\nRolled out of \`project_state.md\` by \`/strata:save\` on ${today()}.\n\n`
  writeText(archiveFile, existing == null ? head + rolledText : existing.replace(/\n*$/, '\n\n') + rolledText)
  const drop = new Set()
  for (const b of roll) for (let n = b.start; n < b.end; n++) drop.add(n)
  writeText(file, lines.filter((_, n) => !drop.has(n)).join('\n'))
  addArchiveRow(project, name, `Sessions ${nums.join(', ')} rolled from project_state.md on ${today()}`)
}

export function addArchiveRow(project, name, what) {
  const file = path.join(project, '.strata', 'memory', 'archive', 'ARCHIVE.md')
  const text = readLf(file)
  const row = `| \`${name}\` | ${cell(what)} |`
  if (text == null) {
    writeText(file, `# Archive Index\n\n## Files\n\n### Session snapshots\n\n| File | What it is |\n|---|---|\n${row}\n`)
    return
  }
  if (text.includes(`\`${name}\``)) return
  const lines = text.split('\n')
  const h = lines.findIndex((l) => /^###\s+Session snapshots/i.test(l))
  if (h < 0) {
    writeText(file, text.replace(/\n*$/, '\n\n') + `### Session snapshots\n\n| File | What it is |\n|---|---|\n${row}\n`)
    return
  }
  let end = lines.length
  for (let n = h + 1; n < lines.length; n++) if (/^#{1,3}\s/.test(lines[n])) { end = n; break }
  const section = lines.slice(h + 1, end)
  const placeholder = section.findIndex((l) => /^_No files yet\._\s*$/.test(l.trim()))
  if (placeholder >= 0) {
    lines.splice(h + 1 + placeholder, 1, '| File | What it is |', '|---|---|', row)
  } else {
    let lastRow = -1
    section.forEach((l, k) => { if (/^\|/.test(l)) lastRow = k })
    if (lastRow >= 0) lines.splice(h + 1 + lastRow + 1, 0, row)
    else lines.splice(h + 1, 0, '', '| File | What it is |', '|---|---|', row)
  }
  writeText(file, lines.join('\n'))
}

// --- the run ------------------------------------------------------------------------
export async function prepare(roots, { dryRun = false, ...opts } = {}) {
  const ctx = { dryRun, changed: [], judgment: [], info: {}, opts }
  const { project } = roots

  archiveIssues(project, ctx)
  rollSessions(project, ctx)

  const v = syncViews(project, { check: dryRun })
  const touched = v.views.filter((x) => ['updated', 'created', 'stale'].includes(x.state)).map((x) => x.file)
  const hotTouched = v.hot.results.filter((h) => ['updated', 'stale', 'installed'].includes(h.state)).map((h) => `${h.file} (hot rules)`)
  if (touched.length || hotTouched.length) ctx.changed.push(`regenerate ${[...touched, ...hotTouched].join(', ')}`)
  if (v.external) ctx.info.views = 'external'
  if (v.hot.overflow) ctx.judgment.push(`hot rules: ${v.hot.overflow} over the adapter block budget (${v.hot.total} hot); curate the hot set`)
  for (const x of v.views) if (x.state === 'no-table') ctx.judgment.push(`${x.file}: no generated rules table found; add one under "## Rules by trigger"`)

  for (const step of extraSteps) await step(roots, ctx)

  const entries = readJournal(roots.shared)
  ctx.info.journal = entries.length
  if (entries.length) ctx.judgment.unshift(`${journalSummaryLine(entries)} Then run strata journal clear --all.`)

  const inbox = inboxSummary(roots.shared)
  ctx.info.inbox = { total: inbox.total, counts: inbox.counts, repeated: inbox.repeated }
  if (inbox.total) {
    const rep = inbox.repeated.slice(0, 5).map((g) => `${g.count}x ${g.command || g.signal}`).join('; ')
    ctx.judgment.push(`${inbox.line}${rep ? ` Repeated: ${rep}.` : ''} Promote what is worth keeping, then run strata inbox clear.`)
  }

  const issues = readIssues(project)
  const parked = issues.filter((i) => i.status === 'parked')
  if (parked.length) ctx.judgment.push(`parked: check each revive-when against this session: ${parked.map((i) => `${i.id} (${i.revive || 'no trigger'})`).join('; ')}`)

  const chk = runCheck(project)
  // After a dry run the views are expected to differ; do not report that twice.
  const findings = chk.findings.filter((f) => !(dryRun && (f.code === 'view-drift' || f.code === 'hot-rules-drift' || f.code === 'terminal-not-archived' || (f.code === 'budget-state' && ctx.changed.some((c) => c.startsWith('roll '))))))
  ctx.check = { errors: findings.filter((f) => f.level === 'error').length, warnings: findings.filter((f) => f.level === 'warn').length, findings }
  for (const f of findings) ctx.judgment.push(`check [${f.level}] ${f.path}: ${f.detail}`)
  return ctx
}

export function formatPrepare(ctx) {
  const lines = [`strata save --prepare${ctx.dryRun ? ' (dry run: nothing written)' : ''}`, '']
  lines.push(ctx.dryRun ? 'Would change:' : 'Changed:')
  if (ctx.changed.length) for (const c of ctx.changed) lines.push(`- ${c}`)
  else lines.push('- nothing')
  lines.push('', 'Needs judgment:')
  if (ctx.judgment.length) for (const j of ctx.judgment) lines.push(`- ${j}`)
  else lines.push('- nothing')
  if (ctx.drift && ctx.drift.length) {
    lines.push('', `Drift list (${ctx.drift.length} commit${ctx.drift.length === 1 ? '' : 's'} since the last save that no record mentions):`)
    for (const d of ctx.drift.slice(0, 15)) lines.push(`- ${d.short} ${d.subject}${d.files.length ? ` (${d.files.slice(0, 3).join(', ')}${d.files.length > 3 ? ` +${d.files.length - 3}` : ''})` : ''}`)
    if (ctx.drift.length > 15) lines.push(`- … ${ctx.drift.length - 15} more (strata drift)`)
  }
  return lines.join('\n')
}
