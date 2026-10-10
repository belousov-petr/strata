// Dated backlog items (ADR-0023): a parked issue may carry `revive-on:
// YYYY-MM-DD`, any live issue may carry `due: YYYY-MM-DD`. A date can be
// checked by a machine, so load, status and save list only the dates that have
// arrived and count the rest. A `revive-when:` text that is nothing but a date
// ("on or after 2026-10-12") counts as one; any other text stays a judgment
// call and is listed every time, as before.

import { readIssues, LIVE } from './model.mjs'
import { today as todayIso, plural } from './core.mjs'

export function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim())
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  const p = (x) => String(x).padStart(2, '0')
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`
}

export function daysBetween(a, b) {
  const t = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((t(b) - t(a)) / 86400000)
}

// A revive-when text that is only a date, optionally with a word in front.
const PLAIN_DATE = /^\s*(?:(on or after|not before|no earlier than|after|from|on|by)\s+)?(\d{4}-\d{2}-\d{2})\s*\.?\s*$/i

export function dateFromText(text) {
  const m = PLAIN_DATE.exec(String(text || ''))
  if (!m || !validDate(m[2])) return null
  return { date: m[2], strict: /^after$/i.test(m[1] || '') }
}

// When a parked issue revives: { date, strict, source } or null (text only).
export function reviveDate(i) {
  const on = String(i.reviveOn || '').trim()
  if (validDate(on)) return { date: on, strict: false, source: 'revive-on' }
  const t = dateFromText(i.revive)
  return t ? { ...t, source: 'revive-when' } : null
}

const reached = (r, today) => (r.strict ? today > r.date : today >= r.date)

// Parked items: dates reached, text triggers to judge, dates still ahead.
export function parkedPlan(issues, today = todayIso()) {
  const plan = { reached: [], text: [], later: [] }
  for (const i of issues) {
    if (i.archived || i.status !== 'parked') continue
    const r = reviveDate(i)
    if (!r) plan.text.push({ issue: i })
    else if (reached(r, today)) plan.reached.push({ issue: i, date: r.date, source: r.source })
    else plan.later.push({ issue: i, date: r.date, source: r.source })
  }
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.issue.id < b.issue.id ? -1 : 1)
  plan.reached.sort(byDate)
  plan.later.sort(byDate)
  return plan
}

// Live issues with a due date: overdue, due today, later.
export function duePlan(issues, today = todayIso()) {
  const plan = { overdue: [], today: [], later: [] }
  for (const i of issues) {
    if (i.archived || !LIVE.includes(i.status) || !validDate(i.due)) continue
    const e = { issue: i, date: String(i.due).trim() }
    if (e.date < today) plan.overdue.push(e)
    else if (e.date === today) plan.today.push(e)
    else plan.later.push(e)
  }
  for (const k of Object.keys(plan)) plan[k].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.issue.id < b.issue.id ? -1 : 1))
  return plan
}

const ref = (e) => `${e.issue.id} (${e.date})`

function short(s, max = 80) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

// Lines for status and save --prepare. Empty when nothing is parked or due.
export function datedLines(issues, today = todayIso(), { textLimit = 10 } = {}) {
  const p = parkedPlan(issues, today)
  const d = duePlan(issues, today)
  const lines = []
  const parts = []
  if (p.reached.length) parts.push(`revive date reached: ${p.reached.map(ref).join(', ')}`)
  if (p.text.length) {
    const shown = p.text.slice(0, textLimit).map((e) => `${e.issue.id} (${short(e.issue.revive || 'no trigger', 60)})`)
    parts.push(`check against this session: ${shown.join('; ')}${p.text.length > textLimit ? `; ${p.text.length - textLimit} more in PARKED.md` : ''}`)
  }
  if (p.later.length) parts.push(`${p.later.length} wait for a later date (next ${p.later[0].date})`)
  if (parts.length) lines.push(`Parked: ${parts.join('. ')}.`)
  const dparts = []
  if (d.overdue.length) dparts.push(`overdue: ${d.overdue.map(ref).join(', ')}`)
  if (d.today.length) dparts.push(`due today: ${d.today.map((e) => e.issue.id).join(', ')}`)
  if (d.later.length) dparts.push(`${d.later.length} due later (next ${d.later[0].date})`)
  if (dparts.length) lines.push(`Due: ${dparts.join('. ')}.`)
  return { lines, parked: p, due: d }
}

// `strata due [--days N]`: every dated item up to N days ahead, the ones whose
// date has passed first.
export function dueList(project, { days = 7, today = todayIso() } = {}) {
  const issues = readIssues(project)
  const until = addDays(today, days)
  const items = []
  for (const e of parkedPlan(issues, today).reached) items.push({ ...e, kind: e.source, state: 'reached' })
  for (const e of parkedPlan(issues, today).later) items.push({ ...e, kind: e.source, state: 'later' })
  const d = duePlan(issues, today)
  for (const e of d.overdue) items.push({ ...e, kind: 'due', state: 'overdue' })
  for (const e of d.today) items.push({ ...e, kind: 'due', state: 'today' })
  for (const e of d.later) items.push({ ...e, kind: 'due', state: 'later' })
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.issue.id < b.issue.id ? -1 : 1))
  const within = items.filter((x) => x.date <= until)
  const beyond = items.filter((x) => x.date > until)
  const row = (x) => ({ id: x.issue.id, file: x.issue.rel, status: x.issue.status, date: x.date, kind: x.kind, state: x.state, inDays: daysBetween(today, x.date), what: x.issue.what })
  return { today, days, until, items: within.map(row), beyond: beyond.length, nextBeyond: beyond.length ? beyond[0].date : null }
}

export function formatDue(res) {
  const lines = [`Dated items up to ${res.until} (today ${res.today}, next ${plural(res.days, 'day')}):`]
  if (!res.items.length) lines.push('  none')
  for (const x of res.items) {
    const when = x.state === 'overdue' ? 'overdue' : x.state === 'reached' ? 'reached' : x.inDays === 0 ? 'today' : `in ${plural(x.inDays, 'day')}`
    lines.push(`  ${x.date}  ${when.padEnd(10)}  ${x.id.padEnd(12)}  ${x.kind.padEnd(11)}  ${short(x.what)}`)
  }
  if (res.beyond) lines.push(`${plural(res.beyond, 'more dated item')} after ${res.until} (next ${res.nextBeyond}).`)
  return lines.join('\n')
}
