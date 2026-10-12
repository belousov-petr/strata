// Is a newer strata installed than the one running? (ADR-0030)
//
// The plugin loads when a session starts. An update during the session, or a
// later Skill call that loads the newer copy, can mix two versions in one save.
// `strata status` and `strata save --prepare` warn when the newest installed
// version is greater than this script's own. Any read or parse error is silent.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// lib/ -> scripts/ -> strata/ -> skills/ -> the plugin root
export const PLUGIN_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function parseVersion(v) {
  const m = SEMVER.exec(String(v == null ? '' : v).trim())
  if (!m) return null
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] }
}

// Numeric semver order: -1, 0 or 1, or null when either side does not parse.
// A pre-release sorts below its release.
export function compareVersions(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return null
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] > y.core[i] ? 1 : -1
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) return Number(p) > Number(q) ? 1 : -1
    if (pn !== qn) return pn ? -1 : 1
    return p > q ? 1 : -1
  }
  return 0
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

// This script's own version: the Claude plugin manifest, else the Codex one.
export function runningVersion(root = PLUGIN_ROOT) {
  for (const rel of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    const j = readJson(path.join(root, rel))
    if (j && parseVersion(j.version)) return String(j.version).trim()
  }
  return null
}

export function claudeConfigDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

// The highest version among Claude Code's installed `strata@<marketplace>` entries.
export function installedVersion(env = process.env) {
  const j = readJson(path.join(claudeConfigDir(env), 'plugins', 'installed_plugins.json'))
  if (!j || typeof j !== 'object' || !j.plugins || typeof j.plugins !== 'object') return null
  let best = null
  for (const [key, value] of Object.entries(j.plugins)) {
    if (!key.startsWith('strata@')) continue
    for (const e of [].concat(value)) {
      const v = e && typeof e === 'object' ? e.version : null
      if (!parseVersion(v)) continue
      if (best === null || compareVersions(v, best) > 0) best = String(v).trim()
    }
  }
  return best
}

export function versionCheck({ env = process.env, root = PLUGIN_ROOT } = {}) {
  let running = null
  let installed = null
  try {
    running = runningVersion(root)
    installed = installedVersion(env)
  } catch { /* silence */ }
  const newer = Boolean(running && installed && compareVersions(installed, running) > 0)
  return {
    running, installed, newer,
    warning: newer
      ? `strata ${installed} is installed, but this session runs ${running}. Start a new session before saving, so every step runs the same version.`
      : null,
  }
}
