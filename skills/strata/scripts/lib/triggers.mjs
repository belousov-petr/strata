// Operation-triggered lessons (ADR-0020).
//
// A learning may carry `match:` (regexes tested against a Bash command) and
// `paths:` (globs tested against the files an edit touches, and against the
// path-like words of a Bash command). `strata views` compiles them into a small
// JSON index; the PreToolUse hook (hooks/strata-lesson-trigger.mjs) reads only
// that index, so a tool call never parses markdown. When the learnings change
// and nobody ran `strata views`, the hook rebuilds the index once.
//
// The index is a git-ignored cache in the worktree's own `.strata/inbox/`,
// because the learnings, and so the index, belong to the checked-out branch.
//
// This module imports only Node built-ins and frontmatter.mjs, so the hook can
// load it quickly and without the rest of the strata script.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { parseFrontmatter, labelParagraph, firstParagraph, firstSentence, asList } from './frontmatter.mjs'

export const INDEX_FILE = 'lesson-triggers.json'
export const SHOWN_FILE = 'lessons-shown.json'
export const INDEX_VERSION = 1
export const MAX_LESSONS = 3
const SKIP = new Set(['INDEX.md', '_TEMPLATE.md', 'README.md'])

export function learningsDirOf(project) { return path.join(project, '.strata', 'memory', 'learnings') }
export function indexPath(project) { return path.join(project, '.strata', 'inbox', INDEX_FILE) }

const toPosix = (p) => String(p).replace(/\\/g, '/')

// A signature of the learning files (names, sizes, modification times). A
// rename, an edit or a checkout changes it, so a stale index is noticed with
// one directory read and one stat per learning.
export function learningsSignature(project) {
  const dir = learningsDirOf(project)
  let names = []
  try { names = fs.readdirSync(dir) } catch { return 'none' }
  const parts = []
  for (const name of names.sort()) {
    if (!name.endsWith('.md') || SKIP.has(name)) continue
    try {
      const st = fs.statSync(path.join(dir, name))
      parts.push(`${name}|${st.size}|${Math.floor(st.mtimeMs)}`)
    } catch { /* vanished */ }
  }
  return crypto.createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 16)
}

// --- patterns ------------------------------------------------------------------
// A regex from `match:`. A leading `(?i)` makes it case-insensitive. Throws on
// an invalid pattern.
export function compileMatch(src) {
  let source = String(src)
  let flags = ''
  if (source.startsWith('(?i)')) { source = source.slice(4); flags = 'i' }
  if (!source) throw new Error('empty pattern')
  if (/[\u0000-\u0008\u000b-\u001f]/.test(source)) throw new Error('holds a control character; write the regex in single quotes')
  new RegExp(source, flags) // eslint-disable-line no-new
  return { source, flags }
}

function expandBraces(glob) {
  const m = /\{([^{}]*)\}/.exec(glob)
  if (!m) return [glob]
  const out = []
  for (const alt of m[1].split(',')) out.push(...expandBraces(glob.slice(0, m.index) + alt + glob.slice(m.index + m[0].length)))
  return out
}

function globBody(g) {
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++
        if (g[i + 1] === '/') { i++; re += '(?:.*/)?' } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '[') {
      const end = g.indexOf(']', i + 1)
      if (end < 0) { re += '\\['; continue }
      let cls = g.slice(i + 1, end)
      if (cls.startsWith('!')) cls = '^' + cls.slice(1)
      re += `[${cls.replace(/\\/g, '\\\\')}]`
      i = end
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&')
  }
  return re
}

