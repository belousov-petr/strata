# {{PROJECT_NAME}} — agent instructions

Before memory operations or deep project work, read [`.strata/MANIFEST.md`](.strata/MANIFEST.md) — the project memory contract (structure, routing rules, load order) — and load per its rules.

Project memory is repo-owned under `.strata/` (strata format, `layout_version: 3`). Do not write project memory to tool-owned paths such as `~/.codex/` or `~/.claude/`.

Keep memory rules out of this file — the manifest owns them. Operational content (build/test commands, code style, conventions, repo etiquette) belongs *here*; grow the section below as the project develops.

## Project notes

_(Build, test, and run commands; style rules; anything an agent needs to work on this codebase.)_
