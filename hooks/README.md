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

It fires on four events:

- **`SessionStart`** — injects the immediate-capture rule so the agent captures findings
  *as it works*. Re-fires after a compaction, re-priming the rule. If the inbox holds
  un-promoted stubs (e.g. from a prior session), it reports the count so they get triaged.
- **`PostToolUse`** (matcher `Bash`) — when a Bash result shows a failure signal it
  **writes a raw stub to the inbox immediately** and pings the agent to distill the
  lesson. Silent on success, so there is no per-command noise.
- **`PreCompact`** — scans the transcript tail (cursor-based) for failed tool results,
  **writes any not-yet-captured ones to the inbox**, then injects the last-chance
  "save unsaved findings now" reminder.
- **`SessionEnd`** — a non-blocking, silent end-of-session drain: runs the same
  cursor-based transcript scan so a session that ends without compaction still captures
  failures. No nudge — `SessionEnd` cannot inject context into the agent. Skipped only on
  a hard kill. The shared per-transcript cursor means `PreCompact` + `SessionEnd` on one
  session never double-log.

### Failure detection

Grounded in the real Claude Code transcript schema: a non-zero Bash exit is recorded
inconsistently — sometimes `is_error: true`, sometimes `is_error: false` with **no
exit-code field** (e.g. an eslint/pnpm exit 1, where the only signal is `ELIFECYCLE` /
"exit code 1" in the output text). So the guard trusts an explicit error flag **and** a
small set of high-precision output signatures (`Exit code N`, `ELIFECYCLE`, `npm ERR!`,
`fatal:`, `Traceback`, `error TS####`, `command not found`, …). Bare "error"/"FAIL" in
otherwise-successful output does **not** trigger it, so noisy-but-passing commands stay
silent.

### The inbox — `.strata/inbox/captures.jsonl`

The deterministic half, and the part that actually defeats compaction loss. Each stub is
one JSON line (`{ts, event, tool, signal, command, snippet, h}`); duplicates are
suppressed by a content hash, and `PreCompact` tracks a byte cursor (`.cursor.json`) so
it never re-scans. This is **raw evidence, not a finished memory** — `/strata:capture`
and `/strata:save` read the inbox, promote the real findings into issues/learnings, and
clear it; `/strata:load` surfaces the count (wired in /strata:capture, /strata:save,
/strata:load — see SKILL.md §5a). The inbox is git-ignored transient scratch by default;
`/strata:capture` and `/strata:save` promote the real findings then clear it. Do not
commit raw inbox files — redaction is best-effort and raw stubs can still contain secrets.

### Honest limitation

A hook still **cannot make the agent reason**. The nudges prime the discipline; the
*inbox* is the part that does not depend on the agent taking a turn — it captures the
raw failure evidence deterministically, so even if compaction lands before the agent
distills a lesson, the evidence is already on disk to promote later. The agent still
writes the *distilled* learning; the hook guarantees the *evidence* is never lost.

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

> **Codex deterministic capture — verified 2026-06-20.** Codex now does full
> deterministic capture, not nudge-only:
>
> - **`PostToolUse(Bash)`** — Codex sends `tool_name:"Bash"`, `tool_input.command`, and
>   `tool_response` as a plain string. The guard reads these and writes a raw stub on
>   failure signals. One caveat: Codex does **not** include an exit code in the
>   `PostToolUse` payload, so a bare non-zero exit with terse output (no recognisable
>   signature) is caught only at the next rollout scan, not immediately.
> - **`PreCompact` / `Stop` rollout scan** — the guard parses the Codex session rollout
>   (`~/.codex/sessions/**/rollout-*.jsonl`) and detects failures deterministically by the
>   `Process exited with code N` marker in `function_call_output` entries. This is
>   exit-code-deterministic, so it also captures benign non-zero exits (e.g. grep/rg/test
>   no-match) — those land as low-value stubs that `/strata:capture` promotion drops.
>
> The sample config wires **SessionStart + PostToolUse(Bash) + PreCompact + Stop**.
> Codex uses `Stop` (per-turn) rather than `SessionEnd`; the `Stop` drain is silent (no
> stdout) and shares the per-transcript cursor with `PreCompact` so they never double-log.

## Cross-platform notes

- The script is **Node** (`node` is guaranteed for Claude Code; Codex inherits it from
  the shell that launched it). If `node` isn't on PATH for a Codex session, use an
  absolute path to the node binary in `command` / `commandWindows`.
- Claude's `${CLAUDE_PLUGIN_ROOT}` always returns forward slashes, even on Windows.
- Codex uses `command` on macOS/Linux and `commandWindows` on Windows — set both (verify the field name against current Codex docs before relying on it).
- `.gitattributes` keeps this script and the JSON LF on every OS.
- The inbox is git-ignored by default and stubs are redacted at write; do not commit raw inbox files.

## Disabling it

- **Claude:** `claude plugin disable strata` (disables the whole plugin), or remove
  `hooks/hooks.json` from your install.
- **Codex:** delete the hook entry from `~/.codex/hooks.json` (or the project's
  `.codex/hooks.json`).
