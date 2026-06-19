# ADR-0010: Optional capture-guard hook for Claude Code and Codex

- **Status:** accepted
- **Date:** 2026-06-19

## Context and Problem Statement

Strata's highest-value rule is *immediate capture* — write a finding/failure/gotcha to `.strata/` the moment it surfaces, before context compaction discards what lives only in the conversation (README: "Findings die in compaction"). But it is a **convention**: nothing makes the agent follow it. The README says so plainly — "Strata is a convention, not a daemon."

Both host tools now expose lifecycle hooks (ADR research, 2026): Claude Code (`hooks/hooks.json` in settings or a plugin) and Codex CLI (`~/.codex/hooks.json`, `<repo>/.codex/hooks.json`, or inline `config.toml [hooks]`). A hook could reinforce the capture rule. Three things constrain the design:

1. **No forced flush.** On *neither* tool can a hook make the agent take an action before compaction — `PreCompact` fires before compaction but cannot trigger an agent turn. A hook can inject context (`hookSpecificOutput.additionalContext`) and block, nothing more.
2. **Codex plugins cannot ship hooks.** Codex packages carry skills, MCP servers, and tool toggles only. Hooks must live in a Codex config file. This is a Codex platform limit, independent of how many repos strata is split into — a separate "Codex repo" could not ship hooks either.
3. **Cross-platform.** The hook must run on Windows, macOS, and Linux.

## Considered Options

1. **No hook (status quo).** Pros: strata stays a pure convention. Cons: the single most valuable rule depends entirely on the agent remembering it.
2. **Block compaction until capture.** Use `PreCompact` + `continue:false`. Pros: forceful. Cons: can't actually make the agent capture (no agent turn), risks filling the context window, and a blocked compaction is worse than a lost finding. Rejected.
3. **Nudge hook — prime + remind, no-op off-strata.** *(chosen)* Pros: addresses the root cause (the agent forgetting) at `SessionStart`, adds a last-chance `PreCompact` reminder, stays silent outside strata projects, and degrades safely. Cons: it nudges rather than guarantees; ships as a default-on plugin hook for Claude, a small shift from the pure-convention default.

## Decision

Option 3. One shared, dependency-free **Node** script, `hooks/strata-capture-guard.mjs`:

- Reads the hook event JSON on stdin; finds `.strata/` at cwd or an ancestor. **Silent no-op** (exit 0, no output) outside a strata project or on any error — it can never break or stall a session.
- Inside a strata project it prints `{"hookSpecificOutput":{"hookEventName":<event>,"additionalContext":<msg>}}` (the field both tools read), with an event-specific message:
  - **`SessionStart`** — injects the immediate-capture discipline so the agent captures *as it works* (re-fires after compaction, re-priming it). This is the real fix.
  - **`PreCompact`** — a last-chance "save unsaved findings now" reminder.
- **Claude Code:** shipped in the plugin at `hooks/hooks.json` (auto-discovered when the plugin is enabled; `${CLAUDE_PLUGIN_ROOT}` locates the script). Default-on, gentle, silent off-strata; disable with `claude plugin disable strata`.
- **Codex:** a `~/.codex/hooks.json` (machine) or committed `<project>/.codex/hooks.json` (repo-owned — fits strata's ethos and travels with the project), copied from `hooks/codex-hooks.sample.json`. `command` + `commandWindows` cover the OS split.
- **Honest scope, documented everywhere:** the hook *nudges*; the agent still performs the capture. Strata remains a convention, now with a reliable reminder.

## Consequences

- Installing/enabling the Claude plugin now activates the capture-guard by default — a deliberate shift from "pure convention," bounded by: it only acts inside strata projects, it injects a reminder (no action, no blocking), and it is one command to disable.
- Codex needs the one small config file. This is inherent to Codex (see constraint 2) — splitting strata into two repos would not change it, so strata stays a single repo with one shared script (no duplication; consistent with ADR-0001/ADR-0005).
- Cross-platform correctness rests on Node being on PATH (guaranteed for Claude Code; inherited from the launching shell for Codex), `commandWindows`, and the `.gitattributes` LF policy (ADR-0009 consequence).
- `tests/lint.sh` validates the hook files (valid JSON, script present, the plugin hook references the script).

## Sources

- Claude Code — Hooks (events, `hookSpecificOutput.additionalContext`, plugin `hooks/hooks.json`, `${CLAUDE_PLUGIN_ROOT}`) — https://code.claude.com/docs/en/hooks
- Codex — Hooks (events, `hooks.json` / `[hooks]`, `command`/`commandWindows`, stdin `cwd`) — https://developers.openai.com/codex/hooks
- Codex — Configuration reference (plugins carry skills/MCP/tool toggles, not hooks) — https://developers.openai.com/codex/config-reference
