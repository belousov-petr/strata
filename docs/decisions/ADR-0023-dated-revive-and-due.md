# ADR-0023: Parked and open issues can carry dates that a machine checks

- **Status:** implemented (0.2.0)
- **Date:** 2026-10-10

## Context and Problem Statement

A parked issue must say when it comes back (`revive-when:`), and `/strata:save` listed every one of them for the agent to check against the session. In a large project that meant about 30 texts per save. Many were plain dates, such as "on or after 2026-10-12", which a script can check and an agent should not have to read every time. The useful signal, the two items whose time had come, was buried.

## Considered Options

1. **Keep listing every trigger.** Rejected.
2. **Parse dates out of any trigger text.** Pros: no new keys. Cons: "after the vendor ships, around 2026-11" would be misread. Rejected as the main mechanism.
3. **A date key, plus reading triggers that are nothing but a date.** *(chosen)*

## Decision

- A parked issue may carry `revive-on: YYYY-MM-DD`. Any live issue may carry `due: YYYY-MM-DD`.
- A `revive-when:` text that is only a date, optionally after `on or after`, `after`, `from`, `on` or `by`, counts as a date too. `after` means the day after. Any other text stays a trigger for judgment.
- `strata status` (and so `/strata:load`) and `strata save --prepare` list the parked items whose date has come, the text triggers to check, and the overdue or due-today items; items dated later are counted with the next date, not listed.
- `strata due [--days N]` lists every dated item up to N days ahead, default 7, dates already passed first.
- `PARKED.md` shows `on or after <date>` for a `revive-on` item. `strata check` accepts `revive-on` as a parked item's trigger and rejects a malformed date.

## Consequences

- A save lists what needs attention today. The rest is one count line.
- Existing projects get the benefit at once for triggers that are plain dates, with no edits. Other dated triggers can move to `revive-on:` one by one.

## Sources

- [ADR-0002](ADR-0002-unified-issues-backlog.md)
