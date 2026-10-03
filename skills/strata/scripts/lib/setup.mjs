// `strata setup`: the one-time, idempotent install of the 0.1.0 add-ons in a
// project (run by /strata:init): the inbox ignore file, the generated-views
// merge driver (.gitattributes block + local git config), and the hot-rules
// block in CLAUDE.md / AGENTS.md. Never touches anything else.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readLf, writeText, exists, git, gitOut, inGit, SCRIPT_PATH } from './core.mjs'
import { syncHotRules } from './adapters.mjs'

export const DRIVER = 'strata-views'
const BEGIN = '# >>> strata generated views (merge by rows; /strata:save regenerates them)'
const END = '# <<< strata generated views'
export const VIEW_FILES = [
  '.strata/issues/ACTIVE.md',
  '.strata/issues/OPEN.md',
  '.strata/issues/PARKED.md',
  '.strata/memory/learnings/INDEX.md',
  '.strata/memory/MEMORY.md',
  '/CLAUDE.md',
  '/AGENTS.md',
]

const fwd = (p) => p.replace(/\\/g, '/')
const quote = (p) => `"${fwd(p)}"`

// The command git runs. Absolute node and script paths: git config is local to
// this clone, and save --prepare refreshes the line when the plugin moves.
export function driverCommand() {
  return `${quote(process.execPath)} ${quote(SCRIPT_PATH)} views --merge-driver %O %A %B %P`
}

export function attributesBlock() {
  return [BEGIN, ...VIEW_FILES.map((f) => `${f} merge=${DRIVER}`), END].join('\n')
}

function installAttributes(project, dryRun) {
  const file = path.join(project, '.gitattributes')
  const cur = readLf(file)
  const block = attributesBlock()
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
  return { inGit: true, configured: Boolean(cur), current: cur === driverCommand(), command: cur }
}

export function installDriver(project, dryRun) {
  const st = driverState(project)
  if (!st.inGit) return 'not-in-git'
  if (st.current) return 'current'
  if (!dryRun) {
    git(project, ['config', '--local', `merge.${DRIVER}.name`, 'strata generated views (row merge)'])
    git(project, ['config', '--local', `merge.${DRIVER}.driver`, driverCommand()])
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
