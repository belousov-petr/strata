---
name: strata
description: Tool-neutral 3-tier project memory system (hot/warm/cold) with automated save-point routing, load-point orientation, and one-shot project initialization. Invoke with no argument for a rule-lookup reference; invoke with "init" to scaffold the structure into a new project. Used internally by /save-point and /load-point commands as the authoritative source of tier definitions and routing rules.
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion]
---

# Strata — universal project memory

This skill is the **single source of truth** for the 3-tier project memory pattern. Project memory is owned by the repo under `.ai/`, not by Claude, Codex, Gemini, or any other tool. Tool-specific files such as `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` are adapters that point at `.ai/MEMORY-MAP.md`; they should not contain separate memory.

Two entry points:

- **Rule lookup** (default): read the tier model, routing rules, and rollover rules below. Used by save-point / load-point for decisions.
- **`init` action** (when user invokes with "init"): scaffold the memory structure into a target project. See §7.

---

## 1. The three tiers

| Tier | Location | When loaded | Purpose |
|---|---|---|---|
| **Hot** | `.ai/memory/` | Every session (`MEMORY.md` auto-loaded) + on-demand | Active work, current state, evergreen behavioral rules |
| **Warm** | `docs/` | On demand only | Architecture, ADRs, roadmap, reference, parked items |
| **Cold** | `.ai/memory/archive/` + `docs/**/archive/` | Only when explicitly searching history | Superseded state, ADR provenance, historical session narratives, completion log |

**Memory map.** `.ai/MEMORY-MAP.md` is the project-level contract. It states that the project uses hot/warm/cold memory, where each tier lives, and which files to load first.

**Loading discipline.** Tool adapters should load `.ai/MEMORY-MAP.md`, then `.ai/memory/MEMORY.md`. Auto-loaded content should fit in `MEMORY.md` (≤80 lines) + `project_state.md` (≤200 lines) + `open_action_items.md` (active only). Everything else is on demand.

**Capture discipline.** Strata captures knowledge needed to resume, operate, or structurally improve the project. It is not just "memory": route decisions, findings, gotchas, documentation changes, operational lessons, architecture references, runbooks, incidents, and status changes to their durable homes while the context is fresh.

**Portability discipline.** Strata is project-relative and tool-neutral. Use `.ai/...` and `docs/...` paths in memory/docs; avoid persisting machine-specific absolute paths, local usernames, shell profiles, or OS-specific commands unless the project itself requires them. When commands matter, record the Windows PowerShell and POSIX shell variants if both are relevant.

---

## 2. Routing rules — where new knowledge goes

| What you learned this session | Destination | Tier |
|---|---|---|
| New behavioral rule for the agent | `.ai/memory/feedback_<slug>.md` (10–25 lines, with **Why:** and **How to apply:**) | Hot |
| Shipped decision with non-obvious rationale | `docs/decisions/ADR-NNNN-<slug>.md` (40–80 lines). Raw source archives to `.ai/memory/archive/source-adr-NNNN-*.md`. | Warm (+ cold source) |
| New in-flight initiative | `.ai/memory/project_<slug>.md` — stays hot until ship | Hot |
| Deferred initiative (no date, may revive) | `docs/parked/<slug>.md` with a **Revive when:** trigger | Warm |
| Stable reference material (paths, brand, frameworks) | `docs/reference/<slug>.md` | Warm |
| New incident response pattern | `docs/ops/incidents/<symptom>.md` | Warm |
| Operational lesson, runbook change, or recurring gotcha | `docs/OPS.md`, `docs/ops/<slug>.md`, or `docs/ops/incidents/<symptom>.md` | Warm |
| Architecture fact, interface contract, or structural choice | `docs/ARCHITECTURE.md`, `docs/reference/<slug>.md`, or ADR if rationale matters | Warm |
| Documentation drift or stale guidance found while working | Fix in place, or move historically useful stale docs to `docs/**/archive/` with archive index | Warm → Cold |
| Bad execution, poor architecture, broken logic, or improvement opportunity discovered | Project issue tracker if configured; otherwise `.ai/memory/open_action_items.md` for active work or `docs/parked/<slug>.md` for deferred work | Hot or Warm |
| Environment/config mismatch without exposing secret values | Relevant runbook/reference doc plus hot action item if still unresolved | Warm (+ Hot if open) |
| Session narrative | append to `.ai/memory/project_state.md`; older sessions archive at session start | Hot → Cold |
| Completed action item with external artifact (PR, comment, email sent) | append to `.ai/memory/archive/action_log.md` | Cold |