// A glob from `paths:` as a regex source, tested against POSIX paths.
// Relative globs are relative to the project root; a glob without a slash
// matches a file name in any folder; a trailing slash means everything below.
export function globToRegex(glob) {
  let g = toPosix(String(glob).trim())
  if (!g) throw new Error('empty glob')
  if (g.startsWith('~/')) g = toPosix(os.homedir()) + g.slice(1)
  const absolute = g.startsWith('/') || /^[A-Za-z]:\//.test(g)
  if (!absolute) g = g.replace(/^\.\//, '')
  if (g.endsWith('/')) g += '**'
  const alts = expandBraces(g).map((x) => {
    const body = globBody(x)
    if (absolute) return `^${body}$`
    return x.includes('/') ? `^${body}$` : `(?:^|/)${body}$`
  })
  const source = alts.length === 1 ? alts[0] : `(?:${alts.join('|')})`
  new RegExp(source) // eslint-disable-line no-new
  return source
}

// --- the index ---------------------------------------------------------------------
// A heading that opens the body names the lesson; otherwise its trigger does.
function topHeading(body) {
  const first = String(body || '').split('\n').find((l) => l.trim())
  const m = first && /^#{1,6}[ \t]+(.+)$/.exec(first.trim())
  return m ? m[1].trim() : ''
}

function learningRecord(dir, name) {
  const text = fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n')
  const fm = parseFrontmatter(text)
  const match = asList(fm.data.match)
  const paths = asList(fm.data.paths)
  if (!match.length && !paths.length) return { rule: null, errors: [] }
  const errors = []
  const rule = {
    file: `.strata/memory/learnings/${name}`,
    title: topHeading(fm.body) || String(fm.data.trigger || '').trim() || name.replace(/\.md$/, ''),
    lesson: firstSentence(labelParagraph(fm.body, 'Lesson') || firstParagraph(fm.body)),
    match: [],
    paths: [],
  }
  for (const m of match) {
    try { rule.match.push(compileMatch(m)) } catch (e) { errors.push({ file: rule.file, field: 'match', value: m, reason: e.message }) }
  }
  for (const p of paths) {
    try { rule.paths.push({ glob: p, re: globToRegex(p) }) } catch (e) { errors.push({ file: rule.file, field: 'paths', value: p, reason: e.message }) }
  }
  return { rule: rule.match.length || rule.paths.length ? rule : null, errors }
}

export function buildTriggerIndex(project) {
  const dir = learningsDirOf(project)
  const sig = learningsSignature(project)
  let names = []
  try { names = fs.readdirSync(dir) } catch { /* no learnings */ }
  const rules = []
  const errors = []
  for (const name of names.sort()) {
    if (!name.endsWith('.md') || SKIP.has(name)) continue
    let rec
    try { rec = learningRecord(dir, name) } catch { continue }
    if (rec.rule) rules.push(rec.rule)
    errors.push(...rec.errors)
  }
  return { version: INDEX_VERSION, sig, rules, errors }
}

function ensureIgnoredDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const gi = path.join(dir, '.gitignore')
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n')
}

function serialize(index) { return JSON.stringify(index, null, 1) + '\n' }

// Rebuild the index file. Returns { state, rules, errors }.
export function writeTriggerIndex(project, { check = false } = {}) {
  const index = buildTriggerIndex(project)
  const file = indexPath(project)
  let cur = null
  try { cur = fs.readFileSync(file, 'utf8') } catch { /* none */ }
  const next = serialize(index)
  const state = cur == null ? 'created' : cur === next ? 'current' : 'updated'
  if (!check && state !== 'current') {
    ensureIgnoredDir(path.dirname(file))
    const tmp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, next)
    fs.renameSync(tmp, file)
  }
  return { state: check && state !== 'current' ? 'stale' : state, file, rules: index.rules.length, errors: index.errors }
}

// The index the hook uses: the file when it matches the learnings, otherwise a
// fresh build that is written back for the next call (best effort).
export function loadTriggerIndex(project) {
  let index = null
  try { index = JSON.parse(fs.readFileSync(indexPath(project), 'utf8')) } catch { /* missing or torn */ }
  if (index && index.version === INDEX_VERSION && index.sig === learningsSignature(project)) return index
  try { writeTriggerIndex(project) } catch { /* read-only tree: use the build anyway */ }
  return buildTriggerIndex(project)
}

// --- what a tool call touches ---------------------------------------------------------
// Words of a shell command that look like paths: they hold a slash, start with
// ~ or ., or end in a file extension. URLs and options are skipped.
export function pathTokens(command) {
  const out = new Set()
  const re = /"([^"]*)"|'([^']*)'|([^\s;|&<>()`]+)/g
  let m
  let n = 0
  while ((m = re.exec(String(command || ''))) && n < 400) {
    n++
    let tok = m[1] ?? m[2] ?? m[3] ?? ''
    if (!tok || tok.startsWith('-') && !tok.includes('=')) continue
    if (tok.includes('=')) tok = tok.slice(tok.lastIndexOf('=') + 1)
    if (!tok || /^[a-z][a-z0-9+.-]*:\/\//i.test(tok) || tok.includes('$(')) continue
    if (tok.includes('/') || tok.includes('\\') || /^[~.]/.test(tok) || /^[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,10}$/.test(tok)) out.add(tok)
  }
  return [...out]
}

// Files named in an apply_patch body (Codex edits, or a patch piped in Bash).
export function patchPaths(text) {
  const out = []
  const re = /^\*\*\* (?:Add|Update|Delete) File: (.+?)\s*$|^\*\*\* Move to: (.+?)\s*$/gm
  let m
  while ((m = re.exec(String(text || '')))) out.push(m[1] || m[2])
  return out
}

