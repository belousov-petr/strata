// `strata setup`: the one-time, idempotent install of the 0.1.0 add-ons in a
// project (run by /strata:init): the inbox ignore file, the generated-views
// merge driver (.gitattributes block + local git config), and the hot-rules
// block in CLAUDE.md / AGENTS.md. Never touches anything else.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readLf, writeText, exists, git, gitOut, inGit, SCRIPT_PATH } from './core.mjs'
import { syncHotRules, HOT_RULES_FILE } from './adapters.mjs'
import { viewsExternal } from './views.mjs'
import { hotRulesMode } from './manifest.mjs'

export const DRIVER = 'strata-views'
const BEGIN = '# >>> strata generated views (merge by rows; /strata:save regenerates them)'
const END = '# <<< strata generated views'
export const ADAPTER_FILES = ['/CLAUDE.md', '/AGENTS.md']
export const VIEW_FILES = [
  '.strata/issues/ACTIVE.md',
  '.strata/issues/OPEN.md',
  '.strata/issues/PARKED.md',
  '.strata/memory/learnings/INDEX.md',
  '.strata/memory/MEMORY.md',
  ...ADAPTER_FILES,
]

const fwd = (p) => p.replace(/\\/g, '/')
const quote = (p) => `"${fwd(p)}"`

// --- the launcher (ADR-0026) ---------------------------------------------------
// git config used to name the strata script inside the plugin folder, and a
// plugin update removes that version's folder, so the driver broke silently.
// Now git runs a small launcher kept in this clone's git folder. At merge time
// it finds the current strata install (Claude's installed-plugins record, the
// path setup recorded, the newest cached version) and runs its merge driver;
// with no install found it does a plain three-way text merge, so a merge never
// fails because of strata.
export function gitCommonDir(project) {
  const d = gitOut(project, ['rev-parse', '--git-common-dir'])
  return d ? path.resolve(project, d) : null
}

export function launcherPath(project) {
  const c = gitCommonDir(project)
  return c ? path.join(c, 'strata', 'merge-driver.mjs') : null
}

export function launcherSource(recorded = SCRIPT_PATH) {
  return `#!/usr/bin/env node
// strata merge-driver launcher, written by \`strata setup\` into this clone's
// git folder (ADR-0026). git runs it for the files in the .gitattributes
// strata block. It finds the installed strata script and runs its merge
// driver; if none is found it merges the file as plain text. Do not edit;
// \`strata setup\` and /strata:save rewrite it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const RECORDED = ${JSON.stringify(fwd(recorded))}
const SUFFIX = ['skills', 'strata', 'scripts', 'strata.mjs']

const isFile = (p) => { try { return fs.statSync(p).isFile() } catch { return false } }
const list = (d) => { try { return fs.readdirSync(d) } catch { return [] } }
const scriptIn = (root) => { const p = path.join(root, ...SUFFIX); return isFile(p) ? p : null }
const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const inPluginCache = (p) => /[\\\\/]plugins[\\\\/]cache[\\\\/]/.test(p)

function newer(a, b) {
  const x = String(a).split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  const y = String(b).split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  return false
}

// Claude Code's record of installed plugins: a project-scoped install for this
// repository first, then a user install, newest first.
function fromInstalled() {
  let j
  try { j = JSON.parse(fs.readFileSync(path.join(configDir(), 'plugins', 'installed_plugins.json'), 'utf8')) } catch { return null }
  const cwd = path.resolve(process.cwd())
  const rank = (e) => (e.projectPath ? (cwd.startsWith(path.resolve(e.projectPath)) ? 2 : 0) : 1)
  const entries = []
  for (const [k, v] of Object.entries((j && j.plugins) || {})) if (/^strata@/.test(k)) for (const e of [].concat(v)) if (e && e.installPath && rank(e) > 0) entries.push(e)
  entries.sort((a, b) => rank(b) - rank(a) || String(b.lastUpdated || '').localeCompare(String(a.lastUpdated || '')))
  for (const e of entries) { const s = scriptIn(e.installPath); if (s) return s }
  return null
}

function fromCache() {
  const base = path.join(configDir(), 'plugins', 'cache')
  let best = null
  for (const m of list(base)) for (const v of list(path.join(base, m, 'strata'))) {
    const s = scriptIn(path.join(base, m, 'strata', v))
    if (s && (!best || newer(v, best.v))) best = { v, s }
  }
  return best ? best.s : null
}

// A clone or a fixed folder that setup recorded wins; a recorded plugin-cache
// folder yields to the current install, because an update replaces it.
export function findScript() {
  const recorded = isFile(RECORDED) ? RECORDED : null
  if (recorded && !inPluginCache(recorded)) return recorded
  return fromInstalled() || recorded || fromCache()
}

function plainMerge(O, A, B) {
  const r = spawnSync('git', ['merge-file', '-L', 'ours', '-L', 'base', '-L', 'theirs', A, O, B], { stdio: 'inherit', windowsHide: true })
  if (r.error || r.status === null || r.status < 0 || r.status >= 128) return 2
  return r.status > 0 ? 1 : 0
}

const [O, A, B, P] = process.argv.slice(2)
if (O && A && B) {
  const script = findScript()
  if (script) {
    const r = spawnSync(process.execPath, [script, 'views', '--merge-driver', O, A, B, P || A], { stdio: 'inherit', windowsHide: true })
    process.exit(r.status === null ? 2 : r.status)
  }
  process.stderr.write('strata merge driver: no strata install found; merged ' + (P || 'the file') + ' as plain text. Run strata setup (or /strata:init) to repair.\\n')
  process.exit(plainMerge(O, A, B))
}
`
}

