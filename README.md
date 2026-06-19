# Strata

Repo-owned project memory for AI coding agents. Strata keeps durable project state in plain Markdown under `.strata/`, so Claude Code, Codex, Gemini, and whatever you use next all work from one source of truth instead of each keeping a private, drifting memory.

It ships from a single repository as **both a Claude Code plugin and a Codex plugin**, sharing one skill.

- Layout generation: `strata_version: 3`
- Plugin package: `3.1.0` (Claude Code + Codex)

![Strata](Strata.png)

## What you get

- **One repo-owned namespace, `.strata/`** — like a lockfile: it announces its format and version, collides with nothing, and any tool can read it.
- **Three tiers** — hot memory loaded every session, warm docs on demand, cold archive on grep — defended by size budgets and routing, not by writing less down.
- **A unified backlog** (`issues/`) — findings, bugs, tasks, and initiatives as one frontmatter-keyed store with generated `ACTIVE` / `OPEN` / `PARKED` views.
- **Operation-keyed learnings** — behavioral lessons fired by trigger, so the agent reads the one relevant note before an operation, not the whole folder.
- **Immediate capture** — findings hit disk the moment they surface, before context compaction can erase them.
- **One-shot init and safe migration** — scaffold a fresh project, or migrate flat/v1/v2 memory with the source archived first.
- **Two plugins, one tree** — Claude Code (`.claude-plugin/`) and Codex (`.codex-plugin/`) load the same `skills/strata/SKILL.md`; nothing is duplicated.
- **An optional cross-tool capture-guard hook** — a gentle reminder on Claude Code and Codex, Windows/macOS/Linux, that reinforces immediate capture before compaction.
- **Plain Markdown + grep, zero dependencies.**

## Quick start

**Claude Code** — install the plugin, then work inside a project:

```text
/plugin marketplace add belousov-petr/strata
/plugin install strata@belousov-petr
```

```text
Skill(name='strata:strata', args='init')   # scaffold or migrate this project
/strata:load                                # session start — orient from saved state
/strata:capture                             # mid-session — save a finding/gotcha now
/strata:save                                # session end — route everything to its store
```

**Codex** — install the Codex plugin from this repo, then drive the skill directly:

```text
Skill(name='strata', args='init')
Skill(name='strata', args='capture')
Skill(name='strata')                        # rule lookup driving the load/save flow
```

`/strata:save` previews the changes it will make, then writes them immediately — invoking it is the confirmation, with no second yes/no gate. If the project already has flat, v1, or v2 memory, `init` migrates it (archiving the source first) instead of overwriting it.

