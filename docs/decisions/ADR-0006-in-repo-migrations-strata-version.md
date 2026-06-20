# ADR-0006: In-repo migrations keyed off `strata_version`

- **Status:** implemented
- **Date:** 2026-06-09

## Context and Problem Statement

strata has now shipped three incompatible layouts:

- **0.0.1** — tool-tree memory: `.claude/memory/` + `docs/PROJECT-MAP.md`;
- **0.0.2** — universal memory: `.ai/` + `MEMORY-MAP.md` + three adapters, `/save-point` + `/load-point`;
- **0.0.3** — `.strata/` + `MANIFEST.md` + `issues/` + `learnings/` + `.strata/docs/`, `/strata-save` + `/strata-load`.

Projects scaffolded at each generation exist and keep working locally. An agent opening a 0.0.1 or 0.0.2 project must not silently initialize a second memory beside the old one, guess at renames, or — worst — lose content: the 0.0.2→0.0.3 move is *content-bearing* (three legacy work-item stores get extracted into `issues/`, `feedback_*` files become `learnings/`), not a pure rename.

Churn is also the environment's normal state: there is no cross-agent standard for context layouts; upstream mechanisms keep moving (Claude Code merged commands into skills; native `AGENTS.md` support is still an open issue). 0.0.3 will not be the last breaking change, so the migration mechanism itself needs a permanent home.

## Considered Options

1. **No formal migration — exhaustive docs only, or "re-init and copy what matters".**
   Pros: nothing to maintain. Cons: every agent improvises a different migration; extraction steps (the content-bearing ones) silently drop items; no rollback story. Exhaustive docs *reduce* ambiguity but cannot make a destructive transform safe on their own.
2. **External migration document** (kept wherever the author keeps notes).
   Pros: cheap. Cons: not versioned with the thing it migrates; unreachable from a fresh clone; rots independently.
3. **In-repo `MIGRATIONS.md` ladder + a `strata_version` stamp.** *(chosen)*
   Pros: the transform ships with the code it transforms; detection is mechanical (stamp present → exact version; stamp absent → legacy fingerprints); each rung specifies detect → ordered transform → rollback; destructive steps are gated. Cons: must be updated for every future breaking change — which is the point.

## Decision

Option 3.

- `.strata/MANIFEST.md` carries **`strata_version: 0.0.3`**. The layout becomes self-identifying; future tooling can hard-fail on version mismatch instead of misreading structure.
- Root **`MIGRATIONS.md`** holds the ladder: 0.0.1→0.0.2 and 0.0.2→0.0.3, each rung with a detection fingerprint, an ordered transform list (git-aware moves first, content extraction spelled out, index regeneration last), and a rollback note. Migrations run on a backup branch; every step is reversible until the user commits.
- **Destructive migration steps are explicit and gated.** Directory renames, the `open_action_items`/`project_<slug>`/`docs/parked` → `issues/` extraction, and adapter deletion are listed by name in the ladder and require a migration preview-confirm gate. `/strata-save` has since moved to preview-then-autosave.
- The skill's **legacy guard** (init and load) detects 0.0.1/0.0.2 fingerprints — `.claude/memory/`, `docs/PROJECT-MAP.md`, `.ai/`, `open_action_items.md`, `project_<slug>` files, `docs/parked/`, old command names — refuses to double-initialize, and points at the ladder.
- `CHANGELOG.md` records what each version changed; the ladder records *how to get there*. They reference, not duplicate, each other.

## Consequences

- A 0.0.1/0.0.2 project upgrades deterministically, reversibly, and with its content intact — or stays put, also deterministically.
- Version detection costs one file read.
- Future breaking changes inherit an obligation: no layout change ships without its rung in the ladder. That cost is accepted as the price of having users.
- Supersession over deletion, everywhere: like ADRs, old layouts are documented and transformable, never just abandoned.

## Sources

- McGarrah — AI coding agent context files reference (convention churn across tools) — https://mcgarrah.org/ai-coding-agent-context-files-reference/
- Claude Code — the `.claude` directory ("commands and skills are now the same mechanism… for new workflows, use skills/") — https://code.claude.com/docs/en/claude-directory
- Gist (yurukusa) — Claude Code + AGENTS.md (#6235 still open; workarounds, not guarantees) — https://gist.github.com/yurukusa/d36197848911f025add142abefcde685
- MADR — supersede-don't-edit as the precedent for versioned knowledge — https://adr.github.io/madr/