**Never store in memory:**

- API keys, tokens, credentials
- Already-shipped rationale without an active next step (extract to ADR instead)
- Auto-derivable info (folder structure, `git log` output)
- Raw transcripts, full stack traces, debug blobs, or complete command output when a concise root cause + evidence is enough

**Finding capture bar.** When an investigation exposes a weakness worth fixing later, capture enough for a structural fix: symptom, evidence, affected paths/systems, current status, likely root cause or competing hypotheses, why the quick workaround is insufficient, proposed long-term fix, and acceptance criteria. Do this immediately for high-value findings if waiting until `/save-point` risks losing the reasoning.

---

## 3. Rollover rules — how hot stays hot

Enforced at `/save-point` time:

1. **`project_state.md` bloat check.** If it covers more than "current + last completed" session, roll the oldest block into `archive/YYYY-MM-DD-sessions-NN-NN.md`. Trim hot file to current + last completed only.
2. **Shipped-item extraction.** For each completed item in `open_action_items.md`:
   - Shipped decision with rationale → promote to new ADR in `docs/decisions/`, archive raw source to `archive/source-adr-NNNN-*.md`, delete from `open_action_items.md`.
   - Completed action with external artifact (upstream PR, comment posted, email sent) → append entry to `archive/action_log.md`, delete from `open_action_items.md`.
   - Plain task → just delete from `open_action_items.md`.
3. **In-flight ship/park check.** For each `project_<slug>.md`:
   - Shipped this session → promote to ADR, archive source.
   - No work for 30+ days → move to `docs/parked/<slug>.md` with **Revive when:** trigger, archive source.
4. **Parked-promotion check.** If a parked item's revive trigger fired this session, move it back to `project_<slug>.md` and add to `open_action_items.md`.
5. **Index sync.** Update `MEMORY.md` (hot index) and `archive/ARCHIVE.md` (cold index) whenever files move.

---

## 4. The `archive/action_log.md` convention

Append-only log of completed actions that produced external artifacts. Lives in archive (cold tier) — not auto-loaded, grepped on demand.

**Format per entry:**

```markdown
## YYYY-MM-DD — <short session label>
- **<item-id>** — <what was done> (<external-link>). <one-line why it mattered>.
- **<item-id>** — <what was done> (<external-link>). <one-line why it mattered>.
```

**What qualifies:**

- Upstream issue/PR posted to an external repo
- Email/message sent to a named recipient
- External API action with a durable result URL
- External reservation/booking/registration