> Why the two invocation styles? Claude namespaces everything under the plugin (`/strata:save`, `Skill(name='strata:strata')`); Codex uses the bare skill name (`Skill(name='strata')`). Both read the same rules. Full detail in [Installation](#installation).

## Why this exists

I run multiple projects and switch between tools. Claude, Codex, Gemini, and whatever comes next all need the same project state, but tool-owned memory drifts. Without a save habit, memory files either stay empty or contradict each other. The next session starts with transcript archaeology.

So I started writing a `project_state.md` at the end of every session. That worked for a month. Then it grew to 1,085 lines carrying fourteen sessions of narrative, every decision, every gotcha. The file was doing too many jobs, and memory search kept returning stale bits alongside current ones. v1 and v2 of strata split it into tiers: hot state, warm docs, cold archive.

v3 fixes the parts that still broke: action items became another monolith, behavioral memory had no retrieval key, routing rules drifted across files, and findings discovered mid-task could disappear during context compaction. Strata now writes findings to disk immediately, stores lessons by trigger, and keeps the contract in one place.

## Why the name

Three kinds of knowledge, three places they live, three moments they load. Like rock strata.

"Savepoint" was the first name, because that was the verb I typed. The verb isn't the thing. The thing is underneath: which layer a piece of knowledge belongs to, and when it loads.

## What's in this repo

```
strata/
├── .claude-plugin/
│   ├── plugin.json                # Claude Code plugin manifest
│   └── marketplace.json           # single-plugin marketplace (source ".")
├── .codex-plugin/plugin.json      # Codex plugin manifest
├── commands/                      # Claude slash commands
│   ├── save.md                    #   → /strata:save
│   ├── load.md                    #   → /strata:load
│   └── capture.md                 #   → /strata:capture
├── skills/
│   └── strata/
│       ├── SKILL.md               # authoritative rules (the Claude + Codex skill)
│       └── templates/             # scaffolded into projects by init (mirrors .strata/)
├── hooks/                         # optional capture-guard hook (Claude + Codex, cross-platform)
│   ├── strata-capture-guard.mjs   #   shared Node script
│   ├── hooks.json                 #   Claude plugin hook config
│   ├── codex-hooks.sample.json    #   Codex hook template
│   └── README.md
├── docs/
│   ├── DESIGN.md                  # exhaustive reference: every store, schema, lifecycle
│   └── decisions/                 # ADR-0001..0010: why strata is shaped this way
├── MIGRATIONS.md                  # flat/v1/v2 → v3 ladder: detect, transform, rollback
├── CHANGELOG.md                   # what changed per release
└── tests/                         # scaffold check + repo lints
```

Why a skill plus commands: the skill owns the rules. Commands are the verbs you type. I tried putting rules in command files once, and they drifted within a week. The same layering applies to the docs: the skill stays lean and operational, [DESIGN.md](docs/DESIGN.md) carries the depth, and the [ADRs](docs/decisions/README.md) carry the why.

## The shape of a strata project

On a fresh project, `strata init` scaffolds this:

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

Everything strata-owned sits under `.strata/`. Like a lockfile, the directory announces its format and version (`strata_version: 3` in the manifest), collides with nothing, and any tool can read it ([ADR-0001](docs/decisions/ADR-0001-strata-namespace-commands-adapters.md)). The adapters stay thin pointers; `AGENTS.md` keeps room for your project's own build/test/style content.

If memory already exists, init follows [MIGRATIONS.md](MIGRATIONS.md). Flat `project_state.md` files are archived as `memory/archive/source-flat-project-state-*` before v3 hot state is written.

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

### What happens when

| Moment | Reads/writes |
|---|---|
| `/strata:load` | `MANIFEST.md` → `MEMORY.md` → `issues/ACTIVE.md` → `project_state.md` (current + last) |
| Fresh failure or gotcha | `/strata:capture` writes the issue, learning, or both immediately |
| Picking new work | `issues/OPEN.md`, filtered by area |
| About to do operation X | the one or two `learnings/` files whose trigger matches |
| Task touches a topic | the specific `.strata/docs/` file |
| Explicit history question | `archive/`, via grep |
| Never automatically | learnings in bulk, ADRs in bulk, items in bulk, anything in archive |

Exhaustive documentation is welcome in the warm tier. Bloat only hurts the hot path, and the hot path is defended by budgets and routing, not by writing less down.

## The backlog

One store for findings, tasks, and initiatives: `.strata/issues/`, one file per item, frontmatter-keyed ([ADR-0002](docs/decisions/ADR-0002-unified-issues-backlog.md)).

- Capture is immediate. The moment a finding or bug surfaces mid-task, `/strata:capture` writes the item file with full rationale and diagnostics (Tried/Error/Hypothesis/Repro), status `open`, and work continues. Context compaction cannot eat what is already on disk.
- Types are `bug | improvement | debt | task | feature | initiative`; statuses are `open | in-progress | parked | resolved | wont-fix`. Initiatives are just a type now. Parked work is a status with a mandatory `revive-when:` trigger.
- Status changes are frontmatter edits, not file moves. Closed items move to `issues/archive/` and stay greppable.
- The views are generated. `ACTIVE.md`, `OPEN.md`, and `PARKED.md` regenerate from item frontmatter at every `/strata:save` ([ADR-0004](docs/decisions/ADR-0004-generated-indexes-grep-router.md)).

`action_log.md` stays separate on purpose: an append-only ledger of completed actions that left the repo (a PR, an email, a posted comment with a durable URL). An issue tracks work; the action log records that something reached the outside world.

## Learnings

Behavioral memory stores lessons from failures and successes ([ADR-0003](docs/decisions/ADR-0003-operation-keyed-learnings.md)). Each lesson has a trigger, so an agent can read the one relevant note before doing the operation instead of loading the whole folder.

```
---
trigger: before pushing to a shared branch
origin: failure
---
**Lesson:** Run the repo lint first; the hook catches secrets, not broken
cross-references.
```

The routing key is the operation, not the date. A generated by-trigger table in `MEMORY.md` keeps lookup cheap. Failures with their counterfactual fix are usually the most useful entries.

## The commands and init

### `/strata:capture`

Use this while working, not at the end. It is for the moment a command fails, an agent retries with a workaround, a brittle environment rule appears, or a finding is too useful to leave in conversation memory.

In strata mode, it writes or updates:

- an issue under `.strata/issues/` when there is closeable work
- a learning under `.strata/memory/learnings/` when the value is a reusable behavior rule
- both when a fixable problem also taught a future pitfall

It does not regenerate generated views. `/strata:save` handles that after the session inventory, so `ACTIVE.md`, `OPEN.md`, `PARKED.md`, `learnings/INDEX.md`, and the `MEMORY.md` trigger table remain caches of the source files.

### `/strata:save`

Inventories the session (resumption point, issue events, learnings, decisions, doc impact, external completions), routes everything per the manifest, and shows one audit preview block before writing automatically:

```
Proposed changes for /strata:save:

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

Invoking `/strata:save` is the confirmation; there is no second y/n gate. Safeguards: git-dirty files are never moved, ADR numbers are collision-checked, deletions are section-only, and re-running with no new work proposes nothing.

### `/strata:load`

Loads shallow to deep (`MANIFEST` → `MEMORY` → `ACTIVE` → state), verifies against git (`git status`, recent commits, spot-checks), then orients in six lines: last session, next action, active items, prerequisites, fired revive-triggers, drift. State is a hint; the repo is truth.

### Init

One-shot scaffold or migration. In Claude Code, run `Skill(name='strata:strata', args='init')`. In Codex, run `Skill(name='strata', args='init')`.

Fresh projects get two questions (project name, code vs knowledge project), then the tree above, with adapters written only if absent. Existing flat memory is archived and migrated instead of overwritten; v1/v2 layouts route into the migration ladder instead of double-initializing.

## Installation

Strata is one repository with two plugin manifests. Claude Code reads `.claude-plugin/`, Codex reads `.codex-plugin/`, and both load the same `skills/strata/SKILL.md`. Nothing is duplicated.

### Claude Code (plugin)

`.claude-plugin/plugin.json` is the plugin manifest; `.claude-plugin/marketplace.json` lists this repo as a single-plugin marketplace (`source: "."`).

Install from GitHub:

```text
/plugin marketplace add belousov-petr/strata
/plugin install strata@belousov-petr
```

Under the plugin, Claude namespaces every command and skill with the plugin name:

- Commands — `/strata:save`, `/strata:load`, `/strata:capture`
- Skill — `Skill(name='strata:strata')`, with `args='init'` or `args='capture'`

Update after new commits, then restart Claude Code (plugin updates do not rewrite the current session's already-loaded instructions):

```text
/plugin marketplace update belousov-petr
/plugin update strata@belousov-petr
```

Disable or remove:

```text
/plugin disable strata
/plugin uninstall strata
```

Local development — load a clone for one session, or add it as a local marketplace:

```bash
git clone https://github.com/belousov-petr/strata.git
claude --plugin-dir ./strata            # this session only
# or, inside Claude Code:
#   /plugin marketplace add ./strata
#   /plugin install strata@belousov-petr
```

A directory-source install caches the plugin per version, so after editing a local clone, reinstall (`/plugin uninstall strata` then `/plugin install …`) to refresh — `update` is a no-op for it.

Validate the manifests before publishing:

```bash
claude plugin validate . --strict
```

### Codex (plugin)

The Codex manifest is `.codex-plugin/plugin.json`, pointing at `skills/strata/`. Clone this repo into your Codex plugin source directory and install it through your Codex plugin marketplace; after pulling new commits, reinstall or update so Codex refreshes its cached copy, then start a new thread.

Codex uses the skill entry points directly and **without Claude's namespace**:

```text
Skill(name='strata', args='init')
Skill(name='strata', args='capture')
Skill(name='strata')                    # rule lookup driving the load/save flow
```

That bare `strata` is why the skill keeps `name: strata` — it's the contract Codex and other tools depend on.

### Other tools

`AGENTS.md` is the canonical entry point. Codex reads it natively. For Gemini CLI, point the project context at `AGENTS.md` (`settings.json` context config or an import line). Any tool that doesn't read `AGENTS.md` can use a thin adapter that points to `.strata/MANIFEST.md`.

### Automatic capture (optional hook)

Strata ships an optional **capture-guard hook** (`hooks/`) that reminds the agent to write findings to `.strata/` before context is compacted — on Claude Code and Codex, on Windows, macOS, and Linux. One shared Node script ([`hooks/strata-capture-guard.mjs`](hooks/strata-capture-guard.mjs)) injects the immediate-capture rule at `SessionStart` and a last-chance reminder at `PreCompact`. It is **silent outside strata projects** and fail-safe — any error exits cleanly, never stalling a session.

- **Claude Code** — bundled in the plugin (`hooks/hooks.json`, auto-discovered when the plugin is enabled). Nothing to configure; turn it off with `/plugin disable strata`.
- **Codex** — plugins can't ship hooks, so copy [`hooks/codex-hooks.sample.json`](hooks/codex-hooks.sample.json) to `~/.codex/hooks.json` (every project on the machine) or a committed `<project>/.codex/hooks.json` (travels with the repo). Set the `commandWindows` field for Windows.

Honest limit: neither tool lets a hook *force* a pre-compaction save — `PreCompact` can't make the agent act first. The hook **nudges**; the agent still performs the capture, so strata stays a convention. Full detail: [`hooks/README.md`](hooks/README.md).

### Scaffold a project

Inside the project root, run init — `Skill(name='strata:strata', args='init')` under the Claude plugin, or `Skill(name='strata', args='init')` in Codex. Fresh projects answer two questions (project name; code vs knowledge project) and get the tree above, with `AGENTS.md`/`CLAUDE.md` adapters written only if absent. Projects with flat or legacy memory migrate through `MIGRATIONS.md`; source memory is archived before any v3 file is written.

## Migrating from flat/v1/v2

[`MIGRATIONS.md`](MIGRATIONS.md) is the ladder. It detects the generation by fingerprint (flat: `.strata/memory/project_state.md` without a manifest; v1: `docs/PROJECT-MAP.md` or `.claude/memory/`; v2: `.ai/MEMORY-MAP.md`), then runs an ordered, gated transform with a rollback anchor. Flat memory is moved into `memory/archive/source-flat-project-state-*` before the new hot state is written. v1/v2 migrations handle namespace rename, manifest rewrite, extraction of `open_action_items.md` + `project_<slug>.md` + `docs/parked/` into the issues backlog, `feedback_*` conversion into learnings, and view regeneration. Content-bearing steps archive their sources before deleting anything. The old `/save-point` and `/load-point` command names are gone; install the Strata plugin per above.

## Versioning

Two version numbers, on purpose:

- **Layout generation `strata_version: 3`** — stamped in every scaffolded `MANIFEST.md`. It governs the on-disk `.strata/` format. A bump here is breaking and ships with a `MIGRATIONS.md` rung. The plugin packaging (v3.1.0) did **not** change it, so projects already on v3 need no migration when you move to the plugin.
- **Plugin package `3.1.0`** — the version in `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`; the release of the tool itself.

Releases are git tags + `CHANGELOG.md` + ADR supersede-status — no per-folder version archives ([ADR-0008](docs/decisions/ADR-0008-git-native-versioning.md)). The latest tagged layout release is `v3.0.0`; current `main` includes the plugin, capture, and hook work listed under Unreleased in [`CHANGELOG.md`](CHANGELOG.md).

## Research basis

The [ADRs](docs/decisions/README.md) carry the research notes and tradeoffs. The short version:

- Agent instruction files need one contract, not several drifting copies. Strata keeps that contract in `MANIFEST.md` and keeps adapters thin.
- Always-loaded memory should stay small. Hot files point to the next action and the right indexes; warm docs carry depth.
- Lessons work best when they are tied to an operation. `learnings/` stores "before doing X, read Y" rules instead of diary entries.
- Generated views are caches. The item files and learning files are the truth.
- Decision records keep rationale out of hot memory. Strata uses ADRs for durable "why," with source material archived for provenance.

The main external influences are [agents.md](https://agents.md/), [Anthropic's context engineering writing](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), tiered memory systems such as [Cline Memory Bank](https://docs.cline.bot/features/memory-bank) and [Letta/MemGPT](https://www.letta.com/blog/agent-memory), [ReasoningBank](https://arxiv.org/html/2509.25140v1), [Nygard-style ADRs](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions), [MADR](https://adr.github.io/madr/), and [Diátaxis](https://diataxis.fr/start-here/).

## A few honest things

- If `git status` disagrees with the state file, trust git. `/strata:load` flags the mismatch, but the flag is just text on the screen.
- The save preview is an audit trail, not a shield. `/strata:save` writes automatically after the preview; misclassified content can still move if the session inventory is wrong.
- Where knowledge belongs is still a judgment call. The discriminators (rule vs procedure vs fact; issue vs learning) decide most cases; when in doubt, leave it hot and let the next save promote it.
- Generated views are only as fresh as the last save. The items are the truth; the views are a cache with a regeneration contract.
- Strata is a convention, not a daemon. Nothing enforces the mid-session capture rule except the skill's instructions and your habit. The optional capture-guard hook (`hooks/`) reinforces it at session start and before compaction, but it *nudges* — it injects a reminder, it can't force the capture. The structure makes the right thing cheap; it can't make the wrong thing impossible.

## What building this taught me

- A single file doesn't stay cheap. Memory search pulls from it every session, and old and new come back together. Splitting by routing key fixed what splitting by size never did.

- The dumping-ground instinct relocates. I fixed `project_state.md` in v1, then watched `open_action_items.md` quietly become the same thing: one file, several jobs, drifting sections. The fix wasn't a better file; it was admitting work items are a collection, not a document.

- Findings die in compaction. The most expensive v2 failure was invisible: a sharp diagnosis made mid-task, held in conversation memory for the save ritual, gone when the context compacted. Write-to-disk-immediately is the single highest-value rule in v3.

- Hand-maintained lists lie. Every status list I maintained by hand eventually disagreed with reality. Views generated from item frontmatter can't.

- Git already solved versioning. I almost built per-folder version archives before noticing I was reinventing `git log` with worse ergonomics. Tags, a changelog, and supersede-status cover everything I needed ([ADR-0008](docs/decisions/ADR-0008-git-native-versioning.md)).

- Research validates more than it redesigns. The deep-research pass kept ~85% of v2. The value was in the corrections it forced me to name precisely, and in being able to cite why the structure is the way it is instead of "it felt right."

## Contributing

If you've run this and found gaps, I'd like to hear about it. Open an issue or PR with: what kind of project you ran it on, what the routing got wrong (or what the save preview let through), and what you'd change.

## License

[MIT](LICENSE). Use it, fork it, ship it. Credit appreciated but not required.

## Acknowledgments

The first version was drafted in [Claude Code](https://claude.com/claude-code) ([@claude](https://github.com/claude)). I designed the tier model and routing rules, decided what knowledge goes where and why, and directed the work.

The pattern stands on prior art: Michael Nygard's [ADRs](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions), the [MADR](https://adr.github.io/madr/) format, incident-response playbook conventions, and the 2024-2026 agent-memory literature credited in [Research basis](#research-basis) and the ADRs.

Companion skill: [`/shakedown`](https://github.com/belousov-petr/shakedown) for auditing what's broken in a project before you ship.

## Author

Petr Belousov

- GitHub: [@belousov-petr](https://github.com/belousov-petr)
- LinkedIn: [petrbelousov](https://www.linkedin.com/in/petrbelousov/)
