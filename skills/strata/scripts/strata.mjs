#!/usr/bin/env node
// strata — the mechanical half of strata project memory.
//
// Judgment stays with the agent: what to capture, where it belongs, how to word it.
// This script does the rest the same way every time: the pending-capture journal,
// generated views, checks, the save chores, the merge driver, ids, the drift list,
// and the auto-memory pointer. No dependencies; Node 18+ on Windows, macOS, Linux.
//
// Run `node strata.mjs help` for the subcommands.

import fs from 'node:fs'
import { parseArgs, resolveRoots, print, UsageError } from './lib/core.mjs'
import * as journal from './lib/journal.mjs'
import { syncHotRules } from './lib/adapters.mjs'
import { syncViews, viewsSummary, drifted } from './lib/views.mjs'
import { runCheck, formatCheck } from './lib/check.mjs'
import { prepare, formatPrepare } from './lib/save.mjs'

const HELP = `strata <subcommand> [options]     (every subcommand takes --root <dir>)

  journal add --kind <kind> --title <t> [--text <t> | --text - (stdin)] [--lineage <l>] [--ref <path>]... [--filed <path>]
  journal list [--json]
  journal clear (--all | --id <id>...)
  status [--json]                 load-time summary: pending captures, inbox, views
  where [--json]                  print the project root, shared root and inbox path
  hot-rules [--check] [--install] refresh the hot-rules block in CLAUDE.md / AGENTS.md
  views [--check]                 regenerate ACTIVE/OPEN/PARKED, learnings INDEX, the MEMORY table, hot rules
  check [--json]                  validate budgets, frontmatter, ids, links, view drift (exit 1 on errors)
  save --prepare [--dry-run]      every mechanical save step, then what needs judgment

kinds: ${journal.KINDS.join(', ')}
`

function readStdin() {
  if (process.stdin.isTTY) return ''
  try { return fs.readFileSync(0, 'utf8') } catch { return '' }
}

function out(args, obj, text) {
  if (args.json) print(JSON.stringify(obj, null, 2))
  else print(text)
}

const commands = {
  help() { print(HELP); return 0 },

  where(argv) {
    const args = parseArgs(argv, { bools: ['json'] })
    const r = resolveRoots(args.root)
    const inbox = journal.journalPaths(r.shared).dir
    out(args, { ...r, inbox }, `project: ${r.project}\nshared:  ${r.shared}\ninbox:   ${inbox}`)
    return 0
  },

  journal(argv) {
    const [sub, ...rest] = argv
    const args = parseArgs(rest, { bools: ['json', 'all'], multi: ['ref', 'id'] })
    const r = resolveRoots(args.root)
    if (sub === 'add') {
      // `--text -` reads the text from stdin (a heredoc or a pipe). Stdin is only
      // read on that explicit request, so a host that leaves stdin open never hangs.
      let text = typeof args.text === 'string' ? args.text : null
      if (text === '-') text = readStdin()
      const e = journal.addEntry(r, { ...args, text })
      const n = journal.readJournal(r.shared).length
      out(args, { entry: e, pending: n }, `journal: +1 ${e.kind} (${e.id}). ${n} pending.`)
      return 0
    }
    if (sub === 'list') {
      const entries = journal.readJournal(r.shared)
      out(args, { file: journal.journalPaths(r.shared).file, entries },
        journal.formatEntries(entries, { file: journal.journalPaths(r.shared).file }))
      return 0
    }
    if (sub === 'clear') {
      const res = journal.clearEntries(r, { ids: args.id, all: args.all })
      out(args, res, `journal: cleared ${res.cleared}, ${res.kept} still pending.` +
        (res.cleared ? ' The cleared batch is kept in journal.routed.jsonl until the next clear.' : ''))
      return 0
    }
    throw new UsageError('strata journal: use add, list or clear')
  },

  'hot-rules'(argv) {
    const args = parseArgs(argv, { bools: ['json', 'check', 'install'] })
    const r = resolveRoots(args.root)
    const res = syncHotRules(r.project, { check: args.check, install: args.install })
    const lines = res.results.length
      ? res.results.map((x) => `${x.file}: ${x.state}`)
      : ['no CLAUDE.md or AGENTS.md at the project root']
    lines.push(`hot rules: ${res.shown} shown of ${res.total}` + (res.overflow ? ` (${res.overflow} over the block budget; curate the hot set)` : ''))
    out(args, res, lines.join('\n'))
    return args.check && res.results.some((x) => x.state === 'stale') ? 1 : 0
  },

  views(argv) {
    const args = parseArgs(argv, { bools: ['json', 'check'] })
    const r = resolveRoots(args.root)
    const res = syncViews(r.project, { check: args.check })
    const stale = drifted(res)
    out(args, { ...res, drifted: stale }, viewsSummary(res) +
      (args.check ? (stale.length ? `\nviews: ${stale.length} differ from a fresh render; run strata views` : '\nviews: current') : ''))
    return args.check && stale.length ? 1 : 0
  },

  check(argv) {
    const args = parseArgs(argv, { bools: ['json'] })
    const r = resolveRoots(args.root)
    const res = runCheck(r.project)
    out(args, res, formatCheck(res))
    return res.ok ? 0 : 1
  },

  async save(argv) {
    const args = parseArgs(argv, { bools: ['json', 'prepare', 'dry-run', 'no-pointer'] })
    if (!args.prepare) throw new UsageError('strata save: use save --prepare [--dry-run]. The rest of /strata:save is the agent\'s judgment.')
    const r = resolveRoots(args.root)
    const ctx = await prepare(r, { dryRun: Boolean(args['dry-run']), pointer: !args['no-pointer'] })
    out(args, ctx, formatPrepare(ctx))
    return 0
  },

  status(argv) {
    const args = parseArgs(argv, { bools: ['json'] })
    const r = resolveRoots(args.root)
    const entries = journal.readJournal(r.shared)
    const lines = [journal.journalSummaryLine(entries)]
    out(args, { roots: r, journal: { pending: entries.length, kinds: Object.fromEntries(journal.kindCounts(entries)) } },
      lines.join('\n'))
    return 0
  },
}

async function main(argv) {
  const [cmd, ...rest] = argv
  const fn = commands[cmd || 'help'] || commands[(cmd || '').replace(/^--?/, '')]
  if (!fn) { process.stderr.write(`strata: unknown subcommand '${cmd}'\n\n${HELP}`); return 2 }
  return await fn(rest)
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code || 0 },
  (e) => {
    process.stderr.write((e instanceof UsageError ? e.message : (e && e.stack) || String(e)) + '\n')
    process.exitCode = e instanceof UsageError ? 2 : 1
  },
)
