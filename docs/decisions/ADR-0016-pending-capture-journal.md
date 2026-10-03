# ADR-0016: Capture goes to a pending journal first, shared across worktrees

- **Status:** implemented (0.1.0)
- **Date:** 2026-10-03

## Context and Problem Statement

[ADR-0012](ADR-0012-immediate-capture-all-moments.md) made capture write every important moment straight into its home under `.strata/`: an issue, a learning, a decision record, a doc. Those homes are tracked files. In a project whose commits run a six-minute test gate, with no commits allowed at night, every capture became either a loose uncommitted file or a capture put off until later. In one long session the agent gave up and kept a parallel log in Claude's private auto memory, which is the competing record strata exists to prevent.

A second gap made it worse. The hook wrote its inbox in the worktree the session happened to run in. In a project that uses one worktree per task, captures scattered across worktrees and vanished when a worktree was removed.

## Considered Options

1. **Keep writing tracked files at capture time.** Pros: one step, the record is in its final home at once. Cons: the failure above. A slow or blocked commit path turns every capture into loose files or a delay.
2. **Commit each capture as it happens.** Pros: nothing loose. Cons: runs the commit gate per capture, breaks night bans, floods history. Rejected.
3. **Capture to Claude's or Codex's own memory.** Rejected: tool-owned, invisible to the other tool, and exactly the competing log we want gone.
4. **A git-ignored journal that capture appends to, and save routes from.** *(chosen)* Pros: instant, no commit, survives compaction because it is on disk, one place for every session. Cons: a second stage before records reach their homes, and a journal that is never saved stays invisible to git.

## Decision

- `/strata:capture` appends one dated entry to `.strata/inbox/journal.jsonl`: a decision with its lineage, an operator answer, a finding, a gotcha, a requirement, a change of direction. The `strata journal add` script writes it and redacts secret-shaped values on the way in.
- `/strata:save` routes every entry into its real store in one pass, meant for one commit, and then clears the journal. The last cleared batch stays in `journal.routed.jsonl` so a bad pass can be redone.
- `/strata:load` shows the number of pending captures first.
- The agent may still file a record straight away when that is cheap. It then marks the entry `filed` so save only checks it.
- The inbox, the journal, the hook cursors and the small state file resolve to the main worktree of the repository when it holds `.strata/`, for the hook and the script alike. Outside git, or without `.strata/` in the main worktree, they stay in the current project root.

## Consequences

- Capture never waits on a commit path, so nothing pushes the agent toward a private log.
- Captures from every worktree of a clone land in one journal and one inbox, and survive worktree removal.
- Records reach their homes at save, not at capture. A session that never saves leaves its captures in the journal, where the next load reports them.
- The journal is local to one clone. Two machines do not share it. That is the same scope as the inbox before it.
- ADR-0012 stands for *what* gets captured. This record changes *where it lands first*.

## Sources

- [ADR-0011](ADR-0011-deterministic-capture-inbox.md): the git-ignored inbox this journal joins.
- [ADR-0012](ADR-0012-immediate-capture-all-moments.md): every important moment is captured.
- git worktree layout (`.git` file, `commondir`): https://git-scm.com/docs/git-worktree
