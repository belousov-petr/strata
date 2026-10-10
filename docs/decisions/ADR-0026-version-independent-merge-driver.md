# ADR-0026: The merge driver survives plugin updates

- **Status:** implemented (0.2.0)
- **Date:** 2026-10-10

## Context and Problem Statement

`strata setup` puts the generated-views merge driver into the clone's git config ([ADR-0018](ADR-0018-strata-script-for-mechanical-chores.md)). The command named the strata script by its absolute path, which for a Claude Code plugin is a versioned cache folder such as `…/plugins/cache/<marketplace>/strata/0.1.1/…`. A plugin update installs a new folder and later removes the old one. From then on every merge of a view ran a missing script, and git reported the file as conflicted with only one side's content. `save --prepare` repaired the line, but only at the next save in that clone.

## Considered Options

1. **Ask users to rerun `strata setup` after each update.** Rejected: nobody does.
2. **Rely on `node` and a script name on PATH.** Rejected: git may run without the user's PATH, and strata ships no binary.
3. **Warn in `strata status` when the configured path is gone.** Pros: simple. Cons: the merge still breaks until someone acts.
4. **A small launcher in the clone's git folder that finds the current install at merge time.** *(chosen, with option 3 as well)*

## Decision

- `strata setup` writes `.git/strata/merge-driver.mjs` (in the common git folder, so every worktree shares it) and points `merge.strata-views.driver` at it, with node by absolute path.
- At merge time the launcher looks for the strata script in this order: the path setup recorded, when that is a clone or fixed folder rather than a plugin cache folder; Claude Code's `plugins/installed_plugins.json`, a project-scoped install for this repository first, then a user install, newest first; the recorded path even if it is a cache folder; the newest cached version. It runs that script's merge driver.
- With no install found, it runs `git merge-file` itself, a plain three-way text merge, and says so on stderr. A merge never fails because of strata.
- `strata status` and `strata check` name a driver whose configured files no longer exist. `strata setup` repairs it, and `save --prepare` refreshes the launcher and the config line whenever they differ from the running version.

## Consequences

- A plugin update no longer breaks merges of the views.
- The node path is still absolute. Replacing node (an nvm upgrade, for example) breaks the line until the next save or setup; `strata status` names it.
- The launcher lives outside the working tree, so it is never committed and never shows in `git status`.

## Sources

- git attributes, defining a custom merge driver: https://git-scm.com/docs/gitattributes#_defining_a_custom_merge_driver
- [ADR-0018](ADR-0018-strata-script-for-mechanical-chores.md)
