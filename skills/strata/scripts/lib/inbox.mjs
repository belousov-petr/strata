// The hook's capture inbox, read side: counts by category, repeated failures,
// and the clear that /strata:save runs after promotion.

import fs from 'node:fs'
import path from 'node:path'
import { guard, inboxDir, withLock, ensureInboxDir } from './core.mjs'

const CURSOR_MAX_AGE_MS = 30 * 24 * 3600 * 1000

export function inboxSummary(shared) {
  const stubs = guard.readStubs(shared)
  const sum = guard.summarizeStubs(stubs)
  return { ...sum, line: guard.summaryLine(sum), file: guard.inboxPaths(shared).file }
}

export function formatInbox(sum, { limit = 10 } = {}) {
  const lines = [sum.line]
  if (sum.repeated.length) {
    lines.push('Repeated failures:')
    for (const g of sum.repeated.slice(0, limit)) {
      lines.push(`  ${g.count}x  ${g.command || '(no command)'}  [${g.signal}]`)
    }
    if (sum.repeated.length > limit) lines.push(`  … ${sum.repeated.length - limit} more`)
  }
  return lines.join('\n')
}

// Truncate captures.jsonl (keeping any line the hook appended meanwhile) and
// prune only stale cursor files. Cursors must survive a clear: without them the
// next scan re-reads old transcripts and logs promoted failures again.
export function clearInbox(shared) {
  const dir = inboxDir(shared)
  const file = guard.inboxPaths(shared).file
  let cleared = 0
  if (fs.existsSync(file)) {
    ensureInboxDir(dir)
    withLock(path.join(dir, '.captures.lock'), () => {
      const raw = fs.readFileSync(file, 'utf8')
      cleared = raw.split('\n').filter((l) => l.trim()).length
      const now = fs.readFileSync(file, 'utf8')
      const tail = now.length > raw.length && now.startsWith(raw) ? now.slice(raw.length) : ''
      const tmp = `${file}.tmp-${process.pid}`
      fs.writeFileSync(tmp, tail)
      fs.renameSync(tmp, file)
    })
  }
  let pruned = 0
  let names = []
  try { names = fs.readdirSync(dir) } catch { /* none */ }
  for (const n of names) {
    if (!/^\.cursor\.[0-9a-f]+\.json$/.test(n)) continue
    const p = path.join(dir, n)
    let stale = false
    try {
      const c = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (!c.transcriptPath || !fs.existsSync(c.transcriptPath)) stale = true
      if (Date.now() - fs.statSync(p).mtimeMs > CURSOR_MAX_AGE_MS) stale = true
    } catch { stale = true }
    if (stale) { try { fs.rmSync(p, { force: true }); pruned++ } catch { /* ignore */ } }
  }
  return { cleared, pruned }
}
