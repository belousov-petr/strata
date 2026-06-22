# {{PROJECT_NAME}} — Claude adapter

Before memory operations or deep project work, read [`.strata/MANIFEST.md`](.strata/MANIFEST.md) — the project memory contract (structure, routing rules, load order) — and load per its rules.

Project memory is repo-owned under `.strata/` (strata format, `layout_version: 3`). Do not write project memory to tool-owned paths such as `~/.claude/` or `~/.codex/`.

Keep this adapter thin: memory rules live in the manifest; project operational content (build/test commands, style, conventions) belongs in `AGENTS.md`.
