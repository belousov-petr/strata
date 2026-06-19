# ADR-0001: `.strata/` namespace, renamed commands, AGENTS.md + CLAUDE.md adapters

- **Status:** accepted
- **Date:** 2026-06-09
- **Note:** the command-naming decision below (`/strata-save`, `/strata-load`) is revised by [ADR-0009](ADR-0009-claude-plugin-packaging.md) for the Claude Code plugin (`/strata:save`, `/strata:load`, `/strata:capture`); the `.strata/` namespace and adapter decisions stand.

## Context and Problem Statement

0.0.2 stored project memory under `.ai/` with a `MEMORY-MAP.md` contract, scaffolded three tool adapters (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`), and shipped two commands named `/save-point` and `/load-point`.

Four problems surfaced:

1. **`.ai/` is an unowned, generic name.** There is no cross-agent standard for context *directories* — "every tool invented its own convention" (`.amazonq/rules/`, `.cursor/rules/`, `.windsurf/rules/`, `.claude/`, …). A generic `.ai/` invites collision the moment any other tool adopts the same name, and nothing about it says who owns the format or how to migrate it.
2. **No tool auto-discovers `.ai/` anyway.** Discovery always depended on adapter wiring; the "neutral" name bought nothing operationally.
3. **The adapter set was stale.** `AGENTS.md` became a real open standard in 2025 (donated to the Linux Foundation's Agentic AI Foundation in December 2025, read by 25+ tools). Claude Code still does not read it natively (issue #6235, the tracker's most-upvoted ask), so a `CLAUDE.md` shim remains necessary. Gemini CLI, however, can be pointed at `AGENTS.md` via `settings.json` (`"context": {"fileName": ["AGENTS.md", "GEMINI.md"]}`) or a one-line import — a third scaffolded adapter duplicates content, and duplicated instruction files are the documented failure mode (drift; auto-generated context files measured *worse than none* in one study).
4. **Generic command verbs.** `/save-point` and `/load-point` announce no ownership and can collide with other command packs in `~/.claude/commands/`.

## Considered Options

1. **Keep `.ai/` + three adapters + old command names.**
   Pros: zero migration; "tool-neutral" reads well. Cons: unowned namespace, collision-prone, version-less; GEMINI.md is config-solvable duplication; generic command names collide.
2. **No dedicated directory at all** — root `AGENTS.md` plus conventional `docs/` ("agent-ready repo" camp).
   Pros: smallest footprint, tool-agnostic structure ages best. Cons: strata's state (issues backlog, learnings, generated indexes, archive) is structured and owned — it does not fit one markdown file, and spreading it through `docs/` erases the memory/docs boundary the whole system is built on.
3. **Per-tool directories** (`.claude/`, `.kiro/steering/`, `.specify/` style).
   Pros: native discovery in that one tool. Cons: tool lock-in and cross-tool drift — exactly what strata exists to prevent.
4. **`.strata/` namespace + thin `AGENTS.md`/`CLAUDE.md` adapters + namespaced commands.** *(chosen)*
   Pros: owned and self-describing — "strata-format, any tool can read it", like a lockfile names its tool; one namespace holds everything strata-owned (memory, issues, scaffolded docs); a `strata_version` stamp has an unambiguous home; commands `/strata-save` and `/strata-load` collide with nothing. Cons: breaking change for 0.0.1/0.0.2 projects (needs a migration ladder); one more dotdir at project root.

## Decision

Option 4.

- Everything strata-owned lives under **`.strata/`**, including scaffolded project docs at `.strata/docs/` (strata's *own* repo keeps a public root `docs/` — see ADR-0007).
- The contract file is **`.strata/MANIFEST.md`** (renamed from `MEMORY-MAP.md`; it now holds more than a memory map — see ADR-0004).
- Adapters are **`AGENTS.md` + `CLAUDE.md` only**, scaffolded only when absent, and kept thin: a pointer to `.strata/MANIFEST.md` plus the rule that memory is repo-owned. `AGENTS.md` remains the right place for a project to grow its *own* operational content (build/test commands, style) per the standard — strata doesn't own that, so the template leaves room rather than content. `GEMINI.md` is dropped; Gemini users point the CLI at `AGENTS.md` via settings or an import line.
- Commands are renamed **`/save-point` → `/strata-save`** and **`/load-point` → `/strata-load`** (files `strata-save.md`, `strata-load.md`).

Because no tool auto-discovers `.strata/`, the adapters must keep an explicit "read `.strata/MANIFEST.md` first" instruction — the manifest is inert unless always-loaded context points at it. That was equally true of `.ai/`; 0.0.3 just stops pretending otherwise.

## Consequences

- Collision-proof, versionable, self-describing namespace; "is this project on strata, and which version" is answerable from one path.
- Breaking change: 0.0.1/0.0.2 projects need the explicit migration ladder (ADR-0006, `MIGRATIONS.md`); users must re-install commands under the new names.
- One fewer template to keep in sync; Gemini wiring moves to documentation.
- If Claude Code ever ships native `AGENTS.md` support (#6235), the CLAUDE.md adapter can shrink to nothing — revisit then.

## Sources

- Linux Foundation — Agentic AI Foundation formation — https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation
- AGENTS.md canonical site — https://agents.md/
- agentsmd/agents.md (spec repo) — https://github.com/agentsmd/agents.md
- InfoQ — AGENTS.md emerges as open standard — https://www.infoq.com/news/2025/08/agents-md/
- Gist (yurukusa) — Does Claude Code read AGENTS.md? (#6235, @import shim, Windows-safe) — https://gist.github.com/yurukusa/d36197848911f025add142abefcde685
- google-gemini/gemini-cli — Discussion #1471 (pointing Gemini at AGENTS.md) — https://github.com/google-gemini/gemini-cli/discussions/1471
- DeployHQ — CLAUDE.md, AGENTS.md & Copilot instructions guide (duplication drift; auto-generated files worse than none) — https://www.deployhq.com/blog/ai-coding-config-files-guide
- McGarrah — AI coding agent context files reference ("no cross-agent standard … every tool invented its own convention") — https://mcgarrah.org/ai-coding-agent-context-files-reference/
- Medium (huseyinkaplandev) — Agent-Ready Repo Structure 2026 (the no-AI-folders camp) — https://medium.com/@huseyinkaplandev/agent-ready-repo-structure-2026-90af2ac8aed2
- Claude Code — the `.claude` directory — https://code.claude.com/docs/en/claude-directory
- Kiro — Steering (`.kiro/steering/`) — https://kiro.dev/docs/steering/
- Microsoft — Spec-Driven Development with Spec Kit (`.specify/`) — https://developer.microsoft.com/blog/spec-driven-development-spec-kit
