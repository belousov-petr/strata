# ADR-0009: Claude Code plugin packaging and forced command/skill namespacing

- **Status:** accepted
- **Date:** 2026-06-18
- **Revises:** the command-naming decision in [ADR-0001](ADR-0001-strata-namespace-commands-adapters.md) (the manual-copy `/strata-save` / `/strata-load` names) for the Claude Code distribution.

## Context and Problem Statement

0.0.3 shipped Strata to Claude Code as loose files copied into `~/.claude/`: command markdown into `~/.claude/commands/`, the skill into `~/.claude/skills/strata/`. ADR-0001 named the commands `/strata-save` and `/strata-load` for exactly that manual-install world, where a command's invocation name is its filename and nothing namespaces it.

Claude Code now has a first-class plugin system: a `.claude-plugin/plugin.json` manifest, `.claude-plugin/marketplace.json` for distribution, `/plugin marketplace add` + `/plugin install`, and `claude plugin validate`. The repo was already a Codex plugin (`.codex-plugin/plugin.json` → `skills/`). Packaging the same tree as a Claude plugin gives Claude users one-command install/update, manifest validation, and version pinning instead of a per-OS copy-paste block the README had to hand-maintain.

The blocking constraint: **Claude Code forces every plugin command and skill to be namespaced under the plugin name** — there is no short or unqualified form. A plugin named `strata` exposing a command `strata-save` is invoked as `/strata:strata-save`, and a skill `strata` as `Skill(name='strata:strata')`. The bare `/strata-save` and `Skill(name='strata')` that ADR-0001 chose cannot be reproduced by a plugin; they only ever existed because manual install is unnamespaced.

## Considered Options

1. **Keep manual copy-install only; do not package for Claude.**
   Pros: preserves the bare `/strata-save` / `Skill(name='strata')` names verbatim. Cons: no validation, no one-command install/update, a hand-maintained per-OS copy block; Strata would be the only one of its three distributions (Codex plugin, `AGENTS.md`, and this) left unpackaged on the platform it started on.
2. **Plugin + keep manual install side by side.**
   Pros: bare names survive via manual install; the plugin adds convenience. Cons: two install paths with *different* invocation strings for the same tool, documented twice and drifting twice — the duplicated-surface failure mode ADR-0001/ADR-0005 exist to kill, reappearing in the install story.
3. **Plugin-only, accept the doubled `strata:strata-save`.**
   Pros: one install path; least renaming. Cons: `/strata:strata-save` and `Skill(name='strata:strata')` read redundantly; the `strata:strata-` stutter is pure noise.
4. **Plugin-only, shorten the command names to `save` / `load` / `capture`.** *(chosen)*
   Pros: one install path; the namespaced forms read cleanly as `/strata:save`, `/strata:load`, `/strata:capture`; the plugin name already carries the "strata" half, so the command half should not repeat it. Cons: the bare `/strata-save` names from ADR-0001 / 0.0.3 are gone — a second command rename one generation after the first (`/save-point` → `/strata-save` → `/strata:save`); deep docs that used `/strata-save` as a handle moved to `/strata:save`.

## Decision

Option 4. Package the repo root as a single Claude Code plugin and let the platform namespace it:

- **`.claude-plugin/plugin.json`** — plugin manifest, `name: strata`, `version` tracking `.codex-plugin/plugin.json` (`0.0.3`). No component-path fields: commands and the skill are auto-discovered from `commands/` and `skills/`.
- **`.claude-plugin/marketplace.json`** — single-plugin marketplace, `name: belousov-petr`, one entry `strata` with `source: "."` (the repo root *is* the plugin). Install: `/plugin marketplace add belousov-petr/strata` then `/plugin install strata@belousov-petr`.
- **Commands move to `commands/`** and are renamed `save.md` / `load.md` / `capture.md` (`name: save|load|capture`), so the plugin verbs are **`/strata:save`**, **`/strata:load`**, **`/strata:capture`**.
- **The skill stays `skills/strata/SKILL.md`, `name: strata`** — unchanged, because Codex and any other tool invoke it un-namespaced as `Skill(name='strata', …)`, a hard compatibility constraint. Under the Claude plugin the same skill is reached as `Skill(name='strata:strata', …)`; it cannot be shortened below that without breaking Codex, so the doubled *skill* form is accepted while the *command* forms are not.
- **Codex packaging is untouched.** `.codex-plugin/plugin.json` still points at `skills/` and Claude ignores it; the two plugin manifests coexist in one tree.
- Slash-command references across the operative surfaces (SKILL.md, command bodies, README, DESIGN, templates) move to the `/strata:…` form; ADR-0001's `/strata-save` naming is **revised here**, not edited there.

## Consequences

- One Claude install path with validation: `claude plugin validate . --strict` runs clean and is wired into `tests/lint.sh`, plus `/plugin` install/update and version pinning.
- The bare `/strata-save` and `Skill(name='strata')` names no longer work in Claude Code. Users on the old manual install remove `~/.claude/commands/strata-*.md` and install the plugin (documented in the README install section and the MIGRATIONS user-side note).
- An asymmetry remains by necessity: commands shorten (`/strata:save`), the skill does not (`Skill(name='strata:strata')`), because the skill name is load-bearing for Codex.
- Scaffolded user-project templates reference `/strata:…`, and the scaffolded `MANIFEST.md` (like SKILL.md) carries an **Invocation** note mapping `save`/`load`/`capture`/`init` to Claude's `/strata:…` commands and to other tools' `Skill(name='strata', …)` flow — so a Codex or Gemini agent reading a project's contract knows the slash names denote operations it performs through the skill, not commands it must type.
- Repo-wide line-ending normalization (`.gitattributes`: `* text=auto eol=lf`, `*.png binary`) keeps the bash test suite and `claude plugin validate` behaving identically on Windows, macOS, and Linux; without it a Windows CRLF checkout fails `scaffold-check.sh`'s `^strata_version: 0.0.3$` grep.
- Future Claude-side packaging changes are caught by the manifests and `claude plugin validate`, not by prose review.

## Sources

- Claude Code — Plugins — https://code.claude.com/docs/en/plugins
- Claude Code — Plugins reference (manifest fields, `${CLAUDE_PLUGIN_ROOT}`, namespacing) — https://code.claude.com/docs/en/plugins-reference
- Claude Code — Plugin marketplaces (`source`, `marketplace.json`, validate) — https://code.claude.com/docs/en/plugin-marketplaces
- Michael Nygard — Documenting Architecture Decisions (supersede, don't edit or delete) — https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions
