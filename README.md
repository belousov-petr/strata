# Strata

A tier-aware memory system for Claude Code that doesn't bloat your context window. Two slash commands (`/save-point`, `/load-point`) wired to one skill (`strata`) that owns the tier model, the routing, and the rollover.

> Tier-aware when the project has a `docs/PROJECT-MAP.md` — routes new knowledge to the right tier (hot memory, warm docs, cold archive) instead of dumping everything into one file. Works in flat mode too if the project hasn't adopted the pattern.

![Strata](Savepoint.png)

## Why this exists

I run multiple active projects. An intelligence pipeline, a content library, a couple of smaller scripts. Claude Code has memory — `CLAUDE.md` + per-project files under `~/.claude/projects/` auto-load every session — but it's only as good as what gets written to it. Without a habit of saving state at the end of each session, those files either stay empty or drift stale. Next time I opened a project I'd either scroll through yesterday's transcript or re-explain what I did last Thursday, what I tried that didn't work, what was almost done, what I was waiting on.

So I started writing a `project_state.md` at the end of every session. That worked for a month. Then it grew to 1,085 lines, carrying fourteen sessions of narrative, every decision I'd made, every gotcha I'd hit. The file was doing too many jobs — resumption point, decision log, reference manual, rejected-approaches graveyard — and the agent's memory search kept returning stale bits alongside current ones.

So I split it. Current state stays hot. Shipped decisions go to Architecture Decision Records (ADRs) — short, dated notes that capture what was decided and why, committed to git so they don't drift. Parked work gets a "revive when" trigger. Old sessions roll to a cold archive. The commands now route new knowledge to the right tier instead of dumping everything into `project_state.md`. Lighter context window, readable history, no archaeology next session.

## Why the name

The system separates three kinds of knowledge that live in different places and load at different times. Three layers. Like rock strata. The word names the shape of the thing — "savepoint" was the verb; the product is the layered memory discipline underneath.

## What's in this repo

Three things that work together. Two user-facing slash commands and one skill that both commands defer to for rules.

```
strata/
├── save-point.md                    # /save-point command
├── load-point.md                    # /load-point command
├── strata/
│   ├── SKILL.md                     # Authoritative tier model, routing rules, init workflow
│   └── templates/                   # Scaffolded into new projects by `init`
│       ├── MEMORY.md
│       ├── open_action_items.md
│       ├── project_state.md
│       ├── ARCHIVE.md
│       ├── action_log.md
│       └── PROJECT-MAP.md
└── references/                      # Older standalone docs (tier template, rollover rules)
```

**Why a skill and two commands, not three commands?** One source of truth for tier rules. Commands are the verbs you type; the skill is where the rules live. When the rules change, they change in one file. `save-point.md` and `load-point.md` reference the skill — they don't restate it.

## What it does

Three verbs.

### `/save-point`

Captures what happened in the current session and routes it. **Preview-confirm-execute** — the command proposes a single plan of file moves and waits for `y/n` before touching anything:

```
Proposed changes for /save-point:

NEW FILES:
- .claude/memory/feedback_synthesis.md  ← "prefer synthesis over dedup"
- docs/decisions/ADR-0015-voice-tags.md  ← promoted from project_voice_tags_design.md

APPENDS:
- .claude/memory/archive/action_log.md  ← F3, F4, F5 completion entries
- .claude/memory/project_state.md  ← session 47 block

MOVES:
- project_voice_tags_design.md  →  archive/source-adr-0015-voice-tags.md

DELETIONS (section-only):
- open_action_items.md: remove F3/F4/F5 blocks

SKIP (uncommitted edits — commit or stash first):
- .claude/memory/feedback_other.md

Confirm? (y/n)
```

Safeguards baked in:

- **Git-dirty check.** Files with uncommitted edits are skipped — you can't accidentally trample mid-thought work.
- **ADR numbering guard.** Scans `docs/decisions/` for the highest `ADR-NNNN` before assigning the next one.
- **Never deletes whole files.** Section-level deletion only. Misclassified content is always recoverable.
- **Idempotent.** Re-run with no new work → "no changes proposed."

Falls back to a single-file `project_state.md` dump if the project doesn't use the tier pattern.

### `/load-point`

Reads the saved state shallow-to-deep — `MEMORY.md` → `open_action_items.md` → `project_state.md` → `PROJECT-MAP.md` → architecture/ops only if the task needs them. Verifies against `git status` so stale hints don't get acted on silently. Presents a four-line orientation and the next action.

Hard skip: does **not** auto-re-read `feedback_*.md` files on load — they're referenced via `MEMORY.md` and fire when relevant. Does **not** auto-read anything in `archive/` — that's cold storage, grep on demand.

### `Skill: strata init`

One-shot scaffold for a new project. Invoke the skill with `init`, answer two questions (project name + code vs knowledge project), and it writes:

- `.claude/memory/` (MEMORY.md, open_action_items.md, project_state.md)
- `.claude/memory/archive/` (ARCHIVE.md, action_log.md)
- `docs/PROJECT-MAP.md` (with your project name substituted)
- `docs/decisions/` + `docs/parked/` (code projects only)

Idempotent — refuses to overwrite an existing setup.

## What it is and what it is not

It **is**:

- A pair of slash commands + a skill that enforce memory hygiene at session boundaries
- A lightweight way to split one monolithic state file into a tiered memory + docs structure
- Safe for existing projects — flat mode keeps working unchanged until you opt in
- A preview-first system — it will never move files without showing you the plan and getting `y`

It **is not**:

- A general-purpose memory framework. Scope is Claude Code projects, not multi-agent systems or cross-tool state sync.
- A wiki or documentation generator. It routes knowledge you produce during a session. It doesn't write your docs for you.
- A replacement for git. State files are hints. The repo is truth.
- An auto-hook. Saving is a deliberate typed act. See "Design choices" below.

## Design choices worth explaining

**Three tiers.** Hot loads every session, warm is grep-on-demand in git, cold is archive. Two tiers runs back into the monolith problem. More than three starts producing "where does this belong" arguments with the agent, and the agent tends to resolve them inconsistently.

**Skill + commands, not a plugin.** Skills are the natural home for rules; commands are the natural home for verbs the user types. Keeping them separate means the rules live in exactly one place (`strata/SKILL.md`) and both commands reference them. No rule duplication, no drift between "what save-point does" and "what load-point expects."

**Preview-confirm gate, not CLI flags.** I tried `--apply` as a safeguard for the move-execution phase; it felt wrong. Flags are CLI metaphors that don't fit a conversational agent. A single preview block and a `y/n` does the same job in a shape that matches how the agent and the human actually talk.

**Opt-in tier mode.** Auto-migration is nicer to install and worse to live with. Tiers only earn their keep on projects with real history. On a weekend script they're overhead. The commands look for `docs/PROJECT-MAP.md` and only switch modes if they find one — install and nothing changes unless you opt in.

**ADRs, not a wiki.** A wiki is for pages you keep editing. ADRs get written on the day the decision happens, dated, committed, and left alone. For decision provenance I wanted the second thing. MADR already had the format.

**`action_log.md` separate from session archive.** Completed actions that produced external artifacts (an upstream PR, an email sent, a comment posted) don't belong in the active `open_action_items.md` — it's called "open" for a reason — but they also don't naturally fit into a session narrative archive. They get their own append-only log in cold tier. Grep on demand answers "when did we post X?" without bloating the hot file.

**Trim at sessions, not line count.** Line counts drift with how chatty I was that week. "Three sessions back" is something I can reason about at 11pm, which is usually when I notice things are getting heavy.

## Memory tier system

The commands separate four kinds of knowledge:

