// Settings a project keeps in the `.strata/MANIFEST.md` frontmatter.

import path from 'node:path'
import { readLf } from './core.mjs'
import { parseFrontmatter } from './frontmatter.mjs'

export function manifestData(project) {
  return parseFrontmatter(readLf(path.join(project, '.strata', 'MANIFEST.md')) || '').data
}

// `session_heading:` (ADR-0029): a regular expression, case-insensitive, tested
// against the text of each `## ` heading in project_state.md. Returns null when
// the key is absent or empty, { source, re } when it compiles, and
// { source, error } when it does not.
export function sessionHeading(project, data = manifestData(project)) {
  const raw = data.session_heading
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string') return { source: String(raw), error: 'It must be one regular expression, not a list.' }
  const source = raw.trim()
  if (!source) return null
  // "\b" inside double quotes reaches us as a backspace character.
  if (source.includes('\b')) return { source, error: 'It holds a backspace character. Write the pattern in single quotes, so \\b stays a word boundary.' }
  try {
    return { source, re: new RegExp(source, 'i') }
  } catch (e) {
    const msg = String((e && e.message) || e).trim()
    return { source, error: /[.!?]$/.test(msg) ? msg : msg + '.' }
  }
}
