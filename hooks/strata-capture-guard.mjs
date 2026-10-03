#!/usr/bin/env node
// strata capture-guard: one lifecycle hook shared by Claude Code (plugin hooks)
// and Codex CLI (~/.codex/hooks.json or a project .codex/hooks.json).
//
// It reads the hook event JSON on stdin and acts only inside a strata project
// (a `.strata/` folder at the working directory or above):
//
//   1) DETERMINISTIC CAPTURE. Tool calls that really failed are appended as raw
//      stubs to `.strata/inbox/captures.jsonl` in the repository's main worktree
//      (one inbox per repo, ADR-0016). It decides by real status, never by
//      words in successful output (ADR-0017):
//        Claude  PostToolUseFailure      always a failure (Exit code N / interrupt)
//        Claude  PostToolUse             always a success, never logged
//        Claude  transcript tool_result  `is_error` decides
//        Codex   rollout output          `Process exited with code N` decides
//        Codex   PostToolUse             no status: strict, line-anchored fallback
//      Stubs carry a category: failure | policy | tool-error | interrupted.
//      Permission refusals are `policy`, not failures.
//      PreCompact, SessionEnd (Claude) and Stop (Codex) scan the transcript tail
//      on a per-transcript byte cursor, so nothing is missed or logged twice.
//
//   2) CONTEXT. SessionStart primes the capture rule and reports pending journal
//      captures and inbox counts. The per-failure "capture this now" nudge is
//      off unless STRATA_FAILURE_NUDGE=1. PreCompact, SessionEnd and Stop print
//      nothing (PreCompact rejects additionalContext; Stop fires every turn).
//
// Outside a strata project it is a silent no-op. Any error exits 0 with no
// output, so the hook can never break or stall the host session.
//
// Cross-platform: pure Node, path.join, a byte-offset cursor, no git process.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

const MAX_SNIPPET = 600           // per-stub output snippet cap (chars)
const FALLBACK_LINES = 60         // the text fallback reads only the last N lines
const MAX_SCAN_BYTES = 512 * 1024 // transcript scans read at most this much per run
const DEDUPE_WINDOW = 200         // dedupe a new stub against the last N inbox lines
const SHELL_TOOLS = /^(Bash|PowerShell|exec_command|shell|local_shell|container\.exec)$/i

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('') // nothing piped in
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => { data += c })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
    setTimeout(() => resolve(data), 2000).unref() // never hang the host
  })
}

// Walk up from `startDir` looking for a `.strata/` directory.
export function findStrataRoot(startDir) {
  let dir = startDir
  for (let i = 0; i < 40 && dir; i++) {
    try {
      if (fs.statSync(path.join(dir, '.strata')).isDirectory()) return dir
    } catch { /* not here */ }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

// --- worktrees ---------------------------------------------------------------
// Find the git work tree that holds `dir` and, for a linked worktree, the main
// worktree of the same repository. Pure file reads (no git process), matching
// `git rev-parse --show-toplevel` / `--git-common-dir`:
//   main checkout:   <top>/.git is a folder              -> main = top
//   linked worktree: <top>/.git is a file "gitdir: X"     -> X/commondir names the
//                    common folder; main = its parent when it is named .git
//   submodule, bare common folder, unreadable files      -> main = top
export function gitTopAndMain(dir) {
  let cur = dir
  for (let i = 0; i < 60 && cur; i++) {
    const dotgit = path.join(cur, '.git')
    let st = null
    try { st = fs.statSync(dotgit) } catch { /* keep walking */ }
    if (st && st.isDirectory()) return { top: cur, main: cur }
    if (st && st.isFile()) {
      let main = cur
      try {
        const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotgit, 'utf8'))
        if (m) {
          const gitdir = path.resolve(cur, m[1])
          let common = gitdir
          try { common = path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim()) } catch { /* not a linked worktree */ }
          if (common !== gitdir && path.basename(common) === '.git') {
            const candidate = path.dirname(common)
            if (fs.statSync(candidate).isDirectory()) main = candidate
          }
        }
      } catch { /* fall back to this worktree */ }
      return { top: cur, main }
    }
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return null
}

