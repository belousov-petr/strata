# ADR-0019: Hot rules go into the adapters, and Claude auto memory holds only a pointer

- **Status:** accepted
- **Date:** 2026-10-03

## Context and Problem Statement

Learnings and their trigger table live in `.strata/memory/`. The main agent reads them through `/strata:load`. Subagents and Codex agents never do: Claude Code gives a subagent the `CLAUDE.md` and `AGENTS.md` files but not the main conversation's memory, and Codex reads `AGENTS.md`. So the rules that matter most, the ones marked `hot: true`, never reached the agents doing much of the work.

[ADR-0001](ADR-0001-strata-namespace-commands-adapters.md) kept the adapters thin on purpose, so they could not drift from the manifest.

Separately, Claude Code keeps its own auto memory per repository. Strata said nothing about it, so it became a second log beside `.strata/`. The hot memory files there load every session in Claude only, and they drift from the repo.

## Considered Options

1. **Tell subagents to read `MEMORY.md`.** Pros: no generated text. Cons: depends on every agent prompt remembering, which is the problem. Rejected.
2. **Copy the rules into the adapters by hand.** Rejected: drift.
3. **A generated block between markers in `CLAUDE.md` and `AGENTS.md`.** *(chosen)* Pros: reaches every agent that reads the adapters, regenerated from the learnings so it cannot drift, and leaves the rest of the file alone. Cons: the adapters grow, and recent Claude Code versions read both files, so the block can load twice.
4. **Ignore Claude auto memory.** Rejected: it keeps growing as a competing record.
5. **Keep only a pointer in Claude auto memory.** *(chosen)*

## Decision

- `CLAUDE.md` and `AGENTS.md` carry a block between `<!-- strata:hot-rules:begin -->` and `<!-- strata:hot-rules:end -->`: one line per hot learning, with its trigger, the first sentence of the lesson, and a link. Strata writes only between the markers. `init` adds the markers, `save` refreshes the block, and the block is capped at 25 rules and 4,000 characters, with an overflow line pointing at `MEMORY.md`.
- The set is the `MEMORY.md` hot subset from [ADR-0015](ADR-0015-hot-tier-curated-subset.md), including its graceful default.
- The rule for Claude auto memory: it holds only a pointer to `.strata/`. `/strata:save` writes or refreshes one file, `strata-pointer.md`, and one index line in that folder's `MEMORY.md`, when the folder exists. It writes nothing else there and skips silently when the folder is missing. Findings, decisions and lessons go to the strata journal instead.

## Consequences

- Hot rules reach subagents and Codex without any prompt changes.
- The adapters are no longer pure pointers. The block is generated and bounded, so the drift risk ADR-0001 guarded against does not return.
- The block can load twice in Claude Code when both adapters exist. The cap keeps that cost small.
- A Claude user who opens auto memory finds one pointer to the repo record instead of a competing log.
- A custom `autoMemoryDirectory` setting is not detected, and then no pointer is written.

## Sources

- Claude Code subagents, what a subagent loads: https://code.claude.com/docs/en/sub-agents
- Claude Code memory, auto memory location and loading: https://code.claude.com/docs/en/memory
- [ADR-0001](ADR-0001-strata-namespace-commands-adapters.md), [ADR-0015](ADR-0015-hot-tier-curated-subset.md)
