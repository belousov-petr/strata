# Strata

A tier-aware, tool-neutral memory system for AI coding agents that doesn't bloat your context window. Two session verbs (`/save-point`, `/load-point`) wired to one skill (`strata`) that owns the tier model, the routing, and the rollover.

> Tier-aware when the project has a `.ai/MEMORY-MAP.md`. Routes new knowledge to the right tier (hot memory, warm docs, cold archive) instead of dumping everything into one file. Works in flat mode too if the project hasn't adopted the pattern.

![Strata](Strata.png)

## Why this exists

I run multiple active projects. Automation systems, content libraries, research notes, a couple of smaller scripts. I also switch between tools. Claude, Codex, Gemini, and whatever comes next all need the same project state, but tool-owned memory creates drift. Without a habit of saving state at the end of each session, those files either stay empty or become contradictory. Next time I opened a project I'd either scroll through yesterday's transcript or re-explain what I did last Thursday, what I tried that didn't work, what was almost done, what I was waiting on.

So I started writing a `project_state.md` at the end of every session. That worked for a month. Then it grew to 1,085 lines, carrying fourteen sessions of narrative, every decision I'd made, every gotcha I'd hit. The file was doing too many jobs: resumption point, decision log, reference manual, rejected-approaches graveyard. The agent's memory search kept returning stale bits alongside current ones.

So I split it. Current state stays hot. Shipped decisions go to Architecture Decision Records (ADRs). Short, dated notes that capture what was decided and why, committed to git so they don't drift. Parked work gets a "revive when" trigger. Old sessions roll to a cold archive. The commands now route new knowledge to the right tier instead of dumping everything into `project_state.md`. Lighter context window, readable history, no archaeology next session.

## Why the name

Three kinds of knowledge. Three places they live. Three different moments they load. Like rock strata.

"Savepoint" was the first name, because that was the verb I typed. The verb isn't the thing, though. The thing is underneath: which layer a piece of knowledge belongs to, and when it loads. "Strata" says that directly.

## What's in this repo

Three things that work together. Two user-facing slash commands, and one skill that both commands defer to for rules.

```
strata/
├── save-point.md                    # /save-point command
├── load-point.md                    # /load-point command
├── strata/
│   ├── SKILL.md                     # Authoritative tier model, routing rules, init workflow
│   └── templates/                   # Scaffolded into new projects by `init`
│       ├── AGENTS.md
│       ├── CLAUDE.md
│       ├── GEMINI.md
│       ├── MEMORY.md
│       ├── open_action_items.md
│       ├── project_state.md
│       ├── ARCHIVE.md
│       ├── action_log.md
│       └── MEMORY-MAP.md
└── references/                      # Older standalone docs (tier template, rollover rules)
```

**Why a skill and two commands, not three commands?** One source of truth for the tier rules. Commands are the verbs you type. The skill is where the rules live. When a rule changes, it changes in one file and both commands pick it up. I tried putting rules in both command files once. They drifted within a week.

## What it does

Three verbs.

### What Strata captures

Strata routes more than "what happened this session." The point is to preserve anything a future agent needs to resume work, operate the project, or fix it structurally without rediscovering the same facts.

It captures and routes:

