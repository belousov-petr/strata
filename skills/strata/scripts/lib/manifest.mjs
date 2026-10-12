// Settings a project keeps in the `.strata/MANIFEST.md` frontmatter.

import path from 'node:path'
import { readLf, guard } from './core.mjs'
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

// `hot_rules:` and `agent_env:` (ADR-0032), read by the capture guard's own
// parser so the hooks and the script always agree.
export const HOT_RULES_MODES = ['adapters', 'session']

// { mode: 'adapters' | 'session', error? }. An unknown value works as
// `adapters`, and strata check reports it.
export function hotRulesSetting(project) {
  const raw = guard.manifestSettings(project).hotRules
  if (!raw) return { mode: 'adapters' }
  if (HOT_RULES_MODES.includes(raw)) return { mode: raw }
  return { mode: 'adapters', error: `hot_rules '${raw}' must be adapters or session` }
}

export function hotRulesMode(project) { return hotRulesSetting(project).mode }

// { names, bad }: the variable names, and those that are not valid names.
export function agentEnvSetting(project) {
  const names = guard.manifestSettings(project).agentEnv
  return { names, bad: names.filter((n) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) }
}
