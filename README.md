# Strata

A tool-neutral memory system for AI coding agents that doesn't bloat your context window. One owned namespace (`.strata/`), two session verbs (`/strata-save`, `/strata-load`), one skill (`strata`) that owns the rules. Version 3.

> Routes knowledge by the question you'd ask to retrieve it: session state, behavioral lessons, work items, durable docs, and history each live in their own store, load at their own moment, and stay small where it counts. Works in flat mode too if a project hasn't adopted the pattern.

![Strata](Strata.png)

## Why this exists

I run multiple active projects and switch between tools. Claude, Codex, Gemini, and whatever comes next all need the same project state, but tool-owned memory creates drift. Without a habit of saving state at session end, memory files either stay empty or contradict each other. Next time I opened a project I'd either scroll through yesterday's transcript or re-explain what I did last Thursday, what I tried that didn't work, what was almost done.

So I started writing a `project_state.md` at the end of every session. That worked for a month. Then it grew to 1,085 lines carrying fourteen sessions of narrative, every decision, every gotcha. The file was doing too many jobs, and memory search kept returning stale bits alongside current ones. v1 and v2 of strata split it into tiers: hot state, warm docs, cold archive.

v3 is what happened after I stress-tested that design against the industry. A deep-research pass over repo conventions, agent instruction files, persistent memory architectures, and decision-record practice (sources below) validated most of v2 and exposed the weak spots: the action-items file was quietly becoming a new monolith, behavioral memory captured corrections but never successful strategies and had no retrieval key, routing rules were stated in four places, and findings discovered mid-task died in context compaction before reaching disk. v3 fixes those four things and renames the namespace to the one thing that owns it.

## Why the name

Three kinds of knowledge, three places they live, three moments they load. Like rock strata.

"Savepoint" was the first name, because that was the verb I typed. The verb isn't the thing. The thing is underneath: which layer a piece of knowledge belongs to, and when it loads.

## What's in this repo

```
strata/
├── strata-save.md                 # /strata-save command
├── strata-load.md                 # /strata-load command
├── strata/
│   ├── SKILL.md                   # the authoritative rules (lean, operational)
│   └── templates/                 # scaffolded into projects by init (mirrors .strata/)
├── docs/
│   ├── DESIGN.md                  # exhaustive reference: every store, schema, lifecycle
│   └── decisions/                 # ADR-0001..0008 — why v3 is shaped this way
├── MIGRATIONS.md                  # flat/v1/v2 → v3 ladder: detect, transform, rollback
├── CHANGELOG.md                   # what changed per release
└── tests/                         # scaffold check + repo lints
```

Why a skill and two commands, not three commands: one source of truth for the rules. Commands are the verbs you type; the skill is where rules live. I tried putting rules in both command files once. They drifted within a week. The same layering applies to the docs: the skill stays lean and operational, [DESIGN.md](docs/DESIGN.md) carries the depth, the [ADRs](docs/decisions/README.md) carry the why, and none of them restate each other.

## The shape of a strata project

`strata init` scaffolds this:

```
<project>/
├── AGENTS.md · CLAUDE.md          # thin adapters → .strata/MANIFEST.md
├── README.md                      # your project's human front door
└── .strata/
    ├── MANIFEST.md                # the contract: strata_version, structure, routing, load order
    ├── memory/                    # HOT
    │   ├── MEMORY.md              # pure index: live pointers + rules-by-trigger table (≤80 lines)
    │   ├── project_state.md       # current + last completed session (≤200 lines)
    │   ├── learnings/             # operation-keyed lessons + generated INDEX.md
    │   └── archive/               # COLD: old sessions, ADR provenance, action_log.md
    ├── issues/                    # the single backlog
    │   ├── ACTIVE.md · OPEN.md · PARKED.md    # generated views
    │   ├── <id>-<slug>.md         # one item per file
    │   └── archive/               # resolved / wont-fix
    └── docs/                      # WARM, grows on demand
        ├── ARCHITECTURE.md        # codemap + index
        ├── product/ · architecture/ · decisions/ · reference/ · ops/
        └── CHANGELOG.md · roadmap.md   (when they exist)
```

Everything strata-owned sits under `.strata/`. The name is the point: like a lockfile, the directory announces its format and version (`strata_version: 3` in the manifest), collides with nothing, and any tool can read it ([ADR-0001](docs/decisions/ADR-0001-strata-namespace-commands-adapters.md)). The adapters stay thin pointers; `AGENTS.md` keeps room for your project's own build/test/style content, which is what that standard is for.

