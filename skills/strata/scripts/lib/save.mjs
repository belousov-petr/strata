// `strata save --prepare`: every mechanical /strata:save step, then a report of
// what changed and what needs the agent's judgment. `--dry-run` changes nothing.

import fs from 'node:fs'
import path from 'node:path'
import { readLf, writeText, exists, relPosix, git, inGit, today, plural } from './core.mjs'
import { readIssues, findIssue, TERMINAL, cell } from './model.mjs'
import { ARCHIVE_INDEX_HEAD, archiveIndexFile, findArchiveTable, archiveRow, cellsOfRow } from './archive-index.mjs'
import { syncViews } from './views.mjs'
import { runCheck, BUDGETS } from './check.mjs'
import { readJournal, journalSummaryLine, markFiled } from './journal.mjs'
import { inboxSummary } from './inbox.mjs'
import { driverState, installDriver } from './setup.mjs'
import { driftList, recordSaveMarker } from './drift.mjs'
import { writePointers } from './pointer.mjs'
import { datedLines } from './dates.mjs'
import { sessionHeading } from './manifest.mjs'
import { versionCheck } from './version.mjs'


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
  const issues = readIssues(project).filter((i) => i.frontmatter && i.id && TERMINAL.includes(i.status) && i.topLevel)
  if (!issues.length) return
  const archiveDir = path.join(project, '.strata', 'issues', 'archive')
  const target = archiveIndexFile(project)
  const indexFile = target.file
  const indexRel = relPosix(project, indexFile)
  let index = readLf(indexFile)
  const table = index != null ? findArchiveTable(index.split('\n')) : null
  const header = table ? table.header : cellsOfRow(ARCHIVE_INDEX_HEAD[4])
  const has = (id) => index != null && (index.includes(`[${id}](`) || index.split('\n').some((l) => /^\s*\|/.test(l) && cellsOfRow(l)[0] === id))
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
    if (!has(id)) rows.push(archiveRow(header, { id, file: path.basename(i.file), status: i.status, closed: today(), what: i.what }))
  }
  if (rows.length) {
    ctx.changed.push(`append ${plural(rows.length, 'row')} to ${indexRel}`)
    if (!ctx.dryRun) {
      let next
      if (index == null) next = ARCHIVE_INDEX_HEAD.join('\n') + '\n' + rows.join('\n') + '\n'
      else if (table) {
        const lines = index.split('\n')
        lines.splice(table.end, 0, ...rows)
        next = lines.join('\n')
      } else {
        next = index.replace(/\n*$/, '\n\n') + ARCHIVE_INDEX_HEAD.slice(4).join('\n') + '\n' + rows.join('\n') + '\n'
      }
      writeText(indexFile, next)
    }
  }
}

// --- 0. journal entries routed to an issue (ADR-0022) -------------------------------
function localDate(ts) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return today()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// `**Update <date> (journal <id>):** <title>. <text>`
export function updateParagraph(e) {
  const title = String(e.title || '').trim()
  let text = String(e.text || '').trim()
  if (text && title && text.startsWith(title)) text = text.slice(title.length).trim()
  const head = title && !/[.!?:]$/.test(title) ? `${title}.` : title
  return `**Update ${localDate(e.ts)} (journal ${e.id}):** ${[head, text].filter(Boolean).join(' ')}`.trim()
}

// Insert before the Resolution line, or at the end, with blank lines around.
export function insertUpdate(body, para) {
  const lines = body.replace(/\n*$/, '').split('\n')
  const at = lines.findIndex((l) => /^\*\*Resolution:\*\*/.test(l))
  if (at < 0) return lines.join('\n') + '\n\n' + para + '\n'
  const before = lines.slice(0, at)
  while (before.length && !before[before.length - 1].trim()) before.pop()
  return [...before, '', para, '', ...lines.slice(at)].join('\n') + '\n'
}

