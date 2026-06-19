# Strata capture-guard hook

A small lifecycle hook that nudges the agent to write findings to `.strata/` before
they are lost — shared by **Claude Code** and **Codex CLI**, on **Windows, macOS, and
Linux**.

## What it does

[`strata-capture-guard.mjs`](strata-capture-guard.mjs) reads the hook event JSON on
stdin and, **only when the working directory is inside a strata project** (a `.strata/`
directory at the cwd or any ancestor), prints a JSON object that injects a reminder into
the agent's context via `hookSpecificOutput.additionalContext` — the field both tools
read. Outside a strata project it is a **silent no-op**. Any error exits 0 with no
output, so it can never break or stall a session.

It fires on two events:

- **`SessionStart`** — injects the immediate-capture rule so the agent captures findings
  *as it works* (this is the real fix — the agent forgetting the discipline). Re-fires
  after a compaction, re-priming the rule.
- **`PreCompact`** — a last-chance "save unsaved findings now" reminder right before
  context is compacted.

### Honest limitation

A hook **cannot force** the agent to flush before compaction on either tool —
`PreCompact` can't make the agent take an action first. So this is a reliable *nudge*
(prime + remind), not a guaranteed pre-compaction save. The agent still performs the
capture. Strata stays a convention; this just makes the right thing far more likely.

## Enabling it

### Claude Code — automatic (shipped in the plugin)

`hooks/hooks.json` at the plugin root is auto-discovered when the strata plugin is
enabled, using `${CLAUDE_PLUGIN_ROOT}` to find the script. Nothing to configure —
install/update the plugin and it is active (silent outside strata projects).

Refresh an existing install after the repo changes. A directory-source marketplace
caches the plugin per version, so `claude plugin update` is a no-op for it — reinstall
(or bump the plugin version) to pull a fresh copy:

```text
claude plugin uninstall strata && claude plugin install strata@belousov-petr
```

### Codex CLI — one small config file (plugins can't ship hooks)

Codex plugins cannot ship hooks, so add the hook to a Codex config file. Copy
[`codex-hooks.sample.json`](codex-hooks.sample.json) and replace the absolute path with
the real path to `strata-capture-guard.mjs` on each OS, then place it at either:

- **`~/.codex/hooks.json`** — applies to every project on this machine (still silent
  outside strata projects), or
- **`<project>/.codex/hooks.json`** — committed into a repo so it travels with the
  project and every Codex user gets it (most "repo-owned").

Codex also accepts the same events inline in `config.toml` under `[hooks]`.

## Cross-platform notes

- The script is **Node** (`node` is guaranteed for Claude Code; Codex inherits it from
  the shell that launched it). If `node` isn't on PATH for a Codex session, use an
  absolute path to the node binary in `command` / `commandWindows`.
- Claude's `${CLAUDE_PLUGIN_ROOT}` always returns forward slashes, even on Windows.
- Codex uses `command` on macOS/Linux and `commandWindows` on Windows — set both.
- `.gitattributes` keeps this script and the JSON LF on every OS.

## Disabling it

- **Claude:** `claude plugin disable strata` (disables the whole plugin), or remove
  `hooks/hooks.json` from your install.
- **Codex:** delete the hook entry from `~/.codex/hooks.json` (or the project's
  `.codex/hooks.json`).
