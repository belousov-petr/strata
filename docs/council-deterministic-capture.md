# Council brief — deterministic capture + parallel distillation for the capture-guard hook

> **Purpose:** starting point for an **LLM council (Claude Code + Codex)** to agree on the
> best implementation of automatic capture that fits **both agents** and **Windows / macOS /
> Linux**. Relates to and may extend `docs/decisions/ADR-0010-capture-guard-hook.md`.
> Drafted 2026-06-20 from a Claude Code working session; **not yet a decision.**

## The problem we're solving

The premise of the capture-guard hook is that findings/failures/gotchas/learnings get
written to memory **the moment they happen**, so a session that hits context compaction
doesn't lose them. Today the hook only **nudges** (SessionStart + PreCompact inject a
text reminder), and a real long session showed the weakness: the nudge decays, and if no
compaction fires the PreCompact reminder never fires at all — so most captures still get
deferred to a manual `/strata:save`. We want capture that does **not** depend on the agent
remembering, and that does **not** intrusively block the agent.

## Decision criteria (the council should optimise for these)

1. **Works on both Claude Code AND Codex CLI** — or degrades honestly, with the portable
   guarantee clearly separated from per-agent enhancements.
2. **Cross-platform** — Windows / macOS / Linux (pure Node, no shell/OS assumptions).
3. **Compaction-proof** — evidence survives even if the main context is summarized.
4. **Non-intrusive** — must not block/hijack the main flow or risk wedging a session.
5. **Low maintenance** — minimal new surface area / data model in the plugin.
6. **Honest** — no feature claimed for an agent whose hook surface can't support it.

## What's already built (Claude side, UNCOMMITTED — the baseline to evaluate)

`hooks/strata-capture-guard.mjs` + `hooks/hooks.json` now do **deterministic capture**:
- **`PostToolUse`** (matcher `Bash`): on a failing Bash result, append a raw stub to
  `.strata/inbox/captures.jsonl` immediately; silent on success.
- **`PreCompact`**: scan the transcript tail (byte-cursor in `.cursor.json`, deduped) for
  failed tool results and flush any not-yet-captured ones to the inbox; then the
  last-chance nudge.
- **Inbox** = `.strata/inbox/captures.jsonl`, one JSON stub per line
  (`{ts,event,tool,signal,command,snippet,h}`), content-hash deduped. **Raw evidence, not
  a finished memory** — meant to be promoted to issues/learnings, then cleared.
- **Failure detection insight (important):** Claude's transcript records a non-zero Bash
  exit *inconsistently* — sometimes `is_error:true`/string, sometimes `is_error:false`
  with **no exit-code field** (e.g. eslint/pnpm exit 1 → only `ELIFECYCLE` in the text).
  So detection trusts an explicit error flag **and** a curated set of high-precision output
  signatures (`Exit code N`, `ELIFECYCLE`, `npm ERR!`, `fatal:`, `Traceback`, `error TS####`,
  `command not found`, …). Bare "error"/"FAIL" in successful output does **not** trigger it.
- **Tested** (8 cases): catches the `is_error:false`/`ELIFECYCLE` case; silent on a command
  that prints "FAIL" but exits 0; dedupes; skips successes; silent outside strata; never
  crashes (`try/catch → exit 0`). `node --check` + JSON-valid.
- **Cross-platform:** pure Node + `path.join` + whitespace-tolerant parse + byte-offset
  cursor → identical on all three OSes.
- **⚠ Claude-only deterministic.** PostToolUse `tool_response` parsing + the PreCompact
  transcript scan are **Claude-Code-schema-specific**. On Codex the hook **degrades to
  nudge-only** (unrecognised payloads → 0 stubs → nudge still fires; no crash, no
  regression). Documented honestly in `hooks/README.md` + the script header.

## The Codex unknowns the council must resolve

