# ADR-0018: A bundled, dependency-free script runs the mechanical chores

- **Status:** implemented (0.1.0)
- **Date:** 2026-10-03

## Context and Problem Statement

The save contract lists steps that need no judgment: regenerate ACTIVE, OPEN and PARKED and the learnings INDEX and the `MEMORY.md` table, move closed issues to the archive with index rows, roll old sessions out of `project_state.md`, and check budgets, vocabularies and links. Strata shipped no code for any of it, so agents did it by hand. In projects with strict commit gates they failed on small mistakes: a row out of order, a severity spelled wrong, a link off by one folder.

Three more problems need code. Generated views conflict on every parallel branch. "Highest id plus one" collides across branches and worktrees. Nothing flags commits that changed the project without a decision, doc or issue to explain them.

[ADR-0004](ADR-0004-generated-indexes-grep-router.md) already called regeneration "a hard contract". It just never had a tool behind it.

## Considered Options

1. **Keep it in prose.** Pros: no code to maintain. Cons: the failures above. Rejected.
2. **Python 3 standard library.** Pros: readable. Cons: not guaranteed on Windows, and the plugin would then need two runtimes.
3. **Node with only built-in modules.** *(chosen)* Pros: the hook is already Node, Claude Code and Codex both need Node to run it, the same code runs on Windows, macOS and Linux, and the hook's helpers can be shared. Cons: plain JavaScript with no type checking. Tests cover that.

## Decision

- Ship `skills/strata/scripts/strata.mjs`, inside the skill folder so every install path carries it. It uses `node:` modules only and calls git with argument lists, never a shell string.
- Subcommands: `views` (with `--check` and `--merge-driver`), `check`, `save --prepare` (with `--dry-run`), `setup`, `new-issue`, `next-adr`, `drift`, `status`, `journal`, `inbox`, `pointer`, `where`.
- The commands call it. Judgment stays with the agent: what to capture, where it belongs, how to word it. The script does the rest and prints what it changed and what it left for judgment.
- Views render in a fixed order. A git merge driver merges view tables by row and re-renders them, and `strata setup` installs it through `.gitattributes` and the local git config.
- Ids are picked after scanning the working tree, every worktree, recent local and remote-tracking branches, and a reservation list in the shared state file.
- The save report includes a drift list: commits since the last save that no decision record, doc, issue or learning mentions by path, folder, hash, branch or id.
- A project that renders views with its own tool sets `generated_views: external` in `MANIFEST.md`, and strata leaves its views alone.

## Consequences

- Regeneration is exact and repeatable, so a re-run with no new work changes nothing, as ADR-0004 requires.
- Parallel branches stop conflicting on views, and parallel sessions stop colliding on ids.
- Strata now ships code beside its Markdown. Memory stays plain Markdown and grep. The script is a helper, and every file it writes can still be edited by hand.
- The merge driver lives in local git config, so each clone runs `strata setup` once. Without it, git merges the views as plain text, as before.
- The drift check is a heuristic. A commit described only in prose is reported as drift.

## Sources

- [ADR-0004](ADR-0004-generated-indexes-grep-router.md): generated views and idempotent regeneration.
- gitattributes, custom merge drivers: https://git-scm.com/docs/gitattributes#_defining_a_custom_merge_driver
- git merge-file: https://git-scm.com/docs/git-merge-file
