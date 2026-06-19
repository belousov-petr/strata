#!/usr/bin/env node
// strata capture-guard — a lifecycle hook shared by Claude Code (plugin hooks)
// and Codex CLI (~/.codex/hooks.json or a project .codex/hooks.json).
//
// It reads the hook event JSON on stdin. If the session's working directory is
// inside a strata project (a `.strata/` directory exists at cwd or an ancestor),
// it prints a JSON object that injects a capture reminder into the agent's
// context (`hookSpecificOutput.additionalContext` — the field both tools read).
// Everywhere else it is a SILENT no-op (no output). Any error => exit 0 with no
// output, so the hook can never break or stall the host session.
//
// Honest scope: a hook cannot force the agent to act before context compaction
// on either tool. This nudges — it primes the immediate-capture discipline at
// SessionStart and drops a last-chance reminder at PreCompact. The agent still
// performs the capture.

import fs from 'node:fs'
import path from 'node:path'

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

const HOW =
  'capture it now — Claude Code: `/strata:capture` · Codex / other tools: ' +
  "`Skill(name='strata', args='capture')` — writing it straight to `.strata/`"

function messageFor(event) {
  switch (event) {
    case 'SessionStart':
      return (
        'This project uses strata for repo-owned memory (`.strata/`). Follow the ' +
        'immediate-capture rule: the moment a command/tool/test fails, you retry or ' +
        'use a workaround, or you hit a bug, gotcha, or a reusable lesson, ' + HOW +
        '. Do not defer to session end — context compaction can erase findings that ' +
        'live only in the conversation.'
      )
    case 'PreCompact':
      return (
        'Context is about to be compacted. If any findings, failures, gotchas, or ' +
        'durable lessons from this session are not yet written to `.strata/`, ' + HOW +
        ' BEFORE the compaction runs — otherwise they may be lost.'
      )
    default:
      return (
        'If there are unsaved findings, gotchas, or lessons from this session, ' + HOW +
        ' so they reach `.strata/` before context is lost.'
      )
  }
}

;(async () => {
  try {
    let payload = {}
    try { payload = JSON.parse(await readStdin()) } catch { payload = {} }
    const event = payload.hook_event_name || payload.hookEventName || 'Unknown'
    const cwd = payload.cwd || process.cwd()
    if (!findStrataRoot(cwd)) process.exit(0) // not a strata project — stay silent
    const out = {
      continue: true,
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: messageFor(event),
      },
    }
    process.stdout.write(JSON.stringify(out), () => process.exit(0))
  } catch {
    process.exit(0) // never break the host session
  }
})()
