// Minimal frontmatter reader for strata files: flat `key: value` scalars, quoted
// strings, inline `# comments`, and `|` / `>` block scalars. Nested YAML is not
// part of the strata schemas, so it is skipped rather than parsed.

const FM = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

export function parseFrontmatter(text) {
  const t = String(text || '').replace(/^﻿/, '')
  const m = FM.exec(t)
  if (!m) return { present: false, data: {}, body: t }
  const data = {}
  const lines = m[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || /^\s*#/.test(line) || /^\s/.test(line)) continue
    const kv = /^([A-Za-z0-9_.-]+)[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/.exec(line)
    if (!kv) continue
    let v = kv[2] == null ? '' : kv[2]
    if (/^[|>][+-]?\s*$/.test(v)) {
      const parts = []
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || !lines[i + 1].trim())) parts.push(lines[++i].trim())
      v = parts.join(v.startsWith('|') ? '\n' : ' ').trim()
    } else {
      v = scalar(v)
    }
    data[kv[1]] = v
  }
  return { present: true, data, body: t.slice(m[0].length) }
}

function scalar(raw) {
  let v = raw.trim()
  let m = /^"((?:[^"\\]|\\.)*)"/.exec(v)
  if (m) { try { return JSON.parse(`"${m[1]}"`) } catch { return m[1] } }
  m = /^'((?:[^']|'')*)'/.exec(v)
  if (m) return m[1].replace(/''/g, "'")
  const c = v.search(/\s#/)
  if (c >= 0) v = v.slice(0, c)
  return v.trim()
}

// The first `**Label:** text` line of a body (e.g. What, Lesson).
export function labelLine(body, label) {
  const re = new RegExp(`^\\*\\*${label}:\\*\\*[ \\t]*(.+)$`, 'm')
  const m = re.exec(String(body || ''))
  return m ? m[1].trim() : ''
}

export function firstHeading(body) {
  const m = /^#{1,3}[ \t]+(.+)$/m.exec(String(body || ''))
  return m ? m[1].trim() : ''
}
