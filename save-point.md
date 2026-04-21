---
name: save-point
description: Use when ending a work session, switching context, or before closing Claude Code — captures project state so the next session resumes without re-discovery or repeated questions. Tier-aware when the project has a docs/PROJECT-MAP.md.
---

# Save Project State

Capture what happened in this session so the next one starts hot. If the project uses the three-tier memory pattern (hot memory + warm docs + cold archive), route new knowledge to the right tier instead of dumping everything into one file. If it doesn't, fall back to a single-file capture.

## When to use

- End of a work session
- Before switching projects
- After a milestone lands
- When the user says "save state", "wrap up", "let's stop here"

## Process

### 1. Detect the mode

Before anything else, check whether the project uses the three-tier pattern. Look for `docs/PROJECT-MAP.md` in the project root.

- **Present** → **tier mode**. The project has already been structured — follow the routing rules in the map and the rollover discipline in `MEMORY.md`.
- **Absent** → **flat mode**. Either the project is small or it hasn't adopted the pattern yet. Capture a single `project_state.md` as before, and at the end offer to migrate (see "Offer migration").

State which mode you detected before proceeding, so the user can correct you.

### 2. Read the current memory

Read from `~/.claude/projects/<encoded-cwd>/memory/`:

- `MEMORY.md` — the index
- `project_state.md` — the session narrative (if it exists)
- Any `open_action_items.md` / `parked_items.md` / `feedback_*.md` / `project_*.md` that look active

The `<encoded-cwd>` is the current working directory with separators replaced by `--` (e.g., `C--Users-john-myproject` for `C:\Users\john\myproject`).

**First run (no `project_state.md`):** create one using the template in Step 4.

### 3. Inventory this session's work

Review the conversation — what was actually done, decided, or discovered:

- Code changes, fixes, features, tests
- Decisions made and why (including alternatives rejected)
- Bugs found and how they were fixed
- Experiments and failures (these prevent repeating dead ends next time)
- Non-obvious learnings and gotchas
- What was verified and how

Separate into categories — each category routes differently in tier mode.

### 4. Capture the resumption point

This is the single most important section. Write it specifically enough that a fresh session can start without asking:

- What was the last thing completed?
- What is the immediate next action?
- Are there prerequisites? (env vars, service restarts, manual steps)
- Any uncommitted changes and what's their scope?
- Any background processes or scheduled tasks affected?

### 5. Route knowledge to the right tier

**Tier mode — use the routing tree from `docs/PROJECT-MAP.md`:**

| What you learned | Where it goes |
|---|---|
| New behavioral rule the agent should follow | `memory/feedback_<slug>.md` (hot, 10–25 lines, with **Why:** and **How to apply:**) |
| Shipped decision with non-obvious rationale | `docs/decisions/ADR-NNNN-<slug>.md` (warm, 40–80 lines). Archive the in-flight memory source to `memory/archive/source-adr-NNNN-*.md` for provenance. |
| New in-flight initiative | `memory/project_<slug>.md` (hot). Stays there until ship. |
| Deferred initiative (no date, may revive) | `docs/parked/<slug>.md` with a **Revive when:** trigger (warm) |
| Stable reference material (paths, brand, frameworks) | `docs/reference/<slug>.md` (warm) |
| New incident response pattern | `docs/ops/incidents/<symptom>.md` (warm, if the project has an ops tree) |
| Session narrative | append to current `project_state.md` |

**Flat mode** — everything goes into `project_state.md` under its appropriate section (see the template in Step 7).

### 6. Apply rollover discipline (tier mode only)

This keeps the hot memory from re-polluting:

1. **`project_state.md` bloat check.** If it now covers 3+ sessions (current + last completed + older), roll the oldest into `memory/archive/YYYY-MM-sessions-XX-YY.md`. Trim the hot file to current + last completed only.
2. **Open action items — shipped scan.** For each item in `open_action_items.md` completed this session:
   - If it was a shipped decision with rationale → extract to a new ADR in `docs/decisions/`, archive any source to `memory/archive/source-adr-NNNN-*.md`, remove the item from `open_action_items.md`.
   - If it was a plain task → just remove it.
