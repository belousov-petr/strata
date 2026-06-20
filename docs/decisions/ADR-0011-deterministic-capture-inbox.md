# ADR-0011: Deterministic capture inbox + per-agent distillation (extends ADR-0010)

- **Status:** implemented (extends ADR-0010) — P1 core shipped 2026-06-20 (deterministic inbox, read-side promote-and-clear wired in SKILL §5a + commands, secret boundary, both cursor data-loss fixes); P2 (non-blocking SessionEnd scan, signature correlation + Windows signatures) and P3 (Codex PostToolUse adapter + verify-on-target) remain per Consequences
- **Date:** 2026-06-20

## Context and Problem Statement

ADR-0010 chose a **nudge-only** capture-guard: `SessionStart`/`PreCompact` inject reminders, but the agent still performs every capture. A long real session exposed the weakness — the nudge decays, and if no compaction ever fires the `PreCompact` reminder never fires either, so findings that live only in the conversation are lost when context is summarized.

We want capture that does **not** depend on the agent remembering, does **not** block or wedge the session, and works on **both Claude Code and Codex** across **Windows/macOS/Linux**. A Claude + Codex council (2026-06-20) cross-validated the design: a Claude-side review (four lenses) and a Codex-side review (`/codex:rescue` investigation + `/codex:review` + `/codex:adversarial-review`) ran independently and converged.

Decision criteria (the council's): (1) both agents, or degrade honestly; (2) cross-platform, pure Node; (3) compaction-proof; (4) non-intrusive; (5) low maintenance; (6) honest — no capability claimed an agent's hook surface can't back.

## Considered Options

1. **Status quo — nudge-only (ADR-0010).** Pro: stays a pure convention. Con: the highest-value rule depends on the agent remembering it; real findings still die in compaction.
2. **Deterministic inbox backbone + deterministic promote-at-read.** *(chosen)* Raw failure evidence is auto-logged to `.strata/inbox/captures.jsonl` the moment a tool fails; `/strata:capture` and `/strata:save` promote the real stubs into issues/learnings and clear the inbox; `/strata:load` surfaces the un-promoted count. The default distillation path needs no agent turn. Pro: defeats compaction loss (evidence is on disk, not in the conversation); non-blocking; ports to Codex because Codex's hook schema is Claude-compatible. Con: adds a two-stage memory model (inbox → promoted) and requires a read-side loop plus secret and concurrency safeguards before it is safe to ship default-on.
3. **B1 — blocking Stop hook for forced distillation.** Technically viable on both tools (Codex's `Stop` is blockable with a clean `stop_hook_active` unblock). Rejected as the default: runtime-intrusive (fires every turn-end, can hijack flow), carries wedge risk, and the inbox already makes the evidence compaction-proof, so "force before turn-end" buys nothing. Its one useful half — a non-blocking end-of-session transcript scan — is salvaged.
4. **B2 — model-dispatched background distiller subagent as the default.** The council brief's initial preference. Refuted by both reviews and demoted: a hook is a shell command and cannot spawn an in-session subagent on either tool, so B2's dispatch is model-initiated and gated on the very nudge-decay the inbox was built to route around. Since the evidence is already durable, in-session distillation is not time-critical. Kept as an **opt-in** for users who want fresher-context distillation.
5. **B3 — hook spawns a detached headless agent (`claude -p` / `codex exec`).** The only truly hook-triggered drain, but heavy: a separate billable run, auth/config inside the hook env, and working-tree collision risk. Advanced opt-in only.
6. **Codex stays nudge-only by design.** Overturned by the council: Codex's hook schema is intentionally Claude-compatible — `PostToolUse` fires on non-zero Bash exit and exposes `tool_input.command` / `tool_response` / `transcript_path` — so the deterministic `PostToolUse` auto-log ports with essentially no code change. Only the `PreCompact` transcript scan is genuinely Claude-schema-specific. Shipping Codex as nudge-only would be dishonestly pessimistic.

## Decision

Adopt **option 2**. A deterministic raw-evidence inbox is the compaction-proof backbone — shared stub schema `{ts,event,tool,signal,command,snippet,h}`, content-hash dedupe, and a **per-transcript** byte cursor — with per-agent capture adapters:

- **Claude:** `PostToolUse(Bash)` auto-log + `PreCompact` transcript scan + a **new non-blocking `SessionEnd`/`Stop` scan** (the salvaged half of B1) so capture is end-proof, not only compaction-proof.
- **Codex:** the `PostToolUse` auto-log **now** (honest-partial); the `PreCompact` scan **once three facts verify on a live build** — `tool_response` carries the failure output, `transcript_path` is non-null at `PreCompact`, and the rollout line schema is known. Codex now also documents **plugin-bundled hooks** (with trust review), which supersedes ADR-0010's constraint 2 ("Codex plugins cannot ship hooks").

**Distillation:** the default is **deterministic promote-and-clear** at `/strata:capture` and `/strata:save`, with `/strata:load` surfacing the un-promoted count. **B2** background distiller is an **opt-in**; **B1** is rejected as a default; **B3** is an advanced opt-in.

**Safety:** the inbox is **transient scratch** — `.strata/inbox/` is gitignored by default, raw stubs are redacted at write time, and promotion triages before anything durable is written. Nothing raw reaches committed memory.

## Consequences

- **The deterministic writer must not ship default-on, and `hooks/README.md` must stop describing the read-side loop and the Codex field names as live, until the prerequisites land.** Phased (full detail in `docs/deterministic-capture-design.md`):
  - **P1 (blocking):** wire the read-side promote-and-clear + count in `/strata:{load,capture,save}`, with the contract defined once in `SKILL.md`; gitignore `.strata/inbox/` + redact-at-write + triage-at-promote; fix the two cursor data-loss bugs (the 512 KB skip-ahead that marks unscanned bytes consumed, and the UTF-8 boundary forward-drift) and make writes multi-agent-safe (per-transcript cursor + atomic rename).
  - **P2:** `stubHash` collision fix; the non-blocking `SessionEnd` scan (P2, not P1, because it depends on first confirming Claude emits a usable `SessionEnd`/`Stop` event that won't loop — see design §13); signature precision (correlate `tool_result` back to a Bash `tool_use`; add Windows cmd/PowerShell signatures).
  - **P3:** the Codex `PostToolUse` adapter + verify-on-target before promoting Codex from honest-partial to full deterministic.
- The two-stage memory model (inbox → promoted) is new surface across capture/save/load plus dedup; the cost is bounded by defining it once in `SKILL.md` rather than per command.
- Installing the plugin now writes evidence to disk on tool failures — a further step from "pure convention" than ADR-0010, bounded by: gitignored transient scratch, redaction, action only inside strata projects, and one command to disable.
- ADR-0010 stays accepted and is **extended, not superseded** — its nudge remains the honest floor on any tool where the deterministic path is unavailable.

## Sources

- Claude Code — Hooks (`PostToolUse`, `PreCompact`, `SessionEnd`, `hookSpecificOutput.additionalContext`) — https://code.claude.com/docs/en/hooks
- Codex — Hooks (event list; "same event schema as hooks.json"; `PostToolUse` fires on non-zero Bash exit; `Stop` blockable with `stop_hook_active`; `transcript_path`; plugin-bundled hooks with trust review) — https://developers.openai.com/codex/hooks
- Codex — Subagents (`spawn_agent` / `multi_agent`) — https://developers.openai.com/codex/concepts/subagents
- Codex — session rollout files (`~/.codex/sessions/**/rollout-*.jsonl`) — https://github.com/openai/codex/discussions
- ADR-0010 — the nudge-only capture-guard this record extends
