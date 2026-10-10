#!/usr/bin/env node
// strata lesson trigger: a PreToolUse hook for Claude Code and Codex (ADR-0020).
//
// Before a Bash command or a file edit runs, it looks up the learnings whose
// `match:` regexes fit the command or whose `paths:` globs fit a file the call
// touches, and hands at most three of them to the agent as additional context:
// the title, the first sentence of the lesson, and the file to read.
//
// It reads one small compiled index (`.strata/inbox/lesson-triggers.json`,
// written by `strata views` and `/strata:save`), never the markdown, unless the
// learnings changed since the index was written; then it rebuilds it once.
//
// It never blocks or changes a tool call: no permission decision, no updated
// input. Silent outside a strata project, silent when nothing matches, silent on
// any error (exit 0, no output). STRATA_LESSON_TRIGGERS=0 turns it off.
// A lesson already shown in the same session is not repeated for
// STRATA_LESSON_REPEAT_MINUTES (default 30; 0 repeats it every time).

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  loadTriggerIndex, subjectOf, matchLessons, formatLessons, filterShown, recordShown,
} from '../skills/strata/scripts/lib/triggers.mjs'

const DEFAULT_REPEAT_MINUTES = 30

export function disabled(env = process.env) {
  return /^(0|false|off|no)$/i.test(String(env.STRATA_LESSON_TRIGGERS || '').trim())
}

function repeatMinutes(env = process.env) {
  const v = String(env.STRATA_LESSON_REPEAT_MINUTES ?? '').trim()
  if (v === '') return DEFAULT_REPEAT_MINUTES
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_REPEAT_MINUTES
}

// The nearest folder at or above `dir` that holds .strata/ (the same walk as
// the capture guard, kept here so this hook loads one module less).
export function findProject(dir) {
  let cur = dir
  for (let i = 0; i < 40 && cur; i++) {
    try { if (fs.statSync(path.join(cur, '.strata')).isDirectory()) return cur } catch { /* not here */ }
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return null
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('')
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => { data += c })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
    setTimeout(() => resolve(data), 1000).unref() // never hang the host
  })
}

// The whole decision as a pure function of the payload, for tests.
// Returns the additionalContext text, or null to stay silent.
export function lessonsFor(payload, { env = process.env, now = Date.now() } = {}) {
  if (disabled(env)) return null
  const event = payload.hook_event_name || payload.hookEventName
  if (event && event !== 'PreToolUse') return null
  const project = findProject(path.resolve(payload.cwd || process.cwd()))
  if (!project) return null
  const subject = subjectOf(payload, project)
  if (!subject || (subject.command == null && !subject.paths.length)) return null
  const index = loadTriggerIndex(project)
  if (!index.rules.length) return null
  let hits = matchLessons(index, subject, { max: 50 })
  const sid = payload.session_id || payload.sessionId || ''
  // A session runs in one worktree, so its repeat state sits beside the index.
  const inbox = path.join(project, '.strata', 'inbox')
  const minutes = repeatMinutes(env)
  hits = filterShown(inbox, sid, hits, minutes, now).slice(0, 3)
  if (!hits.length) return null
  try { recordShown(inbox, sid, hits, now) } catch { /* best effort */ }
  return formatLessons(hits, { tool: subject.tool })
}

async function main() {
  try {
    if (disabled()) process.exit(0)
    let payload = {}
    try { payload = JSON.parse(await readStdin()) } catch { process.exit(0) }
    const text = lessonsFor(payload)
    if (!text) process.exit(0)
    const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } }
    process.stdout.write(JSON.stringify(out), () => process.exit(0))
  } catch {
    process.exit(0) // never block or break the host's tool call
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()
