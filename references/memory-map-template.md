# MEMORY-MAP.md template

Copy this into `.ai/MEMORY-MAP.md` in your project and fill in the blanks. It is the "open-this-first" memory contract - a fresh agent or future-you reads it and knows where everything lives without trawling through 30 memory files.

When you copy it manually, also add the same short orientation note to whatever tool adapters the project uses: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or equivalent. `strata init` scaffolds thin adapter files for Codex, Claude, and Gemini automatically when they are absent.

```markdown
## Orientation
Before memory operations or deep work, consult `.ai/MEMORY-MAP.md` - it defines
the hot/warm/cold tiers, where each type of knowledge belongs, and the
`/save-point` routing rules for this project.
```

Tool adapters are primers only. They point at `.ai/MEMORY-MAP.md`; they do not contain separate memory.

---

```markdown
# MEMORY-MAP - <project name>

**Open this first.** This is the project-owned memory contract for every AI tool working in this repo.

## What <project> is

<3–5 sentences. What it does, who it's for, core components, one sentence on constraints or house style.>

## Structural overview

<Tree diagram of docs/, .ai/memory/, any app-specific directories. One line per folder explaining its role. Cut anything that's derivable from ls.>

## Where do I look for X?

| If you need… | Open… |
|---|---|
| System architecture & pipeline flow | `docs/ARCHITECTURE.md` |
| Why a decision was made | `docs/decisions/ADR-NNNN-*.md` (indexed in `decisions/README.md`) |
| Current open work | `.ai/memory/open_action_items.md` |
| Strategic roadmap (no deadline) | `docs/roadmap.md` |
| Parked initiatives (revive when…) | `docs/parked/` |
| Operations runbook | `docs/OPS.md` |
| Deep ops procedures | `docs/ops/` |
| Agent IDs, file paths, credentials refs | `docs/reference/` |
| Behavioral rules enforced in-session | `.ai/memory/feedback_*.md` |
| Current session state | `.ai/memory/project_state.md` |
| Historical sessions / superseded specs | `.ai/memory/archive/ARCHIVE.md` |
<Add project-specific rows - standards, agent instructions, normative specs, whatever lives outside the default structure.>

## The three tiers

| Tier | Location | When loaded | Purpose |
|---|---|---|---|
| **Hot** | `.ai/memory/` | Every session (MEMORY.md auto) + on-demand | Active work, current state, evergreen behavioral rules |
| **Warm** | `docs/` | On demand | Architecture, ADRs, roadmap, reference, parked |
| **Cold** | `.ai/memory/archive/` + `docs/**/archive/` | Only when searching history | Superseded state, ADR provenance, old session narratives |

## How new information gets captured

When saving new knowledge, route by type:

- **New behavioral rule the agent should follow** → `.ai/memory/feedback_<slug>.md` (hot). 10–25 lines. Includes **Why:** and **How to apply:**.
- **New decision just shipped** → `docs/decisions/ADR-NNNN-<slug>.md` (warm). Archive any in-flight memory source to `.ai/memory/archive/source-adr-NNNN-*.md`.
- **New in-flight initiative** → `.ai/memory/project_<slug>.md` (hot). Promote to ADR on ship.
- **Deferred initiative (no date)** → `docs/parked/<slug>.md` with a **Revive when:** trigger (warm).
- **New reference material** → `docs/reference/<slug>.md` (warm).
- **New incident response pattern** → `docs/ops/incidents/<symptom>.md` (warm).
- **Session narrative** → append to `project_state.md`; roll older sessions into `archive/` at session start.

Never in memory:

- Raw API keys, tokens, credentials
- Full reference/how-to material
- Already-shipped rationale without active next step
- Auto-derivable info (git history, file paths from code, folder structure)

## /save-point playbook

When `/save-point` runs on this project:

1. Scan session for new knowledge. Route via the tree above.
2. If `project_state.md` covers 3+ sessions, roll the oldest to `archive/YYYY-MM-sessions-XX-YY.md`.
3. For each completed `open_action_items.md` entry:
   - Shipped decision → extract ADR, archive source, drop from open_action_items.
   - Plain task → drop from open_action_items.
4. For each in-flight `project_<slug>.md`:
   - Shipped → promote to ADR.
   - 30+ days no work → park with revive trigger.
5. Update `MEMORY.md` index.
6. Update `archive/ARCHIVE.md`.
7. Report: `Saved hot: […]. Extracted to ADR: […]. Parked: […]. Archived: […].`

## /load-point order

Read shallow → deep:

1. `.ai/MEMORY-MAP.md` - this file.
2. `.ai/memory/MEMORY.md` - hot index.
3. `.ai/memory/open_action_items.md` - what's actionable right now.
4. `.ai/memory/project_state.md` - current + last session context.
5. `docs/ARCHITECTURE.md` + `docs/OPS.md` - only if the task touches them.
6. Specific ADRs / parked docs / reference docs - on demand.

**Do NOT** bulk-load all ADRs, all parked items, or the archive.

## Rollover discipline

Codified in `MEMORY.md`:

1. Feedback memory stays hot only if it changes in-session behavior. Otherwise → `docs/reference/`.
2. Project memory stays hot while in-flight. On ship → ADR + archive source.
3. Deferred >30 days with no work → parked doc with revive trigger.
4. `project_state.md` = current + last session only.
5. Reference material never lives in memory.
6. Archive is preserved, not auto-surfaced.
```
