---
name: save
description: Use when ending an AI coding session, switching context, or wrapping up work - captures session state and routes new knowledge (issues, learnings, decisions, docs) to its durable home. Strata-aware when the project has `.strata/MANIFEST.md`. Fresh failures/gotchas should be captured earlier with `/strata:capture`; this command verifies and bookkeeps them.
---

# Save Project State

Capture what happened in this session so the next one starts hot. In strata mode, route each kind of knowledge to its store — issues, learnings, decisions, docs, narrative, action log — instead of dumping everything into one file. In flat mode, fall back to a single-file capture.

**Authoritative rules live in `Skill: strata:strata`.** This command orchestrates the save flow; the skill defines the tiers, immediate-capture path, routing table, store contracts, and safeguards. Do not restate rules here — read them from the skill.

## When to use

- End of a work session, before switching projects, after a milestone lands
- User says "save state", "wrap up", "let's stop here"

## Process

### 1. Detect the mode

- `.strata/MANIFEST.md` present → **strata mode**. Check its `strata_version` — if it isn't `0.0.3`, stop and point at `MIGRATIONS.md`.
- Legacy fingerprints present (`.ai/MEMORY-MAP.md`, `docs/PROJECT-MAP.md`, `.claude/memory/`) → **legacy layout**. Do not save into it and do not scaffold a second memory; offer the migration ladder in `MIGRATIONS.md`.
- Neither → **flat mode**: capture a single `.strata/memory/project_state.md`; later `strata init` migrates that file into 0.0.3, archiving the original first.

State the detected mode before proceeding.

### 2. Read current memory

`memory/MEMORY.md`, `memory/project_state.md`, `issues/ACTIVE.md`, plus any issue files touched this session. Do not bulk-read learnings, archives, or the whole backlog.

### 3. Inventory the session

Sort what actually happened into the 0.0.3 buckets:

- **Resumption point** — last completed, immediate next action (point at an issue id when one exists), prerequisites, uncommitted scope, background processes. The single most important capture; write it so a fresh session starts without questions.
- **Issue events** — findings/bugs captured mid-session with `/strata:capture` or direct issue writes (should already be on disk — verify; write any that slipped through, with full Tried/Error/Hypothesis/Repro), status changes, items resolved or rejected this session, parked triggers that fired; promote un-promoted `.strata/inbox/` stubs and clear the inbox (skill §5a).
- **Learnings** — strategies that worked (`origin: success`) and pitfalls that burned (`origin: failure`), distilled to trigger + 1–3 sentence lesson.
- **Shipped decisions** with non-obvious rationale → ADR candidates.
- **Durable-doc impact** — architecture/reference/ops/product files this session made wrong or incomplete.
- **External completions** — PRs, emails, posted comments, durable URLs → action-log candidates.
- **Rollover** — `project_state.md` beyond current + last completed.

### 4. Build the preview (one block, then execute)

Apply the skill's routing table and §strata-save contract. Classify every proposed change:

```
Proposed changes for /strata:save:

NEW FILES:
- .strata/issues/<id>-<slug>.md  ← <one-line what>
- .strata/memory/learnings/<slug>.md  ← "<trigger>"
- .strata/docs/decisions/ADR-NNNN-<slug>.md  ← promoted from <source>

APPENDS:
- .strata/memory/project_state.md  ← session N block
- .strata/memory/archive/action_log.md  ← <id> completion entries

UPDATES (frontmatter / sections):
- .strata/issues/<id>-<slug>.md: status open → resolved (+ Resolution)

MOVES:
- .strata/issues/<id>-<slug>.md  →  issues/archive/  (resolved)
- <source>  →  memory/archive/source-adr-NNNN-<slug>.md

DELETIONS (section-only):
- .strata/memory/project_state.md: roll sessions N-2.. to archive/YYYY-MM-sessions-*.md

REGENERATED:
- issues/ACTIVE.md · issues/OPEN.md · issues/PARKED.md
- memory/learnings/INDEX.md · MEMORY.md rules-by-trigger table

PROMOTED (from inbox):
- .strata/issues/<id>-<slug>.md  ← from inbox stub (failure: <signal>)

SKIP (uncommitted edits — commit or stash first):
- <path>
```

Empty plan → say "no changes proposed" and stop. Otherwise, continue directly to execution. Invoking `/strata:save` is the confirmation; do not ask for a second y/n.

### 5. Safeguards (before showing the preview)

Per the skill: git-dirty files are never moved or deleted-from (list under SKIP); ADR numbers assigned as highest-existing + 1; deletions are section-only, never whole files; idempotent on re-run. Dedup new issue captures against the existing backlog — fold new evidence into an existing item rather than filing a near-duplicate.

### 6. Execute

Immediately after the preview, run in this order: **writes → appends → updates → moves → deletions → regenerate views**. Regeneration is last so views reflect the post-save world.

### 7. Verify

- `MEMORY.md` ≤80 lines; `project_state.md` ≤200 lines and covers only current + last completed.
- Generated views match item frontmatter (spot-check one item per view).
- Resumption point is specific enough to act on without questions.
- No contradiction left between hot memory and the warm docs touched this session.
- Nothing ephemeral saved (temp paths, stack traces, secret values).

### 8. Report

```
Mode: strata (0.0.3).
Saved: project_state.md (session N appended; sessions N-2..N-3 archived).
Issues: +2 captured (20260609-03, -04) · 1 resolved → archive · ACTIVE/OPEN/PARKED regenerated.
Learnings: +1 failure ("before bulk renames…") · INDEX + trigger table regenerated.
Promoted: ADR-0007 (queue force-drain) ← source archived.
Docs: docs/ops/runtime-health.md updated.
Action log: 1 entry (upstream PR #14).
```

## Flat mode

Everything goes into `.strata/memory/project_state.md` under WHERE WE LEFT OFF / Current State / Session History / Constraints & Gotchas / Findings / Open Items / Rejected Approaches. Once the file passes ~500 lines or carries 3+ decisions with lasting rationale, report: "Run `strata init` to migrate this flat memory into the full strata pattern; the flat file will be archived first for provenance." Don't push.

## Quality bar

A fresh session must be able to: know what happened and why; start the next action without asking; avoid repeating failed approaches (failure learnings + issue diagnostics); find every unresolved weakness with enough evidence to fix it properly; trust hot memory and warm docs to agree.

## Do NOT

- Ask the user what to capture — derive it from the session
- Ask for y/n after the preview — save executes automatically once invoked
- Defer mid-session issue capture to save time (capture is immediate; save is bookkeeping)
- Hand-edit generated views — edit items, regenerate
- Save anything derivable from code or `git log`, or any secret value
- Move or delete-from a git-dirty file
- Restate routing rules here or in adapters — the skill and MANIFEST own them
