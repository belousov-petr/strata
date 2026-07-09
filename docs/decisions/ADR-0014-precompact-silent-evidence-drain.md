# ADR-0014: PreCompact is a silent evidence drain

- **Status:** implemented
- **Date:** 2026-07-09

## Context and Problem Statement

The capture guard used `hookSpecificOutput.additionalContext` for both `SessionStart` and `PreCompact`. Claude Code accepts that event-specific field for `SessionStart`, but `PreCompact` uses the top-level `decision: "block"` pattern and does not accept an event-specific context response. As a result, the evidence scan ran but every compaction reported `invalid PreCompact hook JSON output`.

ADR-0010 generalized one response shape across events. ADR-0011 made the evidence write deterministic, so the useful `PreCompact` behavior is now the scan itself rather than a reminder that cannot cause an agent turn before compaction.

## Considered Options

1. **Keep returning `hookSpecificOutput.additionalContext`.** Rejected because the host rejects that response for `PreCompact`.
2. **Return a universal `systemMessage`.** Rejected because it addresses the operator rather than the agent, cannot create a capture turn before compaction, and adds noise without improving durability.
3. **Block compaction until capture.** Rejected for the reasons in ADR-0010: the hook cannot make the agent perform the capture, and blocking risks exhausting the context window.
4. **Keep the evidence scan and return no stdout.** Chosen. It preserves the deterministic, compaction-proof write while following the event contract.

## Decision

`PreCompact` remains enabled and synchronously scans the transcript tail. After the scan it exits 0 with no stdout, whether or not it wrote stubs. `SessionEnd` and Codex `Stop` remain silent drains. `SessionStart` and failed `PostToolUse` retain their supported `hookSpecificOutput.additionalContext` responses.

An entry-point regression test invokes the real hook process with a `PreCompact` payload and asserts both sides of the contract: one failure stub is persisted and stdout is empty. A companion test confirms `SessionStart` still emits context.

## Consequences

- Compaction no longer reports an invalid hook response.
- Raw failure evidence is still on disk before compaction, which is the deterministic guarantee from ADR-0011.
- There is no last-chance agent nudge during `PreCompact`. Non-machine-detectable moments still depend on the immediate-capture discipline injected at `SessionStart` and reinforced after failed commands.
- ADR-0010 remains in force for supported nudges, but its `PreCompact` output decision is superseded by this record.

## Sources

- Claude Code hooks reference — JSON output and `PreCompact` decision control: https://code.claude.com/docs/en/hooks
- ADR-0010 — original capture-guard nudge decision
- ADR-0011 — deterministic evidence inbox
