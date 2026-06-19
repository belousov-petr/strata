---
name: init
description: Use when setting up strata project memory in a repo for the first time, or upgrading a flat/older strata layout to the current format. Scaffolds the .strata/ tree, or runs the matching MIGRATIONS.md rung, archiving any existing memory before writing. Strata-aware; the authoritative scaffold and migrate rules live in the `strata` skill.
---

# Initialize or Upgrade Strata Memory

Set up `.strata/` project memory in this repo, or upgrade an older layout to the current format, in one pass.

**Authoritative rules live in `Skill: strata:strata` (section 8, `init`).** This command orchestrates the flow; the skill defines the preconditions, the existing-memory routing, the two questions, the template-to-target mapping, and the migration handoff. Do not restate them here — read them from the skill.

## When to use

- A repo has no project memory yet and you want strata set up
- User says "set up strata", "init strata", "scaffold project memory"
- A repo has flat or older strata memory and you want it on the current format

## Process

Run the skill's `init` flow:

1. **Preconditions.** Confirm the working directory is the project root inside a git repo. Detect existing memory before writing anything: a valid current-format `.strata/MANIFEST.md` means refuse (report it; re-bootstrap needs the user to move or delete it first); a flat or older layout routes to the matching `MIGRATIONS.md` rung instead of a fresh scaffold; a mixed or partial state stops and asks.
2. **Ask** (one prompt): the project name, and whether this is a code project (full `.strata/docs/` taxonomy) or a knowledge/ops project (memory + issues; docs grow later). During a migration, derive these from existing memory when obvious.
3. **Scaffold or migrate.** For a fresh project, write the templates from the skill's `templates/` (substituting the project name and today's date), with `AGENTS.md` and `CLAUDE.md` written only if absent. For flat or older memory, run the `MIGRATIONS.md` rung: archive the source first, then write the current-format files with provenance links back to the archived source.
4. **Report** what was created or migrated, plus the next steps, per the skill's `init` report block.

## Invocation

- Claude Code: `/strata:init`.
- Codex and other tools: `Skill(name='strata', args='init')`.

## Do NOT

- Scaffold a second memory beside existing flat or older memory — migrate it instead, archiving the source first
- Overwrite existing adapters; leave them as-is and report them
- Write project memory into `AGENTS.md` / `CLAUDE.md` — they are thin pointers to `.strata/MANIFEST.md`
