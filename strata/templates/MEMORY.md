# Memory Index — {{PROJECT_NAME}}

Hot tier index. Lists files that should be auto-considered each session. Keep this under ~80 lines — if it grows, move detail into linked files, not here.

See `.ai/MEMORY-MAP.md` for tier model + routing rules.

## Hot files (active)

- [Open action items](open_action_items.md) — what's blocking right now
- [Project state](project_state.md) — current + last completed session narrative
- [Feedback rules](feedback_*.md) — behavioral rules the agent must follow (file per rule)
- [In-flight initiatives](project_*.md) — active multi-session work

## Where to look

| Topic | File |
|---|---|
| System architecture | `docs/ARCHITECTURE.md` (if present) |
| Shipped decisions | `docs/decisions/ADR-*.md` |
| Operations | `docs/OPS.md` (if present) |
| Operational lessons / incidents | `docs/ops/` |
| Parked initiatives | `docs/parked/` |
| Reference material | `docs/reference/` |
| History / archive | `.ai/memory/archive/ARCHIVE.md` |
| Completion log | `.ai/memory/archive/action_log.md` (grep on demand) |

## Discipline

- Hot memory stays hot only if it changes in-session behavior.
- Shipped decisions → extract to ADR, archive source.
- Architecture, ops, runbooks, incidents, and references → update warm docs, not only memory.
- Structural findings → capture evidence, affected paths, status, fix direction, and acceptance criteria.
- Stale docs → fix in place or archive to `docs/**/archive/`; do not leave stale banners.
- Stale initiatives (>30 days no work) → park with revive trigger, archive source.
- Completed actions with external artifacts → append to `action_log.md`, delete from `open_action_items.md`.
