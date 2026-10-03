---
name: capture
description: Use immediately when an agent hits a failure, retry loop, workaround, surprising behavior, gotcha, bug, decision, operator answer, or important finding that should not wait for /strata:save. Appends it to the pending-capture journal at once, with no commit needed; /strata:save files it into issues, learnings, decision records, and docs. Strata-aware when the project has `.strata/MANIFEST.md`; flat-mode fallback appends to `.strata/memory/project_state.md`.
---

# Capture Fresh Finding or Gotcha

Write it down now, then continue. Spending a few tokens on the spot beats losing the evidence to compaction.

**Authoritative rules live in `Skill: strata:strata`, especially §5 (immediate capture) and §5a (journal and inbox).** This command is the interrupt you use while working; `/strata:save` files what you captured and does the bookkeeping.

In this file, `strata` means `node "${CLAUDE_PLUGIN_ROOT}/skills/strata/scripts/strata.mjs"`. Codex and other tools run `node <skill folder>/scripts/strata.mjs`, where the skill folder holds the strata `SKILL.md`.

## When to use

Capture any important moment the instant it is clear, so the project's docs grow as you build:

- A command, tool, API, install, test, or deploy step failed and you retried or changed approach
- You found a bug, weakness, TODO, brittle assumption, config drift, or doc gap
- You learned a rule future agents should know before doing the same operation
- You used a workaround that should not be rediscovered later
- You settled a decision worth explaining later, or changed direction on an earlier one
- The operator answered a question whose answer future sessions need
- You worked out how an outside system actually behaves (runbook material)
- You pinned down a requirement, or the reasoning behind it, that belongs in a spec or PRD

## Process

### 1. Detect the mode

- `.strata/MANIFEST.md` present -> **strata mode**. Check `layout_version: 3`; if it differs (e.g. a legacy `strata_version: 0.0.3` stamp), stop and point at `MIGRATIONS.md`.
- `.strata/memory/project_state.md` present without a manifest -> **flat mode**. Append a concise fresh capture there; later `strata init` migrates and archives the flat source.
- Nothing present -> create `.strata/memory/project_state.md` as flat mode with the capture. Mention that `strata init` can upgrade it later.

State the detected mode in one line.

### 2. Append it to the journal

This is the capture. It writes one line to `.strata/inbox/journal.jsonl` in the main worktree, which git ignores, so it needs no commit and survives compaction and worktree removal.

```bash
strata journal add --kind <kind> --title "<one line>" [--lineage "<supersedes ADR-0007>"] [--ref <path>]... --text - <<'EOF'
<the full capture: what happened, why it matters, the evidence.
Failures: Tried / Error / Hypothesis / Repro.
Decisions: the options you turned down and why.>
EOF
```

| Kind | Use it for | Filed at save as |
|---|---|---|
| `decision` | a settled choice and its reasons | decision record (`docs/decisions/`) |
| `direction` | a change that overturns an earlier decision or spec | new decision record superseding the old one |
| `answer` | an operator answer future sessions need | the record it settles (decision, requirement, learning) |
| `finding` | a bug, weakness, task, or idea | issue |
| `gotcha` | a trap and its fix | learning, often with an issue |
| `learning` | a reusable rule, success or failure | learning |
| `requirement` | a requirement or its reasoning | `docs/product/` |
| `runbook` | how a system behaves, or a procedure | `docs/ops/` or `docs/architecture/` |
| `note` | anything else worth keeping | wherever save routes it |

Put the lineage on decisions and direction changes (`--lineage "supersedes ADR-0007"`, or `"answers 20261003-02"`). Keep the text concise: no raw logs, transcripts, or secret values. Secret-shaped values are masked on write as a backstop, not as permission.

### 3. Optionally file it now

When filing is cheap and the tree can take a loose file, you may also write the store file right away: an issue from `.strata/issues/_TEMPLATE.md` (get the id from `strata new-issue`), a learning from `learnings/_TEMPLATE.md`, a decision record numbered by `strata next-adr`, or a doc. Write the file first, then pass `--filed <path>` on the journal entry so save only checks it. In a repo with a slow commit gate or a commit ban, skip this step; the journal entry is enough.

Do not regenerate the views during capture. `/strata:save` does that.

### 4. Fold in the inbox

If the hook auto-logged the failure you are capturing, mention it in the text. Read the inbox counts with `strata inbox summary` only when it helps; promotion and clearing happen at save (skill §5a).

### 5. Report and resume

```
Mode: strata (layout 3).
Captured: journal j-20261003-134501-3f2a (decision: queue drains before deploy). 3 pending.
Continuing: <original task>
```

Then continue the original task unless the capture shows that the task is blocked.

## Invocation

- Claude Code: `/strata:capture`.
- Codex and other tools: `Skill(name='strata', args='capture')`.

## Do NOT

- Wait for `/strata:save`
- Ask the user what to capture when the session already shows it
- Keep the capture in a tool's private memory (Claude auto memory, Codex memory) instead of the journal
- Dump full logs, transcripts, secrets, or token values
- Move closed issues to archive during capture; save handles archive moves
- Regenerate generated views during capture unless the user explicitly asks
