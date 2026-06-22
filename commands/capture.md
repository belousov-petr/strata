---
name: capture
description: Use immediately when an agent hits a failure, retry loop, workaround, surprising behavior, gotcha, bug, or important finding that should not wait for /strata:save. Captures issues and behavioral learnings while context is fresh. Strata-aware when the project has `.strata/MANIFEST.md`; flat-mode fallback appends to `.strata/memory/project_state.md`.
---

# Capture Fresh Finding or Gotcha

Write the memory now, then continue. Prefer spending a few tokens on the spot over losing the evidence to compaction.

**Authoritative rules live in `Skill: strata:strata`, especially the immediate-capture contract.** This command is the interrupt you use while working; `/strata:save` remains the end-of-session bookkeeping pass.

## When to use

Capture any important moment the instant it is clear, so the project's docs grow as you build:

- A command, tool, API, install, test, or deploy step failed and you retried or changed approach
- You found a bug, weakness, TODO, brittle assumption, config drift, or doc gap
- You learned a rule future agents should know before doing the same operation
- You used a workaround that should not be rediscovered later
- You settled a decision worth explaining later, or changed direction on an earlier one
- You worked out how an outside system actually behaves (runbook material)
- You pinned down a requirement, or the reasoning behind it, that belongs in a spec or PRD

## Process

### 1. Detect the mode

- `.strata/MANIFEST.md` present -> **strata mode**. Check `layout_version: 3`; if it differs (e.g. a legacy `strata_version: 0.0.3` stamp), stop and point at `MIGRATIONS.md`.
- `.strata/memory/project_state.md` present without a manifest -> **flat mode**. Append a concise fresh capture there; later `strata init` migrates and archives the flat source.
- Nothing present -> create `.strata/memory/project_state.md` as flat mode with the capture. Mention that `strata init` can upgrade it later.

State the detected mode in one line.

### 2. Gather just enough context

Use targeted reads only:

- `MANIFEST.md`, `MEMORY.md`, and `issues/ACTIVE.md` in strata mode
- `issues/OPEN.md` only if the capture looks like an existing area of work
- `.strata/inbox/captures.jsonl` — fold any matching auto-logged failure into this capture, then clear it (skill §5a)
- `rg` for a distinctive error phrase, file path, command name, or learning trigger before creating a new file

Do not bulk-read `learnings/`, `archive/`, ADRs, or every issue.

### 3. Route the capture

Write to the home for what you captured (full table in `Skill: strata:strata` §2/§5). `/strata:save` is the safety net that files anything you miss.

- **Issue** if there is closeable work: bug, improvement, debt, task, feature, initiative.
- **Learning** if the value is a reusable behavior rule: "before doing X, know Y."
- **Decision record** under `docs/decisions/ADR-NNNN-<slug>.md` if you settled something with non-obvious rationale (number = highest existing + 1); a change of direction supersedes the old ADR, never edits it.
- **Durable doc** if it is lasting knowledge: a runbook or how-a-system-works under `docs/ops/` or `docs/architecture/`, a requirement or its reasoning under `docs/product/`.
- **Several** if one moment is more than one of these.
- **Flat mode** if no 0.0.3 structure exists: append under Findings/Gotchas/Open Items in `project_state.md`.

Dedup before writing. If a matching file exists, update it with the new evidence instead of creating a near-duplicate. Capture writes the source file only; `/strata:save` regenerates the views and the `ARCHITECTURE.md` index.

### 4. Write immediately

For an issue, use `.strata/issues/_TEMPLATE.md` and include:

- frontmatter: `id`, `type`, `status`, `severity`, `area`, `created`
- What happened and why it matters
- Tried / Error / Hypothesis / Repro, when the finding came from a failure
- Evidence trimmed to the smallest useful command, path, or observation
- Next action or acceptance criteria

For a learning, use `.strata/memory/learnings/_TEMPLATE.md` and keep the lesson to 1-3 sentences with `origin: success | failure`.

For a decision, write an ADR (Context / Considered Options / Decision / Consequences) under `.strata/docs/decisions/`; for a runbook, spec, or PRD, write the durable doc under the matching `.strata/docs/` folder. See `Skill: strata:strata` §5 for the routing.

Do not hand-edit generated views (`ACTIVE.md`, `OPEN.md`, `PARKED.md`, `learnings/INDEX.md`, or the `MEMORY.md` trigger table). `/strata:save` regenerates them from source files.

### 5. Report and resume

Report the file(s) written or updated:

```
Mode: strata (0.0.3).
Captured: .strata/issues/20260617-01-plugin-cache-stale.md
Learning: .strata/memory/learnings/before-updating-codex-plugin.md
Continuing: <original task>
```

Then continue the original task unless the capture shows that the task is blocked.

## Do NOT

- Wait for `/strata:save`
- Ask the user what to capture when the session already shows it
- Dump full logs, transcripts, secrets, or token values
- Move closed issues to archive during capture; save handles archive moves
- Regenerate generated views during capture unless the user explicitly asks
