#!/usr/bin/env node
// strata capture-guard — a lifecycle hook shared by Claude Code (plugin hooks)
// and Codex CLI (~/.codex/hooks.json or a project .codex/hooks.json).
//
// It reads the hook event JSON on stdin. If the session's working directory is
// inside a strata project (a `.strata/` directory exists at cwd or an ancestor) it
// does two things:
//
//   1) DETERMINISTIC CAPTURE (survives compaction without the agent acting) —
//      on PostToolUse (Bash failures) and PreCompact, it appends raw failure stubs
//      to `.strata/inbox/captures.jsonl`. The agent does NOT have to do anything for
//      the evidence to land on disk. `/strata:capture` and `/strata:save` promote
//      these stubs into proper issues/learnings, then clear the inbox.
//
//   2) NUDGE — it injects an immediate-capture reminder via
//      `hookSpecificOutput.additionalContext` (the field both tools read):
//      SessionStart primes the discipline; PreCompact is a last-chance flush;
//      PostToolUse pings only on the calls where it actually logged a failure.
//
// Outside a strata project it is a SILENT no-op (no output). Any error => exit 0 with
// no output, so the hook can never break or stall the host session.
//
// Honest scope: a hook still cannot make the agent *reason*. The nudges prime the
// discipline; the deterministic inbox is the part that does not depend on the agent
// taking a turn — it is what actually defeats compaction loss.
//
// Tool support: the NUDGE is tool-agnostic (any tool that sends SessionStart/PreCompact
// — Claude Code + Codex). The DETERMINISTIC inbox capture parses Claude Code's
// tool-result + transcript schema; on Codex it safely degrades to nudge-only —
// unrecognised payloads yield 0 stubs (no crash, no regression) and the nudge still
// fires — until a Codex adapter (keyed on Codex's per-tool event + rollout format) is
// added. Cross-platform: pure Node + path.join + whitespace-tolerant parsing + a
// byte-offset cursor, so it is identical on Windows / macOS / Linux.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