| Tier | Where it lives | When loaded | What's in it |
|---|---|---|---|
| **Hot** | `.claude/memory/` | Every session (`MEMORY.md` auto) + on-demand | Active work, current session, evergreen behavioral rules |
| **Warm** | `docs/` (git-versioned) | On demand | Architecture, ADRs, roadmap, reference, parked items |
| **Cold** | `.claude/memory/archive/` + `docs/**/archive/` | Only when explicitly searching history | Superseded snapshots, ADR provenance, old session narratives, `action_log.md` |

A fourth kind lives in the project's code/config itself — anything derivable from reading files or `git log` should stay there, not in memory.

Authoritative rules: [`strata/SKILL.md`](strata/SKILL.md). Per-project scaffolds: [`strata/templates/`](strata/templates/).

## Installation

### Claude Code (CLI or Desktop)

Clone the repo and copy the commands + skill into your `~/.claude/` tree:

```bash
git clone https://github.com/belousov-petr/strata.git
cp strata/save-point.md ~/.claude/commands/save-point.md
cp strata/load-point.md ~/.claude/commands/load-point.md
mkdir -p ~/.claude/skills/strata
cp -r strata/strata/* ~/.claude/skills/strata/
```

Restart Claude Code. The commands appear as `/save-point` and `/load-point`. The skill is invocable as `Skill(name='strata')` — the commands defer to it for rules automatically.

To update later: `git pull` in the clone, re-copy.

### Scaffold a new project (tier mode from day one)

Inside the project root, invoke the skill:

```
Skill(name='strata', args='init')
```

It'll ask for the project name and project type, then scaffold `.claude/memory/` + `docs/PROJECT-MAP.md` + (for code projects) `docs/decisions/` and `docs/parked/`. Idempotent — refuses to overwrite existing setup.

### Opt in to tier mode for an existing project

If the project already has history in a flat `project_state.md`, run `/save-point` and it'll offer to migrate once the file crosses ~500 lines. Or explicitly ask: "migrate this project to the tier pattern."

## How save-point works

1. **Detects mode** — tier mode if `docs/PROJECT-MAP.md` exists; flat mode otherwise. Announces which one.
2. **Reads current memory** — `MEMORY.md`, `project_state.md`, active project/feedback files.
3. **Inventories this session's work** — code changes, decisions, experiments, failures, verifications.
4. **Captures the resumption point** — last completed action, immediate next action, prerequisites, uncommitted changes.
5. **Routes new knowledge** — decisions to ADRs, parked to `docs/parked/`, rules to `feedback_*.md`, narrative to `project_state.md`, completed external actions to `archive/action_log.md`.
6. **Preview-confirm-execute gate** — builds the full plan of new files / appends / moves / deletions, shows one preview block, waits for `y/n`. On `n`, aborts with zero writes. On `y`, executes writes → appends → moves → deletions.
7. **Applies rollover discipline** — trims `project_state.md` at 3+ sessions, promotes shipped initiatives to ADRs, parks stalled ones, archives older sessions.
8. **Updates `MEMORY.md` + `archive/ARCHIVE.md`** — keeps the indexes aligned.
9. **Fixes stale references** — scans for statements this session made wrong.
10. **Reports** — what was saved where, what got extracted, what got archived.

Full contract: [`save-point.md`](save-point.md) + [`strata/SKILL.md`](strata/SKILL.md) §5.

## How load-point works

1. **Detects mode** — tier or flat.
2. **Loads shallow-to-deep** — `MEMORY.md` → `open_action_items.md` → `project_state.md` (current + last completed only) → `PROJECT-MAP.md` → architecture/ops only if the task needs them. No bulk-loading ADRs, parked items, archives, or `feedback_*.md`.
3. **Orients from "WHERE WE LEFT OFF"** — pulls last action, next action, prerequisites, uncommitted scope.
4. **Verifies against git** — `git status`, `git log --oneline -5`, spot-check referenced files. Flags drift instead of silently acting on stale state.
5. **Presents a four-line summary** — what was last done, what's next, open items, prerequisites.
6. **Starts the next action on confirm** — without re-exploring the codebase.