function appendJournalUpdates(roots, ctx) {
  const { project } = roots
  const pending = readJournal(roots.shared).filter((e) => e.route === 'append' && !e.filed)
  const filed = {}
  for (const e of pending) {
    const ref = (e.refs || [])[0]
    const target = findIssue(project, ref)
    if (!target || target.archived || !target.topLevel) {
      ctx.judgment.push(`journal ${e.id} asks to be appended to '${ref}', which is not a live issue here; route it by hand`)
      continue
    }
    const rel = relPosix(project, target.file)
    const cur = readLf(target.file)
    if (cur == null) continue
    if (cur.includes(`(journal ${e.id})`)) { filed[e.id] = rel; continue }
    ctx.changed.push(`append journal ${e.id} to ${rel} as a dated update`)
    ctx.appended = (ctx.appended || 0) + 1
    if (!ctx.dryRun) {
      writeText(target.file, insertUpdate(cur, updateParagraph(e)))
      filed[e.id] = rel
    }
  }
  if (!ctx.dryRun) markFiled(roots, filed)
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

export function headingText(line) { return String(line).replace(/^##\s+/, '').trim() }

function rollSessions(project, ctx) {
  const file = path.join(project, '.strata', 'memory', 'project_state.md')
  const text = readLf(file)
  if (text == null) return
  const lines = text.split('\n')
  const total = text.endsWith('\n') ? lines.length - 1 : lines.length
  const sh = sessionHeading(project)
  if (sh && sh.error) {
    ctx.judgment.push(`session_heading in MANIFEST.md is not a valid regular expression, so no sessions were rolled. ${sh.error} Fix it and run strata save --prepare again.`)
    return
  }
  if (sh) return rollByHeading(project, ctx, { file, lines, total }, sh.re)
  const blocks = sessionBlocks(lines).filter((b) => b.session !== null)
  if (blocks.length <= 2) {
    if (total > BUDGETS.state && blocks.length === 0) ctx.judgment.push('project_state.md is over budget and has no numbered session headings to roll; trim it by hand, or name your session headings with session_heading: in MANIFEST.md')
    return
  }
  const keep = new Set(blocks.map((b) => b.session).sort((a, b) => b - a).slice(0, 2))
  const roll = blocks.filter((b) => !keep.has(b.session))
  const nums = roll.map((b) => b.session).sort((a, b) => a - b)
  const lo = nums[0]; const hi = nums[nums.length - 1]
  const name = `${today().slice(0, 7)}-sessions-${lo === hi ? lo : `${lo}-${hi}`}.md`
  ctx.changed.push(`roll ${plural(roll.length, 'session')} (${nums.join(', ')}) from project_state.md -> .strata/memory/archive/${name} (+ ARCHIVE.md row)`)
  if (ctx.dryRun) return
  writeRoll(project, { file, lines }, roll, name, `# Sessions ${lo === hi ? lo : `${lo} to ${hi}`}`,
    `Sessions ${nums.join(', ')} rolled from project_state.md on ${today()}`)
}

// ADR-0029: with `session_heading:` every matching `## ` block is a session,
// in file order, newest first. The first two stay; the rest roll into one file
// named by the first date in the rolled headings, or today.
function rollByHeading(project, ctx, { file, lines, total }, re) {
  const blocks = sessionBlocks(lines).filter((b) => re.test(headingText(b.head)))
  if (blocks.length <= 2) {
    if (total > BUDGETS.state && blocks.length === 0) ctx.judgment.push('project_state.md is over budget and no heading matches session_heading in MANIFEST.md; trim it by hand or fix the pattern')
    return
  }
  const roll = blocks.slice(2)
  const heads = roll.map((b) => headingText(b.head))
  let date = null
  for (const h of heads) { const m = /\b(\d{4}-\d{2}-\d{2})\b/.exec(h); if (m) { date = m[1]; break } }
  const name = `${today().slice(0, 7)}-sessions-${date || today()}.md`
  const short = heads.map((h) => cell(h, 60)).join('; ')
  ctx.changed.push(`roll ${plural(roll.length, 'session block')} (${short}) from project_state.md -> .strata/memory/archive/${name} (+ ARCHIVE.md row)`)
  if (ctx.dryRun) return
  writeRoll(project, { file, lines }, roll, name, '# Sessions from project_state.md',
    `${plural(roll.length, 'session block')} rolled from project_state.md on ${today()}: ${short}`)
}

// Append the rolled blocks to the archive file, drop them from project_state.md,
// and add the ARCHIVE.md row.
function writeRoll(project, { file, lines }, roll, name, title, what) {
  const archiveFile = path.join(project, '.strata', 'memory', 'archive', name)
  const rolledText = roll.slice().sort((a, b) => a.start - b.start)
    .map((b) => lines.slice(b.start, b.end).join('\n').replace(/\n+$/, '')).join('\n\n') + '\n'
  const existing = readLf(archiveFile)
  const head = `${title}\n\nRolled out of \`project_state.md\` by \`/strata:save\` on ${today()}.\n\n`
  writeText(archiveFile, existing == null ? head + rolledText : existing.replace(/\n*$/, '\n\n') + rolledText)
  const drop = new Set()
  for (const b of roll) for (let n = b.start; n < b.end; n++) drop.add(n)
  writeText(file, lines.filter((_, n) => !drop.has(n)).join('\n'))
  addArchiveRow(project, name, what)
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
  // ADR-0030: a newer strata installed than the one running mixes versions.
  ctx.version = versionCheck()

  appendJournalUpdates(roots, ctx)
  archiveIssues(project, ctx)
  rollSessions(project, ctx)

  const v = syncViews(project, { check: dryRun })
  const touched = v.views.filter((x) => ['updated', 'created', 'stale'].includes(x.state)).map((x) => x.file)
  const hotTouched = v.hot.results.filter((h) => ['updated', 'stale', 'installed', 'created'].includes(h.state)).map((h) => `${h.file} (hot rules)`)
  if (touched.length || hotTouched.length) ctx.changed.push(`regenerate ${[...touched, ...hotTouched].join(', ')}`)
  if (v.external) ctx.info.views = 'external'
  if (v.hot.overflow) ctx.judgment.push(`hot rules: ${v.hot.overflow} over the adapter block budget (${v.hot.total} hot); curate the hot set`)
  for (const x of v.views) if (x.state === 'no-table') ctx.judgment.push(`${x.file}: no generated rules table found; add one under "## Rules by trigger"`)

  const drv = driverState(project)
  if (drv.inGit && drv.configured && !drv.current) {
    installDriver(project, dryRun)
    ctx.changed.push('refresh the generated-views merge driver path in local git config (the plugin moved)')
  }

  const drift = driftList(roots)
  ctx.drift = drift.drift
  ctx.info.drift = { marker: drift.marker, checked: drift.checked, unreferenced: drift.drift.length }
  if (drift.inGit && !dryRun) {
    const head = recordSaveMarker(roots)
    if (head) ctx.info.marker = head
  }

  if (opts.pointer !== false) {
    const ptr = writePointers(roots, { dryRun })
    for (const d of ptr.dirs) {
      if (d.pointer !== 'current' || d.index !== 'current') ctx.changed.push(`Claude auto-memory pointer: ${d.pointer === 'current' ? 'index line ' + d.index : 'strata-pointer.md ' + d.pointer} in ${d.dir}`)
    }
  }


  const entries = readJournal(roots.shared)
  ctx.info.journal = entries.length
  if (entries.length) {
    const n = ctx.appended || 0
    const verb = ctx.dryRun ? 'would be appended' : n === 1 ? 'was appended' : 'were appended'
    const appended = n ? ` ${n} ${verb} to ${n === 1 ? 'its issue' : 'their issues'} by save --prepare${ctx.dryRun ? '' : ' and marked filed'}; route the rest.` : ''
    ctx.judgment.unshift(`${journalSummaryLine(entries)}${appended} Then run strata journal clear --all.`)
  }

  const inbox = inboxSummary(roots.shared)
  ctx.info.inbox = { total: inbox.total, counts: inbox.counts, repeated: inbox.repeated, benign: inbox.benign, refused: inbox.refused }
  if (inbox.total || inbox.benign.total) {
    const rep = inbox.repeated.slice(0, 5).map((g) => `${g.count}x ${g.command || g.signal}`).join('; ')
    ctx.judgment.push(`${inbox.line}${rep ? ` Repeated: ${rep}.` : ''} Promote what is worth keeping, then run strata inbox clear.`)
  }
  if (inbox.refused.length) {
    ctx.judgment.push(`steps refused for the agent; hand them to the operator: ${inbox.refused.slice(0, 10).map((g) => `${g.command || '(command not recorded)'} (${g.signal}${g.count > 1 ? `, ${g.count}x` : ''})`).join('; ')}${inbox.refused.length > 10 ? `; ${inbox.refused.length - 10} more` : ''}`)
  }

  // Dated items (ADR-0023): only reached dates and text triggers are listed.
  const dated = datedLines(readIssues(project), today(), { textLimit: 1000 })
  const p = dated.parked
  if (p.reached.length) ctx.judgment.push(`parked: revive date reached, revive or re-park: ${p.reached.map((e) => `${e.issue.id} (${e.source} ${e.date})`).join('; ')}`)
  if (p.text.length) ctx.judgment.push(`parked: check each revive-when against this session: ${p.text.map((e) => `${e.issue.id} (${e.issue.revive || 'no trigger'})`).join('; ')}`)
  if (p.later.length) ctx.judgment.push(`parked: ${plural(p.later.length, 'item')} wait for a later date (next ${p.later[0].date}); strata due lists them`)
  const d = dated.due
  if (d.overdue.length || d.today.length) ctx.judgment.push(`due: ${[...d.overdue.map((e) => `${e.issue.id} overdue since ${e.date}`), ...d.today.map((e) => `${e.issue.id} due today`)].join('; ')}`)
  ctx.info.dated = { reached: p.reached.length, text: p.text.length, later: p.later.length, overdue: d.overdue.length, dueToday: d.today.length, dueLater: d.later.length }

  const chk = runCheck(project)
  // After a dry run the views are expected to differ; do not report that twice.
  const findings = chk.findings.filter((f) => !(dryRun && (f.code === 'view-drift' || f.code === 'hot-rules-drift' || f.code === 'terminal-not-archived' || (f.code === 'budget-state' && ctx.changed.some((c) => c.startsWith('roll '))))))
  ctx.check = { errors: findings.filter((f) => f.level === 'error').length, warnings: findings.filter((f) => f.level === 'warn').length, findings }
  for (const f of findings) ctx.judgment.push(`check [${f.level}] ${f.path}: ${f.detail}`)
  if (chk.baselined) ctx.info.baselined = chk.baselined
  return ctx
}

export function formatPrepare(ctx) {
  const lines = [`strata save --prepare${ctx.dryRun ? ' (dry run: nothing written)' : ''}`, '']
  if (ctx.version && ctx.version.warning) lines.push(`Warning: ${ctx.version.warning}`, '')
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