// The two roots shared by the hook and the strata script:
//   project: where tracked memory lives (the nearest .strata/ at or above cwd)
//   shared:  where untracked scratch lives (inbox, journal, cursors, state):
//            the same folder in the repo's main worktree when that one also
//            holds .strata/, so every worktree shares one inbox and journal
//            and nothing is lost when a worktree is removed.
export function resolveRoots(cwd) {
  const project = findStrataRoot(cwd)
  if (!project) return null
  let shared = project
  try {
    const g = gitTopAndMain(project)
    if (g && g.main !== g.top) {
      const rel = path.relative(g.top, project)
      const candidate = rel && !rel.startsWith('..') ? path.join(g.main, rel) : g.main
      if (fs.statSync(path.join(candidate, '.strata')).isDirectory()) shared = candidate
    }
  } catch { /* no main-worktree .strata: stay in this worktree */ }
  return { project, shared }
}

// Normalise a tool result (string OR {stdout,stderr,...} OR content blocks) to text.
export function resultText(r) {
  if (r == null) return ''
  if (typeof r === 'string') return r
  if (Array.isArray(r)) return r.map((x) => (typeof x === 'string' ? x : x?.text || '')).join('\n')
  if (typeof r === 'object') {
    const parts = []
    if (typeof r.stdout === 'string') parts.push(r.stdout)
    if (typeof r.stderr === 'string') parts.push(r.stderr)
    if (parts.length) return parts.join('\n')
    try { return JSON.stringify(r) } catch { return '' }
  }
  return String(r)
}

// Best-effort masking of common secret shapes before a stub is written.
// Defense in depth on top of gitignoring the inbox; never blocks on a miss.
export function redact(s) {
  if (typeof s !== 'string' || !s) return s
  return s
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '$1<redacted>')                                  // AWS access key id
    .replace(/\bgh[posru]_[A-Za-z0-9]{20,}\b/g, 'gh<redacted>')                               // GitHub tokens
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, 'github_pat_<redacted>')                    // GitHub fine-grained PAT
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '<redacted-jwt>') // JWT
    .replace(/((?:authorization|bearer|api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*)(\S{6,})/gi, '$1<redacted>')
    .replace(/(Bearer\s+)([A-Za-z0-9._-]{12,})/g, '$1<redacted>')
}

// Scan a raw byte window for whole lines. `start` is a byte offset that is
// always a line boundary (0, or a previous newOffset). Returns the decoded
// whole-line text and the next offset, computed from RAW BYTES so a window
// ending mid-multibyte-char never corrupts the offset or inserts U+FFFD.
export function scanChunk(windowBuf, start) {
  const lastNl = windowBuf.lastIndexOf(0x0a) // '\n'
  if (lastNl < 0) return { text: '', newOffset: start } // no complete line yet
  const consumed = lastNl + 1
  return { text: windowBuf.subarray(0, consumed).toString('utf8'), newOffset: start + consumed }
}

function readHead(tp, n) {
  try {
    const fd = fs.openSync(tp, 'r')
    try { const b = Buffer.alloc(n); const r = fs.readSync(fd, b, 0, n, 0); return b.subarray(0, r) }
    finally { fs.closeSync(fd) }
  } catch { return Buffer.alloc(0) }
}

function headHash(buf) {
  return crypto.createHash('sha1').update(buf.subarray(0, 512)).digest('hex').slice(0, 12)
}

export function cursorPath(root, transcriptPath) {
  const id = crypto.createHash('sha1').update(String(transcriptPath)).digest('hex').slice(0, 12)
  return path.join(root, '.strata', 'inbox', `.cursor.${id}.json`)
}

function writeCursorAtomic(file, obj) {
  ensureInbox(path.dirname(file))
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(obj))
  fs.renameSync(tmp, file)
}

// --- inbox ------------------------------------------------------------------
// A missing ignore file means this inbox was not scaffolded here: ignore
// everything, including the ignore file, so captures never show up in git.
export function ensureInbox(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const gi = path.join(dir, '.gitignore')
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n')
}

export function inboxPaths(root) {
  const dir = path.join(root, '.strata', 'inbox')
  return { dir, file: path.join(dir, 'captures.jsonl') }
}

// One stub per tool call: keyed by the host's tool_use_id when there is one, so
// the live event and the later transcript scan agree. Otherwise by content.
export function stubHash(stub) {
  if (stub.tuid) return crypto.createHash('sha1').update('tuid|' + stub.tuid).digest('hex').slice(0, 12)
  const snip = stub.snippet || ''
  const basis = [stub.signal || '', stub.command || '', snip.slice(0, 200), snip.slice(-200)].join('|')
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 12)
}

