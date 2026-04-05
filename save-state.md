---
name: save-state
description: Use when ending a work session, switching context, or before closing Claude Code — captures project state so the next session resumes without re-discovery or repeated questions
---

# Save Project State

Capture the complete state of the current project into persistent memory so the next session can resume exactly where we left off without asking questions.

## When to Use

- End of any work session
- Before switching to a different project
- After completing a major milestone
- When the user says "save state", "wrap up", or "let's stop here"

## Process

### 1. Read Current Memory

Read `MEMORY.md` index and `project_state.md` from the Claude memory directory (`~/.claude/projects/<project>/memory/`).

The `<project>` path is the CWD-encoded directory name (e.g., `C--Users-john-myproject` for `C:\Users\john\myproject`).

**First run:** If `project_state.md` doesn't exist, create it using the template structure in Step 4.

### 2. Assess Current Session

Review everything done in this conversation:
- Actions taken (code changes, fixes, features, tests)
- Decisions made and why (including rejected approaches)
- Bugs found and how they were fixed
- Experiments tried (including failures — these prevent repeating dead ends)
- Non-obvious learnings and gotchas discovered
- What was verified and how (test results, live runs, API calls)

### 3. Capture Resumption Point

Document where we left off — this is the most critical section:
- What was the last thing completed?
- What is the immediate next action? (specific enough to start without asking)
- Are there prerequisites? (env vars, terminal restarts, manual steps, service startups)
- Any uncommitted changes? What's their scope?
- Any background processes or scheduled tasks affected?

### 4. Update `project_state.md`

Rewrite with this structure:

```markdown
## WHERE WE LEFT OFF
<!-- Most important — next session reads this first -->
Last completed: [specific action]
Next action: [specific next step]
Prerequisites: [any setup needed before resuming]
Uncommitted changes: [scope or "none"]

## Current State
<!-- What works, what doesn't, key metrics -->
- [Feature/component]: [status]
- Tests: [count passing/failing]
- Build: [status]

## Session History
### Session N: [date] — [summary phrase]
Phase 1: [what was done]
Phase 2: [what was done]
Decisions: [key choices and why]

## Environment Requirements
<!-- Services, env vars, tools discovered this session -->

## Architecture Overview
<!-- Only include if changed or first run; scope to what you touched, not the entire stack -->

## Key Constraints & Gotchas
<!-- Non-obvious things that will bite the next session -->

## Open Items
<!-- Prioritized: P0 = blocking, P1 = next, P2 = backlog -->
```

### 5. Update `MEMORY.md` Index

Update the one-line description for `project_state.md` to reflect the current session number and state.

### 6. Update Stale References

Scan `MEMORY.md` for memory files that reference things changed this session. Only update files where this session's work made their content factually wrong (e.g., a memory says "auth uses passport.js" but you just replaced it). Skip files unrelated to this session's work — don't audit the entire memory directory.

### 7. Update Project README

If the project has a `README.md` in its root, diff it against what changed this session. Update any sections that reference modified functionality (architecture, setup steps, feature lists, test counts, API endpoints). If no `README.md` exists, skip this step.

### 8. Verify

Re-read the saved `project_state.md` and confirm:
- [ ] "WHERE WE LEFT OFF" gives a clear, actionable resumption point
- [ ] A fresh session could start working without asking clarifying questions
- [ ] No stale information from previous sessions left uncorrected
- [ ] No ephemeral data saved (temp paths, stack traces, debug logs)

## Quality Bar

The state capture must be detailed enough that a fresh Claude session can:
- Understand what was done and why
- Know the immediate next action without asking
- Avoid repeating failed approaches
- Know which prerequisites are needed
- Know the project's current health (tests, build, metrics)

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Saving the entire codebase structure | Only save what's NOT derivable from reading files or git log |
| Vague resumption point ("continue working on auth") | Be specific: "implement refresh token rotation in `src/auth/tokens.ts`, tests stubbed in `tests/auth.test.ts`" |
| Forgetting rejected approaches | Document what was tried and why it failed — prevents loops |
| Saving stack traces or temp file paths | These are ephemeral; save the root cause and fix, not the debug output |
| Creating new memory files for everything | Most state fits in `project_state.md` — only create separate files for durable cross-session knowledge |
| Skipping README update | README is the first thing anyone reads — stale README = stale project |
| Copy-pasting code into state | State captures decisions and status, not code — code lives in files |

## Do NOT

- Ask the user what to capture — figure it out from the session context
- Save code patterns derivable from reading the source
- Duplicate what git log already shows (commit hashes, diffs)
- Create new memory files for things that fit in `project_state.md`
- Save environment-specific paths that won't exist next session
