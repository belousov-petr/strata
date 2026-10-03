// Claude Code auto memory holds only a pointer to .strata/ (ADR-0019).
//
// Auto memory lives in <config dir>/projects/<encoded path>/memory/, where the
// config dir is CLAUDE_CONFIG_DIR or ~/.claude and the encoded path replaces every
// character that is not a letter or digit with '-'. It is derived from the git
// repository, so every worktree shares the main worktree's folder. When that
// folder exists, strata writes one file (strata-pointer.md) and keeps one line
// for it in that folder's MEMORY.md. It never writes anything else there and
// says nothing when the folder is missing.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { guard, readText } from './core.mjs'

export const POINTER_FILE = 'strata-pointer.md'

export const POINTER_TEXT = `---
name: Strata project memory
description: This project's memory is repo-owned under .strata/ (strata). Keep only this pointer here.
type: reference
---

This project keeps its memory in the repository under \`.strata/\`, managed by the strata plugin. Start at \`.strata/MANIFEST.md\`.

- Read it with \`/strata:load\`.
- Capture findings, decisions, operator answers and lessons with \`/strata:capture\`. They go to the pending-capture journal, and \`/strata:save\` files them into the repo.
- Do not keep project notes in this auto-memory folder. It holds only this pointer, which \`/strata:save\` refreshes.
`

export const INDEX_LINE = `- [Strata project memory](${POINTER_FILE}): this project's memory lives in the repo under \`.strata/\`; read it with /strata:load, capture with /strata:capture`

export function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

export function encodePath(p) { return path.resolve(p).replace(/[^a-zA-Z0-9]/g, '-') }

export function pointerDisabled() {
  return /^(0|false|off|no)$/i.test(String(process.env.STRATA_AUTO_MEMORY_POINTER || ''))
}

// Existing auto-memory folders for this project (usually one).
export function memoryDirs(roots) {
  const base = path.join(configDir(), 'projects')
  const names = new Set()
  if (process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CODE_PROJECT_DIR_NAME) names.add(process.env.CLAUDE_CODE_PROJECT_DIR_NAME)
  const g = guard.gitTopAndMain(roots.project)
  for (const p of [g && g.main, g && g.top, g ? null : roots.project]) if (p) names.add(encodePath(p))
  let listing = null
  const out = []
  for (const name of names) {
    let dir = path.join(base, name)
    if (name.length > 200) {
      // Long paths are cut to 200 characters plus a hash strata cannot rebuild.
      if (listing === null) { try { listing = fs.readdirSync(base) } catch { listing = [] } }
      const hit = listing.find((n) => n.startsWith(name.slice(0, 200)))
      if (!hit) continue
      dir = path.join(base, hit)
    }
    const mem = path.join(dir, 'memory')
    try { if (fs.statSync(mem).isDirectory() && !out.includes(mem)) out.push(mem) } catch { /* absent: skip silently */ }
  }
  return out
}

function syncIndex(file, dryRun) {
  const cur = readText(file)
  if (cur == null) {
    if (!dryRun) fs.writeFileSync(file, INDEX_LINE + '\n')
    return 'created'
  }
  const eol = cur.includes('\r\n') ? '\r\n' : '\n'
  const lines = cur.split(/\r?\n/)
  const hits = lines.map((l, i) => (l.includes(`(${POINTER_FILE})`) ? i : -1)).filter((i) => i >= 0)
  let next
  if (!hits.length) {
    const body = cur.length && !/\r?\n$/.test(cur) ? cur + eol : cur
    next = body + INDEX_LINE + eol
  } else {
    const keep = hits[0]
    next = lines.map((l, i) => (i === keep ? INDEX_LINE : l)).filter((_, i) => i === keep || !hits.includes(i)).join(eol)
  }
  if (next === cur) return 'current'
  if (!dryRun) fs.writeFileSync(file, next)
  return 'updated'
}

export function writePointers(roots, { dryRun = false } = {}) {
  if (pointerDisabled()) return { disabled: true, dirs: [] }
  const dirs = []
  for (const mem of memoryDirs(roots)) {
    const file = path.join(mem, POINTER_FILE)
    const cur = readText(file)
    let pointer = 'current'
    if (cur !== POINTER_TEXT) {
      pointer = cur == null ? 'created' : 'updated'
      if (!dryRun) {
        try { fs.writeFileSync(file, POINTER_TEXT) } catch { dirs.push({ dir: mem, pointer: 'not-writable', index: 'skipped' }); continue }
      }
    }
    let index
    try { index = syncIndex(path.join(mem, 'MEMORY.md'), dryRun) } catch { index = 'not-writable' }
    dirs.push({ dir: mem, pointer, index })
  }
  return { disabled: false, dirs }
}