function recentHashes(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').slice(-DEDUPE_WINDOW)
    return new Set(lines.map((l) => { try { return JSON.parse(l).h } catch { return null } }).filter(Boolean))
  } catch { return new Set() }
}

// Append a stub unless a recent identical one exists. Returns true if written.
function appendStub(root, stub) {
  try {
    const { dir, file } = inboxPaths(root)
    const h = stubHash(stub)
    if (recentHashes(file).has(h)) return false
    ensureInbox(dir)
    fs.appendFileSync(file, JSON.stringify({ ...stub, h }) + '\n')
    return true
  } catch { return false }
}

function nowIso() {
  try { return new Date().toISOString() } catch { return '' }
}

// --- classification -------------------------------------------------------
export const CATEGORIES = ['failure', 'policy', 'tool-error', 'interrupted']

// Permission refusals: the agent's own safety layer said no. Counted, not failures.
const POLICY_PATTERNS = [
  /denied by the Claude Code auto mode classifier/i,
  /auto mode classifier gave no verdict/i,
  /denied by a built-in Claude Code safety check/i,
  /^\s*<tool_use_error>\s*Blocked:/i,
  /The user doesn't want to proceed with this tool use/i,
  /\btool use was rejected\b/i,
  /\bPermission (?:for this (?:action|command) |to use \S+ )?(?:was|has been) denied\b/i,
  /haven't granted it yet/i,
  /\brejected by (?:the )?user\b/i,
]

// Strict fallback for results that carry no status (Codex PostToolUse). Every
// pattern is anchored to the start of a line, and only the last lines are read,
// so a grep or cat that merely prints these words does not match.
const FALLBACK_SIGNATURES = [
  /^(?:Exit code|Process exited with code) [1-9]\d*\s*$/m,
  /^(?:(?:ba|z|k|da)?sh|bash\.exe): (?:line \d+: )?[^\n:]+: command not found\s*$/m,
  /^zsh: command not found: \S+/m,
  /^Traceback \(most recent call last\):\s*$/m,
  /^fatal: \S/m,
  /^npm (?:ERR!|error) /m,
  /^\s*ELIFECYCLE\b/m,
  /^error Command failed with exit code [1-9]/m,
  /^(?:\S+\(\d+,\d+\): )?error TS\d{3,}:/m,
  /^Segmentation fault\b/m,
  /^panic: /m,
  /^'[^'\n]+' is not recognized as an internal or external command/m,
  /^(?:\S+ : )?The term '[^'\n]+' is not recognized\b/m,
]

function tailLines(text, n) {
  const lines = String(text).split('\n')
  return lines.length > n ? lines.slice(-n).join('\n') : String(text)
}

function short(s) { return String(s).trim().replace(/\s+/g, ' ').slice(0, 60) }

export function policySignal(text) {
  if (typeof text !== 'string' || !text) return null
  const head = text.slice(0, 2000)
  for (const re of POLICY_PATTERNS) {
    const m = re.exec(head)
    if (m) return short(m[0])
  }
  return null
}

// The strict text fallback. `isError === true` short-circuits (kept for callers
// of the 0.0.x API).
export function failureSignal(text, isError) {
  if (isError === true) return 'is_error'
  if (typeof text !== 'string' || !text) return null
  const tail = tailLines(text, FALLBACK_LINES)
  for (const re of FALLBACK_SIGNATURES) {
    const m = re.exec(tail)
    if (m) return short(m[0])
  }
  return null
}