const MAX_SNIPPET = 600           // per-stub output snippet cap (chars)
const SIG_SCAN_TAIL = 64 * 1024   // only test the last N chars of output for signatures
const MAX_SCAN_BYTES = 512 * 1024 // PreCompact: cap how much transcript tail we read
const DEDUPE_WINDOW = 80          // dedupe a new stub against the last N inbox lines

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
function findStrataRoot(startDir) {
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

// --- failure detection ------------------------------------------------------
// Grounded in the real Claude Code transcript schema: a non-zero Bash exit is
// recorded inconsistently — sometimes tool_result.is_error=true (string output),
// sometimes is_error=false with NO exit-code field (e.g. pnpm/eslint exit 1, where
// the only signal is "ELIFECYCLE" / "exit code 1" in the text). So we trust an
// explicit error flag AND a set of high-precision output signatures.
const FAIL_SIGNATURES = [
  /(^|\n)Exit code [1-9]\d*/,
  /Command failed with exit code [1-9]/i,
  /\bELIFECYCLE\b/,
  /\bnpm ERR!/,
  /(^|\n)fatal: /,
  /Traceback \(most recent call last\)/,
  /\berror TS\d{3,}\b/,
  /\bcommand not found\b/,
  /\bPermission denied\b/,
  /\bsegmentation fault\b/i,
  /\bpanic:/,
]

export function failureSignal(text, isError) {
  if (isError === true) return 'is_error'
  if (typeof text !== 'string' || !text) return null
  const tail = text.length > SIG_SCAN_TAIL ? text.slice(-SIG_SCAN_TAIL) : text
  for (const re of FAIL_SIGNATURES) {
    const m = re.exec(tail)
    if (m) return m[0].trim().replace(/\s+/g, ' ').slice(0, 40)
  }
  return null
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

// Redact tokens/secrets from a string before writing to disk. Placeholder —
// extended by later tasks. Returns the string unchanged at this stage.
export function redact(s) {
  if (typeof s !== 'string') return String(s == null ? '' : s)
  return s
}

// --- inbox ------------------------------------------------------------------
function inboxPaths(root) {
  const dir = path.join(root, '.strata', 'inbox')
  return { dir, file: path.join(dir, 'captures.jsonl'), cursor: path.join(dir, '.cursor.json') }
}

export function stubHash(stub) {
  const tail = (stub.snippet || '').slice(-200) || stub.command || stub.signal || ''
  return crypto.createHash('sha1').update((stub.signal || '') + '|' + tail).digest('hex').slice(0, 12)
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
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(file, JSON.stringify({ ...stub, h }) + '\n')
    return true
  } catch { return false }
}

function unpromotedCount(root) {
  try {
    return fs.readFileSync(inboxPaths(root).file, 'utf8').trim().split('\n').filter(Boolean).length
  } catch { return 0 }
}

function nowIso() {
  try { return new Date().toISOString() } catch { return '' }
}

// --- handlers ---------------------------------------------------------------
// PostToolUse: log a stub when a Bash result shows a failure signal.
function handlePostToolUse(root, payload) {
  const tool = payload.tool_name || payload.toolName
  if (tool && tool !== 'Bash') return 0
  const input = payload.tool_input || payload.toolInput || {}
  const resp = payload.tool_response ?? payload.toolResponse
  const isError =
    payload.is_error === true ||
    (resp && typeof resp === 'object' && (resp.is_error === true || resp.interrupted === true))
  const text = resultText(resp)
  const sig = failureSignal(text, isError)
  if (!sig) return 0
  const command = String(input.command || '').replace(/\s+/g, ' ').slice(0, 300)
  return appendStub(root, {
    ts: nowIso(), event: 'PostToolUse', tool: 'Bash', signal: sig, command, snippet: text.slice(-MAX_SNIPPET),
  }) ? 1 : 0
}

// PreCompact: scan the transcript tail (cursor-based) for failed tool_results and
// log stubs, so anything not already captured survives the compaction.
function handlePreCompact(root, payload) {
  const tp = payload.transcript_path || payload.transcriptPath
  if (!tp || !fs.existsSync(tp)) return 0
  const { cursor } = inboxPaths(root)
  let cur = { transcriptPath: tp, offset: 0 }
  try { cur = JSON.parse(fs.readFileSync(cursor, 'utf8')) } catch { /* fresh */ }
  if (cur.transcriptPath !== tp) cur = { transcriptPath: tp, offset: 0 }

  let size = 0
  try { size = fs.statSync(tp).size } catch { return 0 }
  let start = typeof cur.offset === 'number' ? cur.offset : 0
  if (start > size) start = 0 // rotated / truncated
  if (size - start > MAX_SCAN_BYTES) start = size - MAX_SCAN_BYTES // cap

  let buf = ''
  try {
    const length = size - start
    if (length > 0) {
      const fd = fs.openSync(tp, 'r')
      const b = Buffer.alloc(length)
      fs.readSync(fd, b, 0, length, start)
      fs.closeSync(fd)
      buf = b.toString('utf8')
    }
  } catch { return 0 }

  const lastNl = buf.lastIndexOf('\n')
  const processable = lastNl >= 0 ? buf.slice(0, lastNl) : ''
  const consumed = lastNl >= 0 ? buf.slice(0, lastNl + 1) : ''
  const newOffset = start + Buffer.byteLength(consumed, 'utf8')

  let logged = 0
  for (const line of processable.split('\n')) {
    if (!line.trim()) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    const blocks = Array.isArray(o.message?.content) ? o.message.content : []
    for (const blk of blocks) {
      if (blk?.type !== 'tool_result') continue
      const text = typeof blk.content === 'string' ? blk.content : resultText(blk.content) || resultText(o.toolUseResult)
      const sig = failureSignal(text, blk.is_error === true)
      if (!sig) continue
      if (appendStub(root, {
        ts: o.timestamp || nowIso(), event: 'PreCompact', tool: 'tool_result', signal: sig, command: '',
        snippet: String(text).slice(-MAX_SNIPPET),
      })) logged++
    }
  }

  try {
    fs.mkdirSync(path.dirname(cursor), { recursive: true })
    fs.writeFileSync(cursor, JSON.stringify({ transcriptPath: tp, offset: newOffset }))
  } catch { /* best effort */ }
  return logged
}

// --- nudge text -------------------------------------------------------------
const HOW =
  'capture it now — Claude Code: `/strata:capture` · Codex / other tools: ' +
  "`Skill(name='strata', args='capture')` — writing it straight to `.strata/`"

function inboxNote(root) {
  const n = unpromotedCount(root)
  return n > 0
    ? ` ⚠ ${n} un-promoted finding${n === 1 ? '' : 's'} are staged in \`.strata/inbox/captures.jsonl\` (auto-logged tool failures) — review them and promote the real ones to issues/learnings at your next \`/strata:capture\` or \`/strata:save\`, then clear the file.`
    : ''
}

function messageFor(event, root, logged) {
  switch (event) {
    case 'SessionStart':
      return (
        'This project uses strata for repo-owned memory (`.strata/`). Follow the ' +
        'immediate-capture rule: the moment a command/tool/test fails, you retry or ' +
        'use a workaround, or you hit a bug, gotcha, or a reusable lesson, ' + HOW +
        '. Do not defer to session end — context compaction can erase findings that ' +
        'live only in the conversation.' + inboxNote(root)
      )
    case 'PreCompact':
      return (
        'Context is about to be compacted. If any findings, failures, gotchas, or ' +
        'durable lessons from this session are not yet written to `.strata/`, ' + HOW +
        ' BEFORE the compaction runs — otherwise they may be lost.' +
        (logged > 0
          ? ` (Backstop: ${logged} raw failure stub${logged === 1 ? '' : 's'} were just auto-saved to ` +
            '`.strata/inbox/captures.jsonl`, but still capture the *lessons* now while you have the context.)'
          : '')
      )
    case 'PostToolUse':
      return (
        `⚠ That command failed (${logged > 0 ? 'logged' : 'signal'}). A raw stub was saved to ` +
        '`.strata/inbox/captures.jsonl` as a backstop. If the cause or the fix is a reusable lesson ' +
        '(not a typo), ' + HOW + ' now while it is fresh.'
      )
    default:
      return (
        'If there are unsaved findings, gotchas, or lessons from this session, ' + HOW +
        ' so they reach `.strata/` before context is lost.' + inboxNote(root)
      )
  }
}

async function main() {
  try {
    let payload = {}
    try { payload = JSON.parse(await readStdin()) } catch { payload = {} }
    const event = payload.hook_event_name || payload.hookEventName || 'Unknown'
    const cwd = payload.cwd || process.cwd()
    const root = findStrataRoot(cwd)
    if (!root) process.exit(0) // not a strata project — stay silent

    let logged = 0
    if (event === 'PostToolUse') logged = handlePostToolUse(root, payload)
    else if (event === 'PreCompact') logged = handlePreCompact(root, payload)

    // PostToolUse only speaks on the calls where it logged a failure — no noise on success.
    if (event === 'PostToolUse' && logged === 0) process.exit(0)

    const out = {
      continue: true,
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: messageFor(event, root, logged),
      },
    }
    process.stdout.write(JSON.stringify(out), () => process.exit(0))
  } catch {
    process.exit(0) // never break the host session
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()
