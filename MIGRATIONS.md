# MIGRATIONS — moving a project between strata layout generations

Strata stamps every scaffolded `.strata/MANIFEST.md` with a `strata_version`. This file is the ladder between generations: how each layout is detected, the ordered transform to the next one, and how to back out. No breaking layout change ships without a rung here ([ADR-0006](docs/decisions/ADR-0006-in-repo-migrations-strata-version.md)).

Migrations are **agent-runnable but human-gated**: every rung uses the same preview-confirm gate as `/strata-save` — one plan, one y/n, then execution. Destructive steps are named per rung; nothing destructive happens outside that list.

## Version detection

Check in this order; first match wins.

| Generation | Fingerprint |
|---|---|
| **v3** | `.strata/MANIFEST.md` exists and contains `strata_version: 3` |
| **v2** | `.ai/MEMORY-MAP.md` exists |
| **v1** | `docs/PROJECT-MAP.md` exists, or `.claude/memory/MEMORY.md` exists (project-local tool tree) |
| none | none of the above — fresh project; use `strata init`, not migration |

Mixed fingerprints (e.g. both `.ai/` and `.strata/`) mean an aborted migration or a hand-rolled hybrid: **stop, report what was found, let the human decide.** Never initialize a second memory beside an existing one.

v1 note: v1-era hot memory sometimes lived in the *tool's* tree outside the repo (`~/.claude/projects/<project>/memory/`). If the repo fingerprint is v1 but the memory files are tool-side, copy them into the repo first — the migration operates on repo-owned files only.

## Rules for every rung

1. **Clean tree required.** `git status` must be clean; commit or stash first.
2. **Backup branch first.** `git branch pre-strata-v<N>-migration` before any write. This is the rollback anchor.
3. **Preview-confirm gate.** Full plan (renames, extractions, deletions) shown before anything executes; `n` aborts with zero changes.
4. **`git mv` for renames** so history follows content.
5. **Extraction before deletion.** Content-bearing steps write the new files and archive the source *before* removing the original; a crash mid-migration loses nothing.
6. **Rollback.** Before committing: `git reset --hard && git clean -fd` (the plan lists any untracked files created, so `clean` is informed, not blind). After committing: the backup branch still holds the pre-migration state — `git reset --hard pre-strata-v<N>-migration` or cherry-pick forward.
7. **One commit per rung**, message `chore(strata): migrate v<N-1> layout to v<N>`.

---

## Rung 1: v1 → v2

**Detect:** `docs/PROJECT-MAP.md` or `.claude/memory/MEMORY.md`; no `.ai/`, no `.strata/`.

**Destructive steps:** D1 move of the memory directory; D2 rename of the map file.

**Transform (ordered):**

1. Preflight per the rules above (backup branch `pre-strata-v2-migration`).
2. *(D1)* `git mv .claude/memory .ai/memory` — or, if memory is tool-side, copy it to `.ai/memory/` and leave the tool tree untouched.
3. *(D2)* `git mv docs/PROJECT-MAP.md .ai/MEMORY-MAP.md`; rewrite the header to the v2 contract form (tiers, routing, load order).
4. Write thin adapters `AGENTS.md` / `CLAUDE.md` if absent, pointing at `.ai/MEMORY-MAP.md`.
5. Fix internal path references in `MEMORY.md` and `project_state.md` (`.claude/memory/` → `.ai/memory/`, `PROJECT-MAP` → `MEMORY-MAP`).

**Rollback:** rules above; the rung is two renames plus rewrites — `git reset --hard pre-strata-v2-migration` restores everything.

A v1 project should normally run rung 1 and rung 2 in the same sitting (two commits); there is no reason to stop at v2 today.

---

## Rung 2: v2 → v3

**Detect:** `.ai/MEMORY-MAP.md` exists; no `.strata/`.

**Destructive steps (named, all gated):**

- **D1** — rename `.ai/` → `.strata/`
- **D2** — rename `MEMORY-MAP.md` → `MANIFEST.md` (content rewritten to the v3 contract)
- **D3** — extract `open_action_items.md` + `project_<slug>.md` + `docs/parked/*` into `issues/`, then delete the originals (sources archived first)
- **D4** — convert `feedback_*.md` into `learnings/`, then delete the originals
- **D5** — move strata-managed warm docs into `.strata/docs/`
- **D6** — delete `GEMINI.md` (optional; ask)

**Transform (ordered):**