// Decide what a tool result is. Returns { category, signal } or null (success).
// isError / exitCode undefined means the host gave no status.
export function classify({ tool, text = '', isError, exitCode, interrupted } = {}) {
  const shell = !tool || SHELL_TOOLS.test(String(tool))
  const t = typeof text === 'string' ? text : resultText(text)
  if (interrupted === true) return { category: 'interrupted', signal: 'interrupted' }
  if (typeof exitCode === 'number' && Number.isFinite(exitCode)) {
    if (exitCode === 0) return null
    return { category: shell ? 'failure' : 'tool-error', signal: `exit code ${exitCode}` }
  }
  if (isError === true) {
    const pol = policySignal(t)
    if (pol) return { category: 'policy', signal: pol }
    if (/^\s*\[?(?:Request )?interrupted by user/i.test(t)) return { category: 'interrupted', signal: 'interrupted' }
    const ec = /^Exit code (\d+)/.exec(t)
    if (shell) return { category: 'failure', signal: ec ? `Exit code ${ec[1]}` : 'is_error' }
    const first = t.replace(/<\/?tool_use_error>/g, '').trim().split('\n')[0]
    return { category: 'tool-error', signal: short(first || 'is_error') }
  }
  if (isError === false) return null
  const pol = policySignal(t)
  if (pol) return { category: 'policy', signal: pol }
  if (!shell) return null
  const sig = failureSignal(t)
  return sig ? { category: 'failure', signal: sig } : null
}

// Category of a stored stub. Stubs written before 0.1.0 have none.
export function stubCategory(stub) {
  if (stub && CATEGORIES.includes(stub.category)) return stub.category
  return policySignal(String((stub && stub.snippet) || '')) ? 'policy' : 'failure'
}

export function readStubs(root) {
  try {
    return fs.readFileSync(inboxPaths(root).file, 'utf8').split('\n').filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

// Counts by category, plus failures seen at least twice (same command, or the
// same signal and output tail when there is no command).
export function summarizeStubs(stubs) {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]))
  const groups = new Map()
  for (const s of stubs) {
    const cat = stubCategory(s)
    counts[cat] = (counts[cat] || 0) + 1
    if (cat !== 'failure') continue
    const cmd = String(s.command || '').replace(/\s+/g, ' ').trim().slice(0, 200)
    const key = cmd ? `cmd|${cmd}` : `sig|${s.signal || ''}|${String(s.snippet || '').replace(/\s+/g, ' ').trim().slice(-80)}`
    const g = groups.get(key) || { count: 0, command: cmd, signal: s.signal || '', last: '' }
    g.count++
    if (String(s.ts || '') > g.last) g.last = String(s.ts || '')
    groups.set(key, g)
  }
  const repeated = [...groups.values()].filter((g) => g.count >= 2)
    .sort((a, b) => b.count - a.count || (a.command < b.command ? -1 : 1))
  return { total: stubs.length, counts, repeated }
}

export function summaryLine(sum) {
  if (!sum.total) return 'Inbox: empty.'
  const parts = []
  const c = sum.counts
  if (c.failure) parts.push(`${c.failure} failure${c.failure === 1 ? '' : 's'}${sum.repeated.length ? ` (${sum.repeated.length} repeated)` : ''}`)
  if (c.policy) parts.push(`${c.policy} policy refusal${c.policy === 1 ? '' : 's'}`)
  if (c['tool-error']) parts.push(`${c['tool-error']} tool error${c['tool-error'] === 1 ? '' : 's'}`)
  if (c.interrupted) parts.push(`${c.interrupted} interrupted`)
  return `Inbox: ${sum.total} capture${sum.total === 1 ? '' : 's'}: ${parts.join(', ')}.`
}

