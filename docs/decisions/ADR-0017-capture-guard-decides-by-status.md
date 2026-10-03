# ADR-0017: The capture guard decides by real status and stays quiet

- **Status:** accepted
- **Date:** 2026-10-03

## Context and Problem Statement

[ADR-0011](ADR-0011-deterministic-capture-inbox.md) logged a failure when a tool result carried an error flag *or* matched a text signature such as "Permission denied" or "Exit code 1". Text signatures were meant to cover commands whose failure left no flag. In practice they fired on successful commands whose output merely contained those words, including a grep of the hook's own source. In one long session the hook logged 27 captures and none was worth promoting: typos, missing files, and permission refusals from the agent's own safety layer. Each one also pushed a "capture this now" message into the conversation.

Claude Code now documents that `PostToolUse` fires only after a tool succeeds and that failures go to `PostToolUseFailure`, whose error text starts with `Exit code N`. A Claude transcript records `is_error` on every Bash result. So on Claude every `PostToolUse` capture was a false positive by construction. Codex still sends no status in `PostToolUse`, but its rollout file records `Process exited with code N`.

## Considered Options

1. **Tune the signature list.** Pros: small change. Cons: still guesses from text where the status is known. Rejected.
2. **Decide from the status when there is one, use strict text patterns only where there is none, and put refusals in their own category.** *(chosen)*
3. **Drop text detection entirely.** Pros: no false positives. Cons: Codex `PostToolUse` would never log, leaving only its per-turn `Stop` scan. The strict fallback costs little. Rejected.

## Decision

- Claude: listen on `PostToolUseFailure` (matcher `Bash`). A `PostToolUse` result is a success and is never logged. Transcript results follow `is_error`.
- Codex: the rollout exit code decides. `PostToolUse`, which carries no status, uses a strict fallback: patterns anchored to the start of a line, checked over the last 60 lines only.
- Categories: `failure` for a shell command that really failed, `policy` for permission refusals (the auto mode classifier, the built-in safety check, a harness block, a user rejection), `tool-error` for non-shell tool errors, `interrupted` for calls cut short. Only `failure` is a failure.
- Stubs carry `category` and, when the host provides it, `tool_use_id`, which makes the live event and the transcript scan agree on one stub.
- The per-failure nudge is off by default (`STRATA_FAILURE_NUDGE=1` turns it on). `/strata:load`, `/strata:save` and the `SessionStart` note report counts by category and list only repeated failures.
- Clearing the inbox keeps the transcript cursors, pruning only stale ones, so a cleared failure is not logged again.

## Consequences

- The inbox holds real failures, and the conversation is not interrupted after each one.
- Refusals are visible as a count, which is useful when a permission setup keeps blocking work, without being treated as bugs.
- A one-off failure is counted but not listed. A failure that repeats is listed. That matches what is worth promoting.
- Codex `PostToolUse` can still miss a failure with terse output. Its `Stop` scan picks it up within the turn from the exit code.
- [ADR-0010](ADR-0010-capture-guard-hook.md)'s failure nudge is now opt-in. Its `SessionStart` priming stays.

## Sources

- Claude Code hooks reference, `PostToolUse` and `PostToolUseFailure`: https://code.claude.com/docs/en/hooks
- Codex hooks: https://developers.openai.com/codex/hooks
- [ADR-0011](ADR-0011-deterministic-capture-inbox.md), [ADR-0014](ADR-0014-precompact-silent-evidence-drain.md)
