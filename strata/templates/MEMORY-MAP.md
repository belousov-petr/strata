# MEMORY-MAP — {{PROJECT_NAME}}

**Open this first.** It is the project-owned memory contract for every AI tool working in this repo.

Authoritative tier rules live in the `strata` skill; this file records the project-specific locations, loading order, and routing notes. Tool adapters (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) should point here and should not contain separate memory.

---

## What {{PROJECT_NAME}} is

_(Replace this section with a 1–3 sentence description of the project — what it does, who it's for, what "done" means.)_

---

## Structural overview

```
<project_root>/
├── AGENTS.md                            ← Codex adapter (if present)
├── CLAUDE.md                            ← Claude adapter (if present)
├── GEMINI.md                            ← Gemini adapter (if present)
├── README.md                            ← project setup
├── .ai/
│   ├── MEMORY-MAP.md                    ← this file
│   └── memory/                          ← project-local hot memory
│       ├── MEMORY.md                    ← hot index
│       ├── open_action_items.md         ← active work
│       ├── project_state.md             ← session narrative
│       └── archive/                     ← cold tier
│           ├── ARCHIVE.md               ← cold index
│           └── action_log.md            ← append-only completion log
├── docs/                                ← VERSIONED HUMAN-READABLE DOCS (warm tier)
│   ├── decisions/                       ← ADRs (why decisions were made)
│   ├── reference/                       ← stable reference material
│   └── parked/                          ← deferred initiatives
└── ...
```

_(Extend this tree with project-specific directories as they develop.)_

---

## Where do I look for X?

| If you need… | Open… |
|---|---|
| Why a decision was made | `docs/decisions/ADR-NNNN-*.md` |
| Current open work | `.ai/memory/open_action_items.md` |
| Parked initiatives | `docs/parked/` |
| Reference material | `docs/reference/` |
| Behavioral rules enforced in-session | `.ai/memory/feedback_*.md` |
| Current session state | `.ai/memory/project_state.md` |
| Historical sessions | `.ai/memory/archive/ARCHIVE.md` |
| Did we post / send / complete X? | `.ai/memory/archive/action_log.md` (grep) |

---

## The three tiers

| Tier | Location | When loaded | Purpose |
|---|---|---|---|
| **Hot** | `.ai/memory/` | Every session (MEMORY.md auto) + on-demand | Active work, current state, evergreen behavioral rules |
| **Warm** | `docs/` | On demand | ADRs, reference, parked initiatives |
| **Cold** | `.ai/memory/archive/` | Only when explicitly searching history | Superseded state, ADR provenance, completion log |

---

## How new information gets captured

- New behavioral rule for the agent → `.ai/memory/feedback_<slug>.md`
- New shipped decision with rationale → `docs/decisions/ADR-NNNN-<slug>.md`
- New in-flight initiative → `.ai/memory/project_<slug>.md`
- New deferred initiative → `docs/parked/<slug>.md`
- New reference material → `docs/reference/<slug>.md`
- New session narrative → append to `project_state.md`; archive older sessions at session start
- **Completed action with external artifact (upstream PR/issue, email sent, comment posted) → append to `.ai/memory/archive/action_log.md` and delete from `open_action_items.md`**

Things that should **never** live in memory:

- Raw API keys, tokens, or credentials
- Full reference material that belongs in `docs/reference/`
- Already-shipped rationale without an active next step
- Auto-derivable information such as folder structure or git history

---

## `/save-point` behavior

Governed by the `strata` skill §5. Preview-confirm-execute gate: the agent proposes a single plan of moves/writes/appends/deletions, user confirms with y/n, then execution.

---

## `/load-point` behavior

Governed by the `strata` skill §6. Tier-mode load order:

1. `.ai/MEMORY-MAP.md` (this file)
2. `.ai/memory/MEMORY.md`
3. `.ai/memory/open_action_items.md`
4. `.ai/memory/project_state.md` (current + last completed only)
5. Specific ADRs / parked docs / reference — only when the current task makes them relevant

Do not bulk-load ADRs, `feedback_*.md`, or anything under `archive/`.
