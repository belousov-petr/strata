---
name: load-point
description: Use when starting a new session on a project that has been worked on before — loads saved state so you can resume without asking the user to re-explain context
---

# Load Project State

Read the saved project state and orient yourself so you can resume work immediately without asking the user what happened last time.

## When to Use

- Starting a new session on an existing project
- User says "pick up where we left off", "continue", or "what were we doing?"
- You see a `project_state.md` exists in the memory directory

## Process

### 1. Read State Files

Read from `~/.claude/projects/<project>/memory/`:

1. `MEMORY.md` — the full index of all memory files
2. `project_state.md` — the main state file (start here)
3. Any other memory files referenced that seem relevant to what the user is asking

The `<project>` path is the CWD-encoded directory name (e.g., `C--Users-john-myproject` for `C:\Users\john\myproject`).

**If `project_state.md` doesn't exist:** Tell the user this appears to be a fresh project with no saved state. Offer to explore the codebase instead.

### 2. Orient from "WHERE WE LEFT OFF"

The top section of `project_state.md` contains the resumption point. Extract:
- What was last completed
- What the immediate next action is
- Any prerequisites (env vars, services, manual steps)
- Whether there are uncommitted changes to be aware of

### 3. Verify State is Current

State files are snapshots — they may be stale. Run these checks:
- `git status` — do uncommitted changes mentioned in state still exist? If state says "half-done edit in X" but working tree is clean, the changes were likely lost (reset, stash, or committed separately)
- `git log --oneline -5` — are there commits after the last saved session? If so, someone (or another session) worked on the project since
- Do key files/paths mentioned in state still exist? (quick spot-check, not exhaustive)

**If state conflicts with reality:**
- Tell the user what's different: "State says X but I see Y"
- Trust current repo state over saved state — state is a hint, git is truth
- Don't silently act on outdated state

### 4. Present a Brief Summary

Give the user a concise orientation (not a wall of text):

```
**Last session ([date]):** [1-sentence summary of what was done]
**Next up:** [the immediate next action]
**Prerequisites:** [anything needed before starting, or "none"]
**Open items:** [list the most urgent items, if any are noted in state]
```

Then ask: "Ready to continue, or do you want to work on something else?"

### 5. If User Continues — Start Working

Don't re-read the entire codebase. Trust the state file for context and begin the next action. Only read files you actually need to modify.

## Do NOT

- Dump the entire state file contents at the user
- Re-explore the codebase from scratch when state exists
- Silently act on state that conflicts with what you observe in the repo
- Assume state is authoritative over current git/file state — state is a hint, reality wins
