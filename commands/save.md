---
name: save
description: Use when ending an AI coding session, switching context, or wrapping up work - routes the pending-capture journal and the session's knowledge (issues, learnings, decisions, docs) to their durable homes, then runs the mechanical chores through the strata script. Strata-aware when the project has `.strata/MANIFEST.md`. Fresh failures/gotchas should be captured earlier with `/strata:capture`; this command files and bookkeeps them.
---

# Save Project State

Capture what happened in this session so the next one starts hot. In strata mode, route each kind of knowledge to its store (issues, learnings, decisions, docs, narrative, action log) instead of dumping everything into one file. In flat mode, fall back to a single-file capture.

**Authoritative rules live in `Skill: strata:strata`.** This command orchestrates the save flow; the skill defines the tiers, the journal, the routing table, store contracts, and safeguards. Do not restate rules here; read them from the skill.

In this file, `strata` means `node "${CLAUDE_PLUGIN_ROOT}/skills/strata/scripts/strata.mjs"`. Codex and other tools run `node <skill folder>/scripts/strata.mjs`, where the skill folder holds the strata `SKILL.md`. Judgment (what goes where, how it is worded) is yours; the script does the mechanical steps the same way every time.

## When to use

- End of a work session, before switching projects, after a milestone lands
- User says "save state", "wrap up", "let's stop here"

## Process

### 1. Detect the mode

- `.strata/MANIFEST.md` present → **strata mode**. Check its `layout_version`; if it isn't `3` (e.g. a legacy `strata_version: 0.0.3` stamp), stop and point at `MIGRATIONS.md`.
- Legacy fingerprints present (`.ai/MEMORY-MAP.md`, `docs/PROJECT-MAP.md`, `.claude/memory/`) → **legacy layout**. Do not save into it and do not scaffold a second memory; offer the migration ladder in `MIGRATIONS.md`.
- Neither → **flat mode**: capture a single `.strata/memory/project_state.md`; later `strata init` migrates that file into the current layout (`layout_version: 3`), archiving the original first.

State the detected mode before proceeding.

### 2. Read what is pending

- `strata journal list`: every pending capture. Each one is routed this save.
- `strata save --prepare --dry-run`: the mechanical plan (archive moves, session rollover, regenerated views and hot-rules blocks), the inbox counts and repeated failures, the drift list, parked triggers, and check findings.
- `memory/MEMORY.md`, `memory/project_state.md`, `issues/ACTIVE.md`, plus any issue files touched this session. Do not bulk-read learnings, archives, or the whole backlog.

### 3. Inventory the session

Sort the journal entries and what actually happened into the buckets:

- **Resumption point**: last completed, immediate next action (point at an issue id when one exists), prerequisites, uncommitted scope, background processes. The single most important capture; write it so a fresh session starts without questions.
- **Issue events**: journal `finding` entries, findings that slipped through (write them with full Tried/Error/Hypothesis/Repro), status changes, items resolved or rejected this session, parked triggers that fired. Repeated failures from the inbox become issues or learnings; one-off failures and policy refusals stay counts.
- **Learnings**: `gotcha` and `learning` entries, strategies that worked (`origin: success`) and pitfalls that burned (`origin: failure`), distilled to trigger + 1–3 sentence lesson.
- **Decisions**: `decision`, `direction` and `answer` entries with non-obvious rationale become decision records, with their lineage (a direction change supersedes the old record).
- **Durable-doc impact**: `runbook` and `requirement` entries, and architecture/reference/ops/product files this session made wrong or incomplete. Use the drift list as a prompt: each listed commit either gets a record or is fine as it is.
- **External completions**: PRs, emails, posted comments, durable URLs → action-log candidates.

Entries marked `filed` are already in their store; check them and move on.

### 4. Build the preview (one block, then execute)

Apply the skill's routing table and save contract. Merge your writes with the dry-run plan from step 2:

