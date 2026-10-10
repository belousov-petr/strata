# ADR-0021: The archive index file is configurable

- **Status:** implemented (0.2.0)
- **Date:** 2026-10-10

## Context and Problem Statement

`strata save --prepare` moves closed issues to `issues/archive/` and appends a row for each to `issues/archive/INDEX.md`, creating that file when it is missing. A large project that adopted strata keeps its archive table in `issues/archive/README.md`. Save created a second index beside it, so the agent stopped using `save --prepare` for archive moves and did them by hand three times in one week. The mechanical step lost its point.

## Considered Options

1. **Always INDEX.md.** Rejected: it is the cause.
2. **A MANIFEST key, then detection, then the default.** *(chosen)*
3. **Detection only.** Pros: no new key. Cons: when both files hold a table, detection has to guess.

## Decision

- `archive_index:` in the `MANIFEST.md` frontmatter names the file, a plain file name inside `.strata/issues/archive/` such as `README.md`.
- Without the key, save uses an existing `README.md`, then `INDEX.md`, whichever already holds an archive table: a table whose header names an `Id`, `Issue` or `Item` column, or whose rows link to item files.
- Otherwise it uses `INDEX.md` and creates it with strata's table.
- Rows go to that one file only, right after the table's last row, in that table's own columns: the id link, status, closing date and the item's What line go to the columns whose names fit, and other columns stay empty. Text after the table is kept.
- `strata check` rejects an `archive_index` that is not a file name in the archive folder.

## Consequences

- Projects with their own archive layout can use `save --prepare` again.
- Column matching is by name. A table with unusual column names gets the link in its first column and blanks elsewhere, which is visible in the save preview and easy to fix by hand.

## Sources

- [ADR-0018](ADR-0018-strata-script-for-mechanical-chores.md)