- **Session state**: last completed action, next action, prerequisites, uncommitted scope, background processes, and verification results. This stays hot in `.ai/memory/project_state.md`.
- **Open work and status changes**: active blockers, in-flight initiatives, completed plain tasks, deferred items, and "do not re-raise" notes. Active items stay in `.ai/memory/open_action_items.md`; deferred items move to `docs/parked/` with a `Revive when:` trigger.
- **Behavioral memory**: rules the agent must apply in future sessions, such as "verify before asserting" or "never paste secret values." These live in `.ai/memory/feedback_<slug>.md` only when they change in-session behavior.
- **Decisions and tradeoffs**: shipped decisions with non-obvious rationale, rejected alternatives, constraints, consequences, and follow-up implications. These become `docs/decisions/ADR-NNNN-<slug>.md`; any in-flight source note is archived as ADR provenance.
- **Findings and weak spots**: bad execution, poor architecture, broken logic, brittle workflows, confusing APIs, missing tests, unclear ownership, bad docs, or anything that deserves a structural fix. A useful finding includes symptom, evidence, affected paths/systems, status, likely root cause or hypotheses, why a quick workaround is insufficient, structural fix direction, and acceptance criteria.
- **Gotchas and learnings**: things that would cause a future agent to waste time if forgotten, including failed approaches, surprising tool behavior, command pitfalls, dependency conflicts, or non-obvious project conventions. These route to hot feedback only if they change behavior; otherwise they belong in reference or operations docs.
- **Runbooks and operational lessons**: changed maintenance steps, health checks, deployment procedures, recurring incidents, recovery commands, monitoring interpretations, and "what this signal really means." These go to `docs/OPS.md`, `docs/ops/<topic>.md`, or `docs/ops/incidents/<symptom>.md`.
- **Documentation drift**: docs made wrong by the session, stale instructions, obsolete diagrams, old issues, dead parked notes, or duplicated sources of truth. Current docs are fixed in place. Historically useful stale docs move to the nearest `docs/**/archive/` folder with that archive's index updated.
- **Architecture and interface references**: system topology, data flow, stable interfaces, integration surfaces, path conventions, schema ownership, and architectural choices that do not need a full ADR. These go to `docs/ARCHITECTURE.md` or `docs/reference/<topic>.md`; choices with rationale become ADRs.
- **Config and environment mismatches**: env-var name drift, secret-binding drift, local config vs managed config mismatch, missing setup steps, OS-specific command differences, or credential-surface confusion. Strata records env var names, config surfaces, and mismatch status, never secret values.
- **Incidents**: symptoms, impact, root cause, remediation, verification, follow-up, and recurrence prevention. Incidents live in warm docs, usually under `docs/ops/incidents/`, not in hot memory.
- **External completions**: PRs opened, issues filed, comments posted, emails sent, bookings made, API actions with durable URLs. These are appended to `.ai/memory/archive/action_log.md` and removed from active open items.
- **Historical context**: old session narratives, superseded state snapshots, ADR source notes, and completion logs. These stay grep-able in cold archive but are not auto-loaded.

It deliberately does **not** capture raw secrets, long transcripts, full stack traces, full command logs, giant diffs, or facts that can be re-derived from code, filesystem layout, or `git log`.

### `/save-point`

Captures what happened in the session and routes it. Before anything moves, the command shows you a plan and waits for `y` or `n`:

```
Proposed changes for /save-point:

NEW FILES:
- .ai/memory/feedback_synthesis.md  ← "prefer synthesis over dedup"
- docs/decisions/ADR-0015-voice-tags.md  ← promoted from project_voice_tags_design.md

APPENDS:
- .ai/memory/archive/action_log.md  ← F3, F4, F5 completion entries
- .ai/memory/project_state.md  ← session 47 block
- docs/ops/runtime-health.md  ← new probe interpretation rule

MOVES:
- project_voice_tags_design.md  →  archive/source-adr-0015-voice-tags.md
- docs/parked/old-plan.md  →  docs/parked/archive/old-plan.md

DELETIONS (section-only):
- open_action_items.md: remove F3/F4/F5 blocks

SKIP (uncommitted edits, commit or stash first):
- .ai/memory/feedback_other.md

Confirm? (y/n)
```

Four safeguards:

- **Git-dirty check.** Files with uncommitted edits don't move. You can't accidentally trample mid-thought work.
- **ADR numbering guard.** Before assigning the next `ADR-NNNN`, it scans what's already in `docs/decisions/`.
- **Never deletes whole files.** Only sections within files get removed. Anything misclassified is recoverable.
- **Idempotent.** Run it twice with no new work and you get "no changes proposed."

