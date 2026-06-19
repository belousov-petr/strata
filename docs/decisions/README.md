# Decisions — strata's own ADRs

Architecture Decision Records for the strata skill itself. These ten records lock the v3 design: what was decided, what was considered and rejected, and the primary sources behind each call.

Scaffolded projects get their own decision log at `.strata/docs/decisions/` — this folder is about strata, not about your project.

## Format

MADR-derived ([MADR 4.0.0](https://adr.github.io/madr/)), trimmed to the sections that earn their keep:

```
# ADR-NNNN: <title>
Status / Date
## Context and Problem Statement
## Considered Options        (with honest pros and cons, including the rejected ones)
## Decision
## Consequences              (the costs too, not just the wins)
## Sources                   (primary URLs)
```

Rules:

- Numbered `ADR-NNNN-<slug>.md`, sequential, numbers never reused.
- Records are immutable once accepted. A reversed decision gets a new ADR; the old one is marked **superseded by ADR-NNNN**, never edited or deleted ([Nygard](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions)).
- Scope is MADR's, not just "architecture": any decision worth explaining later qualifies.

## Index

| ADR | Decision | Status |
|---|---|---|
| [ADR-0001](ADR-0001-strata-namespace-commands-adapters.md) | `.strata/` namespace, renamed commands, AGENTS.md + CLAUDE.md adapters | accepted (command naming revised by ADR-0009) |
| [ADR-0002](ADR-0002-unified-issues-backlog.md) | Single unified `issues/` backlog | accepted |
| [ADR-0003](ADR-0003-operation-keyed-learnings.md) | Operation-keyed `learnings/` (ReasoningBank-style) | accepted |
| [ADR-0004](ADR-0004-generated-indexes-grep-router.md) | Generated-from-frontmatter indexes; grep as router; MANIFEST owns routing | accepted |
| [ADR-0005](ADR-0005-layered-self-documenting-docs.md) | Layered self-documenting docs; lean SKILL.md | accepted |
| [ADR-0006](ADR-0006-in-repo-migrations-strata-version.md) | In-repo migrations keyed off `strata_version` | accepted |
| [ADR-0007](ADR-0007-warm-docs-taxonomy.md) | Warm-docs taxonomy (Diátaxis + arc42-informed), offered not prescribed | accepted |
| [ADR-0008](ADR-0008-git-native-versioning.md) | Git-native versioning; no version-archive folders | accepted |
| [ADR-0009](ADR-0009-claude-plugin-packaging.md) | Claude Code plugin packaging; forced command/skill namespacing (`/strata:save`) | accepted |
| [ADR-0010](ADR-0010-capture-guard-hook.md) | Optional capture-guard hook (Claude + Codex), nudge-not-enforce | accepted |

## Provenance

The v3 design came out of a deep-research pass over industry practice for long-lived agentic coding projects (repo conventions, agent instruction files, persistent memory architectures, decision records, documentation frameworks, named practitioners; scope 2024–2026). The report itself stays external to this repo; each ADR cites the primary sources directly so the reasoning is verifiable without it. The README's "Research basis" section carries the short version.
