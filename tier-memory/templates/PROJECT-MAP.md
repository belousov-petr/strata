# PROJECT-MAP — {{PROJECT_NAME}}

**Open this first.** It tells you where everything lives, what goes where, and how `/save-point` should route new knowledge.

Authoritative tier rules live in the `tier-memory` skill; this file is the per-project manifestation.

---

## What {{PROJECT_NAME}} is

_(Replace this section with a 1–3 sentence description of the project — what it does, who it's for, what "done" means.)_

---

## Structural overview

```
<project_root>/
├── CLAUDE.md                            ← auto-loaded session primer (if present)
├── README.md                            ← project setup
├── docs/                                ← VERSIONED HUMAN-READABLE DOCS (warm tier)
│   ├── PROJECT-MAP.md                   ← this file
│   ├── decisions/                       ← ADRs (why decisions were made)
│   ├── reference/                       ← stable reference material
│   └── parked/                          ← deferred initiatives
└── .claude/memory/                      ← project-local hot memory
    ├── MEMORY.md                        ← hot index
    ├── open_action_items.md             ← active work
    ├── project_state.md                 ← session narrative
    └── archive/                         ← cold tier
        ├── ARCHIVE.md                   ← cold index
        └── action_log.md                ← append-only completion log
```

_(Extend this tree with project-specific directories as they develop.)_

---

## Where do I look for X?

| If you need… | Open… |
|---|---|
| Why a decision was made | `docs/decisions/ADR-NNNN-*.md` |
| Current open work | `.claude/memory/open_action_items.md` |
| Parked initiatives | `docs/parked/` |
| Reference material | `docs/reference/` |
| Behavioral rules enforced in-session | `.claude/memory/feedback_*.md` |
| Current session state | `.claude/memory/project_state.md` |
| Historical sessions | `.claude/memory/archive/ARCHIVE.md` |
| Did we post / send / complete X? | `.claude/memory/archive/action_log.md` (grep) |

---

## The three tiers

| Tier | Location | When loaded | Purpose |
|---|---|---|---|
| **Hot** | `.claude/memory/` | Every session (MEMORY.md auto) + on-demand | Active work, current state, evergreen behavioral rules |
| **Warm** | `docs/` | On demand | ADRs, reference, parked initiatives |
| **Cold** | `.claude/memory/archive/` | Only when explicitly searching history | Superseded state, ADR provenance, completion log |

---

## How new information gets captured

- New behavioral rule for Claude → `.claude/memory/feedback_<slug>.md`
- New shipped decision with rationale → `docs/decisions/ADR-NNNN-<slug>.md`
- New in-flight initiative → `.claude/memory/project_<slug>.md`
- New deferred initiative → `docs/parked/<slug>.md`
- New reference material → `docs/reference/<slug>.md`
- New session narrative → append to `project_state.md`; archive older sessions at session start
- **Completed action with external artifact (upstream PR/issue, email sent, comment posted) → append to `.claude/memory/archive/action_log.md` and delete from `open_action_items.md`**

Things that should **never** live in memory:

- Raw API keys, tokens, or credentials
- Full reference material that belongs in `docs/reference/`
- Already-shipped rationale without an active next step
- Auto-derivable information such as folder structure or git history

---

## `/save-point` behavior

Governed by the `tier-memory` skill §5. Preview-confirm-execute gate: Claude proposes a single plan of moves/writes/appends/deletions, user confirms with y/n, then execution.

---

## `/load-point` behavior

Governed by the `tier-memory` skill §6. Tier-mode load order:

1. `MEMORY.md`
2. `open_action_items.md`
3. `project_state.md` (current + last completed only)
4. `docs/PROJECT-MAP.md` (this file) if layout is unfamiliar
5. Specific ADRs / parked docs / reference — only when the current task makes them relevant

Do not bulk-load ADRs, `feedback_*.md`, or anything under `archive/`.