// Every form of a path that a glob may be tested against: as written, relative
// to the project root, and absolute.
export function pathForms(p, { cwd, project }) {
  const forms = new Set()
  let raw = toPosix(String(p).trim())
  if (!raw) return []
  if (raw.startsWith('~/')) raw = toPosix(os.homedir()) + raw.slice(1)
  forms.add(raw.replace(/^\.\//, ''))
  const abs = path.resolve(cwd || project || '.', raw)
  forms.add(toPosix(abs))
  if (project) {
    const rel = path.relative(project, abs)
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) forms.add(toPosix(rel))
  }
  return [...forms]
}

const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit|apply_patch)$/i

// What a PreToolUse payload is about: { command, paths } or null.
export function subjectOf(payload, project) {
  const tool = String(payload.tool_name || payload.toolName || '')
  const input = payload.tool_input || payload.toolInput || {}
  const cwd = payload.cwd || project
  const raw = []
  let command = null
  if (/^Bash$/i.test(tool)) {
    command = typeof input.command === 'string' ? input.command : Array.isArray(input.command) ? input.command.join(' ') : ''
    raw.push(...pathTokens(command), ...patchPaths(command))
  } else if (EDIT_TOOLS.test(tool)) {
    for (const k of ['file_path', 'notebook_path', 'path']) if (typeof input[k] === 'string') raw.push(input[k])
    if (typeof input.command === 'string') raw.push(...patchPaths(input.command))
    if (typeof input.patch === 'string') raw.push(...patchPaths(input.patch))
  } else {
    return null
  }
  const paths = new Set()
  for (const p of raw) for (const f of pathForms(p, { cwd, project })) paths.add(f)
  return { tool, command, paths: [...paths] }
}

// The lessons whose match: or paths: fire for this subject, in file order.
export function matchLessons(index, subject, { max = MAX_LESSONS } = {}) {
  const hits = []
  if (!index || !Array.isArray(index.rules) || !subject) return hits
  for (const r of index.rules) {
    let why = null
    if (subject.command != null) {
      for (const m of r.match || []) {
        try { if (new RegExp(m.source, m.flags).test(subject.command)) { why = 'command'; break } } catch { /* skip */ }
      }
    }
    if (!why && subject.paths.length) {
      for (const p of r.paths || []) {
        let re
        try { re = new RegExp(p.re) } catch { continue }
        if (subject.paths.some((x) => re.test(x))) { why = 'path'; break }
      }
    }
    if (why) hits.push({ ...r, why })
    if (hits.length >= max) break
  }
  return hits
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s }

export function formatLessons(hits, { tool } = {}) {
  const what = /^Bash$/i.test(String(tool || '')) ? 'this command' : 'this edit'
  const lines = [`Strata lessons for ${what} (read the rule before you go on):`]
  for (const h of hits) lines.push(`- **${capitalize(String(h.title).replace(/\s+/g, ' ').trim())}:** ${h.lesson} (${h.file})`)
  return lines.join('\n')
}

// --- repeat control -----------------------------------------------------------------
// The same lesson is not repeated within one session for `minutes` (0 repeats
// every time). State lives in the shared inbox; it is written only when a
// lesson fires.
export function filterShown(inboxDir, sessionId, hits, minutes, now = Date.now()) {
  if (!sessionId || !(minutes > 0) || !hits.length) return hits
  let state = {}
  try { state = JSON.parse(fs.readFileSync(path.join(inboxDir, SHOWN_FILE), 'utf8')) || {} } catch { /* fresh */ }
  const seen = (state.sessions && state.sessions[sessionId]) || {}
  return hits.filter((h) => !(seen[h.file] && now - seen[h.file] < minutes * 60000))
}

export function recordShown(inboxDir, sessionId, hits, now = Date.now()) {
  if (!sessionId || !hits.length) return
  const file = path.join(inboxDir, SHOWN_FILE)
  let state = {}
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')) || {} } catch { /* fresh */ }
  const sessions = state.sessions && typeof state.sessions === 'object' ? state.sessions : {}
  const cur = sessions[sessionId] || {}
  for (const h of hits) cur[h.file] = now
  delete sessions[sessionId]
  sessions[sessionId] = cur
  const keys = Object.keys(sessions)
  for (const k of keys.slice(0, Math.max(0, keys.length - 20))) delete sessions[k] // keep the 20 latest sessions
  ensureIgnoredDir(inboxDir)
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify({ sessions }) + '\n')
  fs.renameSync(tmp, file)
}
