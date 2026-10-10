# ADR-0027: The capture rule rides in the adapters, subagents included

- **Status:** implemented (0.2.0)
- **Date:** 2026-10-10

## Context and Problem Statement

The capture rule, "write it to the strata journal, not to a tool's own memory", lived in `SKILL.md`, the commands, the `SessionStart` note and the auto-memory pointer ([ADR-0019](ADR-0019-hot-rules-in-adapters-and-auto-memory-pointer.md)). Subagents see none of those. In a five-day session no subagent used the journal, and one wrote its findings into the tool's private auto memory twice, where the main agent and every other tool could not see them.

Subagents do read `CLAUDE.md`, and Codex reads `AGENTS.md`. The generated hot-rules block in both is the one place strata controls that every agent reads.

## Considered Options

1. **Tell the main agent to brief each subagent.** Rejected: it depends on the agent remembering, which is the failure.
2. **Add the rule to the hand-written part of the adapters.** Pros: simple. Cons: existing projects only get it if someone edits their files.
3. **Open the generated hot-rules block with the rule, and say it in the adapter templates.** *(chosen)*

## Decision

- The hot-rules block now opens with one line: every agent here, subagents included, captures findings, decisions and lessons with `strata journal add` (the `/strata:capture` skill; Codex: `Skill(name='strata', args='capture')`), never in a tool's private auto-memory.
- The `CLAUDE.md` and `AGENTS.md` templates say the same in their prose, and the `SessionStart` note asks the main agent to tell subagents.
- Existing projects get the line on their next `strata views` or `/strata:save`, because the block is generated.

## Consequences

- One more line in a block that loads in every session and in every subagent.
- Right after updating, `strata check` reports the block as stale until the next save regenerates it.

## Sources

- Claude Code subagents, what a subagent loads: https://code.claude.com/docs/en/sub-agents
- [ADR-0019](ADR-0019-hot-rules-in-adapters-and-auto-memory-pointer.md)