3. **In-flight ship check.** For each `memory/project_<slug>.md`:
   - Shipped this session → promote to ADR (as above), delete the memory source (or archive it).
   - No work for 30+ days → move to `docs/parked/<slug>.md` with a **Revive when:** trigger, archive the source.
4. **Parked-items promotion.** If any entry in `docs/parked/` had its revive trigger fire this session, move it back to `memory/project_<slug>.md` and note it in `open_action_items.md`.

### 7. Update `project_state.md`

**Tier mode** — keep it lean (≤200 lines). Structure:

```markdown
---
name: <Project> State
description: Session N (date) — 1-line summary.
type: project
---

## WHERE WE LEFT OFF (session N, most recent)

**Session N — <date>.** <1-2 sentence summary.>

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
<previous session block — trim to key facts, full narrative rolled to archive>

---

## Older sessions — archived
Sessions 1–(N-2) moved to `archive/YYYY-MM-sessions-XX-YY.md`.
```

**Flat mode** — fuller single-file structure:

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
### Session N: <date> — <summary>
Decisions: …

## Environment Requirements
…

## Key Constraints & Gotchas
…

## Open Items
P0 / P1 / P2 …

## Rejected approaches
- Tried X, failed because Y
```

### 8. Update the MEMORY.md index

- **Tier mode** — MEMORY.md is lean (~60–80 lines). Only list hot files with one-line pointers. Do NOT re-add archived files or ADR sources. Confirm the "Where to look" table still points at the right places.
- **Flat mode** — update the one-line description of `project_state.md` to reflect the current session number.

### 9. Fix stale references

Scan `MEMORY.md` and any `feedback_*.md` / `project_*.md` for statements this session made factually wrong (e.g., "auth uses passport.js" but you just replaced it). Correct them. Skip files unrelated to this session's work — don't audit the entire memory directory.

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
```

Flat mode example:

```
Mode: flat (no docs/PROJECT-MAP.md detected).
Saved: project_state.md (session 7, 3 new decisions, 2 open items).
Stale refs corrected: 1.
```

## Offer migration (flat mode only)

If the project is in flat mode and `project_state.md` has grown past ~500 lines, or you spot 3+ distinct decisions with lasting rationale mixed into the narrative, offer to migrate:

> "`project_state.md` is getting large and has several shipped decisions mixed with session narrative. I can set up the three-tier pattern — split out ADRs, create `docs/PROJECT-MAP.md`, trim the hot file. Want me to?"

Don't push. If the user declines, stay in flat mode.

## Quality bar

The state capture must let a fresh session:

- Know what was done and why
- Start the next action without asking
- Avoid repeating failed approaches
- Know prerequisites before running anything
- Understand project health (tests, build, key metrics)

## Common mistakes

| Mistake | Fix |
|---|---|
| Dumping the whole codebase structure into state | Only save what's NOT derivable from reading files or `git log` |
| Vague resumption point ("continue working on auth") | Specific: "implement refresh token rotation in `src/auth/tokens.ts`, tests stubbed in `tests/auth.test.ts`" |
| Forgetting rejected approaches | Document what was tried and why it failed — prevents loops |
| Saving stack traces or temp file paths | Ephemeral. Save the root cause and fix, not the debug output |
| Creating new memory files for everything (flat mode) | Most state fits in `project_state.md` — only split when the pattern calls for it |
| Re-bloating hot memory with shipped decisions (tier mode) | Extract to ADR. The rationale belongs in `docs/decisions/`, not `memory/` |
| Skipping stale-reference scan | Outdated feedback memories mislead the next session |
| Dumping code into state | State captures decisions and status. Code lives in files. |

## Do NOT

- Ask the user what to capture — figure it out from context
- Save code patterns derivable from reading source
- Duplicate what `git log` shows (commit hashes, diffs)
- Save environment-specific paths that won't exist next session
- Tier mode: re-populate `MEMORY.md` with archived files
- Silently switch a flat-mode project into tier mode without offering migration
