# ADR-0005: Layered self-documenting docs; lean SKILL.md

- **Status:** accepted
- **Date:** 2026-06-09

## Context and Problem Statement

`SKILL.md` loads in full every time the skill is invoked — which is every `/strata-save`, every `/strata-load`, every init. By v2 it was accreting design rationale, philosophy, and comparison notes alongside the operational rules, and v3 adds three new subsystems (issues, learnings, migrations) that all want explanation.

The guidance on always-loaded files is unambiguous: "If your CLAUDE.md is too long, Claude ignores half of it… ruthlessly prune"; keep loaded-every-turn files under ~200 lines (HumanLayer runs theirs under 60); instruction-following degrades as rules pile up; skills are *designed* for progressive disclosure — a lean `SKILL.md` with deeper material in files loaded only when needed.

At the same time, v3's design is research-derived and worth recording durably — the reasoning must live *somewhere* in the repo, versioned with the code it explains, without taxing the operational path. The external research report cannot be that home: it is not in the repo, and links to private files rot.

## Considered Options

1. **Everything in SKILL.md.**
   Pros: one file. Cons: every invoke pays for rationale it never needs; the size cap and the completeness goal fight each other forever.
2. **Rationale only in the external research report.**
   Pros: zero repo weight. Cons: unversioned, unreachable from a clone, effectively lost.
3. **Layered docs, each with one job, linked not restated.** *(chosen)*
   - `skills/strata/SKILL.md` — operational rules only, loaded on invoke; links down for anything deeper.
   - `docs/DESIGN.md` — the exhaustive reference: memory-type model, every store, every schema, what-loads-when, mechanics.
   - `docs/decisions/ADR-*` — why each choice was made and what was rejected, with primary sources.
   - `MIGRATIONS.md` — version detection and transform ladder.
   - `CHANGELOG.md` — what changed per release.
   - `README.md` — human front door, including a research-basis section.
   - The research report stays external; ADRs cite its primary-source URLs directly, so nothing depends on the report file existing.

## Decision

Option 3. The repo becomes self-documenting in layers, and `SKILL.md` is held to *operational content only*: tier model as rules, routing table, store contracts, command contracts, init workflow, legacy guard. Where v2's SKILL.md explained, v3's links: rationale → ADRs, exhaustive detail → DESIGN, transforms → MIGRATIONS.

The same layering applies to scaffolded projects (ADR-0007 gives them the same shape under `.strata/docs/`): hot files index, warm docs explain, decisions record.

## Consequences

- Invoke-time token cost stays flat as the system grows; depth costs only when opened.
- Each question has one home: "how do I…" → SKILL.md; "how does it work" → DESIGN.md; "why is it this way" → ADRs; "how do I upgrade" → MIGRATIONS.md; "what changed" → CHANGELOG.md.
- More files must stay mutually consistent — mitigated by the define-once rule (states/types are defined in DESIGN.md and the MANIFEST template, reused verbatim everywhere else) and checked by the repo's lints.
- Discipline cost: future contributions must resist re-explaining in SKILL.md what a link can carry.

## Sources

- Claude Code — best practices (the over-specified CLAUDE.md failure mode) — https://code.claude.com/docs/en/best-practices
- HumanLayer — writing a good CLAUDE.md (progressive disclosure, <60 lines) — https://www.humanlayer.dev/blog/writing-a-good-claude-md
- redreamality — CLAUDE.md and AGENTS.md in depth (size thresholds, compliance decay) — https://redreamality.com/blog/claude-md-agents-md-deep-dive/
- Simon Willison — Claude Skills ("more than just prompts": SKILL.md + on-demand resources) — https://simonwillison.net/2025/Oct/10/claude-skills/
- Anthropic — effective context engineering (smallest high-signal token set) — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- matklad — ARCHITECTURE.md (curated few docs + ad-hoc notes; docs layering) — https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html
