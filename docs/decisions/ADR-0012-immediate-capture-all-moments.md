# ADR-0012: Immediate capture covers every important moment, not just issues and learnings

- **Status:** implemented — 2026-06-20
- **Date:** 2026-06-20

## Context and Problem Statement

`/strata:capture` and the capture-guard hook began as a fast path for the compaction-vulnerable kinds of knowledge: failures, gotchas, findings, and reusable lessons. Everything heavier — a settled decision, a change of direction, how an outside system actually works, the reasoning behind a requirement — was left for `/strata:save` to route into `docs/`. That defers the most valuable records to session end, where they are most likely to be lost to compaction or to a session that never gets a clean save. The point of strata is that the documentation grows as you build; capture that fires only on errors does not deliver that, and it makes the tool read as an error logger.

## Considered Options

1. **Keep capture narrow (issues + learnings); promote everything else at save.** Pros: capture stays light; one router (`save`) owns `docs/`; no ADR numbering in the capture path. Cons: decisions, runbooks, and specs are captured late or not at all; the docs do not grow mid-session.

2. **Broaden immediate capture to every important moment, written to its home as it happens.** *(chosen)* Capture, and the agent primed by the hook's `SessionStart` rule, writes decisions to `docs/decisions/`, runbooks to `docs/ops/`, specs to `docs/architecture/`, and PRDs to `docs/product/` the instant they are clear, using the same highest-plus-one ADR scan `save` runs (SKILL §6). `save` becomes the safety net (files anything missed), the finalizer (numbers and advances drafts), and the regenerator (views, `ARCHITECTURE.md`), rather than the sole router. Pros: docs grow as you build; the most valuable records survive compaction; the framing matches the purpose. Cons: capture does more and must run the collision scan; two writers can touch `docs/decisions/`, handled by the scan and by `save` never double-creating.

3. **A new hook event that auto-detects semantic moments.** Rejected: a hook reacts to mechanical signals (a failed command), so it cannot detect that a decision was made without the agent's judgment. The deterministic floor stays failures-only ([ADR-0011](ADR-0011-deterministic-capture-inbox.md)); the semantic moments are the agent's to write, which option 2 already covers.

## Decision

Immediate capture covers every important moment, each written to its durable home the moment it is clear. The deterministic hook still guarantees only failures; the richer moments are the agent's to capture, primed by the `SessionStart` rule and routed by §2/§5 of the skill. `/strata:save` keeps its guards, finalizes drafts, and regenerates the generated views — it is no longer the only writer of `docs/`.

## Consequences

- Decisions, runbooks, and specs land in `docs/` mid-session, so the record stays current without a manual write-up pass; less is left to keep up by hand.
- Capture runs the highest-plus-one ADR scan and may write `docs/`; `save` never double-creates an already-filed record and still owns regeneration.
- No on-disk layout change: `strata_version` stays `0.0.3`, no `MIGRATIONS.md` rung. This is a behavior and contract change, not a format change.
- The hook's honest limit is unchanged: it writes the evidence behind a failure; turning any moment into a finished record is still the agent's job.

## Sources

- MADR scope, "any decision worth explaining later qualifies": [README.md](README.md)
- Deterministic floor is failures-only: [ADR-0011](ADR-0011-deterministic-capture-inbox.md)
