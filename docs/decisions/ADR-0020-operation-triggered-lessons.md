# ADR-0020: Lessons fire before the matching command or edit

- **Status:** implemented (0.2.0)
- **Date:** 2026-10-10

## Context and Problem Statement

Learnings are keyed by operation ([ADR-0003](ADR-0003-operation-keyed-learnings.md)), but the key was prose. The agent had to notice, on its own, that the command it was about to run matched a trigger in a table it read at session start. In a five-day session on a large project that did not happen often enough. A lesson about waiting on `pgrep -f` with a pattern that matches the waiter itself was on record, and two such waiters still ran for hours. A lesson about refreshing a registry after merging skill files was missed. The rule was written down; it just did not show up at the moment of the action.

Both hosts can run a hook before a tool call and hand its output to the model. Claude Code's `PreToolUse` returns `hookSpecificOutput.additionalContext`, and Codex supports the same field for `PreToolUse` on Bash and `apply_patch`.

## Considered Options

1. **Put more rules in the hot block.** Pros: no new parts. Cons: the block is read once, early, and a long one is read less carefully. It is the mechanism that already failed. Rejected.
2. **Match the prose trigger against the command with a model call.** Pros: no new frontmatter. Cons: slow, costs tokens on every call, not deterministic. Rejected.
3. **Machine-readable keys on the learning and a hook that matches them.** *(chosen)* Pros: fires at the exact moment, deterministic, cheap. Cons: someone has to write the patterns; a broad pattern adds noise.
4. **Block the tool call until the agent acknowledges the lesson.** Pros: impossible to miss. Cons: a hook that blocks breaks sessions when it misfires, and strata's hooks have never blocked. Rejected.

## Decision

- A learning may carry `match:`, a list of JavaScript regexes tested against a Bash command (a leading `(?i)` makes one case-insensitive), and `paths:`, a list of globs tested against the files an Edit, Write, MultiEdit, NotebookEdit or `apply_patch` call touches and against the path-like words of a Bash command. Globs are relative to the project root; a glob without a slash matches a file name in any folder.
- `strata views` (and so `/strata:save`) compiles these into `.strata/inbox/lesson-triggers.json`, a git-ignored cache in the worktree's own inbox, because learnings belong to the checked-out branch. The index records a signature of the learning files; when it no longer matches, the hook rebuilds it once.
- `hooks/strata-lesson-trigger.mjs` runs on `PreToolUse`. It returns at most three matching lessons, each as its title, the first sentence of the lesson and the file, in `additionalContext`. It never returns a permission decision or changed input, stays silent when nothing matches, and exits 0 with no output on any error. `STRATA_LESSON_TRIGGERS=0` turns it off.
- A lesson already shown in a session is not shown again in that session for 30 minutes (`STRATA_LESSON_REPEAT_MINUTES`, 0 repeats every time), so a lesson tied to a file the agent edits twenty times does not fill the context.
- `strata check` reports a pattern that does not compile; `strata triggers --command … --path …` shows what would fire.

## Consequences

- A lesson reaches the agent right before the operation it is about, in Claude Code and in Codex, including in subagents, whose tool calls run the same hooks.
- Each Bash or edit call starts one more Node process. On a busy small server Node itself starts in about 70 ms and the hook adds about 30 ms; the matching is under 1 ms for 60 learnings.
- Patterns need care. A pattern that matches too much is noise; the repeat window limits the damage, and `strata triggers` makes a pattern easy to test.
- Learnings without `match:` or `paths:` behave exactly as before.

## Sources

- Claude Code hooks, `PreToolUse` input and `additionalContext`: https://code.claude.com/docs/en/hooks
- Codex hooks, `PreToolUse` coverage and `additionalContext`: https://learn.chatgpt.com/docs/hooks
- [ADR-0003](ADR-0003-operation-keyed-learnings.md), [ADR-0019](ADR-0019-hot-rules-in-adapters-and-auto-memory-pointer.md)
