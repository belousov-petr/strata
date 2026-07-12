# ADR-0015: Hot tier is a curated `hot:true` subset, not a full mirror

- Status: implemented
- Date: 2026-07-12

## Context and Problem Statement

The `MEMORY.md` rules-by-trigger table is regenerated from every learning's frontmatter and loaded on **every** session start, under a hard ≤80-line budget (DESIGN §9). But learnings only accumulate — the table grew one row per learning with no ceiling, so any long-lived project eventually breaches the budget (observed in the field at 63 learnings / 81 lines). The always-loaded hot index cannot grow without bound.

The tension: every learning wants to be discoverable, but the hot tier must stay small because it is paid on every load.

## Considered Options

1. **Raise the ≤80 budget.** Trivial, but kicks the can — the table keeps growing, and a larger always-loaded index erodes the hot/warm split. Rejected: treats a design flaw as a size limit.
2. **Re-pick the hot set with a smart analysis on every save.** Self-maintaining, but breaks the generated-views idempotency principle ([ADR-0004](ADR-0004-generated-indexes-grep-router.md)): the same inputs could yield different tables run-to-run, churning the always-loaded index and spending tokens on every save. Worse, an algorithm could silently demote a safety rule because it "looks unused lately." "What's top-of-mind every session" is a human judgment; recency/frequency are poor proxies for it. Rejected.
3. **Curate a `hot:true` subset; keep INDEX complete; nudge, don't auto-decide.** A per-learning `hot:` flag is the deterministic source of truth for the MEMORY table; `INDEX.md` stays the complete list. Chosen.

## Decision

- `learnings/<slug>.md` frontmatter gains an optional `hot: true | false`.
- `MEMORY.md`'s rules-by-trigger table = learnings with `hot: true`; `learnings/INDEX.md` = every learning. Both stay generated ([ADR-0004](ADR-0004-generated-indexes-grep-router.md)) and deterministic.
- **Graceful default (backward-compatible):** a project with **no** `hot:` flag anywhere keeps *all* learnings in the MEMORY table — existing `layout_version: 3` projects are unchanged and need no migration. The first `hot:` flag opts a project into filtering. New learnings default `hot: false` (INDEX-only), so the hot table stays bounded as learnings accumulate; promote to `hot: true` only when a rule proves broadly triggered.
- **Advisory budget guard, not an auto-pick.** At `/strata:save`, if the regenerated MEMORY table would breach ≤80, the save *reports* it and *suggests* curating the hot subset (opt in by flagging the most-triggered learnings `hot: true`). It never auto-picks or auto-trims — the human owns what loads every session, so a guardrail rule is never silently demoted.

No layout change: `hot:` is an additive, optional field; `layout_version` stays `3`, no `MIGRATIONS.md` rung.

## Consequences

- The hot tier is future-bounded regardless of learning count; the ≤80 budget stops being a recurring breakage.
- Regeneration stays deterministic and cheap — no per-save LLM analysis (ADR-0004 idempotency preserved), so `MEMORY.md` diffs stay quiet and the table stays trustworthy across runs.
- One-time opt-in cost per project: flag the hot set once, when the guard first nudges. Legacy projects pay nothing until they choose to.
- The full learning set is never lost — `INDEX.md` stays complete and grep-able; niche rules are found there at operation time.

## Sources

- [ADR-0003](ADR-0003-operation-keyed-learnings.md) — operation-keyed learnings and the by-trigger table.
- [ADR-0004](ADR-0004-generated-indexes-grep-router.md) — generated indexes; idempotent, drift-free regeneration.
- Field trigger: a `layout_version: 3` project reached 63 learnings / 81 lines, breaching the hot budget and prompting this pattern.