If the project doesn't use the tier pattern, save-point falls back to a single-file dump in `project_state.md`.

It also captures more than a session narrative. Decisions, findings, gotchas, runbook updates, documentation drift, operational lessons, architecture choices, config mismatches, and improvement opportunities get routed to the durable owner instead of being buried in hot memory.

### `/load-point`

Loads the saved state shallow to deep. `.ai/MEMORY-MAP.md` first, then `.ai/memory/MEMORY.md`, then `open_action_items.md`, then `project_state.md` (current + last completed session only). Architecture and ops files only get opened if the task actually touches them. Then it runs `git status` to catch drift, and prints a four-line orientation.

Two explicit skips: it does not auto-read `feedback_*.md` files on load. Those are index-referenced, they fire when relevant. It also does not auto-read anything in `archive/`. That's cold storage. Grep on demand.

### `Skill: strata init`

One-shot scaffold for a new project. Invoke the skill with `init`, answer two questions (project name, and code vs. knowledge project), and you get:

- `.ai/memory/` with MEMORY.md, open_action_items.md, project_state.md
- `.ai/memory/archive/` with ARCHIVE.md, action_log.md
- `.ai/MEMORY-MAP.md` with your project name substituted in
- `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` thin adapters if they do not already exist
- `docs/decisions/` and `docs/parked/` if you picked "code project"
- optional warm-doc homes such as `docs/ARCHITECTURE.md`, `docs/OPS.md`, `docs/ops/`, and `docs/reference/` are referenced in the memory map and filled as the project needs them

Idempotent. If the setup already exists, init refuses to touch it. Existing adapter files are preserved rather than overwritten.

## What it is and what it is not

It **is**:

- A pair of slash commands + a skill that enforce memory hygiene at session boundaries
- A lightweight way to split one monolithic state file into a tiered memory + docs structure
- Safe for existing projects. Flat mode keeps working unchanged until you opt in.
- A preview-first system. It will never move files without showing you the plan and getting `y`.

It **is not**:

- A cloud sync layer or vector database. It is a repo-local file convention that any tool can read.
- A wiki or documentation generator. It routes knowledge you produce during a session. It doesn't write your docs for you.
- A replacement for git. State files are hints. The repo is truth.
- An auto-hook. Saving is a deliberate typed act. See "Design choices" below.

## Design choices worth explaining

**Three tiers.** Hot loads every session. Warm is grep-on-demand in git. Cold is archive. Two tiers puts you back in the monolith. More than three and the agent starts arguing with itself about where things belong, inconsistently.

**Skill + commands, not a plugin.** Rules live in one place, `strata/SKILL.md`. Commands are the verbs you type. When a rule changes, it changes in one file and both commands pick it up. I tried putting rules in both command files once. They drifted within a week.

**Preview-confirm gate, not CLI flags.** My first attempt had a `--apply` flag. It felt wrong. Flags are CLI thinking, and the agent is a conversation. A preview block plus a `y/n` does the same safety job in a shape that matches how we actually talk.

**Opt-in tier mode.** Auto-migration is easier to install and worse to live with. Tiers earn their keep on projects with real history. On a weekend script they're overhead. The commands look for `.ai/MEMORY-MAP.md`. If it's not there, nothing changes.

**ADRs, not a wiki.** A wiki is for pages you keep editing. ADRs get written the day the decision happens, dated, committed, left alone. For decision provenance I wanted the second thing. MADR already had the format.

**`action_log.md` separate from session archive.** Completed external actions (a PR, an email, a posted comment) don't belong in `open_action_items.md`. It's called "open" for a reason. But they also don't fit a session narrative. They get their own append-only log in cold tier. "When did we post X?" is a grep away without bloating anything hot.

