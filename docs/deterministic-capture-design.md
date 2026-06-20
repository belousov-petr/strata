# Deterministic capture — design and phased plan

> Detailed design behind **ADR-0011**. Decided by the Claude + Codex council on 2026-06-20
> (brief: `docs/council-deterministic-capture.md`). This is the spec the implementation follows;
> ADR-0011 is the immutable decision, this doc is the how.

## 1. Goal

Write findings to repo memory the moment they happen, so a session that hits compaction — or just ends without compaction — does not lose them, **without** depending on the agent remembering and **without** blocking the flow. Works on Claude Code and Codex, on Windows/macOS/Linux, in pure Node.

## 2. Architecture

Two halves with a clean seam:

- **Write side (deterministic, the hook).** On a failed tool result the hook appends a **raw evidence stub** to `.strata/inbox/captures.jsonl`. The agent does nothing for the evidence to land. This is the part that defeats compaction loss.
- **Read side (the commands).** `/strata:capture` and `/strata:save` read the inbox, **promote** the real stubs into issues/learnings, then **clear** the file and reset the cursor. `/strata:load` surfaces the un-promoted count so the backlog is visible. This is deterministic — it needs no agent turn beyond running the command the user already runs.

The inbox is **raw evidence, not finished memory**. Promotion is where a stub becomes a real issue/learning, and the only place secrets are triaged out.

```
tool fails ──hook──▶ .strata/inbox/captures.jsonl ──/strata:capture or /strata:save──▶ issues/ , learnings/
                          │  (raw, redacted, gitignored)        promote + clear + reset cursor
            /strata:load ─┘  surfaces "Inbox: N un-promoted"
```

## 3. Data model

- **Stub** (one JSON line): `{ ts, event, tool, signal, command, snippet, h }`. Identical on both agents.
- **Inbox file:** `.strata/inbox/captures.jsonl`, append-only between promotions.
- **Cursor:** `.strata/inbox/.cursor.<transcript-id>.json` — **per transcript**, not one shared file (fixes the multi-agent thrash, §7). Holds `{ transcriptPath, offset, headHash }`.
- **Dedupe:** content hash `h` over `signal + normalized command + head-and-tail of snippet` (not tail-only — fixes the collision bug, §6). The append-time window stays, but **promotion is the authoritative dedupe** so quality doesn't decay as the file grows.

## 4. Lifecycle / data flow

**Write (per agent):**
- `PostToolUse(Bash)` — on a failing result, append a stub immediately; silent on success.
- `PreCompact` — scan the transcript tail (cursor-based) for failed tool results not already captured; flush them; then the last-chance nudge.
- `SessionEnd`/`Stop` (new, non-blocking) — run **only** the transcript-tail scan, so a session that ends without compaction still drains. No block, no wedge — the salvaged half of B1.

**Promote (read side, defined once in `SKILL.md`, referenced by the commands):**
- `/strata:capture` §2 — read `.strata/inbox/captures.jsonl`, fold relevant auto-logged failures into the issue/learning being captured.
- `/strata:save` §3 ("issue events… verify the mid-session ones hit disk") — promote every un-promoted stub into issues/learnings (dedup against the backlog per §5/§6 of save), **redact/triage** per SKILL §2 "Never store," then **truncate** the inbox and **reset** the cursors. Listed in the preview block under a new `PROMOTED (from inbox)` group.
- `/strata:load` §5 — add one line to the ≤6-line orientation: `Inbox: <n> un-promoted (auto-logged failures)` (omit when zero).

**Single source of truth:** the inbox contract (schema, promote-and-clear, redaction, cursor) lives in a new `SKILL.md` subsection. The commands keep delegating rules to the skill — they gain only a pointer, not a restated contract.

## 5. Secret / redaction model

The raw stub can contain stack traces, transient paths, or secret command output — exactly what SKILL §2 and `save.md §93` forbid in durable memory. Three layers:

1. **Gitignore by default.** `/strata:init` scaffolds `.strata/inbox/` and writes a `.gitignore` rule for it; the inbox is transient scratch, not committed memory.
2. **Redact at write.** The hook masks common secret shapes (`AKIA…`, `gh[porus]_…`, bearer/`Authorization:` headers, `password=`, long base64/hex blobs, `?…token=…`) in both `command` and `snippet` before the line is written.
3. **Triage at promote.** Promotion keeps the concise root cause + minimal evidence and drops the rest, reconciling the inbox with SKILL §2.

## 6. Known bugs to fix (reproduced by the council)

- **Cursor forward-drift (data loss, high).** `PreCompact` decodes a raw byte window to a string and computes the next offset from the decoded string; a mid-multibyte start re-encodes as U+FFFD and the offset **overshoots** (reproduced 10 vs true 8), silently skipping unread transcript on the next scan. Fix: compute the offset from **raw byte arithmetic** anchored on a real `\n` in the byte buffer; start decoding on a line boundary.
- **512 KB skip-ahead (data loss, high).** When the delta exceeds `MAX_SCAN_BYTES`, `start` jumps to `size - MAX_SCAN_BYTES` and the cursor is later written **past** the unscanned bytes — marking them consumed. Fix: never advance the cursor over unprocessed bytes; scan in bounded chunks from the previous offset, or emit an overflow stub and leave the cursor.
- **`stubHash` collision (data loss, medium).** Hash over `signal + last 200 chars` only → two distinct failures sharing a generic tail collide and the second is dropped (reproduced). Fix per §3 (hash head+tail + command).
- **Signature precision (medium).** `PreCompact` regex-scans every `tool_result` without proving it came from a failed Bash, so a successful `grep`/`cat`/`echo` printing `fatal:`/`Traceback`/`panic:` is logged as a failure; and the set misses Windows `is not recognized` failures. Fix: correlate `tool_result` back to a Bash `tool_use`, prefer explicit exit status, keep regex as a fallback, add Windows cmd/PowerShell signatures.

