---
name: strata
description: 3-tier project memory (hot/warm/cold) with a unified issues backlog, operation-keyed learnings, generated indexes, and one-shot project initialization under .strata/. Invoke with no argument for a rule-lookup reference; invoke with "init" to scaffold a new project. Used internally by /strata-save and /strata-load as the authoritative source of tier definitions and routing rules.
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion]
---

# Strata — universal project memory

The **single source of truth** for the strata v3 pattern. Project memory is owned by the repo under `.strata/`, not by Claude, Codex, Gemini, or any other tool; `AGENTS.md`/`CLAUDE.md` are thin adapters pointing at `.strata/MANIFEST.md` and hold no separate memory.

This file is operational rules only. Depth lives elsewhere — link, don't restate:
**how it all works** → [docs/DESIGN.md](https://github.com/belousov-petr/strata/blob/main/docs/DESIGN.md) · **why** → [docs/decisions/](https://github.com/belousov-petr/strata/blob/main/docs/decisions/README.md) · **upgrades** → [MIGRATIONS.md](https://github.com/belousov-petr/strata/blob/main/MIGRATIONS.md)

Two entry points: **rule lookup** (default — `/strata-save` and `/strata-load` read §§1–6 for decisions) and **`init`** (scaffold a project, §7).

---

## 1. Tiers and stores

| Tier | Where | When loaded |
|---|---|---|
| **Hot** | `.strata/memory/` + `.strata/issues/ACTIVE.md` | Session start |
| **Warm** | `.strata/docs/` + individual `issues/*.md` | On demand, by task |
| **Cold** | `.strata/memory/archive/` + `.strata/issues/archive/` | Explicit history search only |

One routing key per store: `project_state.md` = recency ("what was I doing"), `learnings/` = operation ("what do I know about doing this"), `issues/` = status ("what work exists"), `docs/` = topic ("what is true and why"), `archive/` + `action_log.md` = time ("what happened"). Derivable knowledge (code, `git log`, folder structure) gets **no store**.

**Budgets (hard):** `MEMORY.md` ≤80 lines · `project_state.md` ≤200 lines, current + last completed session only. Warm and cold are unbudgeted — depth is free off the hot path.

**Contract file.** `.strata/MANIFEST.md` (with `strata_version: 3`) is the *only* per-project file stating structure and routing. `MEMORY.md` is a pure index: live pointers + the generated rules-by-trigger table. Never re-add routing tables to it.

**Portability.** Project-relative paths only (`.strata/...`); no machine-specific absolute paths, usernames, or single-OS commands in memory — give PowerShell and POSIX variants when a saved command matters on both.

## 2. Routing — where new knowledge goes

| You produced / discovered | Write to | When |
|---|---|---|
| Finding, bug, improvement, debt, task, feature, initiative | `issues/<id>-<slug>.md`, status `open`, full rationale + diagnostics | **Immediately, mid-session** |
| Deferred work | same file, status `parked` + `revive-when:` | at capture or triage |
| Behavioral lesson (worked or burned you) | `memory/learnings/<slug>.md` | at `/strata-save`, or immediately if hard-won |
| Shipped decision with non-obvious rationale | `docs/decisions/ADR-NNNN-<slug>.md` + source → `memory/archive/source-adr-NNNN-*` | at `/strata-save` |
| Product requirement / PRD | `docs/product/<slug>.md` | when it exists |
| How a subsystem works | `docs/architecture/<slug>.md` + row in `docs/ARCHITECTURE.md` | when it stabilizes |
| Stable fact (paths, schemas, APIs, conventions) | `docs/reference/<slug>.md` | on second lookup |
| Procedure, runbook, incident pattern | `docs/ops/…` (`incidents/<symptom>.md`, `release-rollback.md`) | when it changes |
| Session narrative | `memory/project_state.md`, rollover → `archive/` | at `/strata-save` |
| Completed action with external artifact (PR, email, durable URL) | `memory/archive/action_log.md` append | at `/strata-save` |
| A doc this session made wrong | fix in place; *retired* docs → `docs/_archive/` | at `/strata-save` |

**Never store:** secret values (env-var *names* only); anything derivable from code/`git log`; raw transcripts, full stack traces, command dumps — concise root cause + evidence instead; shipped rationale with no next step outside an ADR.

**Discriminators:** a *rule* fires at an operation → learning; a *procedure* is steps you execute → ops; a *fact* is something you look up → reference. An *issue* can close; a *learning* outlives every issue that taught it. *State* is where you stand; anything with its own lifecycle is an issue.

## 3. Issues — the single backlog

States and types (canonical, defined here and in MANIFEST/DESIGN, reused verbatim):

- **Types:** `bug | improvement | debt | task | feature | initiative`
- **Statuses:** `open | in-progress | parked | resolved | wont-fix`
- **Severity:** `high | med | low`

Operational rules:

1. **Capture immediately and completely.** The moment a finding surfaces mid-task: write `issues/<id>-<slug>.md` (id `YYYYMMDD-NN`) from `_TEMPLATE.md` — What/Why, and for bugs Tried/Error/Hypothesis/Repro *at capture time* — status `open`, then return to the task. Compaction cannot eat what is on disk. Don't fix it unless it blocks the current task.
2. **Status changes are frontmatter edits.** No file moves while an item is alive.
3. **`parked` requires a concrete `revive-when:`** trigger; `/strata-save` checks triggers against the session and revives matches.
4. **Closing** fills **Resolution** (link the ADR/learning if the close produced durable knowledge); `resolved`/`wont-fix` files move to `issues/archive/` at the next `/strata-save`.
5. **Dedup at triage:** fold new evidence into an existing item instead of filing a near-duplicate.
6. **Views are generated, never hand-edited:** `ACTIVE.md` (in-progress), `OPEN.md` (open, by area, severity first), `PARKED.md` (+triggers) — regenerated from frontmatter at every `/strata-save`.

## 4. Learnings — operation-keyed behavioral memory

One lesson per `memory/learnings/<slug>.md`:

```
---
trigger: <when this applies — operation-keyed>
applies-when: <glob/area, optional>
origin: success|failure
---
**Lesson:** <1–3 sentences>
```

- Capture **failures and successes** — a pitfall with its counterfactual fix is the highest-value item.
- `learnings/INDEX.md` and the rules-by-trigger table in `MEMORY.md` are regenerated from frontmatter at `/strata-save`.
- **Retrieval discipline:** consult the trigger table, open the one or two matching files at operation time. Never bulk-read the folder; never re-read at load.
- If a lesson needs more than 3 sentences, the surplus is reference or ops material — route it there.

## 5. `/strata-save` — preview-confirm-execute contract

**A — Scan** the session into buckets: resumption point · issue events (new captures — verify the mid-session ones hit disk; status changes; resolutions) · learnings (both origins) · ADR candidates · durable-doc impact · external completions · rollover (state beyond current + last completed).

**B — Preview**: ONE block listing every proposed change under `NEW FILES / APPENDS / UPDATES / MOVES / DELETIONS (section-only) / REGENERATED / SKIP`, then wait for y/n. Empty plan → "no changes proposed", stop.

**C — Safeguards** (before preview):

- **Git-dirty check** — files to MOVE or DELETE-FROM with uncommitted edits go under SKIP, untouched.
- **ADR collision guard** — next number = highest existing + 1 (scan `docs/decisions/`).
- **Section-only deletions** — never remove whole files without explicit instruction.
- **Idempotent** — re-run with no new work proposes nothing.

**D — Execute** on `y`, in order: writes → appends → updates (frontmatter/status) → moves → deletions → **regenerate all views last** (`ACTIVE/OPEN/PARKED`, `learnings/INDEX`, MEMORY trigger table; sync `MEMORY.md` pointers + `ARCHIVE.md`). On `n`: zero changes.

**E — Verify & report**: budgets hold (§1); views match frontmatter; resumption point actionable; hot memory and touched warm docs agree. Then a concise summary of what went where.

## 6. `/strata-load` — orientation contract

Load order (stop early if the task is already clear):

1. `.strata/MANIFEST.md` (check `strata_version: 3`; mismatch → `MIGRATIONS.md`, stop)
2. `.strata/memory/MEMORY.md`
3. `.strata/issues/ACTIVE.md`
4. `.strata/memory/project_state.md` (current + last completed only)

On demand only: `OPEN.md` by area · the specific issue being resumed · warm docs the task touches. **Never auto-load:** learnings files, ADRs in bulk, item files in bulk, `archive/`, `action_log.md`.

**Verify against git** before presenting: `git status` (do listed uncommitted changes exist?), `git log --oneline -5` (commits since last session?), spot-check referenced paths and issue ids. State is a hint; the repo is truth; report conflicts, never silently absorb them.

**Present** ≤6 lines: last session · next up (issue id) · active count · prerequisites · fired parked-triggers · drift. Then ask: continue or something else?

## 7. `init` — scaffold a project

Invoked via `Skill(name='strata', args='init')` or an explicit ask to set up project memory.

**Preconditions:**

1. CWD is the target project root, inside a git repo (`git rev-parse --is-inside-work-tree`; error out if not).
2. **Idempotence guard.** If `.strata/MANIFEST.md` or `.strata/memory/MEMORY.md` exists, refuse: report the existing memory; re-bootstrap requires the user to move/delete it first.
3. **Legacy guard.** If any v1/v2 fingerprint exists — `.claude/memory/`, `docs/PROJECT-MAP.md`, `.ai/` (or `.ai/MEMORY-MAP.md`), `open_action_items.md`, `project_<slug>.md` memory files, `docs/parked/`, or project files referencing the old `/save-point`//`/load-point` commands — do **not** scaffold a second memory. Report the fingerprint and offer the `MIGRATIONS.md` ladder instead.

**Questions** (single `AskUserQuestion`): project name; project type — "Code project (full `.strata/docs/` taxonomy)" vs "Knowledge/ops project (memory + issues; docs grow later)".

**Files to write** — templates from this skill's `templates/`, substituting `{{PROJECT_NAME}}` and `{{INIT_DATE}}` (today, `YYYY-MM-DD`) in **every** copied file:

| Template | Target | Condition |
|---|---|---|
| `templates/AGENTS.md` | `AGENTS.md` | only if absent |
| `templates/CLAUDE.md` | `CLAUDE.md` | only if absent |
| `templates/MANIFEST.md` | `.strata/MANIFEST.md` | always |
| `templates/memory/MEMORY.md` | `.strata/memory/MEMORY.md` | always |
| `templates/memory/project_state.md` | `.strata/memory/project_state.md` | always |
| `templates/memory/learnings/{INDEX,_TEMPLATE}.md` | `.strata/memory/learnings/` | always |
| `templates/memory/archive/{ARCHIVE,action_log}.md` | `.strata/memory/archive/` | always |
| `templates/issues/{README,_TEMPLATE,ACTIVE,OPEN,PARKED}.md` | `.strata/issues/` (+ create `issues/archive/`) | always |
| `templates/docs/ARCHITECTURE.md` + `templates/docs/{product,architecture,decisions,reference,ops}/README.md` | `.strata/docs/…` | code projects |

Existing adapters are left unchanged and reported as such. Adapters are pointers only — never write project memory into them.

**Report** exactly:

```
strata v3 initialized in <cwd>.

Created:
- .strata/MANIFEST.md (contract, strata_version: 3)
- .strata/memory/ (MEMORY.md index, project_state.md, learnings/, archive/)
- .strata/issues/ (README, _TEMPLATE, ACTIVE/OPEN/PARKED views, archive/)
<- .strata/docs/ (ARCHITECTURE.md + product/architecture/decisions/reference/ops) — code projects>
- AGENTS.md / CLAUDE.md adapters that were absent
<- Existing adapters left unchanged: ...>

Next:
- Describe the project in .strata/MANIFEST.md ("What <project> is")
- Work; capture findings to .strata/issues/ as they surface
- /strata-save at session end · /strata-load at session start
```

## 8. Versioning and migration

- This skill writes layout **`strata_version: 3`**; the stamp lives in `MANIFEST.md` frontmatter.
- On any version mismatch or legacy fingerprint: stop, report, point at `MIGRATIONS.md` (detect → gated transform → rollback, per rung). Never run a migration without the preview-confirm gate; never double-initialize.
- Releases of strata itself: git tags + `CHANGELOG.md` (git-native versioning — no version-archive folders anywhere, one optional `docs/_archive/` for retired docs).

## 9. Common mistakes

| Mistake | Fix |
|---|---|
| Restating routing in commands, adapters, or MEMORY.md | MANIFEST + this skill own it; everything else links |
| Holding a mid-task finding "for save time" | Write the issue file the moment it surfaces |
| Hand-editing ACTIVE/OPEN/PARKED or INDEX | Edit item frontmatter; views regenerate at save |
| Moving an item file to change its status | Status is frontmatter; files move only on close (→ archive) |
| `parked` without `revive-when:` | A concrete trigger or it isn't parked, it's abandoned |
| Bulk-loading learnings/ADRs/archive at load | Indexes + trigger table exist so you don't |
| Save without the preview gate | One block, one y/n — non-optional |
| New ADR with a colliding number | Scan `docs/decisions/`, take highest + 1 |
| Capturing "architecture needs cleanup" | Evidence, affected paths, hypothesis, fix direction, acceptance criteria — in the issue |
| `init` over an existing or legacy setup | Refuse; idempotence + legacy guards, MIGRATIONS ladder |

## 10. Relationship to other memory skills

`remember:remember` (single handoff note), `atlas-memory` (SQLite + vectors), `agentdb-*` (vector/RL backends) are storage mechanisms and are orthogonal. Strata is the **structural pattern** — where knowledge lives, when it loads, when it moves. They can coexist; strata files stay plain markdown + grep on purpose.
