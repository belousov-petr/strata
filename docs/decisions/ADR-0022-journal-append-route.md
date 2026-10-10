# ADR-0022: A journal entry can be appended to an issue at save

- **Status:** implemented (0.2.0)
- **Date:** 2026-10-10

## Context and Problem Statement

The pending-capture journal ([ADR-0016](ADR-0016-pending-capture-journal.md)) holds every capture until `/strata:save` routes it. In a five-day session about 50 entries were routed by hand, and most of them became the same thing: a dated update paragraph on an issue that already existed. The agent knew the target issue at capture time and still spent judgment at save time on a mechanical move.

## Considered Options

1. **Keep routing every entry by hand.** Rejected: it is slow, and slow saves get skipped.
2. **Let save guess the issue from the text.** Rejected: guessing is judgment, and the script does not judge.
3. **Name the issue and the route at capture.** *(chosen)*

## Decision

- `strata journal add --refs <issue-id> --route append` records the target and the route. `--refs` takes ids or paths, comma-separated; the first is the target. `--route` has one value today, `append`.
- `strata save --prepare` appends each such entry that is not yet filed to that issue as `**Update <date> (journal <id>):** <title>. <text>`, placed before the `**Resolution:**` line, or at the end when there is none. The date is the capture's date. It then marks the entry filed with the issue's path and lists the append in its report.
- An entry whose issue is missing, archived, or not a top-level issue file is reported for judgment and never dropped. A re-run appends nothing twice, because save looks for `(journal <id>)` in the issue first.
- Entries without the route stay for judgment, as before.

## Consequences

- The common case, an update on a known issue, costs nothing at save.
- The journal entry schema gains one optional field, `route`. Older entries lack it and behave as before.

## Sources

- [ADR-0016](ADR-0016-pending-capture-journal.md), [ADR-0018](ADR-0018-strata-script-for-mechanical-chores.md)
