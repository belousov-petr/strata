# ADR-0004: Generated-from-frontmatter indexes; grep as router; MANIFEST owns routing

- **Status:** accepted
- **Date:** 2026-06-09

## Context and Problem Statement

0.0.2 stated routing and structure in at least four places: `MEMORY-MAP.md` (routing table + where-to-look table), `MEMORY.md` (its own where-to-look table), `SKILL.md` (the canonical routing table), and the README (a third copy of the tree). Duplicated instruction surfaces drift — that is the single most-documented failure mode for agent context files.

Two design temptations had to be named and refused:

- **The map-of-maps.** Hand-maintaining ever-finer index files ("a map for the docs, a map for the maps") reinvents what grep already does over a well-named file tree — and rots the moment one file moves.
- **The hand-curated status list.** 0.0.2's `open_action_items.md` was a manually maintained view of work state; manual views and reality diverge.

The research points one way. ICM's contract files carry a load table (`Resource | When | Why`) **plus an explicit "What NOT to Load" exclusion table**, capped at ~80 lines. Anthropic's context-engineering guidance: maintain *lightweight identifiers* and retrieve just-in-time, rather than pre-loading. Claude Code's own memory loads a `MEMORY.md` index (first ~200 lines) with topic files on demand. The `llms.txt`-style docs-map pattern does the same for documentation. Datadog's monorepo guidance makes the root file a short router. And plain files + search hold up against heavier retrieval infrastructure.

## Considered Options

1. **Status quo:** hand-maintained tables in several files.
   Pros: none beyond inertia. Cons: guaranteed drift; every structural change is an N-file edit.
2. **Heavier index (SQLite/embeddings).**
   Pros: semantic recall, scale. Cons: infrastructure where grep measurably suffices; opaque to git; adds a build step to a markdown convention. Adopt only if grep demonstrably fails.
3. **One owner + generated views + grep.** *(chosen)*
   `MANIFEST.md` is the single owner of structure/routing; status-dependent index files are *generated from item frontmatter*; everything else is found by grep over a predictable tree. Pros: one edit point; views cannot drift from items (they are derived); navigation is read-manifest → read-index → grep. Cons: regeneration must be reliable — owned by `/strata-save`, checked by repo lints.

## Decision

Option 3, with explicit ownership rules:

- **`.strata/MANIFEST.md` is the only place routing and structure live** (per project): `strata_version`, what the project is, the structural overview, where-to-look, the three tiers, routing rules, load order. The canonical reference for the *pattern* is `docs/DESIGN.md` in the strata repo. Every other file links; none restates.
- **`MEMORY.md` becomes a pure hot index**: live pointers (state, active issues) plus the generated rules-by-trigger table. No routing table, no tier model, ≤80 lines.
- **Generated views, regenerated at every `/strata-save`** from frontmatter:
  - `issues/ACTIVE.md` (status `in-progress`), `issues/OPEN.md` (status `open`, grouped by area), `issues/PARKED.md` (status `parked`, with revive triggers);
  - `memory/learnings/INDEX.md` and the by-trigger table in `MEMORY.md`.
- **Grep is the router** for everything below the indexes. Frontmatter keys (`type:`, `status:`, `area:`, `trigger:`) exist precisely so `grep -l "status: parked" .strata/issues/` is a query language. No hand-maintained map below MANIFEST.

## Consequences

- Structural changes are a one-file edit (MANIFEST) plus regeneration.
- The hot path stays tiny and current; stale hand-lists disappear as a failure class.
- Requires discipline in file naming and frontmatter — enforced by templates and the issue/learning schemas.
- Regeneration is a hard contract on `/strata-save`; the repo's validation lints check that views match item frontmatter and `MEMORY.md` stays within budget.

## Sources

- DeployHQ — config-files guide (duplication drift) — https://www.deployhq.com/blog/ai-coding-config-files-guide
- Gist (LvlyBot) — ICM complete guide (load table + "What NOT to Load", ≤80-line contracts) — https://gist.github.com/LvlyBot/91c386584c99e4f3c300013d5cebaf78
- Van Clief & McDermott — Interpretable Context Methodology (arXiv:2603.16021) — https://arxiv.org/html/2603.16021v2
- Anthropic — Effective context engineering (smallest high-signal set; just-in-time retrieval) — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Claude Code — memory (`MEMORY.md` index + on-demand topic files) — https://code.claude.com/docs/en/memory
- Simon Willison — claude_code_docs_map.md / llms.txt pattern — https://simonwillison.net/2025/Oct/24/claude-code-docs-map/
- DEV / Datadog — steering agents in monorepos (root router pattern) — https://dev.to/datadog-frontend-dev/steering-ai-agents-in-monorepos-with-agentsmd-13g0
- Letta — Benchmarking AI agent memory (plain files vs graph) — https://www.letta.com/blog/benchmarking-ai-agent-memory
