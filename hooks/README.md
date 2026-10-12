# Strata hooks

Two small hooks, each one script shared by **Claude Code** and **Codex CLI**, on **Windows, macOS, and Linux**:

- [`strata-capture-guard.mjs`](strata-capture-guard.mjs) puts failed tool calls on disk before compaction can drop them, and reminds the agent to capture what matters.
- [`strata-lesson-trigger.mjs`](strata-lesson-trigger.mjs) shows the lessons that match a command or an edit right before it runs ([below](#lesson-trigger-pretooluse)).

# Capture guard

## What it does

[`strata-capture-guard.mjs`](strata-capture-guard.mjs) reads the hook event JSON on stdin and acts **only when the working directory is inside a strata project** (a `.strata/` directory at the cwd or any ancestor). Outside a strata project it is a **silent no-op**. Any error exits 0 with no output, so it can never break or stall a session.

It fires on six events:

- **`SessionStart`**: injects the capture rule (capture each important moment with `/strata:capture`, which appends to the pending-capture journal) and reports what is waiting for the next `/strata:save`: pending journal captures and inbox counts by category. Re-fires after a compaction. With `hot_rules: session` it also hands over the hot rules ([below](#hot-rules-at-session-start)).
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

Exit code 1 from `grep`, `egrep`, `fgrep`, `rg`, `ag`, `test`, `[`, `[[`, `diff`, `cmp`, `command -v` and `which` is an answer, not an error. Such a benign exit is counted in `.strata/inbox/benign.json`, once per tool call, and never stored as a stub ([ADR-0024](../docs/decisions/ADR-0024-benign-exits-and-refusals.md)). The guard reads the shell command to find which command set the status, so `cat log | grep -q x` and `[ -f out ] && echo yes` are benign while `npm test && grep x log` is still a failure.

Every stub carries a category:

- `failure`: a shell command that really failed.
- `policy`: a permission refusal, not a failure. Covers the auto mode classifier (a denial, or no verdict), the built-in safety check, a harness block, and a user rejecting a tool call. `strata status` and `strata save --prepare` list these by command as steps refused for the agent, to hand to the operator.
- `tool-error`: a non-shell tool that returned an error, such as a missing file or an edit whose text did not match.
- `interrupted`: a call cut short.

The text fallback is only used where no status exists. Its patterns are anchored to the start of a line and only the last 60 lines are read, so a grep or `cat` that merely prints words like "Permission denied", "fatal:" or "Exit code 1" does not match. It covers shell "command not found", Python tracebacks, git `fatal:`, npm, pnpm and yarn failures, TypeScript errors, segmentation faults, Go panics, and the Windows "is not recognized" errors.

### The inbox: `.strata/inbox/captures.jsonl`

One inbox per repository: the hook and the strata script resolve `.strata/inbox/` in the repository's **main worktree** whenever that worktree also holds `.strata/` (read from the `.git` file and its `commondir`, no git process). Sessions in other worktrees write there too, so captures never scatter or vanish with a removed worktree. Outside git, or when the main worktree has no `.strata/`, the inbox stays in the current project root. An inbox folder created without an ignore file gets one that ignores everything.

Each stub is one JSON line: `{ts, event, tool, category, signal, command, snippet, h}`, plus `tuid` when the host gives a tool-use id. Duplicates are suppressed by `h`. This is **raw evidence, not finished memory**: `/strata:save` promotes what is worth keeping (repeated failures first) into issues and learnings and then runs `strata inbox clear`, which empties the file but keeps the transcript cursors, so cleared failures are not logged again. Stale cursors (transcript gone, or older than 30 days) are pruned. The inbox is git-ignored; do not commit raw inbox files, because redaction is best effort.

The journal (`.strata/inbox/journal.jsonl`) sits beside the inbox. The hook only counts it; `/strata:capture` writes it through the strata script.

### Hot rules at session start

A project that sets `hot_rules: session` in the `MANIFEST.md` frontmatter keeps its hot rules in `.strata/memory/HOT-RULES.md` instead of `CLAUDE.md` and `AGENTS.md` ([ADR-0032](../docs/decisions/ADR-0032-hot-rules-at-session-start.md)). The adapters then hold one pointer line, and `SessionStart` appends the rules to its context, on every source: `startup`, `resume`, `clear` and `compact`.

- It reads `HOT-RULES.md` and rewrites the links to start at the project root. When the file is missing it renders the rules from the learnings.
- Claude Code replaces an `additionalContext` over 10,000 characters with a file path and a short preview, so the whole context stays at or under 9,500 characters. When the rules do not fit, the hook keeps the header and the capture rule, then as many whole rule lines as fit, then one line: `N more hot rules in .strata/memory/HOT-RULES.md`. A rule is never cut mid-line.
- Codex development sessions get the rules this way only when the hooks from [`codex-hooks.sample.json`](codex-hooks.sample.json) are installed. Without them, they rely on the pointer line in `AGENTS.md`.

### Agent runs stay silent: `agent_env`

`agent_env:` in the `MANIFEST.md` frontmatter lists environment variable names, for example `agent_env: [PAPERCLIP_AGENT_ID, PAPERCLIP_RUN_ID]`. When any of them is set and non-empty in the hook's environment, both hooks, this one and the lesson trigger, exit 0 at once with no output and write nothing: no stub, no benign count, no cursor, no lesson index. Unattended agent runs then leave the developer inbox alone. It works with either `hot_rules` mode, and an empty or unset variable changes nothing.

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
>   exit-code-deterministic. Benign exits (grep, rg or test with no match, and the like) are
>   counted, not stored, the same as on Claude.
>
> The sample config wires **SessionStart + PostToolUse(Bash) + PreCompact + Stop**.
> Codex uses `Stop` (per-turn) rather than `SessionEnd`; both rollout drains are silent
> (no stdout) and share the per-transcript cursor so they never double-log.

# Lesson trigger (PreToolUse)

[`strata-lesson-trigger.mjs`](strata-lesson-trigger.mjs) runs before every Bash, Edit, Write, MultiEdit and NotebookEdit call in Claude Code, and before Bash and `apply_patch` in Codex ([ADR-0020](../docs/decisions/ADR-0020-operation-triggered-lessons.md)). It looks up the learnings whose `match:` regexes fit the command or whose `paths:` globs fit a file the call touches, and returns at most three of them as `additionalContext`: the title, the first sentence of the lesson, and the file to read.

- It reads `.strata/inbox/lesson-triggers.json`, which `strata views` and `/strata:save` compile. When the learnings changed since then, it rebuilds the index once. It never parses the markdown on an ordinary call.
- It never blocks or changes a call: no permission decision, no updated input. It is silent when nothing matches, outside a strata project, and on any error.
- A lesson already shown in a session is not shown again in that session for 30 minutes. Set `STRATA_LESSON_REPEAT_MINUTES` to change that (0 repeats every time).
- `STRATA_LESSON_TRIGGERS=0` turns it off, and so does a set variable named in the MANIFEST's `agent_env:` ([above](#agent-runs-stay-silent-agent_env)).
- `strata triggers --command "<command>"` or `strata triggers --path <file>` shows what would fire.

Claude Code gets it with the plugin (`hooks.json`, matcher `Bash|Edit|Write|MultiEdit|NotebookEdit`). Codex users copy the `PreToolUse` entry from [`codex-hooks.sample.json`](codex-hooks.sample.json) (matcher `Bash|apply_patch|Edit|Write`).

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
  `hooks/hooks.json` from your install. To turn off only the lesson trigger, set
  `STRATA_LESSON_TRIGGERS=0`.
- **Codex:** delete the hook entry from `~/.codex/hooks.json` (or the project's
  `.codex/hooks.json`).
