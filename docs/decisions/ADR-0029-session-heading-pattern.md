# ADR-0029: `session_heading:` names a project's session headings

- **Status:** implemented (0.3.0)
- **Date:** 2026-10-12

## Context and Problem Statement

`project_state.md` keeps the current and the last completed session, and `strata save --prepare` rolls older ones into the archive ([ADR-0018](ADR-0018-strata-script-for-mechanical-chores.md)). The script found sessions by a `## ` heading that names `session N`. A large project writes its own headings instead, such as `## CURRENT, Sunday 2026-10-11: ...` and `## LAST COMPLETED — 2026-10-06 to 10-10 ...`. Nothing in them says `session`, so nothing ever rolled, and the agent archived old blocks by hand on every save.

## Considered Options

1. **Ask the project to rename its headings.** Rejected: the headings carry dates and a summary the project relies on, and every agent working there would have to learn a new format.
2. **Guess session blocks from dates in headings.** Rejected: guessing is judgment, and a dated heading is not always a session.
3. **Let the project name its session headings with a pattern.** *(chosen)*

## Decision

- `session_heading:` in the `MANIFEST.md` frontmatter holds a regular expression. It is tested, case-insensitive, against the text of each `## ` heading after the `## `.
- When it is set, every `## ` block whose heading matches is a session block, in file order, newest first. A block runs to the next `## ` heading of any kind, and blocks that do not match stay where they are. Save keeps the first two session blocks and rolls the rest into `memory/archive/YYYY-MM-sessions-<date>.md`. The month is today's, as with numbered rolling. The date is the first `YYYY-MM-DD` found in the rolled headings, or today. An `ARCHIVE.md` row is added, as numbered rolling does.
- Without the key, behaviour is unchanged, and only `session N` headings roll.
- An invalid pattern is a `strata check` error, and save rolls nothing and says why in its judgment list. A pattern written in double quotes loses its `\b` to a backspace character in YAML, which check reports with a hint to use single quotes.

## Consequences

- Projects with their own heading style get the rollover the budget relies on.
- The key does not mix with numbered rolling. A project that sets it and still has `session N` headings must make the pattern match them too.
- A loose pattern rolls blocks it should not. The dry run lists every rolled heading, so the first save after setting the key shows it.

## Sources

- [ADR-0018](ADR-0018-strata-script-for-mechanical-chores.md), [ADR-0021](ADR-0021-configurable-archive-index.md)
