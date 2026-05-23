# Rollover Rules

The six rules that keep a tiered memory system from re-polluting. Paste them into your `MEMORY.md` as a "Decision rules" section.

`/save-point` applies these automatically (tier mode). At session start, `/load-point` checks whether they've drifted.

## The rules

### 1. Feedback memory stays hot only if it changes in-session behavior

Otherwise → `docs/reference/`. A feedback file like "always use officecli for Office docs" changes what the agent does - keep it hot. A feedback file that's really a cheat sheet for pandoc flags is reference - move it to `docs/reference/`.

### 2. Project memory stays hot while the initiative is in-flight

On ship: extract the decision's rationale to `docs/decisions/ADR-NNNN-<slug>.md`, archive the memory source to `.ai/memory/archive/source-adr-NNNN-*.md`. Don't leave shipped specs in hot memory - the ADR has the rationale; the source is archived for provenance.

### 3. Project memory becomes parked if deferred >30 days without work

Move to `docs/parked/<slug>.md` with a **Revive when:** trigger. Example:

```markdown
## Revive when
Next Claude Code outage occurs AND operator confirms watchdog emails still haven't arrived.
```

A specific trigger beats a vague "later." If the trigger fires, `/save-point` moves the file back to hot memory and re-opens the action item.

### 4. `project_state.md` keeps only the current session + last completed session

Older sessions roll into `archive/YYYY-MM-sessions-XX-YY.md` at session start. The hot file is ≤200 lines. If it grows past that, `/save-point` trims it.

### 5. Reference material never lives in memory

Paths, credentials (references only - no keys), brand rules, problem-solving frameworks - all go to `docs/reference/`. Memory is for work state, not reference.

### 6. Archive is preserved, not auto-surfaced

Archive files are grep-able, git-versioned, and listed in `archive/ARCHIVE.md`. But they're NOT listed in `MEMORY.md`, so the agent doesn't auto-load them during a normal memory search. Explicit requests (`"check archive for X"`) pull them.

## When rules conflict

If a memory file is both a behavioral rule *and* an in-flight initiative, split it. Keep the behavioral rule in `feedback_<slug>.md`; track the initiative in `project_<slug>.md`. Cross-link with one line each. Avoid one file doing two jobs.

If a decision is both shipped *and* has an outstanding follow-up, write the ADR (status: implemented), and keep an `open_action_items.md` entry with a link to the ADR for the follow-up. The rationale lives once; the action lives once.

## Enforcement cadence

- **Every `/save-point`** - apply rules 1–6 to this session's changes.
- **Every `/load-point`** - verify the hot memory shape: MEMORY.md ≤~80 lines, `project_state.md` ≤~200 lines. If drift detected, flag to the user.
- **Weekly** (or after a sprint of heavy memory use) - the user can explicitly ask "audit memory hygiene" and `/save-point` will do a full pass without capturing a new session.
