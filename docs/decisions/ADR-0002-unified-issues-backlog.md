# ADR-0002: Single unified `issues/` backlog

- **Status:** implemented
- **Date:** 2026-06-09

## Context and Problem Statement

0.0.2 spread work-item state across three stores:

- `open_action_items.md` — active tasks **and** findings, mixed, in hand-maintained sections;
- `project_<slug>.md` files — in-flight initiatives, hot until shipped;
- `docs/parked/` — deferred items with revive triggers.

That is one concept — *a unit of work with a status* — implemented three ways, with three routing decisions per capture. `open_action_items.md` was quietly re-creating the original monolith problem that strata was built to fix: one file doing several jobs (task list, findings register, blocker board), sections drifting, completed entries lingering. Worse, findings discovered mid-task were often held in conversation context until `/save-point` — and lost to context compaction before they ever reached disk.

The work-tracking precedents in the field all converge on per-item files plus an index: Copilot's community memory bank adds a `tasks/` folder with `_index.md` and per-task files; Geoffrey Huntley's Ralph layout persists `IMPLEMENTATION_PLAN.md` precisely so the task list survives fresh contexts; Harper Reed commits `todo.md` as a first-class artifact; spec-driven layouts give each feature its own spec file with dynamic session state tiered separately.

## Considered Options

1. **Keep the three stores.**
   Pros: no migration; familiar. Cons: routing ambiguity at every capture (finding? task? initiative? parked?); a status change means moving content *between files and folders*; the "open" list polluted by things that aren't tasks; the dumping-ground failure mode, relocated.
2. **External tracker (GitHub Issues or similar).**
   Pros: real tooling, queries, assignments. Cons: requires a remote, an account, and connectivity; useless for local-only and knowledge projects; the agent still needs repo-local context files, so the tracker becomes a *fourth* store, not a replacement.
3. **Single `.strata/issues/` folder — one file per item, frontmatter-keyed, with generated views.** *(chosen)*
   Pros: one capture path ("it's work → it's an issue"); status is a frontmatter edit, not a file relocation; initiatives fold in as `type: initiative`, parked becomes `status: parked` with a `revive-when` trigger; mid-session capture writes the file immediately so full rationale and diagnostics survive compaction; generated `ACTIVE.md` / `OPEN.md` / `PARKED.md` views give the three reading modes without hand-maintained lists; closed items move to `issues/archive/` and stay greppable. Cons: many small files (mitigated by views + archive); the views must be regenerated reliably (owned by `/strata-save`, checked by lints).

## Decision

Option 3. `.strata/issues/` is the **single backlog for findings, tasks, and initiatives**.

- Item files: `<id>-<slug>.md` with frontmatter `id`, `type`, `status`, `severity`, `area`, `created`, and `revive-when` (parked only).
- Types: `bug | improvement | debt | task | feature | initiative`. Statuses: `open | in-progress | parked | resolved | wont-fix`. (Canonical definitions: `docs/DESIGN.md` and the scaffolded `MANIFEST.md`; everything else reuses them verbatim.)
- **Mid-session rule:** a new finding or bug is written to `issues/` *immediately*, with full rationale and diagnostics (Tried / Error / Hypothesis / Repro for bugs), status `open` — then work continues. Capture is not deferred to `/strata-save`; only triage and bookkeeping are.
- Retired: `open_action_items.md`, `project_<slug>.md`, `docs/parked/`. The migration ladder (`MIGRATIONS.md`) extracts their content into issue files.
- Deliberately **not** folded in: `archive/action_log.md` stays as the one non-issue ledger — a chronological, append-only record of completed *external-world* actions (PRs, emails, posted comments with durable URLs). An issue tracks work; the action log records that something left the repo.

## Consequences

- One answer to "where does work-state go", and one place to look for it.
- `ACTIVE.md` (status `in-progress`) is small and loads at `/strata-load`; `OPEN.md` is consulted by area on demand; nothing bulk-loads the item files.
- Resolution links back: closing an issue that produced durable knowledge points at the ADR or learning it became.
- Cost: the 0.0.2→0.0.3 migration is content-bearing (extraction, not just renames) — spelled out step by step in `MIGRATIONS.md`.

## Sources

- github/awesome-copilot — memory-bank instructions (`tasks/` + `_index.md` + per-task files) — https://github.com/github/awesome-copilot/blob/main/instructions/memory-bank.instructions.md
- ghuntley/how-to-ralph-wiggum — persisted `IMPLEMENTATION_PLAN.md`, lean `AGENTS.md` — https://github.com/ghuntley/how-to-ralph-wiggum
- Harper Reed — My LLM codegen workflow atm (`spec.md` → `prompt_plan.md` → `todo.md`) — https://harper.blog/2025/02/16/my-llm-codegen-workflow-atm/
- orchestrator.dev — spec-driven layout (static / semi-static / dynamic tiers) — https://orchestrator.dev/blog/2025-12-16-spec_driven_dev_article/
- Microsoft — Spec Kit (`.specify/`, per-feature spec files) — https://developer.microsoft.com/blog/spec-driven-development-spec-kit
- Cline — Memory Bank (separating `activeContext.md` from append-only `progress.md`) — https://docs.cline.bot/features/memory-bank
