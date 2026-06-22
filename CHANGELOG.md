# Changelog

Notable changes to strata. Releases are git tags on this repo; *layout generations* are `layout_version` stamps (a plain integer) in scaffolded manifests — renamed from `strata_version: 0.0.x` in 0.0.6, see [ADR-0013](docs/decisions/ADR-0013-layout-version-integer.md). When a release breaks the layout, its rung in [`MIGRATIONS.md`](MIGRATIONS.md) ships in the same release.

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
