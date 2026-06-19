# ADR-0007: Warm-docs taxonomy (Diátaxis + arc42-informed), offered not prescribed

- **Status:** accepted
- **Date:** 2026-06-09

## Context and Problem Statement

0.0.2's warm tier (`docs/`) had grown by accretion: `ARCHITECTURE.md`, `OPS.md`, `decisions/`, `ops/`, `reference/`, `parked/`, `roadmap.md`. Two problems:

1. **Ambiguous boundaries.** "Is this `reference/` or `ops/`?" had no discriminator; `OPS.md` vs `ops/` was a size accident; `parked/` mixed a *work status* into the *docs* tree (fixed by ADR-0002).
2. **No home for whole document classes.** PRDs/product requirements had nowhere; full architecture specs (solution overview, data flow, tool surfaces, prompt design, observability — the things an agentic project actually needs specified) had no slot between a one-page codemap and an ADR.

One insight reframed the problem: the instinct toward "exhaustive docs" is the old dumping-ground instinct relocated — and that is *fine* if it is confined to the warm, on-demand tier. Bloat only hurts the hot path. So the taxonomy should allow exhaustiveness, structurally, where it is free.

Diátaxis supplies the discriminator the tree lacked: reference is *facts you look up*, how-to/ops is *procedures you perform*, explanation/decisions is *reasoning you revisit* — and mixing modes is the central anti-pattern. matklad's `ARCHITECTURE.md` defines the codemap: concise, names modules, no fragile deep links, "a map of a country, not an atlas". arc42 (the established architecture-documentation template) informs the checklist for per-topic architecture specs. The human/agent split (README for humans, agent files for tools) stays intact.

## Considered Options

1. **Keep 0.0.2's accreted tree.** Pros: no change. Cons: both problems stay.
2. **Full Diátaxis tree, prescribed upfront** (`tutorials/`, `how-to/`, `reference/`, `explanation/`).
   Pros: textbook-clean. Cons: empty-folder sprawl on day one; tutorials are mostly irrelevant for project memory; prescribing structure people don't need is how conventions get ignored.
3. **Curated taxonomy, offered at init, grown on demand.** *(chosen)*

## Decision

Option 3. The warm tier for scaffolded projects lives at **`.strata/docs/`** and offers:

| Home | What belongs there | Discriminator |
|---|---|---|
| `ARCHITECTURE.md` | Codemap + index into `architecture/` | "Where does X happen?" |
| `product/<slug>.md` | PRDs, product requirements (code projects) | What should exist and why |
| `architecture/<slug>.md` | Specs per topic: solution overview, data flow, tools, prompts, observability… (arc42-informed checklist) | How it works, in depth |
| `decisions/ADR-NNNN-<slug>.md` | Decisions: chosen *and excluded* options, supersede chain | Why it is this way |
| `reference/` | Stable facts: paths, schemas, APIs, conventions | Facts you look up |
| `ops/` (+ `ops/incidents/`, `ops/release-rollback.md`) | Procedures you perform; incident patterns; rollback runbook | Steps you execute |
| `CHANGELOG.md` | Release notes | What changed when |
| `roadmap.md` | Optional strategic themes, no deadlines | Where it is going |

- **Offered, not prescribed:** init scaffolds the folder homes and the `ARCHITECTURE.md` index; files appear when content does. No empty placeholder documents.
- **Grow-on-demand, exhaustive allowed:** warm docs may be as detailed as they like; they load only when a task needs them.
- strata's **own repo keeps a public root `docs/`** (DESIGN, decisions) because its docs are its product documentation, for humans on GitHub — recorded here so the asymmetry is deliberate, not drift.
- 0.0.2's `OPS.md`/`ops/` split collapses into `ops/`; `parked/` is gone (status lives in `issues/`, per ADR-0002).

## Consequences

- Every document class has exactly one home and a one-line discriminator; the "reference or ops?" question has an answer.
- PRDs and deep architecture specs get first-class homes, which matters for agentic projects where prompt design and tool surfaces deserve real specification.
- Cost: two docs conventions exist (scaffolded `.strata/docs/` vs strata's root `docs/`) — accepted and documented.
- `docs/_archive/` (single, optional) is the only archive in the docs tree — see ADR-0008.

## Sources

- Diátaxis — https://diataxis.fr/start-here/
- ekline — technical guide to Diátaxis (mode-mixing as the anti-pattern) — https://ekline.io/blog/a-technical-guide-to-the-diataxis-framework-for-modern-documentation
- matklad — ARCHITECTURE.md (codemap rules) — https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html
- PropelCode — structuring codebases for AI tools (human/agent doc split; Diátaxis-to-repo mapping) — https://www.propelcode.ai/blog/structuring-codebases-for-ai-tools-2025-guide