## The memory-type model

Each store has one routing key, the dimension you'd use to look something up:

| Store | Key | Question it answers | Tier |
|---|---|---|---|
| `memory/project_state.md` | recency | "What was I doing?" | hot |
| `memory/learnings/` | operation | "What do I know about doing this?" | hot index, fired on match |
| `issues/` | status | "What work exists, in what state?" | hot view, warm items |
| `docs/` | topic | "What is true, how, and why?" | warm |
| `archive/` + `action_log.md` | time | "What happened? Did we send X?" | cold |

Anything derivable from the repo itself (code, `git log`, folder structure) gets no store at all. Mixed keys are why memory files bloat; one key per store is the core invariant.

### What loads when

| Moment | Loads |
|---|---|
| `/strata-load` | `MANIFEST.md` → `MEMORY.md` → `issues/ACTIVE.md` → `project_state.md` (current + last) |
| Picking new work | `issues/OPEN.md`, filtered by area |
| About to do operation X | the one or two `learnings/` files whose trigger matches |
| Task touches a topic | the specific `.strata/docs/` file |
| Explicit history question | `archive/`, via grep |
| Never automatically | learnings in bulk, ADRs in bulk, items in bulk, anything in archive |

Exhaustive documentation is welcome in the warm tier. Bloat only hurts the hot path, and the hot path is defended by budgets and routing, not by writing less down.

## The backlog

One store for findings, tasks, and initiatives: `.strata/issues/`, one file per item, frontmatter-keyed ([ADR-0002](docs/decisions/ADR-0002-unified-issues-backlog.md)).

- **Capture is immediate.** The moment a finding or bug surfaces mid-task, the item file gets written with full rationale and diagnostics (Tried/Error/Hypothesis/Repro), status `open`, and work continues. Context compaction can't eat what's on disk. v2 held findings in conversation until save time; that's where they went to die.
- **Types** `bug | improvement | debt | task | feature | initiative` and **statuses** `open | in-progress | parked | resolved | wont-fix`. Initiatives are just a type now; parked is just a status with a mandatory `revive-when:` trigger.
- **Status changes are frontmatter edits**, not file moves. Closed items move to `issues/archive/` and stay greppable.
- **The views are generated.** `ACTIVE.md`, `OPEN.md`, `PARKED.md` regenerate from item frontmatter at every `/strata-save`. Nobody hand-maintains a status list, so the list can't lie ([ADR-0004](docs/decisions/ADR-0004-generated-indexes-grep-router.md)).

`action_log.md` stays separate on purpose: an append-only ledger of completed actions that left the repo (a PR, an email, a posted comment with a durable URL). An issue tracks work; the action log records that something reached the outside world.

## Learnings

Behavioral memory, rebuilt on the ReasoningBank result ([ADR-0003](docs/decisions/ADR-0003-operation-keyed-learnings.md)): lessons distilled from failures as well as successes, stored small, retrieved sparingly.

```
---
trigger: before pushing to a shared branch
origin: failure
---
**Lesson:** Run the repo lint first; the hook only catches secrets, not broken
cross-references. Cost one force-push to learn.
```

The routing key is the operation, not the date. A generated by-trigger table in `MEMORY.md` makes lookup a glance, and the discipline is to open the one or two matching lessons at operation time, never the whole folder. Failures with their counterfactual fix are the highest-value entries; v2's feedback files captured corrections only and had no firing condition.

## The two commands

### `/strata-save`

Inventories the session (resumption point, issue events, learnings, decisions, doc impact, external completions), routes everything per the manifest, and shows one audit preview block before writing automatically:

```
Proposed changes for /strata-save:

NEW FILES:
- .strata/issues/20260609-02-router-drift.md  ← finding, full diagnostics
- .strata/memory/learnings/bulk-renames.md  ← "before bulk renames…"
- .strata/docs/decisions/ADR-0007-queue-drain.md  ← promoted

UPDATES (frontmatter / sections):
- .strata/issues/20260601-01-flaky-probe.md: status in-progress → resolved

MOVES:
- .strata/issues/20260601-01-flaky-probe.md → issues/archive/

DELETIONS (section-only):
- project_state.md: roll session 12 → archive/2026-06-sessions-11-12.md

REGENERATED:
- issues/ACTIVE.md · OPEN.md · PARKED.md · learnings/INDEX.md · MEMORY.md trigger table
```

