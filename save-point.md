---
name: save-point
description: Use when ending an AI coding session, switching context, or wrapping up work - captures project state so the next session resumes without re-discovery or repeated questions. Tier-aware when the project has `.ai/MEMORY-MAP.md`. Tier rules and routing live in the `strata` skill — invoke it for the authoritative definitions.
---

# Save Project State

Capture what happened in this session so the next one starts hot. If the project uses the three-tier memory pattern (hot memory + warm docs + cold archive), route new knowledge to the right tier instead of dumping everything into one file. If it doesn't, fall back to a single-file capture.

**Authoritative rules live in `Skill: strata`.** This command orchestrates the save flow; the skill defines the tier model, routing table, rollover rules, and `action_log.md` format. Do not restate those rules here — read them from the skill when needed.

Capture is broader than hot memory. If the session changed how the project should be operated, documented, reasoned about, or improved, update the durable owner: ADRs, architecture docs, reference docs, ops runbooks, incident notes, action items, issue trackers, and cold archives as appropriate.

## When to use

- End of a work session
- Before switching projects
- After a milestone lands
- When the user says "save state", "wrap up", "let's stop here"

## Process

### 1. Detect the mode

Before anything else, check whether the project uses the three-tier pattern. Look for `.ai/MEMORY-MAP.md` in the project root.

- **Present** → **tier mode**. The project has already been structured - follow the routing rules in the map and the rollover discipline in `.ai/memory/MEMORY.md`.
- **Absent** → **flat mode**. Either the project is small or it has legacy/tool-specific memory. Capture a single `.ai/memory/project_state.md` and at the end offer to initialize or migrate into the tier pattern (see "Offer migration").

State which mode you detected before proceeding, so the user can correct you.

### 2. Read the current memory

Read from `.ai/memory/`:

- `MEMORY.md` - the index
- `project_state.md` - the session narrative (if it exists)
- Any `open_action_items.md` / `parked_items.md` / `feedback_*.md` / `project_*.md` that look active

**First run (no `project_state.md`):** create one using the template in Step 4.

### 3. Inventory this session's work

Review the conversation - what was actually done, decided, or discovered:

- Code changes, fixes, features, tests
- Decisions made and why (including alternatives rejected)
- Bugs found and how they were fixed
- Experiments and failures (these prevent repeating dead ends next time)
- Non-obvious learnings and gotchas
- Bad execution, poor architecture, broken logic, outdated docs, and weak spots discovered while working
- Operational lessons, runbook changes, incident patterns, and status changes
- Environment/config mismatches, credential-surface drift, and path/reference updates (never secret values)
- Documentation updated or now known to be wrong
- What was verified and how

Separate into categories - each category routes differently in tier mode.

If a finding is high-value and unresolved, capture it immediately while context is fresh. Include symptom, evidence, affected paths/systems, current status, likely root cause or hypotheses, why a quick workaround is insufficient, the structural fix direction, and acceptance criteria.

### 4. Capture the resumption point

This is the single most important section. Write it specifically enough that a fresh session can start without asking:

- What was the last thing completed?
- What is the immediate next action?
- Are there prerequisites? (env vars, service restarts, manual steps)
- Any uncommitted changes and what's their scope?
- Any background processes or scheduled tasks affected?

### 5. Route knowledge to the right tier

**Tier mode — see `Skill: strata` §2 for the canonical routing table.** Summary:

- new behavioral rule → `.ai/memory/feedback_<slug>.md`
- shipped decision with rationale → `docs/decisions/ADR-NNNN-<slug>.md` (+ archive source)
- in-flight initiative → `.ai/memory/project_<slug>.md`
- deferred (no date) → `docs/parked/<slug>.md` with **Revive when:**
- reference material → `docs/reference/<slug>.md`
- incident response pattern → `docs/ops/incidents/<symptom>.md`
- ops lesson / runbook change → `docs/OPS.md`, `docs/ops/<slug>.md`, or incident note
- architecture fact / structural choice → `docs/ARCHITECTURE.md`, `docs/reference/<slug>.md`, or ADR
- stale documentation → fix in place, or archive to `docs/**/archive/` if historical
- structural weakness / improvement opportunity → issue tracker if configured; otherwise active item or parked doc
- env/config mismatch → reference/runbook update plus hot action item if unresolved
- session narrative → append to `.ai/memory/project_state.md`
- **completed action with external artifact (PR, comment, email sent) → append to `.ai/memory/archive/action_log.md`**

**Flat mode** — everything goes into `project_state.md` under its appropriate section (see template in Step 7).