The deterministic half is inherently per-agent (it reads each tool's command output+exit
and the session transcript). To port it to Codex we need facts only the Codex side knows:
- Does Codex emit a **post-tool / per-command** hook event? Name + payload shape? Does it
  carry the command, its output, and an exit status?
- Codex's **rollout/transcript** format, and does `PreCompact` (or its analogue) receive a
  **path** to it?
- Does Codex support a **blocking `Stop`** equivalent? And **background subagents**
  (`run_in_background`)? Or a **headless `codex exec`** for detached drains?
- Codex hook config still uses `command`/`commandWindows` + absolute path + `node` on PATH
  (see `hooks/codex-hooks.sample.json`).

## Candidate designs on the table (from the Claude session)

**A. Deterministic inbox (Tier 1/2) — the portable guarantee.** Keep raw-evidence capture
in the hook; one per-agent adapter (Claude done; Codex = a parser keyed on Codex's schema).
This is the part that actually defeats compaction loss and should be the shared backbone.

**B. Distillation (raw stub → good learning) — three options, pick per agent:**
- **B1. Blocking `Stop` hook** — can *force* capture before a turn ends. **Rejected-ish:**
  runtime-intrusive (fires every turn, hijacks flow), and a **loop/wedge risk** if the
  block can't cleanly clear. Likely Claude-only.
- **B2. Main-agent dispatches a background "distiller" subagent** (`run_in_background`) —
  **preferred.** Non-blocking; the subagent runs in its **own context window**, so it's
  *immune to the main session's compaction*, and it reads the already-durable inbox.
  Caveat: dispatch is **model-initiated** (the hook can only nudge — a hook is a shell
  command and cannot spawn an in-session subagent). Since the *evidence* is already safe in
  the inbox, "force" isn't needed — only timely distillation, which can also happen at the
  next `/strata:load`. Codex may lack `run_in_background` subagents → maybe Claude-only.
- **B3. Hook spawns a detached headless agent** (`claude -p "drain .strata/inbox" &` /
  `codex exec`) — the **only** truly hook-triggered option (no main-agent dependency), but
  heavy: a full separate billable invocation, needs auth/config in the hook env, and risks
  file/git collisions. Advanced opt-in.

**C. One-line stub convention + promote-at-save (Tier 4).** Make `/strata:capture` and the
agent append a one-line stub too (not a full file); `/strata:save` promotes. Gentle at
runtime, but introduces a **two-stage memory model** (inbox → promoted) across
capture/save/load + dedup, and a new failure mode: **inbox rot** if promotion is skipped.

**Read-side loop (needed regardless):** `/strata:capture` + `/strata:save` must
promote-and-clear `.strata/inbox/`, and `/strata:load` must surface its count. Currently the
inbox is *written* and the nudge *tells* the agent to promote — but the commands don't yet
formally consume it. ~80% of a loop.

## Suggested council framing

1. Agree the **shared backbone**: deterministic inbox (A) with a per-agent capture adapter.
   Lock the inbox schema + dedup + cursor so both agents write the same format.
2. Resolve the **Codex adapter** facts above; decide if Codex gets deterministic capture or
   stays nudge-only-by-design.
3. Choose the **distillation** path per agent (B2 preferred where supported; B3 as the
   automatic fallback; B1 only as an opt-in last resort). Decide whether to **drop blocking
   Tier 3 entirely** now that the inbox makes the evidence compaction-proof.
4. Decide the **read-side** promotion contract (capture/save/load) — single source of truth
   so two agents sharing one repo don't double-promote or rot the inbox.
5. Capture the outcome as **ADR-0011** (or an update to ADR-0010) + a MIGRATIONS rung if the
   layout changes.

## File pointers
- `hooks/strata-capture-guard.mjs` · `hooks/hooks.json` · `hooks/README.md` · `hooks/codex-hooks.sample.json`
- `docs/decisions/ADR-0010-capture-guard-hook.md` (existing decision)
- Inbox (runtime, created on first failure): `<project>/.strata/inbox/captures.jsonl`
