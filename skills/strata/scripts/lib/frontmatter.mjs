// Minimal frontmatter reader for strata files: flat `key: value` scalars, quoted
// strings, inline `# comments`, `|` / `>` block scalars, and lists of scalars
// (a `- item` block under the key, or an inline `[a, b]`). Nested YAML is not
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
    if (!v.trim() && i + 1 < lines.length && /^\s*-(\s|$)/.test(lines[i + 1])) {
      // A block list: `key:` then `- item` lines (indented or not).
      const items = []
      while (i + 1 < lines.length && (/^\s*-(\s|$)/.test(lines[i + 1]) || !lines[i + 1].trim())) {
        const item = /^\s*-\s*(.*)$/.exec(lines[++i])
        if (item && item[1].trim()) items.push(scalar(item[1]))
      }
      data[kv[1]] = items
      continue
    }
    if (/^\[.*\]\s*(#.*)?$/.test(v.trim())) {
      data[kv[1]] = flowList(v.trim().replace(/\s+#.*$/, ''))
      continue
    }
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

// `[a, 'b, c', "d"]`: split on commas outside quotes. Regexes with commas
// belong in a block list, where each line is one item.
function flowList(raw) {
  const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'))
  const out = []
  let cur = ''
  let q = null
  for (const ch of inner) {
    if (q) { cur += ch; if (ch === q) q = null; continue }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue }
    if (ch === ',') { if (cur.trim()) out.push(scalar(cur)); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(scalar(cur))
  return out
}

// A frontmatter value as a list: arrays as they are, a non-empty scalar as one item.
export function asList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((x) => x.trim())
  if (v == null) return []
  const s = String(v).trim()
  return s ? [s] : []
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

// A line that starts a new block, so it ends the paragraph before it: a heading,
// a list item, a table row, a quote, a code fence, or another bold label.
const BLOCK_START = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>|```|~~~|\*\*[^*]+:\*\*)/

function paragraphFrom(lines, i, first) {
  const parts = [first]
  for (let j = i + 1; j < lines.length; j++) {
    if (!lines[j].trim() || BLOCK_START.test(lines[j])) break
    parts.push(lines[j])
  }
  return parts.map((s) => s.trim()).join(' ').trim()
}

// The whole labelled paragraph: the text after `**Label:**` plus the lines it
// wraps onto, up to a blank line or the next block. labelLine keeps only the
// first physical line.
export function labelParagraph(body, label) {
  const lines = String(body || '').split('\n')
  const re = new RegExp(`^\\*\\*${label}:\\*\\*[ \\t]*(.*)$`)
  const i = lines.findIndex((l) => re.test(l))
  return i < 0 ? '' : paragraphFrom(lines, i, re.exec(lines[i])[1])
}

// The first paragraph of a body, or the text of a heading when the body opens with one.
export function firstParagraph(body) {
  const lines = String(body || '').split('\n')
  const i = lines.findIndex((l) => l.trim())
  if (i < 0) return ''
  const h = /^#{1,6}[ \t]+(.+)$/.exec(lines[i])
  return h ? h[1].trim() : paragraphFrom(lines, i, lines[i])
}

export function firstHeading(body) {
  const m = /^#{1,3}[ \t]+(.+)$/m.exec(String(body || ''))
  return m ? m[1].trim() : ''
}

// The first sentence of a text, shortened to `max` characters.
export function firstSentence(text, max = 220) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  const m = /^(.+?[.!?])(?=\s|$)/.exec(t)
  let s = m ? m[1] : t
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + '…'
  return s
}
