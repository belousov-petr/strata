# {{PROJECT_NAME}} Codex Adapter

Before memory operations or deep project work, open [`.ai/MEMORY-MAP.md`](.ai/MEMORY-MAP.md), then [`.ai/memory/MEMORY.md`](.ai/memory/MEMORY.md).

Project memory is repo-owned under `.ai/`. Do not write project memory to tool-owned paths such as `~/.codex/`, `~/.claude/`, or other per-tool state directories.

Keep this adapter thin. Put project-specific loading order, routing notes, and memory structure in `.ai/MEMORY-MAP.md`; put durable decisions in `docs/decisions/`.
