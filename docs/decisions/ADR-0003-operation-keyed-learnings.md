# ADR-0003: Operation-keyed `learnings/` (ReasoningBank-style)

- **Status:** accepted
- **Date:** 2026-06-09

## Context and Problem Statement

0.0.2's behavioral memory was flat `feedback_<slug>.md` files: 10–25 lines each, with **Why** and **How to apply** sections. Three weaknesses showed up in practice:

1. **Preference-shaped.** The files mostly captured corrections ("don't do X again") and almost never captured *successful strategies worth repeating* — half the value of experience.
2. **No retrieval key.** Nothing said *when* a rule fires. The agent either re-read all of them (context bloat) or relied on remembering they exist (they don't).
3. **Flat sprawl.** `feedback_*` files accumulated beside state files with no index discipline of their own.

The research is unusually crisp here. ReasoningBank (Google Cloud AI, arXiv:2509.25140) distills generalizable strategy items from **both successful and failed** trajectories — "successes contribute validated strategies, while failures supply counterfactual pitfalls" — as small human-readable items (Title / one-sentence when-to-use / 1–3 sentences of content), and finds that retrieving *few* is optimal: k=1 outperformed k=4 (49.7% vs 44.4%). A-MEM structures lessons as linked, evolving notes; the memory-taxonomy literature calls this the procedural layer; Windsurf's docs explicitly prefer deliberate rules over auto-generated memories; Cursor makes memories user-approved. And Letta's benchmarking shows plain files holding up against heavier memory infrastructure (74.0% vs 68.5% for a graph-based competitor on LoCoMo).

## Considered Options

1. **Keep flat `feedback_*` files.**
   Pros: simplest; already works. Cons: all three weaknesses above stay; failures and successes indistinguishable; no when-to-fire key.
2. **Vector or graph store for lessons.**
   Pros: semantic recall at scale. Cons: infrastructure where files suffice (and measurably compete); opaque to git diff and grep; overkill for the tens-of-lessons scale a single project accumulates.
3. **`.strata/memory/learnings/<slug>.md` — operation-keyed, origin-tagged, index-generated.** *(chosen)*
   Pros: each lesson carries its firing condition in frontmatter (`trigger:` — "when about to do X"), an optional scope (`applies-when:` glob/area), and provenance (`origin: success|failure`); a generated `INDEX.md` plus a by-trigger table in `MEMORY.md` make lookup an operation-time check, not a bulk load; failure lessons become first-class pitfall warnings. Cons: one more folder; the index must be regenerated at `/strata-save`.

## Decision

Option 3. Behavioral memory moves from flat `feedback_*.md` to **`.strata/memory/learnings/<slug>.md`**:

```
---
trigger: <when this applies, operation-keyed>
applies-when: <glob/area, optional>
origin: success|failure
---
**Lesson:** <1–3 sentences>
```

- The routing key is the **operation**, not the date: "before pushing", "when editing templates", "when a test fails twice the same way".
- `origin:` records whether the lesson came from something that worked or something that burned us — capture both, per ReasoningBank.
- `learnings/INDEX.md` and the rules-by-trigger table in `MEMORY.md` are **generated from frontmatter** at `/strata-save` (ADR-0004). Retrieval discipline follows the k≈1 finding: consult the trigger table, open the one or two matching lessons, not the folder.
- `/strata-load` does not bulk-read learnings — same rule as 0.0.2's feedback files, now with a real index making the on-demand path actually work.

## Consequences

- Failures stop being embarrassments that evaporate and become the highest-value memory items.
- Lesson lookup costs one table row at load time and one file read at operation time.
- Migration: existing `feedback_*.md` content maps cleanly (Why → trigger, body → Lesson; origin best-guessed as `failure` since most corrections were) — see `MIGRATIONS.md`.
- The two memory systems stop being conflated: `project_state.md` stays recency-keyed ("what was I doing"), `learnings/` is operation-keyed ("what do I know about doing this").

## Sources

- ReasoningBank: Scaling Agent Self-Evolving with Reasoning Memory (arXiv:2509.25140) — https://arxiv.org/html/2509.25140v1
- MarkTechPost — Google Cloud AI introduces ReasoningBank — https://www.marktechpost.com/2026/04/23/google-cloud-ai-research-introduces-reasoningbank-a-memory-framework-that-distills-reasoning-strategies-from-agent-successes-and-failures/
- A-MEM: Agentic Memory for LLM Agents (arXiv:2502.12110) — https://arxiv.org/html/2502.12110v1
- Anatomy of Agentic Memory: taxonomy & empirical analysis (arXiv:2602.19320) — https://arxiv.org/html/2602.19320v1
- Park et al. — Generative Agents (memory stream: recency × importance × relevance) — https://arxiv.org/abs/2304.03442
- Letta — Benchmarking AI agent memory (filesystem beats graph on LoCoMo) — https://www.letta.com/blog/benchmarking-ai-agent-memory
- Windsurf/Devin — Cascade Memories (prefer explicit rules over auto-memories) — https://docs.devin.ai/desktop/cascade/memories
- Cursor — 1.0 changelog (Memories: proposed in background, user-approved) — https://cursor.com/changelog/1-0
