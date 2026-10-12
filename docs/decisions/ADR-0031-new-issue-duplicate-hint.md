# ADR-0031: `strata new-issue` lists open issues that look like duplicates

- **Status:** implemented (0.3.0)
- **Date:** 2026-10-12

## Context and Problem Statement

The save flow tells the agent to dedup new issues against the backlog and fold new evidence into an existing item ([ADR-0002](ADR-0002-unified-issues-backlog.md)). In a backlog of a few hundred issues the agent does that from memory, or not at all, and near-duplicates pile up. The step that files a new issue, `strata new-issue`, already scans the issues folder for ids, so it can point at likely duplicates at no extra cost.

## Considered Options

1. **Leave dedup to the agent.** Rejected: the 11 Oct 2026 review found near-duplicates in exactly the large backlog where reading everything is not an option.
2. **Refuse a new issue that looks like a duplicate.** Rejected: word overlap is a hint, not proof, and a refusal would push agents to reword titles until it goes away.
3. **List likely duplicates as advice.** *(chosen)*

## Decision

- `strata new-issue` compares the new issue's significant words, taken from its title, slug and area, with the same words of every open issue. Significant words are those of four letters or more, lowercased, minus a short stopword list, the same rule `strata journal clear` uses ([ADR-0028](ADR-0028-journal-clear-needs-evidence.md)).
- Open means any status except `resolved`, `wont-fix`, `rejected` and `closed`. Archived files and id-less notes in sub-folders are not considered.
- An issue that shares at least two words is listed, most shared words first, then by id, at most five.
- The list goes to stderr, so the id line stays the only line on stdout for scripts. `--json` carries it as `duplicates: [{ id, file, title, status, shared }]`. It works with `--dry-run`, so the agent can look before any file exists. It never blocks.

## Consequences

- The agent sees likely duplicates at the moment it files, without reading the backlog.
- Exact word matching misses a duplicate worded differently, and two short common words can list an unrelated issue. Both are acceptable for advice.
- The new issue scans every open issue once more. That is cheap next to the id scan it already does.

## Sources

- [ADR-0002](ADR-0002-unified-issues-backlog.md), [ADR-0018](ADR-0018-strata-script-for-mechanical-chores.md), [ADR-0028](ADR-0028-journal-clear-needs-evidence.md)