```
Proposed changes for /strata:save:

NEW FILES:
- .strata/issues/<id>-<slug>.md  ← journal finding <journal id>
- .strata/memory/learnings/<slug>.md  ← "<trigger>"
- .strata/docs/decisions/ADR-NNNN-<slug>.md  ← journal decision <journal id>

APPENDS:
- .strata/memory/project_state.md  ← session N block
- .strata/memory/archive/action_log.md  ← <id> completion entries

UPDATES (frontmatter / sections):
- .strata/issues/<id>-<slug>.md: status open → resolved (+ Resolution)

FROM strata save --prepare:
- move .strata/issues/<id>-<slug>.md -> issues/archive/ (resolved) + archive INDEX row
- roll sessions 3, 4 from project_state.md -> memory/archive/YYYY-MM-sessions-3-4.md (+ ARCHIVE.md row)
- regenerate ACTIVE/OPEN/PARKED, learnings INDEX, MEMORY.md table, CLAUDE.md/AGENTS.md hot rules

CLEARED:
- journal: <n> entries routed · inbox: <n> stubs (<n> failures, <n> policy)

DRIFT (commits since the last save that no record mentions):
- <sha> <subject>  → <new record, or "no record needed">
```

Empty plan → say "no changes proposed" and stop. Otherwise, continue directly to execution. Invoking `/strata:save` is the confirmation; do not ask for a second y/n.

### 5. Safeguards (before showing the preview)

Per the skill: a conflicted file is never moved; deletions are section-only, never whole files; idempotent on re-run. Take new issue ids from `strata new-issue` and decision numbers from `strata next-adr`, which scan every worktree and recent branch so parallel work does not collide. Dedup new issues against the existing backlog: fold new evidence into an existing item rather than filing a near-duplicate.

### 6. Execute

Immediately after the preview, in this order:

1. Your writes, appends and updates (new issues via `strata new-issue --slug <slug> …`, then fill the body).
2. `strata save --prepare`: moves, rollover, regenerated views and hot-rules blocks, the auto-memory pointer, the save marker. It runs last among the writers so the views reflect the post-save world.
3. `strata journal clear --all` (or `--id <id>` for only the routed ones) and `strata inbox clear`. The cleared journal batch stays in `.strata/inbox/journal.routed.jsonl` until the next clear.

Leave everything for one commit. If the project gates commits, say what is ready to commit rather than working around the gate.

### 7. Verify

- `strata check` passes: budgets (`MEMORY.md` ≤80 lines, `project_state.md` ≤200), frontmatter vocabularies, unique ids, links, no view drift. If the `MEMORY.md` rules table would breach ≤80, don't auto-trim; report it and suggest curating the hot subset (flag the most-triggered learnings `hot: true`; the rest stay in `INDEX.md`), per skill §4/§6E.
- `strata journal list` shows no pending captures.
- Resumption point is specific enough to act on without questions.
- No contradiction left between hot memory and the warm docs touched this session.
- Nothing ephemeral saved (temp paths, stack traces, secret values).

### 8. Report

```
Mode: strata (layout 3).
Saved: project_state.md (session N appended; sessions N-2..N-3 archived).
Journal: 5 routed (2 decisions → ADR-0007, ADR-0008; 2 findings → 20260609-03, -04; 1 gotcha → learning) · cleared.
Issues: 1 resolved → archive · ACTIVE/OPEN/PARKED regenerated.
Learnings: +1 failure ("before bulk renames…") · INDEX, trigger table, hot-rules blocks regenerated.
Inbox: 9 stubs (3 failures, 1 repeated → 20260609-05; 6 policy) · cleared.
Drift: 2 commits listed, 1 now covered by ADR-0008.
Ready to commit: <n> files.
```

## Flat mode

Everything goes into `.strata/memory/project_state.md` under WHERE WE LEFT OFF / Current State / Session History / Constraints & Gotchas / Findings / Open Items / Rejected Approaches, including every pending journal entry; then clear the journal. Once the file passes ~500 lines or carries 3+ decisions with lasting rationale, report: "Run `strata init` to migrate this flat memory into the full strata pattern; the flat file will be archived first for provenance." Don't push.

## Quality bar

A fresh session must be able to: know what happened and why; start the next action without asking; avoid repeating failed approaches (failure learnings + issue diagnostics); find every unresolved weakness with enough evidence to fix it properly; trust hot memory and warm docs to agree.

## Do NOT

- Ask the user what to capture; derive it from the journal and the session
- Ask for y/n after the preview; save executes automatically once invoked
- Clear the journal before every entry is written to its store
- Hand-edit generated views; edit items, then `strata views` or `strata save --prepare`
- Save anything derivable from code or `git log`, or any secret value
- Write project memory into Claude's auto memory; `save --prepare` keeps only a pointer there
- Restate routing rules here or in adapters; the skill and MANIFEST own them