**Trim at sessions, not line count.** Line counts drift with how chatty the week was. "Three sessions back" is something I can actually reason about at 11pm, which is usually when I notice things are getting heavy.

## Memory tier system

The commands separate knowledge by how often it should load and who owns the truth:

| Tier | Where it lives | When loaded | What's in it |
|---|---|---|---|
| **Hot** | `.ai/memory/` | Every session (`MEMORY.md` auto) + on-demand | Active work, current session, open findings, in-flight initiatives, evergreen behavioral rules |
| **Warm** | `docs/` (git-versioned) | On demand | Architecture, ADRs, operations, runbooks, incidents, reference, roadmap, parked items |
| **Cold** | `.ai/memory/archive/` + `docs/**/archive/` | Only when explicitly searching history | Superseded snapshots, ADR provenance, old session narratives, stale-but-useful docs, `action_log.md` |

A fourth kind lives in the project's code/config itself. Anything derivable from reading files or `git log` should stay there, not in memory.

Paths in Strata are project-relative (`.ai/...`, `docs/...`) so the same memory works on Linux, macOS, and Windows. When a saved operational step is OS-specific, write the relevant PowerShell and POSIX shell variants rather than assuming one machine.

### Scaffolded project structure

`strata init` gives a project this shape, then the project fills in only the warm docs it actually needs:

```text
<project>/
├── AGENTS.md                         # Codex adapter; points at .ai/MEMORY-MAP.md
├── CLAUDE.md                         # Claude adapter; points at .ai/MEMORY-MAP.md
├── GEMINI.md                         # Gemini adapter; points at .ai/MEMORY-MAP.md
├── .ai/
│   ├── MEMORY-MAP.md                 # project memory contract and routing map
│   └── memory/
│       ├── MEMORY.md                 # hot index; keep short
│       ├── open_action_items.md      # active work, findings, blockers, status
│       ├── project_state.md          # current + last completed session only
│       ├── feedback_<slug>.md        # behavior rules that change agent behavior
│       ├── project_<slug>.md         # in-flight initiatives
│       └── archive/
│           ├── ARCHIVE.md            # cold memory index
│           ├── action_log.md         # external completions, append-only
│           ├── YYYY-MM-sessions-*.md # old session narratives
│           ├── source-adr-*.md       # source notes behind ADRs
│           └── source-*.md           # provenance for promoted/parked/reference material
├── docs/
│   ├── ARCHITECTURE.md               # topology, data flow, interfaces
│   ├── OPS.md                        # lean operations runbook
│   ├── decisions/
│   │   └── ADR-NNNN-<slug>.md        # shipped decisions and rationale
│   ├── ops/
│   │   ├── incidents/                # incident notes and response patterns
│   │   └── archive/                  # stale historical ops docs
│   ├── reference/                    # stable paths, APIs, schemas, conventions
│   │   └── archive/                  # stale historical reference docs
│   ├── parked/                       # deferred initiatives with Revive when triggers
│   │   └── archive/                  # stale historical parked notes
│   └── roadmap.md                    # optional no-deadline strategic work
└── ...
```

The two archive families are intentionally separate:

- `.ai/memory/archive/` is cold memory: old session state, ADR source notes, action logs, provenance for memory that moved elsewhere.
- `docs/**/archive/` is cold documentation: historically useful docs that should not appear in active surveys. Do not leave "stale" banners in active docs; fix them or move them to archive.

Authoritative rules: [`strata/SKILL.md`](strata/SKILL.md). Per-project scaffolds: [`strata/templates/`](strata/templates/).

## Installation

### Claude Code (CLI or Desktop)

Clone the repo and copy the commands + skill into your Claude settings tree.

Linux/macOS:

```bash
git clone https://github.com/belousov-petr/strata.git
cp strata/save-point.md ~/.claude/commands/save-point.md
cp strata/load-point.md ~/.claude/commands/load-point.md
mkdir -p ~/.claude/skills/strata
cp -r strata/strata/* ~/.claude/skills/strata/
```