Full contract: [`load-point.md`](load-point.md) + [`strata/SKILL.md`](strata/SKILL.md) §6.

## A few honest things

- **Trust `git status` when it disagrees with the state file.** Load-point flags the mismatch, but the flag is just text. If you skim past it, you're back to the problem it was meant to prevent.
- **Tier mode earns its keep on projects with real history.** On a weekend prototype, flat mode is fine and ADRs are overkill.
- **Where knowledge belongs is a judgment call.** Is a new caveat a behavioral rule (hot feedback) or a gotcha someone will grep for once a quarter (warm reference)? I've landed wrong on this often enough. In doubt, leave it in hot memory and let the next session's `/save-point` promote it if it turns out evergreen.
- **Archiving keeps the file around.** Files that roll to `memory/archive/` keep the same git tracking and the same grep-ability. What changes is whether the agent loads them without being asked.
- **The preview-confirm gate is a discipline, not a shield.** If you approve the preview without reading it, misclassified content moves anyway. Read the preview.
- **`action_log.md` only fires for external artifacts.** A closed internal task isn't worth logging — `git log` already has that. The bar is: did something end up outside this repo (an email, a PR comment, an API call with a durable URL)?

## What building this taught me

**A single file doesn't stay cheap.** The agent's memory search pulls from it every session, and the bigger the file, the more old and new get returned side by side. Ten sessions in, mine was still surfacing tasks I'd closed three weeks earlier. So I split it. Four smaller files, each narrow enough that memory search mostly pulls from the right one.

**The three-tier shape is borrowed.** Git has it. ADRs have it. Incident-response playbooks had it before Claude Code existed. Current state, decisions, archive. I only noticed the overlap after I'd built most of this, which is its own kind of embarrassing. Whatever's original here is the application to Claude Code.

**A drifting state file costs more than no state file.** A month in, mine had action items that had been closed for weeks, questions I'd answered in session two, and paragraphs that contradicted each other outright. Each was true when I wrote it; none were true together. Once you stop trusting the file, you go check the code anyway before acting on anything, and at that point reading the file is wasted motion.

**Completed items don't belong in an "open" list.** The most recent thing I was wrong about: leaving DONE entries in `open_action_items.md` with a tag, expecting "next memory sweep" to clean them up. That's tombstone-by-neglect. A separate append-only `action_log.md` in cold storage is the honest answer — active list is about what's open, log is about what got done.

**The name matters less than the boundaries.** I shipped this as "savepoint" first, because the verb was what I actually typed. It turned out the product was the layered discipline underneath, not the save moment. Renaming to "strata" cost nothing (private repo) and made the thing explain itself.

## Contributing

If you've run this and found gaps, I'd like to hear about it. Open an issue or PR with:

1. What kind of project you ran it on
2. What the routing got wrong (or what the preview-confirm gate let through)
3. What you'd add to fix it

## License

[MIT](LICENSE). Use it, fork it, ship it — credit appreciated but not required.

## Acknowledgments

Claude Code ([@claude](https://github.com/claude)) wrote this — the commands, the skill, the templates, this README. I designed the tier system, the routing rules, the rollover discipline, and the preview-confirm gate. Division of labor: mine is judgment, Claude's is typing speed.

The three-tier pattern borrows from Michael Nygard's [original ADR post](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions), the [MADR](https://adr.github.io/madr/) format, and incident-response playbook conventions. None of those were built for Claude Code. They just converge on the same separation, and that convergence is what made me trust the structure.

Companion skill: [`/shakedown`](https://github.com/belousov-petr/shakedown) for auditing what's broken in a project before you ship.

## Author

Petr Belousov

- GitHub: [@belousov-petr](https://github.com/belousov-petr)
- LinkedIn: [petrbelousov](https://www.linkedin.com/in/petrbelousov/)
