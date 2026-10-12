# ADR-0030: Status and save warn when a newer strata is installed than the one running

- **Status:** implemented (0.3.0)
- **Date:** 2026-10-12

## Context and Problem Statement

A plugin loads when a session starts. On 11 Oct 2026 one session ran strata 0.1.1 although 0.2.0 was installed, because the update landed after the session began. A later Skill call in the same session loaded 0.2.0, so one save mixed two versions: the commands of one and the script of the other. Nothing warned. The cure is simple, a new session, but only if someone notices.

## Considered Options

1. **Do nothing and document it.** Rejected: nobody reads the documentation in the middle of a save.
2. **Have the script re-run itself from the newest install.** Rejected: the commands and the skill text in the session are still the old ones, so a silent switch makes the mix worse.
3. **Warn in the two places a save starts from.** *(chosen)*

## Decision

- `strata status` and `strata save --prepare` compare two versions. The running one is the plugin manifest found relative to the script, `.claude-plugin/plugin.json`, else `.codex-plugin/plugin.json`. The installed one is the highest `version` among the entries of `${CLAUDE_CONFIG_DIR or ~/.claude}/plugins/installed_plugins.json` whose key starts with `strata@`.
- When the installed version is greater, by numeric semver order with a pre-release below its release, both print a warning line first that says to start a new session before saving. `--json` carries `version: { running, installed, newer, warning }`.
- Any read or parse error, a missing file, or a version that does not parse means silence.
- `/strata:load` passes the warning on. `/strata:save` stops and asks the operator for a new session.

## Consequences

- A mixed-version save is visible before it starts.
- Only Claude Code's install record is read. A Codex-only setup, or a plain clone, has no record and never warns.
- A newer version installed for another project also triggers the warning. That is the cautious side: starting a new session costs little.

## Sources

- [ADR-0026](ADR-0026-version-independent-merge-driver.md), which reads the same install record to find the merge driver
