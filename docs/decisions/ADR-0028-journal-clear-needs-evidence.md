# ADR-0028: `strata journal clear` needs evidence that each entry was filed

- **Status:** implemented (0.3.0)
- **Date:** 2026-10-12

## Context and Problem Statement

`/strata:save` routes every pending journal entry into its store and then runs `strata journal clear --all` ([ADR-0016](ADR-0016-pending-capture-journal.md)). The clear trusted the agent. It removed every entry whether or not it had been written anywhere, so one missed entry in a long save was lost without a trace, apart from the last batch in `journal.routed.jsonl`, which the next clear overwrites. A review of a save in a large project on 11 Oct 2026 found exactly that risk: dozens of entries, routed by hand, and nothing that checked the routing before the clear.

## Considered Options

1. **Keep trusting the agent.** Rejected: the journal exists so that nothing captured is lost, and the clear was the one step that could lose it.
2. **Require every entry to name its target file before the clear.** Pros: exact. Cons: a second bookkeeping step per entry at the end of a long save, which is the step that gets skipped. Rejected as the only route, kept as one route: entries that already carry a `filed` path pass.
3. **Look for the entry in what the save changed.** *(chosen)* A save leaves its writes uncommitted for one commit at the end, so the working tree shows what was filed. Matching the title's significant words against that text is cheap, deterministic and needs nothing new from the agent.

## Decision

- Before clearing, each chosen entry, all of them with `--all` or the listed ones with `--id`, must be proven. It is proven when it carries a `filed` path, which `--filed` at capture sets and which `save --prepare` sets when it appends an entry to its issue ([ADR-0022](ADR-0022-journal-append-route.md)).
- Otherwise it is proven by the working tree. The title's significant words are its words of four letters or more, lowercased, minus a short stopword list. At least half of them, and at least two, must appear in the added lines of `git diff HEAD` plus the full text of untracked files. A word counts when a word in that text starts with it, so `stall` finds `stalls`.
- Only `.strata/` and the docs folders count, meaning `docs/` at the project root and at the repository root, the same docs folders the drift list reads. `.strata/inbox/` never counts, because it holds the journal itself. Renames are detected, so an archive move adds no evidence of its own.
- If any chosen entry is unproven, the clear changes nothing, lists each unproven entry's id and title, and exits 1 with a hint to file them or pass `--force`. `--force` clears anyway and reports how many entries it forced. `--json` carries `checked`, `forced`, `unproven` and, on a refusal, `refused: true`.
- Outside git the check is skipped with a one-line warning, and `checked` is false.

## Consequences

- A save can no longer drop an entry silently. A dropped entry is either filed, or forced with a count in the output that the save report repeats.
- The check is a heuristic. An entry filed in very different words, or one with fewer than two significant words in its title, needs `--force` even though it was filed. A title whose words happen to appear in unrelated changes passes without being filed. Both cases are rare in practice, and the first is visible.
- Entries filed in a commit made before the clear no longer show in the working tree and need `--force`, unless they carry a `filed` path. The save flow already leaves its writes for one commit at the end, after the clear.
- The clear now runs `git diff` and `git ls-files` once, limited to `.strata/` and `docs/`, before it takes the journal lock, so captures never wait on git.

## Sources

- [ADR-0016](ADR-0016-pending-capture-journal.md), [ADR-0018](ADR-0018-strata-script-for-mechanical-chores.md), [ADR-0022](ADR-0022-journal-append-route.md)
