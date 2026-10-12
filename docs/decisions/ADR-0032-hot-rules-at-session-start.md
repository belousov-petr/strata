# ADR-0032: A project can keep the hot rules out of the adapters, and silence the hooks for agent runs

- **Status:** implemented (0.3.0)
- **Date:** 2026-10-12

## Context and Problem Statement

The hot rules reach every agent through a generated block in `CLAUDE.md` and `AGENTS.md` ([ADR-0019](ADR-0019-hot-rules-in-adapters-and-auto-memory-pointer.md)), and since 0.2.0 the block opens with the capture rule ([ADR-0027](ADR-0027-capture-rule-in-the-adapters.md)). In one large project, unattended production agents run in folders below the repository root, and Claude Code loads `CLAUDE.md` from parent folders. So every night agent read about 1,100 words of developer rules. Every save that changed a hot rule silently changed those agents' instructions, and the capture line told them to write into the developer journal. The strata hooks also ran in those agent sessions and logged their failures into the developer inbox.

The operator chose to change strata so a project can keep the block out of the adapter files.

## Considered Options

1. **Drop the block from the adapters for everyone.** Rejected: subagents and Codex still need the rules where they look, and most projects have no agents below the root.
2. **Have the project's agents ignore the block by prompt.** Rejected: the words still load into every run, and a prompt cannot stop a rule from steering an agent.
3. **A per-project switch: the block in a strata file, delivered by the session hook, plus a way to mark agent runs.** *(chosen)*

## Decision

- `hot_rules:` in the `MANIFEST.md` frontmatter takes `adapters`, the default and today's behaviour, or `session`. Any other value is a `strata check` error and works as `adapters`.
- In `session` mode, `strata views`, `strata setup` and `strata save --prepare` render the whole block into `.strata/memory/HOT-RULES.md`, between the same markers: the header, the capture rule, the rules and the overflow line. Links in that file are relative to `.strata/memory/`. Inside the `CLAUDE.md` and `AGENTS.md` markers they put one pointer line instead: "Development sessions: the strata session hook shows the hot rules from `.strata/memory/HOT-RULES.md`. If it did not, read that file before working." The markers stay, so switching back to `adapters` works.
- `strata check` reports drift in `HOT-RULES.md` and any adapter whose block is not the pointer line. In session mode `strata setup` adds `HOT-RULES.md` to the `.gitattributes` block, so the merge driver merges it by rule lines like an adapter. An adapter that holds only the pointer line gets a plain text merge. `strata check` warns when the attributes line is missing.
- The capture guard's `SessionStart` output appends the hot rules in session mode. It reads `HOT-RULES.md`, rewrites its links to start at the project root, and renders the rules itself when the file is missing. It fires on every `SessionStart` source, `compact` included. Claude Code replaces an `additionalContext` over 10,000 characters with a file path and a 2,000-character preview, so the whole string stays at or under 9,500 characters. When the rules would go over, the hook keeps the lines before the first rule, then as many whole rule lines as fit, then one line "N more hot rules in .strata/memory/HOT-RULES.md". A rule is never cut mid-line.
- `agent_env:` in the `MANIFEST.md` frontmatter lists environment variable names. When any of them is set and non-empty in a hook's environment, every strata hook, the capture guard and the lesson trigger, exits 0 at once with no output and writes nothing. It works in both modes. Its default is empty. The project in question sets `agent_env: [PAPERCLIP_AGENT_ID, PAPERCLIP_RUN_ID]`, which its runner sets for agent runs. The capture guard reads both keys with a small parser of its own, and the strata script reads them through that same function, so the hooks and the script agree.
- Codex development sessions get the rules at session start only when strata's Codex hooks are installed from `hooks/codex-hooks.sample.json`. Without them they rely on the pointer line.

## Consequences

- Agents below the root read one line instead of the developer rules, and a save no longer changes their instructions. With `agent_env` set, their runs leave nothing in the developer inbox and see no lessons.
- Development sessions get the rules from the hook, which is a weaker channel than a file the host always loads. A Claude Code session without the plugin's hooks, or a Codex session without the sample hooks, sees only the pointer line and has to read the file.
- Subagents do not get `SessionStart` context. In session mode they see the pointer line in the adapters and read the file when they need the rules.
- Switching a project rewrites both adapters and adds a file, which is one commit through the project's gate.

## Sources

- [ADR-0019](ADR-0019-hot-rules-in-adapters-and-auto-memory-pointer.md), [ADR-0020](ADR-0020-operation-triggered-lessons.md), [ADR-0026](ADR-0026-version-independent-merge-driver.md), [ADR-0027](ADR-0027-capture-rule-in-the-adapters.md)
- Claude Code hooks reference: https://docs.claude.com/en/docs/claude-code/hooks
