---
name: strata
description: 3-tier project memory (hot/warm/cold) with a unified issues backlog, operation-keyed learnings, generated indexes, immediate capture, and one-shot project initialization under .strata/. Invoke with no argument for rule lookup, "capture" to save a fresh finding/gotcha right away, or "init" to scaffold or migrate existing flat/0.0.1/0.0.2 memory without losing provenance. Used by /strata:save, /strata:load, and /strata:capture as the authoritative source of tier definitions and routing rules.
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion]
---

# Strata — universal project memory

The **single source of truth** for the strata 0.0.3 pattern. Project memory is owned by the repo under `.strata/`, not by Claude, Codex, Gemini, or any other tool; `AGENTS.md`/`CLAUDE.md` are thin adapters pointing at `.strata/MANIFEST.md` and hold no separate memory.

This file is operational rules only. Depth lives elsewhere — link, don't restate:
**how it all works** → [docs/DESIGN.md](https://github.com/belousov-petr/strata/blob/main/docs/DESIGN.md) · **why** → [docs/decisions/](https://github.com/belousov-petr/strata/blob/main/docs/decisions/README.md) · **upgrades** → [MIGRATIONS.md](https://github.com/belousov-petr/strata/blob/main/MIGRATIONS.md)

Three entry points: **rule lookup** (default — commands read §§1–7 for decisions), **`capture`** (write a fresh finding/gotcha before context decays, §5), and **`init`** (scaffold or migrate a project, §8).

**Invocation.** The skill's canonical name is `strata`; Codex and other tools call `Skill(name='strata', …)`. Installed as the Claude Code plugin, commands and skill are namespaced under the plugin name — the commands are `/strata:init`, `/strata:save`, `/strata:load`, `/strata:capture`, and the skill is `Skill(name='strata:strata', …)`. Slash-command references below use the plugin form.

**The strata script.** `strata <subcommand>` in this file means `node "${CLAUDE_SKILL_DIR}/scripts/strata.mjs" <subcommand>`. Claude Code fills in `${CLAUDE_SKILL_DIR}`; in Codex and other tools, use the folder that holds this `SKILL.md`. It needs only Node, and its subcommands are listed in §12.

---

## 1. Tiers and stores

| Tier | Where | When loaded |
|---|---|---|
| **Hot** | `.strata/memory/` + `.strata/issues/ACTIVE.md` | Session start |
| **Warm** | `.strata/docs/` + individual `issues/*.md` | On demand, by task |
| **Cold** | `.strata/memory/archive/` + `.strata/issues/archive/` | Explicit history search only |

One routing key per store: `project_state.md` = recency ("what was I doing"), `learnings/` = operation ("what do I know about doing this"), `issues/` = status ("what work exists"), `docs/` = topic ("what is true and why"), `archive/` + `action_log.md` = time ("what happened"). Derivable knowledge (code, `git log`, folder structure) gets **no store**.

**Budgets (hard):** `MEMORY.md` ≤80 lines · `project_state.md` ≤200 lines, current + last completed session only. Warm and cold are unbudgeted — depth is free off the hot path.

**Contract file.** `.strata/MANIFEST.md` (with `layout_version: 3`) is the *only* per-project file stating structure and routing. `MEMORY.md` is a pure index: live pointers + the generated rules-by-trigger table — the **hot subset** of learnings (§4); the complete list is `learnings/INDEX.md`. Never re-add routing tables to it.

**Portability.** Project-relative paths only (`.strata/...`); no machine-specific absolute paths, usernames, or single-OS commands in memory — give PowerShell and POSIX variants when a saved command matters on both.

## 2. Routing — where new knowledge goes

| You produced / discovered | Write to | When |
|---|---|---|
| Finding, bug, improvement, debt, task, feature, initiative | `issues/<id>-<slug>.md`, status `open`, full rationale + diagnostics | **Immediately, mid-session** |
| Deferred work | same file, status `parked` + `revive-when:` | at capture or triage |
| Behavioral lesson (worked or burned you) | `memory/learnings/<slug>.md` | at `/strata:save`, `/strata:capture`, or immediately if hard-won |
| Shipped decision with non-obvious rationale | `docs/decisions/ADR-NNNN-<slug>.md` + source → `memory/archive/source-adr-NNNN-*` | **immediately when settled** (§5), or at `/strata:save` |
| Product requirement / PRD | `docs/product/<slug>.md` | when it exists |
| How a subsystem works | `docs/architecture/<slug>.md` + row in `docs/ARCHITECTURE.md` | when it stabilizes |
| Stable fact (paths, schemas, APIs, conventions) | `docs/reference/<slug>.md` | on second lookup |
| Procedure, runbook, incident pattern | `docs/ops/…` (`incidents/<symptom>.md`, `release-rollback.md`) | when it changes |
| Session narrative | `memory/project_state.md`, rollover → `archive/` | at `/strata:save` |
| Completed action with external artifact (PR, email, durable URL) | `memory/archive/action_log.md` append | at `/strata:save` |
| A doc this session made wrong | fix in place; *retired* docs → `docs/_archive/` | at `/strata:save` |

**Never store:** secret values (env-var *names* only); anything derivable from code/`git log`; raw transcripts, full stack traces, command dumps — concise root cause + evidence instead; shipped rationale with no next step outside an ADR.

**Discriminators:** a *rule* fires at an operation → learning; a *procedure* is steps you execute → ops; a *fact* is something you look up → reference. An *issue* can close; a *learning* outlives every issue that taught it. *State* is where you stand; anything with its own lifecycle is an issue.

## 3. Issues — the single backlog

States and types (canonical, defined here and in MANIFEST/DESIGN, reused verbatim):

- **Types:** `bug | improvement | debt | task | feature | initiative`
- **Statuses:** `open | in-progress | parked | resolved | wont-fix`
- **Severity:** `high | med | low`

Operational rules:

1. **Capture immediately and completely.** The moment a finding surfaces mid-task: journal it (§5), or write `issues/<id>-<slug>.md` (id `YYYYMMDD-NN`, allocated by `strata new-issue`, which checks other branches and worktrees) from `_TEMPLATE.md`: What/Why, and for bugs Tried/Error/Hypothesis/Repro *at capture time*, status `open`, then return to the task. Compaction cannot eat what is on disk. Don't fix it unless it blocks the current task.
2. **Status changes are frontmatter edits.** No file moves while an item is alive.
3. **`parked` requires a concrete `revive-when:`** trigger; `/strata:save` checks triggers against the session and revives matches.
4. **Closing** fills **Resolution** (link the ADR/learning if the close produced durable knowledge); `resolved`/`wont-fix` files move to `issues/archive/` at the next `/strata:save`.
5. **Dedup at triage:** fold new evidence into an existing item instead of filing a near-duplicate.
6. **Views are generated, never hand-edited:** `ACTIVE.md` (in-progress), `OPEN.md` (open, by area, severity first), `PARKED.md` (+triggers) — regenerated from frontmatter at every `/strata:save`.

## 4. Learnings — operation-keyed behavioral memory

One lesson per `memory/learnings/<slug>.md`:

```
---
trigger: <when this applies — operation-keyed>
applies-when: <glob/area, optional>
origin: success | failure
hot: <true|false, optional — true loads the rule into MEMORY.md every session>
---
**Lesson:** <1–3 sentences>
```

- Capture **failures and successes** — a pitfall with its counterfactual fix is the highest-value item.
- `learnings/INDEX.md` (every learning) and the `MEMORY.md` rules-by-trigger table (the **hot subset**) are regenerated from frontmatter at `/strata:save`.
- **Hot subset.** The MEMORY table lists learnings marked `hot: true` — the broad/frequent rules worth loading every session. *Graceful default:* a project with **no** `hot:` flag anywhere keeps all learnings in the table (legacy, unchanged); the first `hot:` flag opts it into filtering. New learnings default `hot: false` (INDEX-only), so the hot table stays bounded as learnings accumulate — promote to `hot: true` only when a rule proves broadly triggered. Never auto-pick the set; `/strata:save` only *flags* an over-budget table and suggests curating (§6E).
- **Adapter block (reaches every agent).** Subagents and Codex read `CLAUDE.md` / `AGENTS.md` but never open `.strata/memory/`, so the same hot subset is mirrored into a generated block between `<!-- strata:hot-rules:begin -->` and `<!-- strata:hot-rules:end -->` in each adapter: one line per rule (trigger, first sentence of the lesson, link). `strata views` and `/strata:save` refresh it; text outside the markers is never touched. Budget 25 rules / 4,000 characters, with an overflow line pointing at `MEMORY.md`.
- **Retrieval discipline:** consult the trigger table, open the one or two matching files at operation time. Never bulk-read the folder; never re-read at load.
- If a lesson needs more than 3 sentences, the surplus is reference or ops material — route it there.

## 5. Immediate capture, before context decays

Invoked via `Skill(name='strata', args='capture')`, `/strata:capture`, or any moment something worth keeping appears mid-task. Capture every important moment the instant it is clear, so the docs grow as you build instead of waiting on session end. Spend tokens now; a compacted-away diagnosis or rationale is more expensive than a one-line write.

**Trigger:** a failed command/tool/API, retry loop, or workaround; surprising repo behavior or a brittle environment step; a bug, finding, or doc drift; a rule future agents should know before an operation; **a decision you settled** (with the rationale and the options you rejected); **a change of direction** that overturns a prior decision or spec; **an operator answer** future sessions need; **how an outside system actually works**; or **a requirement, or the reasoning behind it**.

**Journal first.** The capture is one entry in the pending-capture journal (§5a): `strata journal add --kind <kind> --title "…" --text -` with the full text on stdin. It is instant, git-ignored, needs no commit, survives compaction, and is shared by every worktree of the repo. Kinds: `decision`, `direction`, `answer`, `finding`, `gotcha`, `learning`, `requirement`, `runbook`, `note`. Give decisions and direction changes their lineage (`--lineage "supersedes ADR-0007"`).

**Route at save** (`/strata:save` files each entry; this is where it lands):

- Closeable work -> `issues/<id>-<slug>.md` from `_TEMPLATE.md` (id from `strata new-issue`), with `status: open` or `in-progress`, severity/area, What/Why, Tried/Error/Hypothesis/Repro, evidence, and next action.
- Reusable behavior -> `memory/learnings/<slug>.md`, with operation-keyed `trigger:`, optional `applies-when:`, `origin: success | failure`, and a 1-3 sentence lesson.
- Settled decision with non-obvious rationale -> `docs/decisions/ADR-NNNN-<slug>.md` (number from `strata next-adr`), status `proposed`/`accepted`, with the considered options. A change of direction supersedes the old ADR per `docs/decisions/README.md`: a new ADR, the old one marked superseded, never an in-place rewrite.
- Durable knowledge -> the warm docs: a runbook or how-a-system-works under `docs/ops/` or `docs/architecture/`; a requirement or its reasoning under `docs/product/`.
- Several at once when one moment is more than one of these: e.g. a fixable bug (issue) that also taught a rule (learning).
- Flat mode -> append a concise "Fresh capture" entry to `.strata/memory/project_state.md` under Findings/Gotchas/Open Items.

**Filing early is optional.** When the tree can take a loose file, the agent may write the store file at capture time too, then add the entry with `--filed <path>` so save only checks it. In a repo with a slow commit gate or a commit ban, the journal entry alone is the capture.

**Write discipline:** keep evidence concise; no raw transcript dumps, full logs, or secret values (the journal masks secret-shaped values as a backstop). Capture never regenerates views or the `ARCHITECTURE.md` index; `/strata:save` does.

**Report and resume:** say what was captured (journal id, or the file written), then continue the original task unless the capture reveals a blocker.

**Claude auto memory is not a capture target.** It holds only the pointer `/strata:save` maintains (§11); findings, decisions, and lessons go to the journal.

### 5a. Journal and inbox: the git-ignored capture stage

Two files under `.strata/inbox/`, both git-ignored scratch, both resolved to the **main worktree** of the repository when it holds `.strata/` (so every worktree shares one; outside git, the current project root):

- `journal.jsonl` holds what the agent captured (§5). Entries `{id, ts, kind, title, text, lineage, refs, filed, branch, worktree}`, redacted on write.
- `captures.jsonl` holds what the hook auto-logged: raw tool-result stubs `{ts, event, tool, category, signal, command, snippet, h}`. Categories: `failure` (a shell command that really failed), `policy` (a permission refusal), `tool-error` (a non-shell tool error), `interrupted`. **Raw evidence, not finished memory.**

**Route and clear** (the read side, run by the commands, no extra agent turn):
- `/strata:save`: route every journal entry and every real, repeated, or reusable failure into its store (dedup against the backlog, drop secrets/stack-traces per §2), then `strata journal clear --all` and `strata inbox clear`. The last cleared journal batch stays in `journal.routed.jsonl` until the next clear.
- `/strata:load`: report pending captures first, then the inbox counts by category and any repeated failures (`strata status`).
- A typo, a one-off failure, or a policy refusal is counted, not promoted. Promotion is the authoritative dedup.

## 6. `/strata:save`: preview-execute contract

**A. Scan.** Start from the pending journal (`strata journal list`) and the mechanical plan (`strata save --prepare --dry-run`, which also reports inbox counts, repeated failures, the drift list, parked triggers, and check findings). Sort them and the session into buckets: resumption point · issue events (journal findings, status changes, resolutions, repeated failures) · learnings (both origins) · decision records (journal decisions, direction changes, answers) · durable-doc impact (the drift list is a prompt) · external completions · rollover.

**B. Preview**: ONE block listing every proposed change under `NEW FILES / APPENDS / UPDATES / FROM strata save --prepare / CLEARED / DRIFT / SKIP`, then continue automatically. The preview is an audit record, not a confirmation gate. Empty plan → "no changes proposed", stop.

**C. Safeguards** (before preview):

- **Moves keep content.** Archive moves use `git mv` (or a plain rename when untracked), so uncommitted edits travel with the file and the report says so; a file with an unresolved merge conflict is never moved.
- **Collision-free numbers.** Issue ids from `strata new-issue`, decision numbers from `strata next-adr`: both scan the tree, every worktree, recent branches, and recent reservations.
- **Section-only deletions.** Never remove whole files without explicit instruction.
- **Idempotent.** A re-run with no new work proposes nothing; `strata save --prepare` on an unchanged tree changes nothing.

**D. Execute** immediately after the preview, in order: your writes → appends → updates (frontmatter/status) → `strata save --prepare` (archive moves with `issues/archive/INDEX.md` rows, session rollover with an `ARCHIVE.md` row, **regenerate all views last**: `ACTIVE/OPEN/PARKED`, `learnings/INDEX`, the MEMORY trigger table, the hot-rules blocks; plus the auto-memory pointer and the save marker) → `strata journal clear` + `strata inbox clear` once everything is routed. Sync `MEMORY.md` live pointers by hand. Leave it all for one commit.

**E. Verify & report**: `strata check` passes (budgets §1, vocabularies, unique ids, links, no view drift); the journal is empty; resumption point actionable; hot memory and touched warm docs agree. **If the regenerated `MEMORY.md` would breach ≤80, don't auto-trim; report it and suggest curating the hot subset** (opt in by flagging the most-triggered learnings `hot: true`; the rest stay in `INDEX.md`, §4). Then a concise summary of what went where.

A project that renders views with its own tool sets `generated_views: external` in the `MANIFEST.md` frontmatter; strata then leaves the views alone (the hot-rules blocks are still strata's).

## 7. `/strata:load` — orientation contract

Load order (stop early if the task is already clear):

1. `.strata/MANIFEST.md` (check `layout_version: 3`; a legacy `strata_version: 0.0.3` stamp or any other mismatch → `MIGRATIONS.md`, stop)
2. `.strata/memory/MEMORY.md`
3. `.strata/issues/ACTIVE.md`
4. `.strata/memory/project_state.md` (current + last completed only)

On demand only: `OPEN.md` by area · the specific issue being resumed · warm docs the task touches. **Never auto-load:** learnings files, ADRs in bulk, item files in bulk, `archive/`, `action_log.md`.

**Verify against git** before presenting: `git status` (do listed uncommitted changes exist?), `git log --oneline -5` (commits since last session?), spot-check referenced paths and issue ids. State is a hint; the repo is truth; report conflicts, never silently absorb them.

**Start with `strata status`**: pending journal captures, inbox counts by category with repeated failures, view drift, and a setup hint for projects initialized before 0.1.0.

**Present** ≤8 lines, pending captures first: pending captures · last session · next up (issue id) · active count · prerequisites · fired parked-triggers · inbox counts (failures, repeated, policy) · drift. Then ask: continue or something else?

## 8. `init` — scaffold or migrate a project

Invoked via `/strata:init` (Claude Code), `Skill(name='strata', args='init')` (Codex and other tools), or an explicit ask to set up project memory.

**Preconditions:**

1. CWD is the target project root, inside a git repo (`git rev-parse --is-inside-work-tree`; error out if not).
2. **Existing-memory routing.** Detect before writing:
   - Valid current layout (`.strata/MANIFEST.md` with `layout_version: 3`) → do not re-scaffold. Run `strata setup` instead: it adds what a project initialized before 0.1.0 lacks (the views merge driver and the hot-rules block) and changes nothing else. Report what it did. A full re-bootstrap still requires the user to move/delete the existing memory first.
   - Flat mode (`.strata/memory/project_state.md` exists, with no `.strata/MANIFEST.md` and no `.strata/memory/MEMORY.md`) → run the flat→0.0.3 rung in `MIGRATIONS.md`; never overwrite the flat file in place.
   - 0.0.1/0.0.2 fingerprints — `.claude/memory/`, `docs/PROJECT-MAP.md`, `.ai/` (or `.ai/MEMORY-MAP.md`), `open_action_items.md`, `project_<slug>.md` memory files, `docs/parked/`, or project files referencing the old `/save-point`//`/load-point` commands → run the matching `MIGRATIONS.md` rung(s), not a fresh scaffold.
   - Mixed or partial `.strata/` state that is not the flat fingerprint → stop, report every fingerprint, and ask the user to choose repair/migration; never guess and never overwrite.

**Questions** (single `AskUserQuestion`): project name; project type — "Code project (full `.strata/docs/` taxonomy)" vs "Knowledge/ops project (memory + issues; docs grow later)". During migration, derive these from existing memory when obvious and ask only for missing values.

**Fresh files to write** — templates from this skill's `templates/`, substituting `{{PROJECT_NAME}}` and `{{INIT_DATE}}` (today, `YYYY-MM-DD`) in **every** copied file:

| Template | Target | Condition |
|---|---|---|
| `templates/AGENTS.md` | `AGENTS.md` | only if absent |
| `templates/CLAUDE.md` | `CLAUDE.md` | only if absent |
| `templates/MANIFEST.md` | `.strata/MANIFEST.md` | always |
| `templates/memory/MEMORY.md` | `.strata/memory/MEMORY.md` | always |
| `templates/memory/project_state.md` | `.strata/memory/project_state.md` | always |
| `templates/memory/learnings/{INDEX,_TEMPLATE}.md` | `.strata/memory/learnings/` | always |
| `templates/memory/archive/{ARCHIVE,action_log}.md` | `.strata/memory/archive/` | always |
| `templates/issues/{README,_TEMPLATE,ACTIVE,OPEN,PARKED}.md` + `templates/issues/archive/INDEX.md` | `.strata/issues/` and `.strata/issues/archive/` | always |
| `templates/docs/ARCHITECTURE.md` + `templates/docs/{product,architecture,decisions,reference,ops}/README.md` | `.strata/docs/…` | code projects |
| `templates/inbox/.gitignore` | `.strata/inbox/.gitignore` | always |

After the templates are written, run `strata setup`: it writes the `.gitattributes` block that routes the generated views (and the adapters' hot-rules block) through the `strata-views` merge driver, sets that driver in the clone's local git config, and appends the hot-rules block to adapters that existed before init. Existing adapters are otherwise left unchanged and reported as such. Adapters are pointers plus that one generated block; never write project memory into them. Every other clone of the repo runs `strata setup` once, because git config is not committed.

Migration writes may target the same paths, but source memory is archived first. Flat `project_state.md` becomes `.strata/memory/archive/source-flat-project-state-<date>.md` before a new hot `project_state.md` is written; extracted issues, learnings, and ADRs cite that archive path or the archived section heading. Ambiguous content stays in the archive and gets a triage issue, not a silent drop.

**Report** exactly:

```
strata 0.0.3 initialized in <cwd>.

Created:
- .strata/MANIFEST.md (contract, layout_version: 3)
- .strata/memory/ (MEMORY.md index, project_state.md, learnings/, archive/)
- .strata/issues/ (README, _TEMPLATE, ACTIVE/OPEN/PARKED views, archive/)
- .strata/inbox/ (git-ignored capture scratch: journal + hook inbox)
- .gitattributes block + local merge driver for the generated views (strata setup)
<- .strata/docs/ (ARCHITECTURE.md + product/architecture/decisions/reference/ops) — code projects>
- AGENTS.md / CLAUDE.md adapters that were absent
<- Existing adapters left unchanged: ...>

Next:
- Describe the project in .strata/MANIFEST.md ("What <project> is")
- Work; use /strata:capture for findings/gotchas as they surface
- /strata:save at session end · /strata:load at session start
```

## 9. Versioning and migration

- **Two distinct version numbers, deliberately different formats so they cannot be confused** ([ADR-0013](https://github.com/belousov-petr/strata/blob/main/docs/decisions/ADR-0013-layout-version-integer.md)):
  - **Memory layout** — `layout_version: <integer>` in `MANIFEST.md` frontmatter; a generation counter. This skill writes **`layout_version: 3`** (the generation formerly stamped `strata_version: 0.0.3`; same structure, only the stamp label changed).
  - **Plugin release** — semver via git tags + `plugin.json`/`marketplace.json` (e.g. `0.0.6`), per ADR-0008. A plugin release can ship with no layout change.
- On `init`, any flat/0.0.1/0.0.2 fingerprint — or a legacy `strata_version: 0.0.3` stamp — routes to `MIGRATIONS.md` (detect → gated transform → rollback, per rung) instead of fresh scaffolding. On save/load version mismatch: stop, report, point at `MIGRATIONS.md`. Never double-initialize and never overwrite source memory before archiving it.
- Releases of strata itself: git tags + `CHANGELOG.md` (git-native versioning — no version-archive folders anywhere, one optional `docs/_archive/` for retired docs).

## 10. Common mistakes

| Mistake | Fix |
|---|---|
| Restating routing in commands, adapters, or MEMORY.md | MANIFEST + this skill own it; everything else links |
| Holding a mid-task finding "for save time" | Run `/strata:capture` or write the issue/learning file the moment it surfaces |
| Hand-editing ACTIVE/OPEN/PARKED or INDEX | Edit item frontmatter; views regenerate at save |
| Moving an item file to change its status | Status is frontmatter; files move only on close (→ archive) |
| `parked` without `revive-when:` | A concrete trigger or it isn't parked, it's abandoned |
| Bulk-loading learnings/ADRs/archive at load | Indexes + trigger table exist so you don't |
| Save waits for a y/n gate | One preview block, then execute automatically — invoking `/strata:save` is the confirmation |
| New ADR or issue id that collides with a parallel branch | Take numbers from `strata next-adr` and ids from `strata new-issue`; they scan worktrees, recent branches and reservations |
| Capturing "architecture needs cleanup" | Evidence, affected paths, hypothesis, fix direction, acceptance criteria — in the issue |
| `init` over flat or legacy memory | Migrate via `MIGRATIONS.md`; archive source first, then write 0.0.3 files |

## 11. Relationship to other memory skills

`remember:remember` (single handoff note), `atlas-memory` (SQLite + vectors), `agentdb-*` (vector/RL backends) are storage mechanisms and are orthogonal. Strata is the **structural pattern** — where knowledge lives, when it loads, when it moves. They can coexist; strata files stay plain markdown + grep on purpose.

**Claude Code auto memory holds only a pointer.** Claude keeps a per-repository auto memory (`~/.claude/projects/<encoded repo path>/memory/`, shared by all worktrees). Left alone it becomes a second log that only Claude sees and that drifts from the repo. The rule: it holds one file, `strata-pointer.md`, plus one index line in that folder's `MEMORY.md`, both written and refreshed by `strata save --prepare` (or `strata pointer`) when the folder exists, and nothing else. Findings, decisions, answers, and lessons go to the journal (§5). `STRATA_AUTO_MEMORY_POINTER=0` turns the pointer off; a custom `autoMemoryDirectory` setting is not detected.

## 12. The strata script

`scripts/strata.mjs` in this skill folder runs the mechanical half of strata, the same way every time. Node only, no dependencies, Windows, macOS, and Linux. Every subcommand takes `--root <dir>`; the ones commands parse take `--json`.

| Subcommand | Does |
|---|---|
| `journal add / list / clear` | the pending-capture journal (§5, §5a) |
| `status` | load-time summary: pending captures, inbox counts by category, repeated failures |
| `where` | the project root, the shared root (main worktree), and the inbox path |
| `inbox summary / clear` | hook inbox counts by category and repeated failures; clear after promotion (cursors kept) |
| `views [--check]` | regenerate ACTIVE/OPEN/PARKED, `learnings/INDEX.md`, the MEMORY table and the hot-rules blocks, in a fixed order |
| `views --merge-driver %O %A %B %P` | the git merge driver: merges view rows (and the adapters' hot-rules lines) three ways, renders them in the fixed order, `git merge-file` for the text around them |
| `check [--json]` | budgets, frontmatter vocabularies, unique ids, links, view drift; exit 1 on errors |
| `save --prepare [--dry-run]` | the mechanical save steps (§6D), then a report of what changed and what needs judgment |
| `setup [--dry-run]` | one-time, idempotent: inbox ignore file, `.gitattributes` block, local merge driver, hot-rules block in existing adapters |
| `hot-rules [--check] [--install]` | refresh the hot-rules block in `CLAUDE.md` / `AGENTS.md` (§4); `--install` appends it to adapters that lack it |
| `new-issue --slug <s> [--title --type --severity --area --status --revive] [--dry-run]` | today's next free issue id after scanning the tree, every worktree, recent branch tips and reservations; writes the file from `_TEMPLATE.md` |
| `next-adr [--dir <d>] [--dry-run]` | the next free decision-record number, same scan |
| `drift [--since <rev>]` | commits since the last save (the marker `save --prepare` records) that no decision record, doc, issue, learning, changelog or pending capture mentions by path, folder, hash, branch or id |
| `pointer [--dry-run]` | write or refresh the Claude auto-memory pointer (§11); silent when the folder does not exist |

