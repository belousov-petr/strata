---
name: load
description: Use when starting an AI coding session on a project that has been worked on before - loads saved state shallow-to-deep so you can resume without asking the user to re-explain context. Strata-aware when the project has `.strata/MANIFEST.md`. Tier rules live in the `strata` skill.
---

# Load Project State

Read the saved state and orient yourself so you can resume immediately — without bulk-loading every record the project has ever made.

**Authoritative rules live in `Skill: strata:strata`.** This command orchestrates the load flow; the skill defines the tiers and load order. Do not restate them here.

## When to use

- Starting a session on an existing project
- User says "pick up where we left off", "continue", "what were we doing?"

## Process

### 1. Detect the mode

- `.strata/MANIFEST.md` present → **strata mode**. If its `strata_version` isn't `0.0.3`, say so and point at `MIGRATIONS.md` before loading anything else.
- Legacy fingerprints (`.ai/MEMORY-MAP.md`, `docs/PROJECT-MAP.md`, `.claude/memory/`) → **legacy layout**: orient from what exists, tell the user this is a 0.0.1/0.0.2 layout, and say `strata init` will run the matching `MIGRATIONS.md` rung. Never scaffold 0.0.3 beside it.
- Neither, but `.strata/memory/project_state.md` exists → **flat mode**: read it as the single source; say `strata init` will archive and migrate it into 0.0.3 when invoked.
- Nothing → fresh project; say so and offer `strata init` or exploration.

State the detected mode.

### 2. Load shallow → deep (strata mode)

1. `.strata/MANIFEST.md` — the contract: structure, routing, load order.
2. `.strata/memory/MEMORY.md` — live pointers + rules-by-trigger table.
3. `.strata/issues/ACTIVE.md` — what's in flight.
4. `.strata/memory/project_state.md` — current + last completed session only.
5. `.strata/inbox/captures.jsonl` — count only (do not bulk-read); promote per the skill §5a.

Stop early if the user's task is already clear. On demand only: `issues/OPEN.md` filtered by the task's area; the specific issue file being resumed; warm docs the task touches.

**Do NOT auto-load:** `learnings/` files (the trigger table in MEMORY.md fires them at operation time), ADRs in bulk, item files in bulk, anything under `archive/`, `action_log.md`. Cold is grep-on-demand.

### 3. Orient

From WHERE WE LEFT OFF + ACTIVE: last completed action; immediate next action (usually an issue id — open that one file); prerequisites; uncommitted scope; any in-progress item whose state demands attention.

### 4. Verify against git

State files are hints; the repo is truth.

- `git status` — do the listed uncommitted changes still exist?
- `git log --oneline -5` — commits after the last saved session?
- Spot-check: do the paths/issue files the state references still exist?

Conflicts → tell the user ("state says X, repo shows Y"), trust git, never silently act on stale state.

### 5. Present the orientation (≤6 lines)

```
**Last session (<date>):** <1-sentence summary>
**Next up:** <immediate next action — issue id if any>
**Active:** <n> in progress (<ids>)
**Prerequisites:** <env/services, or "none">
**Parked triggers:** <any revive-when that looks fired, or "none">
**Drift:** <state-vs-git mismatches, or "none">
**Inbox:** <n> un-promoted (auto-logged failures), or "none"
```

Then: "Ready to continue, or work on something else?"

### 6. On continue — start working

Don't re-explore the codebase; trust the state and open only what the next action needs. Before any operation listed in the rules-by-trigger table, read the matching learning (one file, not the folder). New findings mid-task → run `/strata:capture` or write the issue/learning immediately, per the skill.

## Quality bar

After load you can: answer "what are we doing?" in one sentence; start the next action without asking; catch state-vs-reality drift before acting; know which stores are relevant without having loaded them all.

## Do NOT

- Dump file contents at the user — orient, don't recite
- Bulk-load learnings, ADRs, issues, or archives
- Re-explore the codebase when state exists
- Act on state that contradicts git
- Initialize or migrate anything without being asked