### 6. Preview-confirm-execute gate (tier mode only)

**Do not move files silently.** Before any write/move/delete, produce ONE preview block and wait for user `y/n`. See `Skill: strata` §5 for the full contract. Short version:

#### 6a — Build the proposed-changes list

Classify this session's work into four buckets: NEW FILES, APPENDS, MOVES, DELETIONS. Include rollover work:

1. **`project_state.md` bloat check.** If it covers more than current + last completed, the oldest block → `archive/YYYY-MM-DD-sessions-NN.md`.
2. **Durable-doc scan.** For each discovered fact that makes an existing durable doc wrong or incomplete, include the doc update or archive move in the preview. Do not leave contradictions between hot memory and warm docs.
3. **Finding-quality scan.** For each unresolved structural finding, make sure the proposed action has evidence, affected paths/systems, current status, root-cause hypothesis, structural fix direction, and acceptance criteria.
4. **Open action items — shipped scan.** For each item completed this session:
   - Shipped decision with rationale → NEW ADR in `docs/decisions/` + MOVE source to `archive/source-adr-NNNN-*.md` + DELETE block from `open_action_items.md`.
   - Completed external action (PR posted, email sent, comment made) → APPEND entry to `archive/action_log.md` + DELETE block from `open_action_items.md`.
   - Plain task → DELETE block from `open_action_items.md`.
5. **In-flight ship check.** For each `.ai/memory/project_<slug>.md`:
   - Shipped this session → promote to ADR + archive source.
   - No work for 30+ days → MOVE to `docs/parked/<slug>.md` with **Revive when:** + archive source.
6. **Parked-items promotion.** If a parked item's revive trigger fired, MOVE back to `.ai/memory/project_<slug>.md` + add to `open_action_items.md`.

#### 6b — Safeguards (apply before showing preview)

- **Git-dirty check.** For each target file (MOVE/DELETE-FROM only; pure writes are safe), run `git status --porcelain -- <file>`. If dirty, mark as SKIP in preview; do not touch.
- **ADR collision guard.** Before assigning `ADR-NNNN`, run `ls docs/decisions/ADR-*.md` and pick `highest + 1`.
- **Never delete whole files.** Deletions only remove sections within files (e.g. an F3 block in `open_action_items.md`). Whole-file removal requires explicit user instruction.

#### 6c — Render the preview

Single block, this shape:

```
Proposed changes for /save-point:

NEW FILES:
- <path>  ← <why>

APPENDS:
- <path>  ← <what>

MOVES:
- <src>  →  <dst>

DELETIONS (section-only):
- <file>: remove <section-id>

SKIP (uncommitted edits — commit or stash first):
- <path>

Confirm? (y/n)
```

If the list is empty ("no changes proposed"), say so and stop.

#### 6d — Execute

On `y`, execute in this order: **writes → appends → moves → deletions**. Deletions only fire after their corresponding appends/moves succeed. On `n`, abort with zero changes.

### 7. Update `project_state.md`

**Tier mode** - keep it lean (≤200 lines). Structure:

```markdown
---
name: <Project> State
description: Session N (date) - 1-line summary.
type: project
---

## WHERE WE LEFT OFF (session N, most recent)

**Session N - <date>.** <1-2 sentence summary.>

### Last completed
- …

### Next action
…

### Prerequisites
…

### Uncommitted changes
…

---

## WHERE WE LEFT OFF (session N-1, last completed)
<previous session block - trim to key facts, full narrative rolled to archive>

---

## Older sessions - archived
Sessions 1–(N-2) moved to `archive/YYYY-MM-sessions-XX-YY.md`.
```

**Flat mode** - fuller single-file structure:

```markdown
## WHERE WE LEFT OFF
Last completed: [specific action]
Next action: [specific next step]
Prerequisites: [any setup needed]
Uncommitted changes: [scope or "none"]

## Current State
- [Feature/component]: [status]
- Tests: [count passing/failing]
- Build: [status]

## Session History
### Session N: <date> - <summary>
Decisions: …

## Environment Requirements
…

## Key Constraints & Gotchas
…

## Findings & Improvement Opportunities
- [status] Symptom / evidence / affected paths / likely root cause / structural fix / acceptance criteria

## Open Items
P0 / P1 / P2 …

## Rejected approaches
- Tried X, failed because Y
```

### 8. Update the MEMORY.md index