Windows PowerShell:

```powershell
git clone https://github.com/belousov-petr/strata.git
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\commands" | Out-Null
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills\strata" | Out-Null
Copy-Item strata\save-point.md "$env:USERPROFILE\.claude\commands\save-point.md" -Force
Copy-Item strata\load-point.md "$env:USERPROFILE\.claude\commands\load-point.md" -Force
Copy-Item strata\strata\* "$env:USERPROFILE\.claude\skills\strata" -Recurse -Force
```

Restart Claude Code. The commands appear as `/save-point` and `/load-point`. The skill is invocable as `Skill(name='strata')`. The commands defer to it for rules automatically.

To update later: `git pull` in the clone, re-copy.

### Other tools

Use `.ai/MEMORY-MAP.md` as the adapter target. In Codex, point `AGENTS.md` at `.ai/MEMORY-MAP.md`; in Claude, point `CLAUDE.md` at it; in Gemini, point `GEMINI.md` at it. The adapters stay thin. The memory itself lives in `.ai/`. `strata init` now scaffolds these adapters when they are absent.

### Scaffold a new project (tier mode from day one)

Inside the project root, invoke the skill:

```
Skill(name='strata', args='init')
```

It'll ask for the project name and project type, then scaffold `.ai/memory/` + `.ai/MEMORY-MAP.md` + (for code projects) `docs/decisions/` and `docs/parked/`. Idempotent. Refuses to overwrite an existing setup.

### Opt in to tier mode for an existing project

If the project already has history in a flat `project_state.md`, run `/save-point` and it'll offer to migrate once the file crosses ~500 lines. Or explicitly ask: "migrate this project to the tier pattern."

## How save-point works

1. **Detects mode.** Tier mode if `.ai/MEMORY-MAP.md` exists; flat mode otherwise. Announces which one.
2. **Reads current memory.** `MEMORY.md`, `project_state.md`, active project/feedback files.
3. **Inventories this session's work.** Code changes, decisions, experiments, failures, verifications.
4. **Captures the resumption point.** Last completed action, immediate next action, prerequisites, uncommitted changes.
5. **Routes new knowledge.** Decisions to ADRs, parked to `docs/parked/`, rules to `feedback_*.md`, findings to issues/action items/parked docs, architecture and operations to warm docs, narrative to `project_state.md`, completed external actions to `archive/action_log.md`.
6. **Preview-confirm-execute gate.** Builds the full plan of new files / appends / moves / deletions, shows one preview block, waits for `y/n`. On `n`, aborts with zero writes. On `y`, executes writes → appends → moves → deletions.
7. **Applies rollover discipline.** Trims `project_state.md` at 3+ sessions, promotes shipped initiatives to ADRs, parks stalled ones, archives older sessions.
8. **Updates `MEMORY.md` + `archive/ARCHIVE.md`.** Keeps the indexes aligned.
9. **Fixes stale references.** Scans for statements this session made wrong.
10. **Reports.** What was saved where, what got extracted, what got archived.

Full contract: [`save-point.md`](save-point.md) + [`strata/SKILL.md`](strata/SKILL.md) §5.

## How load-point works

1. **Detects mode.** Tier or flat.
2. **Loads shallow-to-deep.** `.ai/MEMORY-MAP.md` → `.ai/memory/MEMORY.md` → `open_action_items.md` → `project_state.md` (current + last completed only) → architecture/operations docs only if the task needs them. No bulk-loading ADRs, parked items, archives, or `feedback_*.md`.
3. **Orients from "WHERE WE LEFT OFF".** Pulls last action, next action, prerequisites, uncommitted scope.
4. **Verifies against git.** `git status`, `git log --oneline -5`, spot-check referenced files. Flags drift instead of silently acting on stale state.
5. **Presents a four-line summary.** What was last done, what's next, open items, prerequisites.
6. **Starts the next action on confirm.** Without re-exploring the codebase.

