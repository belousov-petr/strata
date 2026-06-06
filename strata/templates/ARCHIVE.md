# Archive Index — {{PROJECT_NAME}} Memory

Cold storage. **Not surfaced via `MEMORY.md`.** Files here are preserved for forensics / history / explicit searches, not auto-loaded. Skim this index when investigating older decisions, incidents, or session narratives; open individual files only when needed.

## How to access
- **Explicit ask** — "check archive for X" → scan this index, open the relevant file.
- **Grep** — `grep -rl "keyword" archive/` works normally.
- **Git history** — if the file was ever committed, `git log` still has it.

## Rollover rules
- Superseded state snapshots → archive on the day they're superseded.
- `project_state.md` sessions older than "current + last completed" → rolled into a dated archive file at session start.
- Shipped-initiative memory files whose rationale was extracted to an ADR → archived here as `source-adr-NNNN-*` for ADR provenance.
- Reference/parked content migrated to `docs/reference/` or `docs/parked/` → raw source archived here as `source-reference-*` or `source-parked-*`.
- Historically useful stale docs → move to the nearest `docs/**/archive/` directory and update that archive's index, not this hot-memory archive.
- Completed action items with external artifacts (upstream PR/issue, email sent, comment posted) → append entry to `action_log.md`, delete from `open_action_items.md`.

## Files

### Action log (append-only completion log)
| File | What it is |
|---|---|
| `action_log.md` | Dated entries for completed actions that produced external artifacts. Grep on demand ("did we post X?", "when did we do Y?"). Not auto-loaded. |

### Session snapshots
_No files yet._

### ADR provenance
_No files yet._

### Reference provenance
_No files yet._

### Parked provenance
_No files yet._