- **Tier mode** - MEMORY.md is lean (~60–80 lines). Only list hot files with one-line pointers. Do NOT re-add archived files or ADR sources. Confirm the "Where to look" table still points at the right places.
- **Flat mode** - update the one-line description of `project_state.md` to reflect the current session number.

### 9. Fix stale references

Scan `MEMORY.md`, any `feedback_*.md` / `project_*.md`, and the warm docs touched by this session for statements this session made factually wrong (e.g., "auth uses passport.js" but you just replaced it). Correct them. Skip files unrelated to this session's work - don't audit the entire repository.

If a doc is simply wrong, fix it in place. If it is historically useful but no longer active, move it to the nearest `archive/` directory and update that archive index. Do not add "stale" banners as a resting state.

### 10. Update the project README (optional)

If the project has a root `README.md` and this session changed user-facing behavior (setup steps, feature list, API), update it. If not, skip.

### 11. Verify

Re-read the saved `project_state.md` and confirm:

- [ ] "WHERE WE LEFT OFF" gives a clear, actionable resumption point.
- [ ] A fresh session could start working without asking clarifying questions.
- [ ] No stale info from earlier sessions left uncorrected.
- [ ] No ephemeral junk saved (temp paths, stack traces, debug blobs).
- [ ] Tier mode: MEMORY.md ≤ ~80 lines, `project_state.md` ≤ ~200 lines.

### 12. Report back

Tell the user what changed. Tier mode example:

```
Mode: tier-aware.
Saved hot: project_state.md (session 35 appended).
Extracted to ADR: ADR-0019 (enrichment queue force-drain).
Parked: email-dispatcher-followup (revive when dispatcher audit needed).
Archived: sessions 32–33 → archive/2026-04-20-sessions-32-33.md.
Cleaned: 2 stale feedback references.
Updated docs: docs/ops/runtime-health.md, docs/reference/auth-surfaces.md.
Captured findings: A12 docs/source drift follow-up in open_action_items.md.
```

Flat mode example:

```
Mode: flat (no .ai/MEMORY-MAP.md detected).
Saved: project_state.md (session 7, 3 new decisions, 2 open items).
Stale refs corrected: 1.
```

## Offer migration (flat mode only)

If the project is in flat mode and `project_state.md` has grown past ~500 lines, or you spot 3+ distinct decisions with lasting rationale mixed into the narrative, offer to migrate:

> "`project_state.md` is getting large and has several shipped decisions mixed with session narrative. I can set up the three-tier pattern - split out ADRs, create `.ai/MEMORY-MAP.md`, trim the hot file. Want me to?"

Don't push. If the user declines, stay in flat mode.

## Quality bar

The state capture must let a fresh session:

- Know what was done and why
- Start the next action without asking
- Avoid repeating failed approaches
- Know prerequisites before running anything
- Understand project health (tests, build, key metrics)
- Find any unresolved structural weakness with enough evidence to fix it properly
- Trust warm docs and hot memory to agree about facts discovered this session

## Common mistakes

| Mistake | Fix |
|---|---|
| Dumping the whole codebase structure into state | Only save what's NOT derivable from reading files or `git log` |
| Vague resumption point ("continue working on auth") | Specific: "implement refresh token rotation in `src/auth/tokens.ts`, tests stubbed in `tests/auth.test.ts`" |
| Forgetting rejected approaches | Document what was tried and why it failed - prevents loops |
| Losing weak spots discovered mid-investigation | Capture them immediately with evidence, status, fix direction, and acceptance criteria |
| Treating memory as the only output | Update ADRs, docs, runbooks, incidents, references, and action statuses when they are the durable owner |
| Capturing secret drift by pasting secrets | Save env var names, secret refs, surfaces, and mismatch status only - never values |
| Saving stack traces or temp file paths | Ephemeral. Save the root cause and fix, not the debug output |
| Creating new memory files for everything (flat mode) | Most state fits in `project_state.md` - only split when the pattern calls for it |
| Re-bloating hot memory with shipped decisions (tier mode) | Extract to ADR. The rationale belongs in `docs/decisions/`, not `memory/` |
| Skipping stale-reference scan | Outdated feedback memories mislead the next session |
| Dumping code into state | State captures decisions and status. Code lives in files. |

## Do NOT

- Ask the user what to capture - figure it out from context
- Save code patterns derivable from reading source
- Duplicate what `git log` shows (commit hashes, diffs)
- Save environment-specific paths that won't exist next session
- Assume one OS shell when a saved operational command must work across Windows, Linux, and macOS
- Tier mode: re-populate `MEMORY.md` with archived files
- Silently switch a flat-mode project into tier mode without offering migration
