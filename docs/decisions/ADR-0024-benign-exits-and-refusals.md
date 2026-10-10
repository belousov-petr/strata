# ADR-0024: Benign exits are counted, and refusals go to the operator

- **Status:** implemented (0.2.0)
- **Date:** 2026-10-10

## Context and Problem Statement

[ADR-0017](ADR-0017-capture-guard-decides-by-status.md) made the capture guard decide by real exit status. That was right, and it had a side effect: exit code 1 from a command where 1 is an answer, not an error, was logged as a failure. After five days the inbox of a large project held about 50 stubs, nearly all of them `grep` or `rg` finding nothing, `test` or `[` being false, and similar. The few real failures were hard to see.

Separately, permission refusals were counted as `policy` and then ignored. Each one is a step the agent wanted to take and could not, which usually means the operator has to take it.

## Considered Options

1. **A new category, `benign`, stored like the others.** Pros: one file. Cons: the inbox keeps growing with noise, and older readers of the file would count the new category as failures. Rejected.
2. **Drop benign exits silently.** Rejected: a count is cheap and shows the guard is working.
3. **Count benign exits in a separate small file, and list refusals as steps for the operator.** *(chosen)*

## Decision

- Exit code 1 from `grep`, `egrep`, `fgrep`, `rg`, `ag`, `test`, `[`, `[[`, `diff`, `cmp`, `command -v` and `which` is benign. The guard reads the shell command to find which command set the status: only the last list counts (after the last `;` or newline), unless the command sets `errexit`; in it, every command that could have set the status must be benign or a safe builtin such as `echo` or `cd`, and only the last element of a pipeline counts unless `pipefail` is set. So `cat log | grep -q x` and `[ -f out ] && echo yes` are benign, and `npm test && grep x log` is not.
- A benign exit is counted in `.strata/inbox/benign.json`, once per tool call, and never stored as a stub. Stubs stored by earlier versions that match the rule are read as benign. The four categories stay as they were.
- `strata status` and `strata save --prepare` list permission refusals, grouped by command, as "steps refused for the agent; hand them to the operator".
- `strata inbox clear` resets the benign count with the stubs.

## Consequences

- The failure count means failures again.
- The rule is a heuristic over shell text. A benign command after a failing `cd` in an `&&` chain is counted as benign. That trade is deliberate: the alternative was 50 false failures.
- A command that fails inside a background wrapper and still reports exit 0 stays invisible to the guard. Status-based capture cannot see it; only the agent reading the output can.

## Sources

- [ADR-0011](ADR-0011-deterministic-capture-inbox.md), [ADR-0017](ADR-0017-capture-guard-decides-by-status.md)
- POSIX exit status of `grep`, `test`, `diff`, `cmp`, `command -v`: https://pubs.opengroup.org/onlinepubs/9799919799/
