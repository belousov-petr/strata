# ADR-0025: `strata check` can baseline the warnings a project already has

- **Status:** implemented (0.2.0)
- **Date:** 2026-10-10

## Context and Problem Statement

`strata check` reported 215 warnings in a large project that adopted strata, all of them legacy naming that predates the adoption. Nobody reads 215 warnings, so a new, real warning had nowhere to stand out. Fixing all of the old ones first is the right end state and the wrong precondition.

## Considered Options

1. **Turn the legacy warnings off.** Rejected: the same warning is real in a new file.
2. **Per-file ignore comments.** Rejected: noise in the project's own files.
3. **A recorded baseline, the way linters handle legacy code.** *(chosen)*

## Decision

- `strata check --baseline` writes `.strata/check-baseline.json` with every current warning, keyed by code, file and detail, without line numbers, so an edit above a known warning does not make it new.
- Later, `strata check` lists only warnings not in the baseline, and adds one line with the count of known warnings it did not show. `strata check --all` ignores the baseline. `/strata:save` uses the same filter.
- Errors are never baselined. `--baseline` lists them and exits 1 when there are any.
- The file is committed, so every clone and agent sees the same filter. Rewriting it is a deliberate act, and deleting it shows everything again.

## Consequences

- A new warning is visible on the first run that has it.
- A baselined warning that gets worse in the same way stays hidden until the baseline is rewritten. The count line keeps the debt in view.

## Sources

- [ADR-0018](ADR-0018-strata-script-for-mechanical-chores.md)
