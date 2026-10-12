// Evidence that a journal entry was filed before `strata journal clear` drops
// it (ADR-0028). An entry is proven when it carries a `filed` path, or when the
// uncommitted working tree shows it: at least half of its title's significant
// words, and at least two, appear in the added lines of `git diff HEAD` plus the
// full text of untracked files, both limited to `.strata/` (without the inbox)
// and the project's docs folders.

import fs from 'node:fs'
import path from 'node:path'
import { git, gitOut, inGit, isDir } from './core.mjs'
import { significantWords, wordIndex, hasWord } from './words.mjs'

const FILE_CAP = 2 * 1024 * 1024
const TOTAL_CAP = 32 * 1024 * 1024

// The folders whose uncommitted text counts: the strata tree without the
// git-ignored inbox (it holds the journal itself), and `docs/` at the project
// root and at the repository root, the same docs folders the drift list reads.
export function evidencePathspecs(project) {
  const specs = ['.strata', ':(exclude).strata/inbox']
  if (isDir(path.join(project, 'docs'))) specs.push('docs')
  const top = gitOut(project, ['rev-parse', '--show-toplevel'])
  if (top && path.resolve(top) !== path.resolve(project) && isDir(path.join(top, 'docs'))) specs.push(':(top)docs')
  return specs
}

// Added lines only: a hunk line that starts with `+`. Headers (`+++ b/x`) come
// before the first `@@` of each file, so they are never read as content.
function addedLines(diff) {
  const out = []
  let inHunk = false
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) { inHunk = false; continue }
    if (line.startsWith('@@')) { inHunk = true; continue }
    if (inHunk && line.startsWith('+')) out.push(line.slice(1))
  }
  return out
}

// The uncommitted text of the evidence folders, or null outside git.
export function treeEvidence(project) {
  if (!inGit(project)) return null
  const specs = evidencePathspecs(project)
  // A repository without commits compares against the empty tree.
  let base = gitOut(project, ['rev-parse', '--verify', '-q', 'HEAD']) ? 'HEAD' : null
  if (!base) {
    const e = git(project, ['hash-object', '-t', 'tree', '--stdin'], { input: '' })
    base = e.ok ? e.stdout.trim() : null
  }
  const parts = []
  let size = 0
  if (base) {
    const d = git(project, ['diff', '--no-color', '--no-ext-diff', '-M', '-U0', base, '--', ...specs])
    if (d.ok) for (const l of addedLines(d.stdout)) { parts.push(l); size += l.length }
  }
  const u = git(project, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...specs])
  if (u.ok) {
    for (const rel of u.stdout.split('\0')) {
      if (!rel || size >= TOTAL_CAP) continue
      const file = path.resolve(project, rel)
      try {
        if (fs.statSync(file).size > FILE_CAP) continue
        const text = fs.readFileSync(file, 'utf8')
        if (text.includes('\0')) continue
        parts.push(text)
        size += text.length
      } catch { /* vanished or unreadable */ }
    }
  }
  return parts.join('\n')
}

// How many of `words` must appear: half of them, rounded up, and at least two.
export function wordsNeeded(n) { return Math.max(2, Math.ceil(n / 2)) }

// Proof for one entry against a word index of the evidence text (null when the
// tree could not be read). Returns { by: 'filed' | 'tree' | null, words, hits }.
export function proveEntry(entry, index) {
  if (entry.filed) return { by: 'filed', words: [], hits: [] }
  const words = significantWords(entry.title)
  if (!index) return { by: null, words, hits: [] }
  const hits = words.filter((w) => hasWord(index, w))
  return { by: words.length && hits.length >= wordsNeeded(words.length) ? 'tree' : null, words, hits }
}

export function evidenceIndex(project) {
  const text = treeEvidence(project)
  return text == null ? null : wordIndex(text)
}