Full contract: [`load-point.md`](load-point.md) + [`strata/SKILL.md`](strata/SKILL.md) §6.

## A few honest things

- **If `git status` disagrees with the state file, trust git.** Load-point flags the mismatch, but the flag is just text on the screen. Skim past it and you're back to the problem this was supposed to prevent.
- **Tier mode is for projects with real history.** On a weekend prototype, flat mode is fine. ADRs are overkill.
- **Where knowledge belongs is a judgment call.** Is a new caveat a behavioral rule (hot feedback) or a gotcha someone will grep for once a quarter (warm reference)? I get this wrong often. When in doubt I leave it hot and let next session's save-point promote it if it turns out evergreen.
- **Archiving keeps the file around.** Files that roll to `.ai/memory/archive/` keep the same git tracking and the same grep-ability. What changes is whether the agent loads them without being asked.
- **The preview-confirm gate is discipline, not a shield.** If you approve the preview without reading it, misclassified content moves anyway. Read the preview.
- **`action_log.md` is for external artifacts only.** A closed internal task doesn't belong there. `git log` already has it. The bar: did something end up outside this repo (an email, a PR comment, an API call with a durable URL)?

## What building this taught me

**A single file doesn't stay cheap.** The agent's memory search pulls from it every session, and the bigger the file, the more old and new come back together. Ten sessions in, mine was still surfacing tasks I'd closed three weeks earlier. So I split it. Four smaller files, each narrow enough that memory search mostly pulls from the right one.

**The three-tier shape is borrowed.** Git has it. ADRs have it. Incident-response playbooks had it before AI coding tools existed. Current, decisions, archive. I only noticed the overlap after I'd built most of this, which is its own kind of embarrassing. What's useful here is applying that structure to AI-assisted project memory.

**A drifting state file costs more than no state file.** A month in, mine had action items that had been closed for weeks, questions I'd answered in session two, paragraphs that contradicted each other. Each was true when written. None were true together. Once you stop trusting the file, you check the code anyway before acting. At that point reading the file is wasted motion.

**Completed items don't belong in an "open" list.** Most recent thing I got wrong: leaving DONE entries in `open_action_items.md` with a tag, expecting the "next memory sweep" to clean them up. That's tombstone-by-neglect. Append-only `action_log.md` in cold storage is the honest answer. Active list is about what's open. Log is about what got done.

**The name matters less than the boundaries.** I shipped this as "savepoint" first, because the verb was what I typed. Turned out the product was the layered discipline underneath, not the save moment. Renaming to "strata" cost nothing (private repo, no external users) and the thing started explaining itself.

## Contributing

If you've run this and found gaps, I'd like to hear about it. Open an issue or PR with:

1. What kind of project you ran it on
2. What the routing got wrong (or what the preview-confirm gate let through)
3. What you'd add to fix it

## License

[MIT](LICENSE). Use it, fork it, ship it. Credit appreciated but not required.

## Acknowledgments

[Claude Code](https://claude.com/claude-code) ([@claude](https://github.com/claude)) wrote this - the skill, the commands, the templates, the docs. I designed the tier model and routing rules, decided what knowledge goes where and why, and directed the work. Division of labor: mine is judgment, Claude's is typing speed.

The three-tier pattern borrows from Michael Nygard's [original ADR post](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions), the [MADR](https://adr.github.io/madr/) format, and incident-response playbook conventions. None of those were built for Claude Code. They converge on the same separation, and that convergence is what made me trust the structure.

Companion skill: [`/shakedown`](https://github.com/belousov-petr/shakedown) for auditing what's broken in a project before you ship.

## Author

Petr Belousov

- GitHub: [@belousov-petr](https://github.com/belousov-petr)
- LinkedIn: [petrbelousov](https://www.linkedin.com/in/petrbelousov/)
