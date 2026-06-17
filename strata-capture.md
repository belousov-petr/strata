---
name: strata-capture
description: Use immediately when an agent hits a failure, retry loop, workaround, surprising behavior, gotcha, bug, or important finding that should not wait for /strata-save. Captures issues and behavioral learnings while context is fresh. Strata-aware when the project has `.strata/MANIFEST.md`; flat-mode fallback appends to `.strata/memory/project_state.md`.
---

# Capture Fresh Finding or Gotcha

Write the memory now, then continue. Prefer spending a few tokens on the spot over losing the evidence to compaction.

**Authoritative rules live in `Skill: strata`, especially the immediate-capture contract.** This command is the interrupt you use while working; `/strata-save` remains the end-of-session bookkeeping pass.

## When to use

- A command, tool, API, install, test, or deploy step failed and you retried or changed approach
- You found a bug, weakness, TODO, brittle assumption, config drift, or doc gap
- You learned a rule future agents should know before doing the same operation
- You used a workaround that should not be rediscovered later

## Process

### 1. Detect the mode

- `.strata/MANIFEST.md` present -> **strata mode**. Check `strata_version: 3`; if it differs, stop and point at `MIGRATIONS.md`.
- `.strata/memory/project_state.md` present without a manifest -> **flat mode**. Append a concise fresh capture there; later `strata init` migrates and archives the flat source.
- Nothing present -> create `.strata/memory/project_state.md` as flat mode with the capture. Mention that `strata init` can upgrade it later.

State the detected mode in one line.

### 2. Gather just enough context

Use targeted reads only:

- `MANIFEST.md`, `MEMORY.md`, and `issues/ACTIVE.md` in strata mode
- `issues/OPEN.md` only if the capture looks like an existing area of work
- `rg` for a distinctive error phrase, file path, command name, or learning trigger before creating a new file

Do not bulk-read `learnings/`, `archive/`, ADRs, or every issue.

### 3. Route the capture

- **Issue** if there is closeable work: bug, improvement, debt, task, feature, initiative.
- **Learning** if the value is a reusable behavior rule: "before doing X, know Y."
- **Both** if a fixable issue also taught a future rule.
- **Flat mode** if no v3 structure exists: append under Findings/Gotchas/Open Items in `project_state.md`.

Dedup before writing. If a matching issue or learning exists, update it with the new evidence instead of creating a near-duplicate.

### 4. Write immediately

For an issue, use `.strata/issues/_TEMPLATE.md` and include:

- frontmatter: `id`, `type`, `status`, `severity`, `area`, `created`
- What happened and why it matters
- Tried / Error / Hypothesis / Repro, when the finding came from a failure
- Evidence trimmed to the smallest useful command, path, or observation
- Next action or acceptance criteria

For a learning, use `.strata/memory/learnings/_TEMPLATE.md` and keep the lesson to 1-3 sentences with `origin: success | failure`.

Do not hand-edit generated views (`ACTIVE.md`, `OPEN.md`, `PARKED.md`, `learnings/INDEX.md`, or the `MEMORY.md` trigger table). `/strata-save` regenerates them from source files.

### 5. Report and resume

Report the file(s) written or updated:

```
Mode: strata (v3).
Captured: .strata/issues/20260617-01-plugin-cache-stale.md
Learning: .strata/memory/learnings/before-updating-codex-plugin.md
Continuing: <original task>
```

Then continue the original task unless the capture shows that the task is blocked.

## Do NOT

- Wait for `/strata-save`
- Ask the user what to capture when the session already shows it
- Dump full logs, transcripts, secrets, or token values
- Move closed issues to archive during capture; save handles archive moves
- Regenerate generated views during capture unless the user explicitly asks
