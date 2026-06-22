# ADR-0013: Layout version is an integer, named distinctly from the plugin release

- **Status:** implemented
- **Date:** 2026-06-22

## Context and Problem Statement

strata carries two independent version numbers:

- the **plugin release** — git tags + `plugin.json`/`marketplace.json` (`0.0.5`, …), per [ADR-0008](ADR-0008-git-native-versioning.md);
- the **memory-layout generation** — the stamp in each scaffolded `.strata/MANIFEST.md`, `strata_version: 0.0.3`, per [ADR-0006](ADR-0006-in-repo-migrations-strata-version.md).

Both used the same `0.0.x` semver shape, and they were equal once (release 0.0.3 shipped layout 0.0.3). Releases 0.0.4 and 0.0.5 then shipped non-breaking changes, so the plugin advanced to 0.0.5 while the layout stayed 0.0.3. A reader seeing `strata_version: 0.0.3` under a 0.0.5 plugin reasonably concludes their memory is on an old version — the two counters look like one counter out of sync. This confusion happened in practice.

The layout generation is not semver: it has no minor/patch axis, only "which incompatible structure is this." Encoding it as `0.0.N` invites exactly that misread.

## Considered Options

1. **Leave it; document the distinction harder.** Pros: zero change. Cons: the formats stay identical, so the trap stays; documentation does not survive a glance at the frontmatter.
2. **Keep `strata_version`, switch the value to an integer (`strata_version: 3`).** Pros: smallest blast radius. Cons: the key name still reads like a generic "strata version", not specifically the layout.
3. **Rename the stamp to `layout_version` and make it a plain integer (`layout_version: 3`).** *(chosen)* Pros: the label says what it is; an integer cannot be mistaken for the plugin's semver; the two numbers are unambiguous at a glance. Cons: largest doc/test churn; existing `strata_version: 0.0.3` projects need a (trivial) migration.

## Decision

Option 3.

- The layout stamp is **`layout_version: <integer>`**. The current generation — structurally identical to what was `strata_version: 0.0.3` — is **`layout_version: 3`**, preserving the 0.0.1 → 0.0.2 → 0.0.3 lineage as generations 1 → 2 → 3. The next breaking layout change is `4`.
- The **plugin release** keeps semver via git tags + `plugin.json`/`marketplace.json` (now `0.0.6`); ADR-0008 stands. The two are deliberately different formats so they cannot be confused: `layout_version: 3` (memory format) vs plugin `0.0.6` (release).
- **Strict back-compat.** The skill recognizes only `layout_version: 3` as current. A project still stamped `strata_version: 0.0.3` is a version mismatch: `load`/`save`/`capture` stop and point at `MIGRATIONS.md`. A new **Rung 3** does the one-line stamp rewrite (`strata_version: 0.0.3` → `layout_version: 3`) — no structural change, fully reversible.
- This **revises the stamp format only** from ADR-0006; ADR-0006's migration-ladder mechanism and ADR-0008's git-native release versioning both stand.

## Consequences

- A glance at `MANIFEST.md` frontmatter now distinguishes layout from release.
- Every existing `strata_version: 0.0.3` project must run Rung 3 once before strata commands work under plugin ≥ 0.0.6 — accepted as the price of clarity; the migration is one line and gated.
- Future layout generations are plain integers; the migration obligation from ADR-0006 is unchanged — no breaking layout change ships without its rung.

## Sources

- ADR-0006 (in-repo migrations keyed off the stamp) — `docs/decisions/ADR-0006-in-repo-migrations-strata-version.md`
- ADR-0008 (git-native release versioning) — `docs/decisions/ADR-0008-git-native-versioning.md`
- Semantic Versioning 2.0.0 (a generation counter is not semver) — https://semver.org/