**What does NOT qualify** (don't pollute the log):

- Internal code edits (that's what `git log` is for)
- File reorganization (captured by session narrative)
- Session-internal decisions (that's ADR territory)

---

## 5. `/save-point` — preview-confirm-execute contract

When `/save-point` is invoked in tier mode, the skill enforces this contract:

### Step A — Scan

Inventory this session's work into these buckets:

- New behavioral rules → candidate `feedback_*.md` entries
- Shipped decisions → candidate ADRs
- New in-flight work → candidate `project_*.md` entries
- Parked/deferred → candidate `docs/parked/` entries
- Structural findings / weak spots → candidate issue, action item, parked item, ADR, or reference/runbook update
- Operational lessons / runbook changes → candidate `docs/ops/` updates or incident notes
- Documentation drift → candidate fix-in-place or cold archive move
- Environment/config mismatches → candidate reference/runbook update plus active action item if unresolved
- Completed external actions → candidate `action_log.md` appends
- Session narrative → append target for `project_state.md`
- Rollover candidates → `project_state.md` bloat, 30+ day inactivity, etc.

### Step B — Preview (single block)

Produce ONE preview block listing every proposed change. Example:

```
Proposed changes for /save-point:

NEW FILES:
- .ai/memory/feedback_<slug>.md  ← "<one-line rule>"
- docs/decisions/ADR-0015-<slug>.md  ← promoted from project_<slug>.md
- .ai/memory/archive/2026-04-24-session-47.md  ← rolled from project_state.md

APPENDS:
- .ai/memory/archive/action_log.md  ← F3, F4, F5 completion entries
- .ai/memory/project_state.md  ← session 47 block

MOVES:
- project_<slug>.md  →  archive/source-adr-0015-<slug>.md (ADR source)

DELETIONS:
- .ai/memory/open_action_items.md F3/F4/F5 blocks (after action_log append)

SKIP (uncommitted edits — commit or stash first):
- .ai/memory/feedback_something.md

Confirm? (y/n)
```

### Step C — Safeguards (before executing)

- **Git-dirty check.** For each file to MOVE or DELETE FROM, run `git status --porcelain -- <file>`. If dirty, list under "SKIP" in preview and do not touch. New files (Write-only) are not affected.
- **Never delete file contents irrecoverably.** Deletions only apply to *sections within* files (e.g. F3 block in `open_action_items.md`). Whole-file removal requires explicit user instruction.
- **ADR number collision guard.** Before assigning `ADR-NNNN`, run `ls docs/decisions/ADR-*.md` and pick `highest + 1`.
- **Idempotent on re-run.** If user re-runs save-point without new work, preview shows "no changes proposed."

### Step D — Execute

On `y`, execute in this order:

1. Writes (new files) — safe, adds only
2. Appends (existing files get new content) — safe, adds only
3. Moves (source-adr archival, session rollover) — use git-aware moves where possible
4. Deletions (section removal from `open_action_items.md`) — only after corresponding appends succeed

On `n`, abort with zero file changes.

### Step E — Report

Print concise summary: what was written, appended, moved, deleted. Include ADR numbers assigned.

---

## 6. `/load-point` — orientation contract

When `/load-point` is invoked in tier mode, load in this order (stop early if user's task is clear):

1. `.ai/MEMORY-MAP.md` — memory contract, tiers, and project-specific routing notes
2. `.ai/memory/MEMORY.md` — hot index
3. `.ai/memory/open_action_items.md` — full file; what's actionable now
4. `.ai/memory/project_state.md` — current + last completed session only (trimmed)
5. `docs/ARCHITECTURE.md` + `docs/OPS.md` — only if task touches architecture or operations
6. Specific ADRs / parked docs / reference — only when current task makes them relevant

**Do not auto-re-read `feedback_*.md` files.** They are visible via `MEMORY.md` index and fire when relevant; re-reading bulks context without benefit.

**Verify state is current.** Before presenting orientation:

- `git status` — do uncommitted changes listed in state still exist?
- `git log --oneline -5` — commits after last saved session?
- Key file spot-check — do referenced paths still exist?

**Present brief summary** (4 lines max):

```
**Last session (<date>):** <1-sentence summary>
**Next up:** <immediate next action>
**Prerequisites:** <env vars, services, or "none">
**Open items:** <urgent blockers, if any>
```

State conflicts with git? Tell the user; trust git; do not silently act on stale state.

---

## 7. `init` action — scaffold into a new project

Invoked when user calls the skill with "init" as argument (`Skill(name='strata', args='init')`) or explicitly asks to set up tier memory in a project.

### Preconditions

1. Current working directory is the target project root.
2. Project has a git repo (run `git rev-parse --is-inside-work-tree`; error out if not).
3. **Idempotence guard.** If `.ai/memory/MEMORY.md` OR `.ai/MEMORY-MAP.md` already exists, refuse: "Project already initialized. Existing memory at <path>. If you want to re-bootstrap, move or delete the existing files first."
4. **Legacy guard.** If `.claude/memory/MEMORY.md`, `docs/PROJECT-MAP.md`, or a tool-owned per-project memory directory exists, do not create a second memory silently. Report the legacy location and offer a migration into `.ai/`.

### Questions to ask (single `AskUserQuestion` call)

1. **Project name** (free text) — used as `<Project>` in all template headers.
2. **Project type**:
   - "Code project (has `docs/decisions/` ADRs + `docs/parked/`)"
   - "Knowledge/ops project (no ADRs; just memory + reference)"

### Files to write

Templates live in this skill's `templates/` directory. For each target, read the template, substitute placeholders, and write to the target path:

| Template (skill dir) | Target (project dir) |
|---|---|
| `templates/MEMORY.md` | `.ai/memory/MEMORY.md` |
| `templates/open_action_items.md` | `.ai/memory/open_action_items.md` |
| `templates/project_state.md` | `.ai/memory/project_state.md` |
| `templates/ARCHIVE.md` | `.ai/memory/archive/ARCHIVE.md` |
| `templates/action_log.md` | `.ai/memory/archive/action_log.md` |
| `templates/MEMORY-MAP.md` | `.ai/MEMORY-MAP.md` |
| `templates/AGENTS.md` | `AGENTS.md` (Codex adapter; write only if absent) |
| `templates/CLAUDE.md` | `CLAUDE.md` (Claude adapter; write only if absent) |
| `templates/GEMINI.md` | `GEMINI.md` (Gemini adapter; write only if absent) |

**Placeholders to substitute:**

- `{{PROJECT_NAME}}` → value from question 1 (user-supplied)
- `{{INIT_DATE}}` → today in `YYYY-MM-DD` format (from `date +%Y-%m-%d`)

**Tool adapter writes:** For `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`, write the template only when the target file does not exist. If an adapter already exists, leave it unchanged and list it under "Existing adapters left unchanged" in the report. Adapter files are primers only; they point to `.ai/MEMORY-MAP.md` and must not contain separate project memory.

If code project type was chosen:
- create empty `docs/decisions/` directory (e.g. `mkdir -p docs/decisions && touch docs/decisions/.gitkeep`)
- create empty `docs/parked/` directory (same)

### Post-write report

Print exactly:

```
strata initialized in <cwd>.

Created:
- .ai/memory/ (hot tier: MEMORY.md, open_action_items.md, project_state.md)
- .ai/memory/archive/ (cold tier: ARCHIVE.md, action_log.md)
- .ai/MEMORY-MAP.md (tier map + routing rules)
- AGENTS.md / CLAUDE.md / GEMINI.md adapters that were absent
<+ docs/decisions/ and docs/parked/ if code project>
<+ Existing adapters left unchanged: ... if any already existed>

Next steps:
- At end of session, run /save-point (will now route by tier)
- At start of session, run /load-point (will orient from hot tier only)
- Edit .ai/MEMORY-MAP.md to describe your project (What it is, Structural overview)
```

---

## 8. Common mistakes (both modes)

| Mistake | Fix |
|---|---|
| Restating routing rules in save-point.md or tool adapter files | Rules live HERE. Tool adapters point at `.ai/MEMORY-MAP.md`. |
| Executing save-point moves without preview | Preview is non-optional. One preview block, one y/n. |
| Re-reading `feedback_*.md` during /load-point | Skip. They're index-referenced, not context-loaded. |
| Bulk-loading all ADRs during /load-point | Only load ADRs when the current task makes them relevant. |
| Leaving DONE entries in open_action_items.md | That's what `action_log.md` is for. Migrate at save-point. |
| Deleting instead of archiving | Cold tier exists so misclassification is recoverable. Move, never delete. |
| Capturing only `project_state.md` while docs/runbooks/ADRs are now wrong | Update the durable owner in warm docs; state files are not a substitute for docs. |
| Saving vague findings like "architecture needs cleanup" | Capture evidence, paths, root-cause hypothesis, structural fix direction, status, and acceptance criteria. |
| Hiding a discovered problem because it is not part of the original task | Capture it as a finding or deferred item while context is fresh; do not let it vanish. |
| New ADR with colliding number | Scan `docs/decisions/` first; pick `highest + 1`. |
| `init` over an existing setup | Refuse. User must migrate, move, or delete existing memory first. |

---

## 9. Relationship to other memory skills

- **`remember:remember`** — single `.remember/remember.md` handoff note. Orthogonal; fine to use alongside for single-session breadcrumbs.
- **`atlas-memory`** — SQLite + vector search. Orthogonal; fine if the project needs semantic recall over many notes.
- **`agentdb-memory-patterns`** — HNSW vector store + reinforcement learning. Heavier; overlaps only if you want neural pattern recall.

`strata` is the **structural pattern** (where things live, when they move). The others are **storage backends** (how things are indexed / retrieved). They do not conflict.
