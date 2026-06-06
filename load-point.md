---
name: load-point
description: Use when starting an AI coding session on a project that has been worked on before - loads saved state shallow-to-deep so you can resume without asking the user to re-explain context. Tier-aware when the project has `.ai/MEMORY-MAP.md`. Tier rules live in the `strata` skill.
---

# Load Project State

Read the saved state and orient yourself so you can resume work immediately without asking "what were we doing?" - but without bulk-loading every decision record the project has ever made.

**Authoritative rules live in `Skill: strata`.** This command orchestrates the load flow; the skill defines the tier model and loading order. Do not restate them here.

Load-point is also a quality gate for saved findings. If hot memory says there are unresolved structural issues, stale-doc follow-ups, env/config mismatches, or operational lessons, surface the immediate next action and open only the specific warm doc or action item needed.

## When to use

- Starting a new session on an existing project
- User says "pick up where we left off", "continue", "what were we doing?"
- You see a `project_state.md` in the memory directory

## Process

### 1. Detect the mode

Check whether the project uses the three-tier pattern. Look for `.ai/MEMORY-MAP.md` in the project root.

- **Present** → **tier mode**. Load shallow-to-deep per the map's load order.
- **Absent** → **flat mode**. Read `project_state.md` as a single source.

State which mode you detected.

### 2. Load in order (shallow → deep)

Read only as much as you need to orient. Do NOT bulk-load ADRs, parked items, or the archive - they're on-demand.

**Tier mode:**

1. `.ai/MEMORY-MAP.md` - memory contract, tiers, and project-specific routing notes.
2. `.ai/memory/MEMORY.md` - the hot index.
3. `.ai/memory/open_action_items.md` - what's actionable right now.
4. `.ai/memory/project_state.md` - current + last completed session only.
5. `docs/ARCHITECTURE.md` + `docs/OPS.md` - only if the user's task touches architecture or operations.
6. Specific ADRs / parked docs / reference docs - only when the current task makes them relevant.

**Do NOT auto-re-read `feedback_*.md` files during load-point.** They are referenced from `MEMORY.md` (which auto-loads) and fire when relevant in-session; re-reading them here bulks context without adding information. If the user's task specifically touches a feedback rule, open the matching file then — not at orientation time.

**Do NOT auto-read `archive/action_log.md` or anything under `archive/`.** The log is cold storage — grep on demand when the user asks "did we post X?" or "when did we do Y?". Never load it proactively.

**Flat mode:**

1. `.ai/memory/MEMORY.md` - the index, if present.
2. `.ai/memory/project_state.md` - the full state file.
3. Any other memory file that looks directly relevant to the user's ask.

**If `project_state.md` doesn't exist:** tell the user this is a fresh project with no saved state. Offer to explore the codebase instead.

### 3. Orient from "WHERE WE LEFT OFF"

The top section of `project_state.md` is the resumption point. Pull:

- Last completed action
- Immediate next action
- Prerequisites (env vars, services, manual steps)
- Uncommitted changes and their scope
- Unresolved findings or weak spots that have an active next action
- Any docs/runbooks/reference files the next action depends on

### 4. Verify the state is current

State files are snapshots - they may be stale. Check:

- `git status` - do uncommitted changes listed in state still exist? If state says "half-done edit in X" but the working tree is clean, the changes were committed, stashed, or lost.
- `git log --oneline -5` - are there commits after the last saved session? Someone (or another session) worked on the project since.
- Do key files/paths mentioned in state still exist? Quick spot-check, not exhaustive.
- **Tier mode extra:** if `project_state.md` references an ADR number, grep `docs/decisions/` to confirm it exists. If a parked item is mentioned, confirm the file is still in `docs/parked/`.
- If hot memory references a runbook, incident, architecture doc, reference doc, or issue as the owner of a finding, spot-check that target exists before relying on it.

**If state conflicts with reality:**

- Tell the user what's different: "State says X but I see Y".
- Trust current repo state over saved state - state is a hint, git is truth.
- Don't silently act on stale state.

### 5. Present a brief summary

Give the user a concise orientation (not a wall of text):

```
**Last session (<date>):** <1-sentence summary of what was done>
**Next up:** <the immediate next action>
**Prerequisites:** <anything needed before starting, or "none">
**Open items:** <the most urgent ones, if any>
**Findings:** <urgent unresolved finding, or "none surfaced">
```

Tier mode - add one line on where the next action will probably write:

```
**Touches:** .ai/memory/open_action_items.md + (likely) a new ADR in docs/decisions/
```

Then ask: "Ready to continue, or work on something else?"

### 6. If the user continues - start working

Don't re-explore the codebase. Trust the state file for context and begin the next action. Only read files you actually need to modify.

If the task surfaces a decision that needs lasting rationale, remember that at `/save-point` it should route to an ADR, not get dumped into `project_state.md`.

## Quality bar

After load-point, you should be able to:

- Answer "what are we doing?" in one sentence.
- Start the next action without asking the user for context.
- Catch state-vs-reality drift before acting on stale info.
- Know which tier files are relevant to the task without loading all of them.
- Know whether unresolved findings, doc drift, or env/config mismatches need attention before implementation.

## Do NOT

- Dump the entire state file contents at the user
- Re-explore the codebase from scratch when state exists
- Bulk-load every ADR, parked item, or archive file during orientation
- Silently act on state that conflicts with git
- Assume state is authoritative over current repo state - state is a hint, reality wins
