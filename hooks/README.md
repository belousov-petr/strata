# Strata capture-guard hook

A small lifecycle hook that puts failed tool calls on disk before compaction can drop them, and reminds the agent to capture what matters. One script, shared by **Claude Code** and **Codex CLI**, on **Windows, macOS, and Linux**.

## What it does

[`strata-capture-guard.mjs`](strata-capture-guard.mjs) reads the hook event JSON on stdin and acts **only when the working directory is inside a strata project** (a `.strata/` directory at the cwd or any ancestor). Outside a strata project it is a **silent no-op**. Any error exits 0 with no output, so it can never break or stall a session.

It fires on six events:

- **`SessionStart`**: injects the capture rule (capture each important moment with `/strata:capture`, which appends to the pending-capture journal) and reports what is waiting for the next `/strata:save`: pending journal captures and inbox counts by category. Re-fires after a compaction.
- **`PostToolUseFailure`** (Claude, matcher `Bash`): a shell command that failed. Claude sends `error` text that starts with `Exit code N`. Logged as a `failure`, or `interrupted` when `is_interrupt` is true.
- **`PostToolUse`** (matcher `Bash`): on Claude this event only follows a success, so it never logs. On Codex the response is a plain string with no status, so a strict text fallback applies (below).
- **`PreCompact`**: scans the transcript tail (cursor-based) for failed tool results not yet logged, then exits with no stdout. Claude Code's `PreCompact` contract rejects `hookSpecificOutput.additionalContext`.
- **`SessionEnd`** (Claude): the same silent scan for a session that ends without compacting.
- **`Stop`** (Codex): Codex's per-turn drain, the same silent scan of the rollout. Codex has no `SessionEnd`.

All scans share one per-transcript cursor, so nothing is logged twice. A stub keyed by the host's `tool_use_id` is never written twice either, so the live event and a later scan agree.

**Quiet by default.** The old per-failure "capture this now" message is off. Set `STRATA_FAILURE_NUDGE=1` in the hook environment to turn it back on. Counts by category, with repeated failures listed, show up at `SessionStart`, in `strata status` (run by `/strata:load`), and in `strata save --prepare` (run by `/strata:save`).

### Failure detection: status first

The hook decides from the real status of a tool result ([ADR-0017](../docs/decisions/ADR-0017-capture-guard-decides-by-status.md)):

| Source | Status | Decision |
|---|---|---|
| Claude `PostToolUseFailure` | always a failure | `failure`, or `interrupted` |
| Claude `PostToolUse` | always a success | nothing |
| Claude transcript `tool_result` | `is_error` | `is_error: false` is a success whatever the text says |
| Codex rollout `function_call_output` | `Process exited with code N` | `N` decides |
| Codex `PostToolUse` | none | strict text fallback |

Every stub carries a category:

- `failure`: a shell command that really failed.
- `policy`: a permission refusal, not a failure. Covers the auto mode classifier (a denial, or no verdict), the built-in safety check, a harness block, and a user rejecting a tool call.
- `tool-error`: a non-shell tool that returned an error, such as a missing file or an edit whose text did not match.
- `interrupted`: a call cut short.

The text fallback is only used where no status exists. Its patterns are anchored to the start of a line and only the last 60 lines are read, so a grep or `cat` that merely prints words like "Permission denied", "fatal:" or "Exit code 1" does not match. It covers shell "command not found", Python tracebacks, git `fatal:`, npm, pnpm and yarn failures, TypeScript errors, segmentation faults, Go panics, and the Windows "is not recognized" errors.

### The inbox: `.strata/inbox/captures.jsonl`

One inbox per repository: the hook and the strata script resolve `.strata/inbox/` in the repository's **main worktree** whenever that worktree also holds `.strata/` (read from the `.git` file and its `commondir`, no git process). Sessions in other worktrees write there too, so captures never scatter or vanish with a removed worktree. Outside git, or when the main worktree has no `.strata/`, the inbox stays in the current project root. An inbox folder created without an ignore file gets one that ignores everything.

Each stub is one JSON line: `{ts, event, tool, category, signal, command, snippet, h}`, plus `tuid` when the host gives a tool-use id. Duplicates are suppressed by `h`. This is **raw evidence, not finished memory**: `/strata:save` promotes what is worth keeping (repeated failures first) into issues and learnings and then runs `strata inbox clear`, which empties the file but keeps the transcript cursors, so cleared failures are not logged again. Stale cursors (transcript gone, or older than 30 days) are pruned. The inbox is git-ignored; do not commit raw inbox files, because redaction is best effort.

The journal (`.strata/inbox/journal.jsonl`) sits beside the inbox. The hook only counts it; `/strata:capture` writes it through the strata script.

### Honest limitation

A hook still **cannot make the agent reason**. The `SessionStart` note primes the
discipline. The *inbox* is the part that does not depend on the agent taking a turn: it
captures the raw failure evidence deterministically, so even if compaction lands before
the agent distills a lesson, the evidence is already on disk to promote later. The agent
still writes the *distilled* learning, through the journal; the hook guarantees the
*evidence* is never lost.

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
> - **`PostToolUse(Bash)`**: Codex sends `tool_name:"Bash"`, `tool_input.command`, and
>   `tool_response` as a plain string with no exit code. The guard applies the strict,
>   line-anchored text fallback there. A bare non-zero exit with terse output is caught
>   at the next `Stop` scan, which reads the exit code from the rollout.
> - **`PreCompact` / `Stop` rollout scan** — the guard parses the Codex session rollout
>   (`~/.codex/sessions/**/rollout-*.jsonl`) and detects failures deterministically by the
>   `Process exited with code N` marker in `function_call_output` entries. This is
>   exit-code-deterministic, so it also captures benign non-zero exits (e.g. grep/rg/test
>   no-match). Those are one-off `failure` stubs: counted at save, not listed unless they
>   repeat, and not promoted unless they matter.
>
> The sample config wires **SessionStart + PostToolUse(Bash) + PreCompact + Stop**.
> Codex uses `Stop` (per-turn) rather than `SessionEnd`; both rollout drains are silent
> (no stdout) and share the per-transcript cursor so they never double-log.

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
