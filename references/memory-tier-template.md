# Memory Tier Template

Three-tier pattern for keeping Claude Code memory lean and a companion `docs/` tree readable.

## The problem it solves

Memory drifts into a dumping ground. Superseded state snapshots, shipped-initiative specs, one-time incident notes, duplicated decision records - they accumulate. Two side effects:

1. The hot `MEMORY.md` index bloats to dozens of entries, so on-demand memory search returns stale files alongside current ones.
2. The *rationale* for shipped decisions lives only in memory. When those files age out, the "why" evaporates.

The three-tier pattern fixes both by routing each type of knowledge to its correct persistence layer.

## Three tiers

| Tier | Location | When loaded | Contains |
|---|---|---|---|
| **Hot** | `.claude/memory/` (lean) | Every session (`MEMORY.md` auto) + on-demand | Active open items, current session state, in-flight initiatives, evergreen behavioral feedback |
| **Warm** | `docs/` (git-versioned) | On demand | Architecture, ADRs (decision rationale), roadmap, reference, parked initiatives |
| **Cold** | `.claude/memory/archive/` + `docs/**/archive/` | Only when explicitly searching history | Superseded snapshots, old session narratives, ADR provenance, historical incidents |

## Target structure

```
<project>/
├── CLAUDE.md                     # auto-loaded; points at docs/PROJECT-MAP.md
├── docs/
│   ├── PROJECT-MAP.md            # open-this-first orientation doc
│   ├── ARCHITECTURE.md           # system topology, data flow
│   ├── OPS.md                    # optional - lean ops runbook
│   ├── roadmap.md                # no-deadline strategic items
│   ├── decisions/                # ADRs - one file per decision
│   │   ├── README.md             # ADR format guide
│   │   └── ADR-NNNN-<slug>.md
│   ├── reference/                # stable reference material
│   ├── parked/                   # deferred with "Revive when:" triggers
│   └── ops/                      # optional - deep ops + incidents + archive
└── ...

~/.claude/projects/<encoded-path>/memory/
├── MEMORY.md                     # lean index + decision rules
├── open_action_items.md          # actionable work
├── parked_items.md               # keep-in-mind (not active)
├── project_state.md              # current session + last completed ONLY
├── project_<slug>.md             # in-flight initiatives
├── feedback_<slug>.md            # evergreen behavioral rules
└── archive/
    └── ARCHIVE.md                # cold-storage index
```

## ADR format (lightweight)

```markdown
---
status: implemented | parked | superseded | in-progress
date: YYYY-MM-DD
---

# ADR-NNNN: <short title>

## Context
What problem / situation prompted the decision. Constraints that mattered.

## Decision
What we decided.

## Rationale
Why - tradeoffs, alternatives rejected, principle at stake.

## Consequences
Downstream effects - what it makes easier, what it locks us into.

## Related
- Source memory / code paths
- Other ADRs
```

Keep each ADR 40–80 lines. Focus on *why*, not *what* (the "what" is in code).

## Decision rules for routing new knowledge

When saving something new:

1. **Behavioral rule (agent should do X going forward)** → `memory/feedback_<slug>.md` if it modifies in-session behavior; otherwise `docs/reference/`.
2. **Decision just shipped with non-obvious rationale** → `docs/decisions/ADR-NNNN-<slug>.md`. Archive any in-flight memory source to `memory/archive/source-adr-NNNN-*.md`.
3. **In-flight initiative** → `memory/project_<slug>.md` (hot). Promote to ADR on ship.
4. **Deferred initiative (no date)** → `docs/parked/<slug>.md` with **Revive when:** trigger.
5. **Reference material** (paths, brand, frameworks) → `docs/reference/<slug>.md`. Never in memory.
6. **Incident response pattern** → `docs/ops/incidents/<symptom>.md`.
7. **Session narrative** → append to current `project_state.md`; roll older sessions into `memory/archive/` at session start.

Never in memory:

- Raw secrets/keys (use `secret_ref` or env-var names)
- Already-shipped rationale without active next step (it's an ADR)
- Stuff derivable from code / git / filesystem

## Rollover discipline

Applied at `/save-point` and at session start. Codify these in the project's `MEMORY.md`:

1. Feedback memory stays hot only if it changes in-session behavior. Otherwise → `docs/reference/`.
2. Project memory stays hot while in-flight. On ship → ADR + archive source.
3. Project memory becomes parked if deferred >30 days without work. Move to `docs/parked/` with revive trigger.
4. `project_state.md` keeps only current session + last completed. Older → `archive/YYYY-MM-sessions-XX-YY.md` at session start.
5. Reference material never lives in memory.
6. Archive is preserved, not auto-surfaced. Not listed in `MEMORY.md`.

## Setup checklist (new project)

- [ ] Create `docs/` with `decisions/`, `reference/`, `parked/`.
- [ ] Write `docs/PROJECT-MAP.md` using the template at `references/project-map-template.md`.
- [ ] Write `docs/decisions/README.md` with the ADR format.
- [ ] Create `.claude/memory/archive/ARCHIVE.md` as cold-storage index.
- [ ] Write lean `MEMORY.md` listing only hot files + decision rules.
- [ ] Add `## Orientation` section to project `CLAUDE.md` pointing at `docs/PROJECT-MAP.md`.

## Migrating an existing project

If a project has an oversized `project_state.md` or a sprawling memory directory, migrate in phases:

1. **Archive first (reversible).** Create `memory/archive/`. Copy the current `project_state.md` there as a full backup. Trim the hot file to current + last completed.
2. **Extract ADRs.** For each shipped initiative with rationale in memory, write an ADR in `docs/decisions/` and archive the source to `memory/archive/source-adr-NNNN-*.md`.
3. **Migrate reference.** Move paths-and-credentials, framework notes, brand rules to `docs/reference/`. Sanitize any secrets.
4. **Park deferred.** Move stalled initiatives to `docs/parked/<slug>.md` with **Revive when:** triggers.
5. **Rewrite MEMORY.md.** Lean index pointing at hot files + warm docs + archive.
6. **Trim open_action_items.md.** Move no-deadline items to `docs/roadmap.md`. Keep only A-tier + in-flight.
7. **Hook CLAUDE.md.** Add the Orientation section.

The `/save-point` skill can help - in flat mode, it offers to migrate once `project_state.md` passes ~500 lines.