## 7. Concurrency / multi-agent model

Two agents (Claude + Codex) or two sessions share one repo, so:
- **Per-transcript cursor** (§3) — no shared `.cursor.json` to thrash; each session advances its own.
- **Atomic cursor writes** — write to a temp file and rename.
- **Append safety** — `appendFileSync` with `O_APPEND` is atomic for these small lines on local FS; the residual read-then-append duplicate race is absorbed by promote-time dedupe (§3), so duplicates are tolerable and never corrupt the scan.

## 8. Codex adapter (shipped — full deterministic)

Codex's hook schema is Claude-compatible, so the script's existing snake_case reads already map Codex payloads. Shipped state (verified on a live Codex build 2026-06-20):
- **PostToolUse(Bash):** the same script is registered as a Codex hook via config-file only — `~/.codex/hooks.json` or `<repo>/.codex/hooks.json` (plugin_hooks is removed in current Codex; there is no plugin-bundled hook path). The failed-Bash auto-log ports with no logic change.
- **PreCompact / Stop rollout scan:** a Codex rollout-JSONL parser branch handles `response_item` / `function_call_output` entries, keyed on the `Process exited with code N` marker. Guarded by the existing `transcript_path` null-check.
- **Verify-on-target complete:** (a) `tool_response` carries failure output/exit on a real failed Bash; (b) `transcript_path` is non-null at `PreCompact`; (c) the rollout line schema matches the parser. Codex is now full deterministic.

## 9. Distillation decision

- **Default (both agents):** deterministic promote-at-read (§4). No agent turn, no second context window, no extra bill.
- **Opt-in:** B2 background distiller (Claude `run_in_background`; Codex `spawn_agent`) reading the durable inbox in its own context window — documented as model-initiated and therefore best-effort.
- **Rejected as default:** B1 blocking Stop (intrusive, wedge risk; its non-blocking scan half is salvaged as `SessionEnd`). **Advanced opt-in:** B3 detached headless drain (`claude -p` / `codex exec`).

## 10. Error handling

Unchanged where it already holds: any error → exit 0, no output; silent no-op outside a strata project; no output on a successful `PostToolUse`; bounded stdin read. New code keeps the same discipline — a redaction or parser failure degrades to "write less / nudge only," never to a crash or a block.

## 11. Testing

Add to `tests/` (extend `lint.sh` or a new node test): multibyte-boundary cursor (no overshoot, no skip); 512 KB-overflow (no consumed-but-unscanned bytes); `stubHash` distinct-tail-collision; redaction of each secret shape; promote-and-clear + reset; promote idempotency on re-run; signature false-positive on a successful `grep 'Traceback'`; Windows `is not recognized` true-positive; two concurrent writers (dedup at promote). All pure Node, cross-platform.

## 12. Phased plan (acceptance criteria)

**P1 — blockers (must land before the deterministic writer is default-on):**
1. **Read-side loop.** Inbox contract in `SKILL.md`; `/strata:load` surfaces the count; `/strata:capture` + `/strata:save` promote-and-clear + reset cursor. *Done when* a stub written by the hook is promoted to an issue/learning and the inbox is emptied by running `/strata:save`, and `/strata:load` reports a non-zero count before that.
2. **Secret boundary.** `.strata/inbox/` gitignored + scaffolded by `/strata:init`; redact-at-write; triage-at-promote. *Done when* a failing `echo "TOKEN=ghp_…"` lands a **masked** stub and the dir is gitignored.
3. **Cursor data-loss + concurrency.** Fix forward-drift and 512 KB skip-ahead; per-transcript cursor + atomic rename. *Done when* the new cursor tests pass and no scan marks unscanned bytes consumed.

**P2 — correctness/coverage:** `stubHash` head+tail+command; non-blocking `SessionEnd` scan; signature correlation + Windows signatures. *Done when* the collision, false-positive, Windows, and no-compaction-flush tests pass.

**P3 — Codex parity (shipped 2026-06-20):** Codex `PostToolUse` adapter wired; rollout `function_call_output` parser added for `PreCompact`/`Stop` exit-code scan; verify-on-target checklist (§8) run on a live Codex build. Codex is now full deterministic (PostToolUse signature capture + rollout exit-code scan via PreCompact/Stop). `hooks/README.md` updated accordingly.

**Docs reconciliation (with P1):** `hooks/README.md` stops asserting the read-side loop and the `commandWindows` field name as live until they are wired/verified; ADR-0011 index row added.

## 13. Open questions

- Does Claude Code emit a `SessionEnd` (or non-blocking `Stop`) a hook can read without B1's wedge risk? (Load-bearing for P2 item 2.)
- The three Codex verify-on-target facts (§8).
- Inbox lifecycle owner when a project chooses to commit it anyway — out of scope for default (gitignored), revisit only if a user opts in.

## 14. References

- Decision: `docs/decisions/ADR-0011-deterministic-capture-inbox.md` (extends ADR-0010)
- Council brief: `docs/council-deterministic-capture.md`
- Implementation: `hooks/strata-capture-guard.mjs`, `hooks/hooks.json`, `hooks/README.md`
- Read side: `skills/strata/SKILL.md`, `commands/{load,capture,save}.md`
