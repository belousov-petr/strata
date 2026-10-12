import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { gitProject, run, runJson, rm, write, tmpDir, repoRoot } from './helpers.mjs'
import { compareVersions, runningVersion, versionCheck } from '../skills/strata/scripts/lib/version.mjs'

// The version this checkout declares, so the tests survive a release bump.
const RUNNING = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version
const [MA, MI, PA] = RUNNING.split('.').map(Number)

function claudeDir(plugins) {
  const cfg = tmpDir('strata-claude-cfg-')
  if (plugins !== undefined) {
    write(cfg, 'plugins/installed_plugins.json', typeof plugins === 'string' ? plugins : JSON.stringify({ version: 2, plugins }))
  }
  return cfg
}

const entry = (version) => ({ scope: 'user', installPath: '/x', version, lastUpdated: '2026-10-10T00:00:00.000Z' })

test('semver order is numeric, and a pre-release sorts below its release', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1)
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0)
  assert.equal(compareVersions('0.2.0', '0.3.0'), -1)
  assert.equal(compareVersions('0.3.0-rc.1', '0.3.0'), -1)
  assert.equal(compareVersions('0.3.0-rc.2', '0.3.0-rc.10'), -1)
  assert.equal(compareVersions('unknown', '0.3.0'), null)
  assert.equal(runningVersion(), RUNNING)
})

test('a newer installed strata warns in status and save --prepare, text and json', () => {
  const dir = gitProject()
  const newer = `${MA}.${MI + 1}.0`
  const cfg = claudeDir({
    'strata@mkt': [entry(RUNNING), entry(newer)],
    'strata@other': [entry(`${MA}.${MI}.${PA + 1}`)],
    'notstrata@mkt': [entry('99.0.0')],
  })
  const env = { CLAUDE_CONFIG_DIR: cfg }
  const want = `Warning: strata ${newer} is installed, but this session runs ${RUNNING}. Start a new session before saving, so every step runs the same version.`
  const st = run(['status'], { cwd: dir, env })
  assert.equal(st.stdout.split('\n')[0], want)
  const sj = runJson(['status'], { cwd: dir, env }).json
  assert.deepEqual(sj.version, { running: RUNNING, installed: newer, newer: true, warning: want.replace(/^Warning: /, '') })
  const sp = run(['save', '--prepare', '--dry-run'], { cwd: dir, env })
  assert.equal(sp.stdout.split('\n')[2], want)
  const pj = runJson(['save', '--prepare', '--dry-run'], { cwd: dir, env }).json
  assert.equal(pj.version.newer, true)
  assert.equal(pj.version.installed, newer)
  rm(cfg)
  rm(dir)
})

test('an equal or older installed version says nothing', () => {
  const dir = gitProject()
  for (const v of [RUNNING, '0.0.1', `${MA}.${MI}.${PA}-rc.1`]) {
    const cfg = claudeDir({ 'strata@mkt': [entry(v)] })
    const env = { CLAUDE_CONFIG_DIR: cfg }
    assert.ok(!run(['status'], { cwd: dir, env }).stdout.includes('Warning:'), v)
    assert.ok(!run(['save', '--prepare', '--dry-run'], { cwd: dir, env }).stdout.includes('Warning:'), v)
    const j = runJson(['status'], { cwd: dir, env }).json.version
    assert.equal(j.newer, false)
    assert.equal(j.warning, null)
    assert.equal(j.installed, v)
    rm(cfg)
  }
  rm(dir)
})

test('an unreadable, malformed or missing record is silent', () => {
  const dir = gitProject()
  const cases = [
    claudeDir('{ not json'),
    claudeDir(JSON.stringify({ version: 2, plugins: 'nope' })),
    claudeDir({ 'strata@mkt': [{ installPath: '/x', version: 'unknown' }] }),
    claudeDir(),
  ]
  for (const cfg of cases) {
    const env = { CLAUDE_CONFIG_DIR: cfg }
    const st = run(['status'], { cwd: dir, env })
    assert.equal(st.status, 0, st.stderr)
    assert.ok(!st.stdout.includes('Warning:'))
    const j = runJson(['status'], { cwd: dir, env }).json.version
    assert.deepEqual(j, { running: RUNNING, installed: null, newer: false, warning: null })
    rm(cfg)
  }
  rm(dir)
})

test('the running version falls back to the Codex manifest; an unreadable one is silent', () => {
  const root = tmpDir('strata-plugin-root-')
  write(root, '.claude-plugin/plugin.json', '{ broken')
  write(root, '.codex-plugin/plugin.json', JSON.stringify({ name: 'strata', version: '0.1.1' }))
  assert.equal(runningVersion(root), '0.1.1')
  const cfg = claudeDir({ 'strata@mkt': [entry('0.2.0')] })
  assert.equal(versionCheck({ root, env: { CLAUDE_CONFIG_DIR: cfg } }).newer, true)
  fs.rmSync(path.join(root, '.codex-plugin'), { recursive: true })
  assert.equal(runningVersion(root), null)
  assert.deepEqual(versionCheck({ root, env: { CLAUDE_CONFIG_DIR: cfg } }), { running: null, installed: '0.2.0', newer: false, warning: null })
  rm(cfg)
  rm(root)
})
