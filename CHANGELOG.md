# Changelog

Notable changes to strata. Releases are git tags on this repo; *layout generations* are `layout_version` stamps (a plain integer) in scaffolded manifests — renamed from `strata_version: 0.0.x` in 0.0.6, see [ADR-0013](docs/decisions/ADR-0013-layout-version-integer.md). When a release breaks the layout, its rung in [`MIGRATIONS.md`](MIGRATIONS.md) ships in the same release.

## 0.3.0 (unreleased)

**Saves that cannot lose a capture, and fewer chores by hand in a big project.** Found in a review of `/strata:save` on a large project on 11 Oct 2026. No memory-layout change: projects stay on `layout_version: 3` and need no migration rung. Adoption steps are in [`MIGRATIONS.md`](MIGRATIONS.md#plugin-030-no-rung-a-few-adoption-steps).

### Added
- **`session_heading:`** in the `MANIFEST.md` frontmatter is a regular expression, case-insensitive, for the `## ` headings of `project_state.md` that start a session block. With it, every matching block is a session, newest first, and save keeps the first two and rolls the rest into `memory/archive/YYYY-MM-sessions-<date>.md` with an `ARCHIVE.md` row. The date is the first one in the rolled headings, or today. Without the key nothing changes. An invalid pattern is a `strata check` error, and save then rolls nothing and says why ([ADR-0029](docs/decisions/ADR-0029-session-heading-pattern.md)).

### Changed
- **`strata journal clear` needs evidence.** Each chosen entry must carry a `filed` path, or at least half of its title words, and at least two, must appear in the uncommitted changes under `.strata/` or `docs/`. Otherwise the clear changes nothing, lists the unproven entries by id and title, and exits 1. `--force` clears anyway and counts the forced entries. Outside git the check is skipped with a warning ([ADR-0028](docs/decisions/ADR-0028-journal-clear-needs-evidence.md)).

## 0.2.0 - 2026-10-10

**Lessons that fire at the moment of the action, and saves that stay short in a big project.** Found over five days of heavy use on a large project: lessons on record that did not show up when they mattered, archive rows written to the wrong file, dozens of journal entries routed by hand, thirty parked triggers per save, an inbox full of `grep` exit codes, and 215 legacy warnings hiding new ones. No memory-layout change: projects stay on `layout_version: 3` and need no migration rung. Adoption steps are in [`MIGRATIONS.md`](MIGRATIONS.md#plugin-020-no-rung-a-few-adoption-steps). Decisions: [ADR-0020](docs/decisions/ADR-0020-operation-triggered-lessons.md) to [ADR-0027](docs/decisions/ADR-0027-capture-rule-in-the-adapters.md).

### Added
- **Operation-triggered lessons.** A learning may carry `match:` (regexes tested against a Bash command) and `paths:` (globs tested against the files an Edit, Write, MultiEdit or Codex `apply_patch` call touches, and against the path-like words of a Bash command). A new `PreToolUse` hook, `hooks/strata-lesson-trigger.mjs`, shows at most three matching lessons as additional context right before the call: title, first sentence, file. It reads a compiled index (`.strata/inbox/lesson-triggers.json`, git-ignored) that `strata views` and `/strata:save` write, and rebuilds it once when the learnings changed. It never blocks or changes a call, is silent when nothing matches, does not repeat a lesson within a session for 30 minutes (`STRATA_LESSON_REPEAT_MINUTES`), and `STRATA_LESSON_TRIGGERS=0` turns it off. Shipped in the Claude plugin's `hooks.json` and in the Codex sample.
- `strata triggers [--command <c>] [--path <p>]` rebuilds the index and shows which lessons would fire. `strata check` reports a pattern that does not compile.
- **`journal add --refs <issue-id> --route append`.** `save --prepare` appends such an entry to the named issue, before its Resolution line, as `**Update <date> (journal <id>):** <title>. <text>`, marks it filed and reports it. Entries without the route stay for judgment.
- **Dated items.** Parked issues may carry `revive-on: YYYY-MM-DD`, live issues `due: YYYY-MM-DD`, and a `revive-when:` text that is only a date counts as one. `strata status` and `save --prepare` list only the dates that have come (and text triggers, as before) and count the future ones. `strata due [--days N]` lists dated items in the next N days, default 7.
- **`strata check --baseline`** writes `.strata/check-baseline.json` with the current warnings. Later runs show only new warnings plus one count line; `--all` shows everything. Errors are never baselined.
- **`archive_index:`** in the `MANIFEST.md` frontmatter names the archive index file, for example `README.md`.

### Changed
- **The archive index.** `save --prepare` appends archive rows to the file `archive_index:` names; without it, to an existing `README.md` or `INDEX.md` in `issues/archive/` that already holds an archive table; otherwise to `INDEX.md`. Rows go after the table's last row, in that table's columns, and no second index is created.
- **Benign exits are counted, not stored.** Exit code 1 from `grep`, `egrep`, `fgrep`, `rg`, `ag`, `test`, `[`, `[[`, `diff`, `cmp`, `command -v` and `which` goes to a count in `.strata/inbox/benign.json` instead of the failure inbox. The guard reads the shell command to see which command set the status, so `npm test && grep x log` still counts as a failure. Benign stubs stored by older versions are read as benign. The four categories are unchanged.
- **Refusals go to the operator.** `strata status` and `save --prepare` list permission refusals, grouped by command, as steps refused for the agent to hand to the operator.
- **The capture rule reaches every agent.** The generated hot-rules block in `CLAUDE.md` and `AGENTS.md` opens with: capture with `strata journal add` (the `/strata:capture` skill), never in a tool's private auto-memory, subagents included. The adapter templates and the `SessionStart` note say the same.
- `PARKED.md` shows `on or after <date>` for a `revive-on` item. `strata check` accepts `revive-on` as a parked item's trigger.
- The frontmatter reader understands lists (`- item` lines or `[a, b]`).

### Fixed
- **The merge driver survives plugin updates.** git config used to name the strata script inside the versioned plugin cache folder, which an update removes; merges of the views then failed until the next save. Setup now points git at a launcher in the clone's git folder (`.git/strata/merge-driver.mjs`) that finds the current install at merge time and falls back to a plain text merge when there is none. `strata status` and `strata check` name a driver whose files are gone.

### Upgrading
- Update the plugin and start a new session. Run `/strata:save` (or `strata views`) once: it regenerates the hot-rules block with the capture rule, writes the lesson-trigger index and moves the merge driver to the launcher. Until then `strata check` reports the hot-rules block as stale.
- Codex: add the new `PreToolUse` entry from `hooks/codex-hooks.sample.json` to your hooks file.
- Optional: `strata check --baseline` in a project with many legacy warnings, `archive_index:` when your archive table lives in another file, and `match:` / `paths:` on the learnings you most need at the moment of the action.

## 0.1.1 - 2026-10-06

**Four fixes found while running `/strata:init` on a large project that renders its own views.** No memory-layout change and no migration. Projects with `generated_views: external` run `/strata:init` once more after updating, so setup can shrink their `.gitattributes` block.

### Fixed
- **The merge driver honours `generated_views: external`.** It used to re-render every view in strata's own table layout during a merge, even when nothing changed, which rewrote the headers, columns and row order of a project's own views. Now setup routes only `CLAUDE.md` and `AGENTS.md` through the driver for such a project, and the driver gives any other view a plain three-way text merge. That also covers clones still carrying the 0.1.0 block.
- **The whole lesson reaches the hot-rules block.** The block took only the first physical line of a `**Lesson:**` paragraph, so a wrapped lesson was cut mid-sentence. It now reads the whole paragraph. A learning with no Lesson line shows its title without the `#` marker.
- **Twenty-five hot rules fit the block.** The 4,000-character budget cut a 25-rule set to about 12 rules, chosen by alphabet, because real rule lines average about 340 characters. The rule cap of 25 is now the limit. Triggers longer than 160 characters are shortened in the block, and a 12,000-character backstop only stops a pathological block.
- **A merge keeps the "N more hot rules" line.** The adapters' row merge dropped that line, so a merged `CLAUDE.md` or `AGENTS.md` differed from a fresh render until the next save.

## 0.1.0 - 2026-10-03

**Capture and save that hold up in big repos: slow commit gates, night commit bans, one worktree per task, parallel branches.** No memory-layout change: projects stay on `layout_version: 3` and need no migration rung. Run `/strata:init` once after updating (it runs `strata setup`; details below). Plan and spec: [`docs/specs/0.1.0-capture-and-save.md`](docs/specs/0.1.0-capture-and-save.md). Decisions: [ADR-0016](docs/decisions/ADR-0016-pending-capture-journal.md) to [ADR-0019](docs/decisions/ADR-0019-hot-rules-in-adapters-and-auto-memory-pointer.md).

### Added
- **Pending-capture journal.** `/strata:capture` appends one dated entry (a decision with its lineage, an operator answer, a finding, a gotcha, a requirement, a runbook note) to `.strata/inbox/journal.jsonl`. The write is instant, git-ignored, needs no commit, and masks secret-shaped values. `/strata:save` routes every entry into its store and clears the journal, keeping the last batch in `journal.routed.jsonl`. `/strata:load` shows the pending count first.
- **The strata script**, `skills/strata/scripts/strata.mjs`: Node only, no dependencies, Windows, macOS and Linux. Subcommands: `journal`, `status`, `where`, `inbox`, `views`, `check`, `save --prepare`, `setup`, `new-issue`, `next-adr`, `drift`, `pointer`, `hot-rules`. The commands call it; judgment stays with the agent.
- **Deterministic save chores.** `strata save --prepare` archives resolved and wont-fix issues with `git mv` and an `issues/archive/INDEX.md` row, rolls old `project_state.md` sessions into a dated archive file with an `ARCHIVE.md` row, regenerates every view, and reports what changed and what needs judgment. `--dry-run` writes nothing. `strata check` validates budgets, frontmatter vocabularies, unique ids, parked triggers, links and view drift.
- **Hot rules reach every agent.** A generated block between `strata:hot-rules` markers in `CLAUDE.md` and `AGENTS.md` lists the `hot: true` learnings (trigger, first sentence, link), because subagents and Codex read the adapters but never `.strata/memory/`. Text outside the markers is never touched. Budget 25 rules and 4,000 characters.
- **Merge-friendly views.** Views render in a fixed order. A `strata-views` git merge driver merges view rows (and the adapters' hot-rules lines) three ways and re-renders them; `strata setup` installs it through `.gitattributes` and the clone's local git config.
- **Collision-free ids.** `strata new-issue` and `strata next-adr` scan the tree, every worktree, recent local and remote-tracking branch tips, and a reservation list before picking a number.
- **Drift list at save.** Commits since the last save that no decision record, doc, issue, learning, changelog or pending capture mentions are listed in the save report (`strata drift`).
- **Claude auto-memory pointer.** Claude Code's per-repository auto memory now holds only `strata-pointer.md` and one index line, which `/strata:save` writes or refreshes when that folder exists. `STRATA_AUTO_MEMORY_POINTER=0` turns it off.
- `.github/workflows/test.yml` runs the lint, the scaffold check and the node tests on Ubuntu, macOS and Windows.
- Templates: `issues/archive/INDEX.md`; the hot-rules markers in the `CLAUDE.md` and `AGENTS.md` templates.

### Changed
- **One inbox and journal per repository.** The hook and the script resolve `.strata/inbox/` to the main worktree whenever it holds `.strata/`, so captures from every worktree land in one place and survive worktree removal.
- **The capture guard decides by real status.** Claude failures come from the new `PostToolUseFailure` hook (`Exit code N`); `PostToolUse` is a success and never logs; transcript results follow `is_error`; Codex rollouts use the exit code; only Codex `PostToolUse`, which has no status, uses a strict line-anchored text fallback. Successful output that merely contains words like "Permission denied" no longer counts.
- **Categories.** Inbox stubs carry `category`: `failure`, `policy` (permission refusals: the auto mode classifier, the built-in safety check, a harness block, a user rejection), `tool-error`, `interrupted`, and the host's tool-use id, so the live event and the transcript scan never double-log.
- **Quiet by default.** The per-failure "capture this now" message is off (`STRATA_FAILURE_NUDGE=1` turns it on). `SessionStart`, `/strata:load` and `/strata:save` report counts by category and list only repeated failures.
- `strata inbox clear` keeps live transcript cursors, so cleared failures are not logged again; stale cursors are pruned.
- `/strata:init` on a project that already has the current layout runs `strata setup` instead of refusing.

### Upgrading
- Update the plugin and start a new session. Then run `/strata:init` once in each project (Codex: `Skill(name='strata', args='init')`). On a current-layout project it only runs `strata setup`: the `.gitattributes` block and local git config line for the merge driver, and the hot-rules block appended to existing `CLAUDE.md` / `AGENTS.md`. Commit those two files. Every other clone runs `/strata:init` (or `strata setup`) once too, because git config is not committed.
- A project that renders its views with its own generator sets `generated_views: external` in the `MANIFEST.md` frontmatter; strata then leaves the views alone.
- Codex users: add nothing. Codex has no `PostToolUseFailure`; the existing `hooks/codex-hooks.sample.json` wiring stays correct.

## 0.0.9 — 2026-09-11

### Fixed
- Set the bundled `SessionEnd` hook timeout to 3 seconds, matching [Codex’s documented maximum](https://learn.chatgpt.com/docs/hooks). This removes the startup warning that the previous 10-second timeout was being clamped. Other hook timeouts and capture behavior are unchanged. No memory-layout change or migration is required.

## 0.0.8 — 2026-07-12

**The hot tier (`MEMORY.md` rules table) is now a curated `hot: true` subset, so it stays within its ≤80-line budget as learnings accumulate.** No memory-layout change; projects remain on `layout_version: 3` and need no migration ([ADR-0015](docs/decisions/ADR-0015-hot-tier-curated-subset.md)).

### Added
- **`hot:` frontmatter on learnings + the curated hot subset.** `learnings/<slug>.md` gains an optional `hot: true | false`. `MEMORY.md`'s rules-by-trigger table now regenerates from `hot: true` learnings only (the broad / frequently-triggered rules worth loading every session); `learnings/INDEX.md` stays the complete list. New learnings default `hot: false` (INDEX-only), so the always-loaded hot table is future-bounded no matter how many learnings a project accumulates.
- **Advisory budget guard at `/strata:save`.** If the regenerated `MEMORY.md` table would breach ≤80 lines, the save reports it and suggests curating the hot subset — it never auto-picks or auto-trims the set. A human owns what loads every session, so a guardrail rule is never silently demoted, and deterministic regeneration is preserved (no per-save analysis; [ADR-0004](docs/decisions/ADR-0004-generated-indexes-grep-router.md) idempotency stands).

### Compatibility
- **Fully backward-compatible — graceful default.** A project with no `hot:` flag anywhere keeps *all* learnings in the MEMORY table (current behavior); the first `hot:` flag opts it into filtering. Existing `layout_version: 3` projects are unchanged and need no migration. To adopt: run `/strata:save`, and when the guard flags an over-budget table, flag your most-triggered learnings `hot: true` in one pass — the rest stay in `INDEX.md`.
- `SKILL.md §1/§4/§6E`, `commands/save.md`, `docs/DESIGN.md §5.2/§5.4/§5.8`, and the scaffold templates (`memory/learnings/_TEMPLATE.md`, `memory/MEMORY.md`, `MANIFEST.md`) document the convention; new projects scaffold with the `hot: false` default and the hot-subset note.

## 0.0.7 — 2026-07-09

**`PreCompact` is now a silent, cross-tool evidence drain.** No memory-layout change; projects remain on `layout_version: 3` and need no migration.

### Fixed
- `PreCompact` now performs its transcript drain silently. The previous `hookSpecificOutput.additionalContext` response is not valid for Claude Code's `PreCompact` event and caused compaction to report `invalid PreCompact hook JSON output`. Entry-point tests now lock the event's zero-stdout contract while confirming that evidence is still persisted and `SessionStart` context injection remains intact ([ADR-0014](docs/decisions/ADR-0014-precompact-silent-evidence-drain.md)).

## 0.0.6 — 2026-06-22

**The memory-layout stamp is now an integer, named distinctly from the plugin release.** Breaking layout-stamp change — see `MIGRATIONS.md` Rung 3 ([ADR-0013](docs/decisions/ADR-0013-layout-version-integer.md)).

### Changed
- The layout stamp in scaffolded `MANIFEST.md` is **`layout_version: 3`** (a plain integer generation counter), replacing `strata_version: 0.0.3`. Same on-disk structure — only the stamp label changed. This ends the confusion where the layout (`0.0.3`) and the plugin release (`0.0.5`) looked like one semver counter out of sync: a glance now distinguishes `layout_version: 3` (memory format) from plugin `0.0.6` (release).
- `SKILL.md §9`, the `load`/`save`/`capture` version checks, `docs/DESIGN.md`, the scaffold templates (`MANIFEST.md`), and the adapter templates (`AGENTS.md`/`CLAUDE.md`) all reference `layout_version: 3`; the plugin release stays semver (ADR-0008 stands).

### Migration
- **Strict:** a project still stamped `strata_version: 0.0.3` is a version mismatch — `load`/`save`/`capture` stop and point at `MIGRATIONS.md`. New **Rung 3** does the one-line, gated stamp rewrite (`strata_version: 0.0.3` → `layout_version: 3`); no structural change, fully reversible.

## 0.0.5 — 2026-06-20

**Immediate capture now covers every important moment, not just failures.** No layout change (`strata_version` stays `0.0.3`, no migration) — a capture-contract change, recorded in [ADR-0012](docs/decisions/ADR-0012-immediate-capture-all-moments.md).

### Changed
- `/strata:capture`, the agent's immediate-capture rule ([`SKILL.md §5`](skills/strata/SKILL.md)), and the hook's `SessionStart` nudge now prompt capture of the full range of important moments to their durable homes the instant they are clear: a settled decision (→ `docs/decisions/ADR-NNNN`, using the §6 collision scan), a change of direction (supersedes the old ADR), how an outside system works or a procedure (→ `docs/ops/` / `docs/architecture/`), and a requirement or its reasoning (→ `docs/product/`) — alongside the issues, learnings, and failure capture already covered. `/strata:save` becomes the safety net that files anything missed, finalizes drafts, and still owns view and `ARCHITECTURE.md` regeneration.
- The deterministic floor is unchanged: the hook still detects only failures (a machine cannot detect that a decision was made); the richer moments are the agent's to write, primed by the nudge ([ADR-0011](docs/decisions/ADR-0011-deterministic-capture-inbox.md) stands).
- **README reframed** around saving every important moment to its right place rather than logging errors: the capture sections and the hooks explanation expanded, the "Why this exists" opener reframed around how documentation drifts when you build with agents, a new hero image, and an honest cross-agent / cross-OS note (tested on Windows and Linux for Claude Code and Codex; the macOS path written but untested).

## 0.0.4 — 2026-06-20

Plugin release — **deterministic capture-guard**. No layout change (`strata_version` stays `0.0.3`, no migration). Extends the nudge-only hook ([ADR-0010](docs/decisions/ADR-0010-capture-guard-hook.md)) into deterministic, compaction-proof capture across Claude Code and Codex. Decided by a Claude + Codex council; design in [ADR-0011](docs/decisions/ADR-0011-deterministic-capture-inbox.md) + [`docs/deterministic-capture-design.md`](docs/deterministic-capture-design.md).

### Added
- **Deterministic capture inbox** — the capture-guard hook auto-logs failed tool results to `.strata/inbox/captures.jsonl` the moment they happen (raw, redacted, git-ignored scratch), so evidence survives compaction without the agent acting. `PostToolUse(Bash)` logs live; `PreCompact`, a non-blocking `SessionEnd` (Claude), and a silent `Stop` (Codex) scan the transcript tail on a byte-exact per-transcript cursor (ADR-0011 P1/P2/P3).
- **Read-side promote-and-clear loop** — `/strata:capture` and `/strata:save` promote real stubs into issues/learnings then clear the inbox; `/strata:load` surfaces the un-promoted count. Contract defined once in `SKILL.md §5a`; `tests/lint.sh §2d` fails the build if the commands ever drop the inbox reference.
- **Codex deterministic capture** (live-verified 2026-06-20) — `PostToolUse(Bash)` signature capture plus a Codex rollout-JSONL parser (`function_call_output`, keyed on the `Process exited with code N` marker) on `PreCompact`/`Stop`. `hooks/codex-hooks.sample.json` wires SessionStart + PostToolUse + PreCompact + Stop.
- **Secret boundary** — `.strata/inbox/` git-ignored by default (scaffolded by `/strata:init`); stubs redacted at write (tokens, keys, `password=`, GitHub PATs); triaged at promote.
- **`docs/decisions/ADR-0011`** (deterministic capture inbox), **`docs/deterministic-capture-design.md`**, and the ADR status lifecycle `proposed → accepted → implemented`.

### Changed
- The capture-guard hook is no longer nudge-only — it is **deterministic** (the nudge remains the honest floor wherever a deterministic path is unavailable). `hooks/hooks.json` now also fires `SessionEnd`.
- **Codex correction:** plugin-bundled hooks are **removed** in current Codex (`codex features list → plugin_hooks: removed`); Codex hooks are config-file only, so `hooks/codex-hooks.sample.json` is the supported path (ADR-0010 constraint 2 stands).

## 0.0.3 — 2026-06-09 … 2026-06-19

Layout generation **`strata_version: 0.0.3`** — breaking; see `MIGRATIONS.md` rung 2 (0.0.2 → 0.0.3). The same generation later packaged Strata as a Claude Code and Codex plugin, added the `/strata:capture` immediate-capture command, and added an optional capture-guard hook; none of those change the on-disk format. Design rationale: [`docs/decisions/`](docs/decisions/README.md), full reference: [`docs/DESIGN.md`](docs/DESIGN.md).

### Added
- **Unified backlog `.strata/issues/`** — findings, tasks, and initiatives as one frontmatter-keyed store (`type`/`status`/`severity`/`area`), generated `ACTIVE`/`OPEN`/`PARKED` views, `archive/` for closed items, and the mid-session rule: findings are written to disk *immediately*, with full diagnostics (ADR-0002).
- **Operation-keyed learnings `.strata/memory/learnings/`** — behavioral lessons with `trigger:`/`applies-when:`/`origin: success|failure` frontmatter, generated `INDEX.md`, and a rules-by-trigger table in `MEMORY.md`; failures captured as first-class pitfalls (ADR-0003).
- **Warm-docs taxonomy for scaffolded projects** at `.strata/docs/` — `ARCHITECTURE.md` index, `product/`, `architecture/`, `decisions/`, `reference/`, `ops/` (+ `incidents/`, `release-rollback.md`); offered at init, grown on demand (ADR-0007).
- **`strata_version` stamp** in `MANIFEST.md` + in-repo **`MIGRATIONS.md`** ladder with per-rung detect/transform/rollback (ADR-0006).
- **Self-documenting repo layers:** `docs/DESIGN.md` (exhaustive reference), `docs/decisions/ADR-0001…0010`, this changelog (ADR-0005).
- **`tests/`** — scaffold validation + repo lints (legacy tokens, size budgets, states/types consistency).
- `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`, packaging Strata as a Claude Code plugin installable via `/plugin marketplace add belousov-petr/strata`.
- `.codex-plugin/plugin.json`, which packages Strata as a Codex plugin and points Codex at `skills/strata/`.
- `/strata:capture`, an immediate capture command for failures, gotchas, workarounds, and findings that should be written before `/strata:save`.
- `/strata:init`, a command to scaffold a project's `.strata/` memory or upgrade an older layout (Codex keeps `Skill(name='strata', args='init')`).
- [ADR-0009](docs/decisions/ADR-0009-claude-plugin-packaging.md) — Claude plugin packaging and the forced command/skill namespacing.
- **Optional capture-guard hook** (`hooks/`) for Claude Code and Codex, cross-platform (Windows/macOS/Linux). One shared Node script injects the immediate-capture rule at `SessionStart` and a last-chance reminder at `PreCompact`, silent outside strata projects. Shipped in the Claude plugin (`hooks/hooks.json`, auto-on); for Codex (whose plugins can't ship hooks) a `~/.codex/hooks.json` or committed `.codex/hooks.json` from `hooks/codex-hooks.sample.json`. [ADR-0010](docs/decisions/ADR-0010-capture-guard-hook.md).

### Changed
- Namespace **`.ai/` → `.strata/`**; contract file **`MEMORY-MAP.md` → `MANIFEST.md`** (ADR-0001, ADR-0004).
- Commands renamed across two steps: **`/save-point` → `/strata-save` → `/strata:save`**, **`/load-point` → `/strata-load` → `/strata:load`**. Under the plugin the slash verbs are namespaced and the skill is `Skill(name='strata:strata', …)`, while Codex keeps the canonical `Skill(name='strata', …)` (ADR-0001, ADR-0009).
- `MEMORY.md` is now a **pure hot index** (≤80 lines): live pointers + generated by-trigger table; all routing/structure lives in `MANIFEST.md` only (ADR-0004).
- Status-dependent lists are **generated from frontmatter** at `/strata:save`, never hand-maintained (ADR-0004).
- `/strata:save` previews its proposed changes and then writes automatically; invoking the command is the confirmation, with no trailing `Confirm? (y/n)` prompt.
- The skill bundle lives under `skills/strata/`, so the repo installs as both a Codex plugin and a Claude Code plugin from one tree.
- Versioning is **git-native**: tags + changelog + ADR supersede-status + ops rollback runbook; the 0.0.2 per-folder `docs/**/archive/` convention is retired in favor of one optional `docs/_archive/` (ADR-0008).

### Removed
- `open_action_items.md`, `project_<slug>.md` files, and `docs/parked/` — folded into `issues/` as types and statuses (ADR-0002).
- Flat `feedback_*.md` behavioral memory — replaced by `learnings/` (ADR-0003).
- `GEMINI.md` adapter — Gemini CLI reads `AGENTS.md` via `settings.json` context config or an import line (ADR-0001).
- `references/` standalone docs — superseded by `docs/DESIGN.md`.