Invoking `/strata-save` is the confirmation; there is no second y/n gate. Safeguards: git-dirty files are never moved, ADR numbers are collision-checked, deletions are section-only, and re-running with no new work proposes nothing.

### `/strata-load`

Loads shallow to deep (`MANIFEST` → `MEMORY` → `ACTIVE` → state), verifies against git (`git status`, recent commits, spot-checks), then orients in six lines: last session, next action, active items, prerequisites, fired revive-triggers, drift. State is a hint; the repo is truth.

### `Skill: strata init`

One-shot scaffold or migration. Fresh projects get two questions (project name, code vs knowledge project), then the tree above, with adapters written only if absent. Existing flat memory is archived and migrated instead of overwritten; v1/v2 layouts route into the migration ladder instead of double-initializing.

## Research basis

v3's choices trace to primary sources; each [ADR](docs/decisions/README.md) cites its own. The load-bearing ones:

- **AGENTS.md is a real standard now** ([agents.md](https://agents.md/), [Linux Foundation / AAIF](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)), but [Claude Code doesn't read it natively](https://gist.github.com/yurukusa/d36197848911f025add142abefcde685), so the CLAUDE.md shim stays; Gemini is [config-wirable](https://github.com/google-gemini/gemini-cli/discussions/1471), so GEMINI.md is gone.
- **Duplicated instruction files drift; auto-generated ones can be worse than none** ([DeployHQ guide](https://www.deployhq.com/blog/ai-coding-config-files-guide)). Hence one contract file and generated views.
- **Always-loaded files must stay lean** ([Anthropic best practices](https://code.claude.com/docs/en/best-practices), [HumanLayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md)); **retrieve just-in-time** ([Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).
- **Tiered file memory is the converged pattern** ([Cline Memory Bank](https://docs.cline.bot/features/memory-bank), [Letta/MemGPT](https://www.letta.com/blog/agent-memory), [Claude Code's own memory](https://code.claude.com/docs/en/memory)), and **plain files compete with heavy infra** ([Letta benchmark](https://www.letta.com/blog/benchmarking-ai-agent-memory)).
- **ReasoningBank** ([arXiv:2509.25140](https://arxiv.org/html/2509.25140v1)): distill lessons from successes *and* failures; retrieving few (k≈1) beats retrieving more.
- **Folder structure as agentic architecture** ([ICM, arXiv:2603.16021](https://arxiv.org/html/2603.16021v2)): contract files with load tables and explicit what-not-to-load.
- **Decision records**: [Nygard's ADRs](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions), [MADR 4.0](https://adr.github.io/madr/), [ThoughtWorks "Adopt"](https://www.thoughtworks.com/en-us/radar/techniques/lightweight-architecture-decision-records).
- **Docs structure**: [Diátaxis](https://diataxis.fr/start-here/) for the reference/ops/decisions discriminators, [matklad](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html) for the codemap.

## Installation

### Claude Code

Clone, then copy the commands and skill into your Claude settings tree. Upgrading from v1/v2: remove the old skill copy and command files first, the names changed.

Linux/macOS:

```bash
git clone https://github.com/belousov-petr/strata.git
rm -rf ~/.claude/skills/strata ~/.claude/commands/save-point.md ~/.claude/commands/load-point.md
mkdir -p ~/.claude/commands ~/.claude/skills/strata
cp strata/strata-save.md strata/strata-load.md ~/.claude/commands/
cp -r strata/strata/* ~/.claude/skills/strata/
```

Windows PowerShell:

```powershell
git clone https://github.com/belousov-petr/strata.git
Remove-Item -Recurse -Force "$env:USERPROFILE\.claude\skills\strata" -ErrorAction SilentlyContinue
Remove-Item -Force "$env:USERPROFILE\.claude\commands\save-point.md","$env:USERPROFILE\.claude\commands\load-point.md" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\commands" | Out-Null
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills\strata" | Out-Null
Copy-Item strata\strata-save.md,strata\strata-load.md "$env:USERPROFILE\.claude\commands\" -Force
Copy-Item strata\strata\* "$env:USERPROFILE\.claude\skills\strata" -Recurse -Force
```

Restart Claude Code. The commands appear as `/strata-save` and `/strata-load`; the skill is invocable as `Skill(name='strata')`. To update later: `git pull` in the clone, re-run the copy block.

### Other tools

`AGENTS.md` is the canonical entry point. Codex reads it natively. For Gemini CLI, set `settings.json` `"context": {"fileName": ["AGENTS.md", "GEMINI.md"]}` or import it with a `Please follow @./AGENTS.md` line. Every adapter ends up at `.strata/MANIFEST.md`, which is where the actual contract lives.

### Scaffold a project

Inside the project root: `Skill(name='strata', args='init')`. Fresh projects get two questions and one tree. Projects with flat or legacy memory migrate through `MIGRATIONS.md`; source memory is archived before v3 files are written.

## Migrating from flat/v1/v2

[`MIGRATIONS.md`](MIGRATIONS.md) is the ladder. It detects the generation by fingerprint (flat: `.strata/memory/project_state.md` without a manifest; v1: `docs/PROJECT-MAP.md` or `.claude/memory/`; v2: `.ai/MEMORY-MAP.md`), then runs an ordered, gated transform with a rollback anchor. Flat memory is moved into `memory/archive/source-flat-project-state-*` before the new hot state is written. v1/v2 migrations handle namespace rename, manifest rewrite, extraction of `open_action_items.md` + `project_<slug>.md` + `docs/parked/` into the issues backlog, `feedback_*` conversion into learnings, and view regeneration. Content-bearing steps archive their sources before deleting anything. The old `/save-point` and `/load-point` command names are gone; install the new files per above.

## Version

**v3.0.0.** Layout generation `strata_version: 3`, stamped in every scaffolded manifest. History in [`CHANGELOG.md`](CHANGELOG.md); releases are git tags.

## A few honest things

- **If `git status` disagrees with the state file, trust git.** Load-point flags the mismatch, but the flag is just text on the screen.
- **The save preview is an audit trail, not a shield.** `/strata-save` writes automatically after the preview; misclassified content can still move if the session inventory is wrong.
- **Where knowledge belongs is still a judgment call.** The discriminators (rule vs procedure vs fact; issue vs learning) decide most cases; when in doubt, leave it hot and let the next save promote it.
- **Generated views are only as fresh as the last save.** The items are the truth; the views are a cache with a regeneration contract.
- **Strata is a convention, not a daemon.** Nothing enforces the mid-session capture rule except the skill's instructions and your habit. The structure makes the right thing cheap; it can't make the wrong thing impossible.

## What building this taught me

**A single file doesn't stay cheap.** Memory search pulls from it every session, and old and new come back together. Splitting by routing key fixed what splitting by size never did.

**The dumping-ground instinct relocates.** I fixed `project_state.md` in v1, then watched `open_action_items.md` quietly become the same thing: one file, several jobs, drifting sections. The fix wasn't a better file; it was admitting work items are a collection, not a document.

**Findings die in compaction.** The most expensive v2 failure was invisible: a sharp diagnosis made mid-task, held in conversation memory for the save ritual, gone when the context compacted. Write-to-disk-immediately is the single highest-value rule in v3.

**Hand-maintained lists lie.** Every status list I maintained by hand eventually disagreed with reality. Views generated from item frontmatter can't.

**Versioning was already solved.** I almost built per-folder version archives before noticing I was reinventing `git log` with worse ergonomics. Tags, a changelog, and supersede-status cover everything I actually needed ([ADR-0008](docs/decisions/ADR-0008-git-native-versioning.md)).

**Research validates more than it redesigns.** The deep-research pass kept ~85% of v2. The value was in the corrections it forced me to name precisely, and in being able to cite why the structure is the way it is instead of "it felt right."

## Contributing

If you've run this and found gaps, I'd like to hear about it. Open an issue or PR with: what kind of project you ran it on, what the routing got wrong (or what the save preview let through), and what you'd change.

## License

[MIT](LICENSE). Use it, fork it, ship it. Credit appreciated but not required.

## Acknowledgments

[Claude Code](https://claude.com/claude-code) ([@claude](https://github.com/claude)) wrote this - the skill, the commands, the templates, the docs. I designed the tier model and routing rules, decided what knowledge goes where and why, and directed the work. Division of labor: mine is judgment, Claude's is typing speed.

The pattern stands on prior art: Michael Nygard's [ADRs](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions), the [MADR](https://adr.github.io/madr/) format, incident-response playbook conventions, and the 2024–2026 agent-memory literature credited in [Research basis](#research-basis) and the ADRs.

Companion skill: [`/shakedown`](https://github.com/belousov-petr/shakedown) for auditing what's broken in a project before you ship.

## Author

Petr Belousov

- GitHub: [@belousov-petr](https://github.com/belousov-petr)
- LinkedIn: [petrbelousov](https://www.linkedin.com/in/petrbelousov/)
