# ADR-0008: Git-native versioning; no version-archive folders

- **Status:** accepted
- **Date:** 2026-06-09

## Context and Problem Statement

As the docs tree grew richer (ADR-0007), the obvious next instinct appeared: per-folder version archives — `architecture/archive/spec-0.0.2.md`, dated copies of superseded runbooks, "old versions" subfolders. 0.0.2 already had `docs/**/archive/` conventions pointing this way.

The instinct is wrong for a git repo. Manual version-archives reinvent what git already does, badly: they double the tree, the copies drift from history, grep and memory search surface stale versions beside current ones — re-creating exactly the noise strata exists to eliminate — and "which file is canonical" becomes a question again.

What actually needs versioning resolves into four distinct needs: releases of the skill itself, superseded *decisions*, retired *documents*, and runtime *rollback procedures*. Each has an established mechanism: tags + changelog; ADR supersede-status (Nygard: reversed decisions are "marked superseded, not deleted or edited"; `adr-tools` automates the back-link); keeping records in source control so they stay in sync with code (ThoughtWorks' standing "Adopt" rationale); and an ops runbook for the runtime side.

## Considered Options

1. **Per-folder version archives** (`docs/**/archive/`, `-0.0.2` suffixes).
   Pros: visible without git knowledge. Cons: duplicates git history with a worse tool; stale copies pollute search; unclear canonical; per-folder archive indexes to hand-maintain — a standing invitation to drift.
2. **Git-native versioning.** *(chosen)*
   Pros: one history mechanism that already exists and cannot drift from itself; human-readable deltas where humans look (CHANGELOG); decision lineage explicit in the documents (supersede chains); the active tree contains only active content. Cons: requires tag/changelog discipline at release time; readers must use `git log` for deep history (acceptable — that is what it is for).

## Decision

Option 2. Versioning is handled by four git-native mechanisms, and **no version-archive folders exist**:

- **`git tag`** marks releases of strata itself (`0.0.3`, …); `strata_version` in scaffolded manifests tracks the *layout* generation (ADR-0006).
- **`CHANGELOG.md`** (root) records what each release changed, in prose.
- **ADR supersede-status** versions decisions: a reversed decision gets a new ADR; the old one gets `Status: superseded by ADR-NNNN` and is never edited or deleted.
- **`ops/release-rollback.md`** (in scaffolded projects' `.strata/docs/ops/`) owns the runtime question "how do I roll back a bad release" — a procedure, so it lives with ops per ADR-0007.

One narrow exception: a single, optional **`docs/_archive/`** for *retired documents* — docs that no longer describe anything current but are worth keeping readable (not versions of living docs; those are git history). 0.0.2's per-folder `docs/**/archive/` convention is retired.

The cold memory archive (`.strata/memory/archive/`) is unaffected: that is *memory* rollover (session narratives, ADR provenance, the action log), not document versioning.

## Consequences

- The active docs tree contains only current truth; history is one `git log -p` away.
- Release discipline becomes a checklist: tag + changelog entry (+ migration rung if breaking, per ADR-0006).
- Decision history reads as a chain of supersessions inside the decisions folder itself.
- Anyone browsing without git tooling sees less history than before — mitigated by CHANGELOG for releases and supersede notes for decisions, which cover the two histories humans actually ask about.

## Sources

- Michael Nygard — Documenting Architecture Decisions (supersede, don't edit or delete) — https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- MADR 4.0.0 — https://adr.github.io/madr/
- npryce/adr-tools (`adr new -s` automates supersede back-links) — https://github.com/npryce/adr-tools
- ThoughtWorks Tech Radar — Lightweight ADRs, Adopt ("store these details in source control… in sync with the code itself") — https://www.thoughtworks.com/en-us/radar/techniques/lightweight-architecture-decision-records