function installLauncher(project, dryRun) {
  const file = launcherPath(project)
  if (!file) return 'not-in-git'
  const src = launcherSource()
  let cur = null
  try { cur = fs.readFileSync(file, 'utf8') } catch { /* none */ }
  if (cur === src) return 'current'
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, src)
  }
  return cur == null ? 'created' : 'updated'
}

// The command git runs: node by absolute path (git may run without the
// user's PATH), then the launcher. save --prepare refreshes both when they move.
export function driverCommand(project) {
  return `${quote(process.execPath)} ${quote(launcherPath(project) || SCRIPT_PATH)} %O %A %B %P`
}

// Paths named in a configured driver command that no longer exist.
export function missingPaths(command) {
  const out = []
  for (const m of String(command || '').matchAll(/"([^"]+)"/g)) if (!exists(m[1])) out.push(m[1])
  return out
}

// With generated_views: external the project's own generator owns the views,
// so the block routes only the adapters (their hot-rules block is strata's).
// With hot_rules: session, HOT-RULES.md holds the hot rules and joins either
// list (ADR-0032).
export function attributesBlock({ external = false, session = false } = {}) {
  const files = [...(external ? ADAPTER_FILES : VIEW_FILES), ...(session ? [HOT_RULES_FILE] : [])]
  return [BEGIN, ...files.map((f) => `${f} merge=${DRIVER}`), END].join('\n')
}

function installAttributes(project, dryRun) {
  const file = path.join(project, '.gitattributes')
  const cur = readLf(file)
  const block = attributesBlock({ external: viewsExternal(project), session: hotRulesMode(project) === 'session' })
  if (cur == null) {
    if (!dryRun) writeText(file, block + '\n')
    return 'created'
  }
  const b = cur.indexOf(BEGIN)
  const e = b >= 0 ? cur.indexOf(END, b) : -1
  if (b >= 0 && e >= 0) {
    const next = cur.slice(0, b) + block + cur.slice(e + END.length)
    if (next === cur) return 'current'
    if (!dryRun) writeText(file, next)
    return 'updated'
  }
  const sep = cur.endsWith('\n\n') || cur === '' ? '' : cur.endsWith('\n') ? '\n' : '\n\n'
  if (!dryRun) writeText(file, cur + sep + block + '\n')
  return 'appended'
}

export function driverState(project) {
  if (!inGit(project)) return { inGit: false }
  const cur = gitOut(project, ['config', '--local', '--get', `merge.${DRIVER}.driver`])
  const file = launcherPath(project)
  let launcherCurrent = false
  try { launcherCurrent = Boolean(file) && fs.readFileSync(file, 'utf8') === launcherSource() } catch { /* missing */ }
  return {
    inGit: true, configured: Boolean(cur), command: cur,
    current: cur === driverCommand(project) && launcherCurrent,
    missing: cur ? missingPaths(cur) : [],
  }
}

export function installDriver(project, dryRun) {
  const st = driverState(project)
  if (!st.inGit) return 'not-in-git'
  if (st.current) return 'current'
  installLauncher(project, dryRun)
  if (!dryRun) {
    git(project, ['config', '--local', `merge.${DRIVER}.name`, 'strata generated views (row merge)'])
    git(project, ['config', '--local', `merge.${DRIVER}.driver`, driverCommand(project)])
  }
  return st.configured ? 'updated' : 'installed'
}

function installInboxIgnore(project, dryRun) {
  const file = path.join(project, '.strata', 'inbox', '.gitignore')
  if (exists(file)) return 'current'
  const tpl = fileURLToPath(new URL('../../templates/inbox/.gitignore', import.meta.url))
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.copyFileSync(tpl, file)
  }
  return 'created'
}

export function setup(project, { dryRun = false } = {}) {
  const res = {
    inboxIgnore: installInboxIgnore(project, dryRun),
    gitattributes: installAttributes(project, dryRun),
    mergeDriver: installDriver(project, dryRun),
  }
  const hot = syncHotRules(project, { install: !dryRun, check: dryRun })
  res.hotRules = hot.results
  return res
}

export function formatSetup(res) {
  const lines = [
    `.strata/inbox/.gitignore: ${res.inboxIgnore}`,
    `.gitattributes (generated views merge by rows): ${res.gitattributes}`,
    `git config merge.${DRIVER}.driver: ${res.mergeDriver}`,
    ...res.hotRules.map((h) => `${h.file} hot-rules block: ${h.state}`),
  ]
  if (res.mergeDriver === 'not-in-git') lines.push('Not a git repository: the merge driver is skipped.')
  else lines.push('Other clones of this repo run `strata setup` once too: git config is not committed.')
  return lines.join('\n')
}