export function journalCount(root) {
  try {
    return fs.readFileSync(path.join(root, '.strata', 'inbox', 'journal.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).length
  } catch { return 0 }
}

// --- handlers ---------------------------------------------------------------
function oneLine(s, max = 300) { return redact(String(s || '').replace(/\s+/g, ' ').trim().slice(0, max)) }

function stubFor(event, tool, r, { command = '', text = '', ts, tuid } = {}) {
  const stub = {
    ts: ts || nowIso(), event, tool: tool || 'Bash', category: r.category, signal: r.signal,
    command: oneLine(command), snippet: redact(String(text || '').slice(-MAX_SNIPPET)),
  }
  if (tuid) stub.tuid = String(tuid)
  return stub
}

// PostToolUse. Claude only calls it after a tool succeeded (failures go to
// PostToolUseFailure); its Bash response is an object with stdout/stderr, so an
// object here is a success unless it says otherwise. Codex sends a plain string
// with no status, so only the strict fallback applies there.
function handlePostToolUse(root, payload) {
  const tool = payload.tool_name || payload.toolName || 'Bash'
  if (!SHELL_TOOLS.test(tool)) return { logged: 0 }
  const input = payload.tool_input || payload.toolInput || {}
  const resp = payload.tool_response ?? payload.toolResponse
  let isError
  let exitCode
  let interrupted
  if (resp && typeof resp === 'object' && !Array.isArray(resp)) {
    for (const k of ['exit_code', 'exitCode', 'returnCode']) if (typeof resp[k] === 'number') exitCode = resp[k]
    if (resp.is_error === true) isError = true
    if (resp.interrupted === true) interrupted = true
    if (exitCode === undefined && isError === undefined) isError = false // Claude: PostToolUse = success
  }
  if (payload.is_error === true) isError = true
  const text = resultText(resp)
  const r = classify({ tool, text, isError, exitCode, interrupted })
  if (!r) return { logged: 0 }
  const ok = appendStub(root, stubFor('PostToolUse', tool, r, {
    command: input.command, text, tuid: payload.tool_use_id || payload.toolUseId,
  }))
  return { logged: ok ? 1 : 0, category: r.category }
}

// PostToolUseFailure (Claude): the tool ran and failed, or was aborted.
// `error` starts with "Exit code N" for a shell command that exited.
function handlePostToolUseFailure(root, payload) {
  const tool = payload.tool_name || payload.toolName || 'Bash'
  const input = payload.tool_input || payload.toolInput || {}
  const err = typeof payload.error === 'string' ? payload.error : resultText(payload.error)
  const r = classify({ tool, text: err, isError: true, interrupted: payload.is_interrupt === true })
  if (!r) return { logged: 0 }
  const ok = appendStub(root, stubFor('PostToolUseFailure', tool, r, {
    command: input.command, text: err, tuid: payload.tool_use_id || payload.toolUseId,
  }))
  return { logged: ok ? 1 : 0, category: r.category }
}

// Shared transcript-tail scan used by PreCompact, SessionEnd and Stop: cursor
// based, chunk bounded, per transcript. Parses Claude transcript lines
// (message.content tool_use / tool_result blocks) and Codex rollout lines
// (response_item function_call / function_call_output).
export function scanTranscript(root, tp, event) {
  const cursorFile = cursorPath(root, tp)
  let size = 0
  try { size = fs.statSync(tp).size } catch { return 0 }

  let cur = { offset: 0, headHash: '' }
  try { cur = JSON.parse(fs.readFileSync(cursorFile, 'utf8')) } catch { /* fresh */ }
  const curHead = headHash(readHead(tp, 512))
  let start = typeof cur.offset === 'number' ? cur.offset : 0
  if (cur.headHash && cur.headHash !== curHead) start = 0 // file replaced in place
  if (start > size) start = 0                              // truncated/rotated

  const end = Math.min(size, start + MAX_SCAN_BYTES)        // bounded chunk, no skip-ahead
  let windowBuf = Buffer.alloc(0)
  const len = Math.max(0, end - start)
  if (len > 0) {
    try {
      const fd = fs.openSync(tp, 'r')
      try { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, start); windowBuf = b }
      finally { fs.closeSync(fd) }
    } catch { return 0 }
  }

  const { text: scanned, newOffset } = scanChunk(windowBuf, start)

  const toolById = new Map()
  const callById = new Map()
  let logged = 0
  for (const line of scanned.split('\n')) {
    if (!line.trim()) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    const blocks = Array.isArray(o.message?.content) ? o.message.content : []
    for (const blk of blocks) {
      if (blk?.type === 'tool_use' && blk.id) toolById.set(blk.id, { name: blk.name, command: blk.input?.command || '' })
    }
    for (const blk of blocks) {
      if (blk?.type !== 'tool_result') continue
      const origin = toolById.get(blk.tool_use_id)
      const t = typeof blk.content === 'string' ? blk.content : resultText(blk.content) || resultText(o.toolUseResult)
      // A tool_result without is_error (older hosts, non-shell tools) has no
      // status: only a shell result may use the strict text fallback. When the
      // tool_use sits before this scan window, infer the tool from the result:
      // a shell result carries stdout/stderr or starts with "Exit code N".
      const isError = blk.is_error === true ? true : blk.is_error === false ? false : undefined
      let tool = origin ? origin.name : null
      if (!tool) {
        const tur = o.toolUseResult
        tool = (tur && typeof tur === 'object' && 'stdout' in tur) || /^Exit code \d+/.test(String(t)) ? 'Bash' : 'tool'
      }
      const r = classify({ tool, text: t, isError })
      if (!r) continue
      if (appendStub(root, stubFor(event, tool, r, {
        command: origin ? origin.command : '', text: t, ts: o.timestamp, tuid: blk.tool_use_id,
      }))) logged++
    }

    // Codex rollout line: {type:'response_item', payload:{type:'function_call'|'function_call_output', …}}
    const cp = o.type === 'response_item' && o.payload && typeof o.payload === 'object' ? o.payload : null
    if (cp && cp.type === 'function_call' && cp.call_id) {
      let cmd = ''
      try { const a = JSON.parse(cp.arguments); cmd = a.cmd || a.command || '' } catch { cmd = '' }
      if (Array.isArray(cmd)) cmd = cmd.join(' ')
      callById.set(cp.call_id, { name: cp.name || 'exec_command', command: String(cmd || '') })
    } else if (cp && cp.type === 'function_call_output') {
      const call = callById.get(cp.call_id) || { name: 'exec_command', command: '' }
      const t = typeof cp.output === 'string' ? cp.output : resultText(cp.output)
      const codes = [...String(t).matchAll(/Process exited with code (\d+)/g)]
      const exitCode = codes.length ? Number(codes[codes.length - 1][1]) : undefined
      const r = classify({ tool: call.name, text: t, exitCode })
      if (r && appendStub(root, stubFor(event, call.name, r, {
        command: call.command, text: t, ts: o.timestamp, tuid: cp.call_id,
      }))) logged++
    }
  }

  try { writeCursorAtomic(cursorFile, { transcriptPath: tp, offset: newOffset, headHash: curHead }) } catch { /* best effort */ }
  return logged
}

function drain(root, payload, event) {
  const tp = payload.transcript_path || payload.transcriptPath
  if (!tp || !fs.existsSync(tp)) return 0
  return scanTranscript(root, tp, event)
}

// --- context text -----------------------------------------------------------
const HOW =
  "`/strata:capture` (Codex and other tools: `Skill(name='strata', args='capture')`)"

function pendingNote(root) {
  const parts = []
  const j = journalCount(root)
  if (j) parts.push(`${j} pending capture${j === 1 ? '' : 's'} in the journal`)
  const sum = summarizeStubs(readStubs(root))
  if (sum.total) parts.push(summaryLine(sum).replace(/^Inbox: /, 'inbox: ').replace(/\.$/, ''))
  return parts.length ? ` Waiting for the next /strata:save: ${parts.join('; ')}.` : ''
}

function messageFor(event, root, res) {
  if (event === 'SessionStart') {
    return (
      'This project keeps its memory in `.strata/` (strata). Capture each important moment as soon ' +
      'as it is clear: a failure and its fix, a gotcha, a reusable lesson, a decision and why, a ' +
      'change of direction, an operator answer, how an outside system works, a requirement. Run ' +
      HOW + '; it appends to the pending-capture journal at once, with no commit needed, and ' +
      '`/strata:save` files it into issues, learnings, decision records and docs. Do not keep a ' +
      'parallel log in Claude or Codex memory.' + pendingNote(root)
    )
  }
  return (
    `That command failed (${res.category}, logged to the strata inbox). If the cause or the fix ` +
    'is worth keeping, capture it with ' + HOW + ' while it is fresh.'
  )
}

async function main() {
  try {
    let payload = {}
    try { payload = JSON.parse(await readStdin()) } catch { payload = {} }
    const event = payload.hook_event_name || payload.hookEventName || 'Unknown'
    const cwd = payload.cwd || process.cwd()
    const roots = resolveRoots(cwd)
    if (!roots) process.exit(0) // not a strata project: stay silent
    // Inbox, cursors and counts live in the shared root (the main worktree).
    const root = roots.shared

    let res = { logged: 0 }
    if (event === 'PostToolUse') res = handlePostToolUse(root, payload)
    else if (event === 'PostToolUseFailure') res = handlePostToolUseFailure(root, payload)
    else if (event === 'PreCompact' || event === 'SessionEnd' || event === 'Stop') {
      drain(root, payload, event)
      process.exit(0) // silent drains: PreCompact rejects additionalContext, Stop fires every turn
    }

    if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
      const nudge = process.env.STRATA_FAILURE_NUDGE === '1' && res.logged > 0 && res.category === 'failure'
      if (!nudge) process.exit(0)
    } else if (event !== 'SessionStart') {
      process.exit(0)
    }

    const out = {
      continue: true,
      hookSpecificOutput: { hookEventName: event, additionalContext: messageFor(event, root, res) },
    }
    process.stdout.write(JSON.stringify(out), () => process.exit(0))
  } catch {
    process.exit(0) // never break the host session
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()