1. **Preflight** per the rules (backup branch `pre-strata-v3-migration`).
2. *(D1)* `git mv .ai .strata`.
3. *(D2)* `git mv .strata/MEMORY-MAP.md .strata/MANIFEST.md`; rewrite to the v3 contract from the skill's `templates/MANIFEST.md`: `strata_version: 3`, project description carried over, structural overview, where-to-look, tiers, routing, load order, canonical states/types. Project-specific notes from the old map are preserved, not regenerated.
4. **Create the backlog skeleton:** `.strata/issues/` with `README.md`, `_TEMPLATE.md`, `ACTIVE.md`, `OPEN.md`, `PARKED.md` from templates, plus `issues/archive/`.
5. *(D3a)* **Extract `open_action_items.md`:** one `issues/<id>-<slug>.md` per item. Mapping: findings/structural-fix sections → `type: improvement` (or `bug` if it describes broken behavior); time-bounded and in-flight sections → `type: task`; blockers → `type: task`, `severity: high`; "do-not-re-raise" notes → `status: wont-fix` items in `issues/archive/` (they exist to be greppable, not active). `area:` best-effort from the item text; `created:` from the item's date or today. Archive the whole original to `.strata/memory/archive/source-issues-extraction-open-action-items.md`, then delete it.
6. *(D3b)* **Extract `project_<slug>.md` files:** each becomes `issues/<id>-<slug>.md` with `type: initiative`, `status: in-progress` (it was hot) — body carries the initiative content. Originals → `archive/source-issues-extraction-<slug>.md`, then deleted.
7. *(D3c)* **Extract `docs/parked/*.md`:** each becomes an issue with `status: parked`; `revive-when:` carries the file's "Revive when:" trigger verbatim. Originals → `archive/source-issues-extraction-parked-<slug>.md`; `docs/parked/` removed.
8. *(D4)* **Convert `feedback_*.md` → `memory/learnings/<slug>.md`:** `trigger:` distilled from the rule's "How to apply" (operation-keyed — *when* does this fire); `applies-when:` if the rule named a scope; `origin: failure` for correction-born rules (most), `success` where it records an approach that worked; body compressed to a 1–3 sentence **Lesson**. Originals deleted after conversion (git history keeps them).
9. **Create `learnings/INDEX.md` + `_TEMPLATE.md`** if step 8 didn't already.
10. *(D5)* **Move strata-managed docs** into `.strata/docs/`: `docs/decisions/` → `.strata/docs/decisions/`, `docs/reference/` → `.strata/docs/reference/`, `docs/ops/` → `.strata/docs/ops/`, `docs/ARCHITECTURE.md` → `.strata/docs/ARCHITECTURE.md`, `docs/OPS.md` → `.strata/docs/ops/README.md` (or `ops/runbook.md` if a README exists). **Judgment call, shown in the preview:** docs that are the project's *public/product* documentation stay at root `docs/` — only the strata-managed memory-adjacent docs move.
11. **Adapters:** rewrite `AGENTS.md` / `CLAUDE.md` pointers `.ai/MEMORY-MAP.md` → `.strata/MANIFEST.md`. *(D6)* `GEMINI.md`: offer deletion (point Gemini at `AGENTS.md` via `settings.json` `"context": {"fileName": ["AGENTS.md","GEMINI.md"]}` or an import line) or, if the user keeps it, update its pointer.
12. **`MEMORY.md` → pure index** (≤80 lines): live pointers + rules-by-trigger table; routing/tier content dropped (MANIFEST owns it now).
13. **Path sweep:** fix `.ai/` references inside `project_state.md`, `ARCHIVE.md`, and any moved docs.
14. **Regenerate views:** `ACTIVE.md`/`OPEN.md`/`PARKED.md` from the new issue frontmatter; `learnings/INDEX.md`; the `MEMORY.md` by-trigger table.
15. **Verify:** `grep -rn "\.ai/\|open_action_items\|MEMORY-MAP\|docs/parked" --include="*.md" .` over the project — expect matches only under `.strata/memory/archive/` (provenance). Confirm `MANIFEST.md` carries `strata_version: 3`.
16. **Commit** `chore(strata): migrate v2 layout to v3`.

**User-side (outside the repo, once per machine):** remove the old commands `~/.claude/commands/save-point.md` and `load-point.md`; install `strata-save.md` and `strata-load.md`; refresh the skill copy at `~/.claude/skills/strata/`. See the README's install section.

**Rollback:** rules above. The content-bearing steps (5–8) archive every source before deleting, so even a partially-applied, committed migration loses nothing — the originals are in `archive/source-issues-extraction-*` and in git history; `pre-strata-v3-migration` holds the full v2 state.

---

## Future rungs

v4, if it ever exists, gets detected by `strata_version` alone (one file read), and its rung documents detect → transform → rollback in this same shape before anything ships. That is the standing rule, not an aspiration.
