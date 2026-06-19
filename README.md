# Strata

Keep a project's documentation honest about what the project actually does. Strata does it for you, on one command or an automatic hook, so the decisions, specs, runbooks, and memory stay current without manual upkeep. It also keeps your context lean, loading only what a task needs.

Strata is a plugin for Claude Code and Codex. It writes everything to plain Markdown under `.strata/`, in layers, and the files live in your repo, so Claude, Codex, Gemini, and any other tool read the same record.

![Strata](Strata.png)

## What it does

- Installs as one plugin for Claude Code and Codex.
- Keeps the project's documented state in one place, `.strata/`, that any tool can read.
- Captures decisions, requirements, and specs as they form, so the architecture on record matches the architecture you built.
- Tracks findings, bugs, tasks, and ideas in one backlog that opens, updates, closes, and archives items as the work moves.
- Saves runbooks and lessons the moment you learn them, so the next session does not rediscover how a system behaves.
- Holds session memory in layers: recent state every session, deeper docs on demand, old history on request.
- Writes findings to disk the moment they happen, before the context window compacts and drops them.
- Brings all of it current on one command, `/strata:save`, when you close a session.
- Sets up a new project, or upgrades older memory, in one command.
- Uses plain Markdown and grep. No dependencies.

## Why this exists

When you build software, the documentation drifts away from the code. The decision you made last week, the spec you agreed on, the bug you found and the workaround you used, the way an outside system really behaves: most of it stays in your head or in the chat, and the written record falls behind. Weeks later you read your own docs and they describe a project that no longer exists.

Agents make this faster and sharper. They try things, hit errors, find fixes, and move on, all in minutes. They work out how a site paginates, why a queue stalls, what the real acceptance test is. Most of that never reaches the code or the docs. It lives in the session. Then the context window fills up, the session compacts, and it is gone. So you rediscover the same fix, re-explain the same decision, and re-learn how the same website works.

Strata keeps the written record in step with the work. As you build, it captures decisions, requirements, specs, issues, runbooks, and findings to disk right away, in plain Markdown under `.strata/`. You do not have to stop and document by hand. When you wrap up, one command, `/strata:save`, routes everything you learned to its proper home and rebuilds the views, the indexes, and the backlog. Next session, `/strata:load` reads it back, so the agent starts from where the project really is.

Two examples of what this saves. You build a bot that scrapes a site and work out, the hard way, how its pagination, rate limits, and login flow behave. Strata records that as a runbook, so the next agent to touch the scraper reads it instead of starting over. Or the first request leaves a case out, and you find the real requirement mid-build. Strata files it as an issue, and once it is decided, as a written requirement, so the gap is on record rather than in someone's memory.

Writing everything down has a cost. Too many notes bury the one you need, and they spend tokens every session. So Strata keeps knowledge in layers. Recent state and the indexes stay small and load every session. Deeper docs, the decisions, specs, runbooks, and references, load when a task needs them. Old history sits in the archive and comes back when you ask. The record stays complete and never floods the context.

Git already stores your files and their history. Strata adds the layer git leaves out: which note belongs where, when it loads, and when it moves down to the archive. The files stay plain Markdown, so other tools can use them too. For example, [graphify](https://github.com/safishamsi/graphify) can index your code and your `.strata/` notes into a knowledge graph you can query.

## How it works

Three moves, and the middle one is the only thing you have to remember.

- **Capture as you go.** The moment a finding, bug, decision, or gotcha appears, `/strata:capture` writes it to disk, mid-task, before compaction can lose it. You can also let the agent write it directly. An optional hook reminds the agent to do this at the right moments.
- **Close with one command.** At the end of a session, `/strata:save` reads what happened, sorts each piece to its store, rebuilds the generated views and indexes, and shows a preview of every change first. Invoking `/strata:save` is the confirmation, so it writes right after the preview without a second prompt. This is the one thing to run before you stop, and nothing you learned is left behind.
- **Start with orientation.** Next session, `/strata:load` reads the recent state shallow to deep, checks it against git, and gives a short summary of where things stand.

## What Strata keeps, and where

Strata sorts knowledge by the question it answers, and gives each kind its own home. Session memory is just one of those homes.

| What you want to know | Where it lives | Tier |
|---|---|---|
| What was I doing? | `memory/project_state.md` | hot |
| What do I know about doing this? | `memory/learnings/` | hot index, read on match |
| What work exists, and in what state? | `issues/` | hot view, warm items |
| What is true, how does it work, and why? | `docs/` (decisions, product, architecture, reference, ops) | warm |
| What happened, and did we send it? | `archive/` + `action_log.md` | cold |

Anything you can read straight from the repo (the code, `git log`, the folder layout) gets no store. One question per store is the main rule, because a file that answers several questions at once is the one that bloats.

### The backlog

One store holds findings, bugs, tasks, and ideas: `.strata/issues/`, one file per item, keyed by frontmatter. Capture is immediate. The moment a finding shows up mid-task, `/strata:capture` writes the file with full notes (What, Why, and for bugs Tried, Error, Hypothesis, Repro), marks it `open`, and the work continues. Compaction cannot delete what is already on disk.

Types are `bug | improvement | debt | task | feature | initiative`. Statuses are `open | in-progress | parked | resolved | wont-fix`. An item opens, changes status by a frontmatter edit, and moves to `issues/archive/` when it closes, where it stays searchable. Parked work carries a required `revive-when:` trigger that `/strata:save` checks against each session. The `ACTIVE`, `OPEN`, and `PARKED` views rebuild from item frontmatter at every `/strata:save`, so the list always matches the items.

`action_log.md` is separate on purpose. It is an append-only record of things that left the repo: a PR, an email, a posted comment with a real URL. An issue tracks work. The action log records that something reached the outside world.

### Decisions, requirements, and specs

The `docs/` tier is where the architecture on record stays honest. A decision you shipped, with the reason and the options you turned down, goes to `docs/decisions/` as a numbered decision record. Product requirements and PRDs go to `docs/product/`. How a subsystem works goes to `docs/architecture/` as a spec, indexed from `ARCHITECTURE.md`. Stable facts you look up, like paths, schemas, APIs, and conventions, go to `docs/reference/`. These load when a task touches them, so they can be as long as the topic needs.

### Runbooks and learnings

Procedures you run, incident patterns, and the way an outside system actually behaves go to `docs/ops/` as runbooks. A learning is a short rule from a win or a failure, keyed to the operation it applies to, so the agent reads the one note it needs before it acts:

```
---
trigger: before pushing to a shared branch
origin: failure
---
**Lesson:** Run the repo lint first. The hook catches secrets, not broken
cross-references.
```

When you find out how a website paginates, or why a deploy needs a manual step, this is where it lands, so the next session reads it rather than learning it again. The trigger keys the lesson to an operation rather than a date, so the by-trigger table in `MEMORY.md` keeps lookups fast.

### Session memory

`memory/project_state.md` holds the current session and the last completed one: where you left off, the next action, prerequisites, uncommitted scope. It stays small, under a hard line budget, and rolls older sessions into the archive. This is the layer that lets a fresh session resume in a single read.

### The archive

Old sessions, the sources behind promoted decisions, and the action log live in `memory/archive/`. Closed issues live in `issues/archive/`. This is cold storage, searched by grep when you ask a history question, never loaded on its own.

### The layers

Three tiers decide when each store loads:

- **Hot** is `memory/` and `issues/ACTIVE.md`, loaded at session start.
- **Warm** is `docs/` and individual issue files, loaded on demand by task.
- **Cold** is the archives, read only on an explicit history search.

Long docs are welcome in the warm tier. The always-loaded files stay small because of size limits and routing, so the hot context never floods.

## The shape of a strata project

When you run `/strata:init` on a fresh project, strata creates this:

```
<project>/
├── AGENTS.md · CLAUDE.md          # thin adapters → .strata/MANIFEST.md
├── README.md                      # your project's front door
└── .strata/
    ├── MANIFEST.md                # the contract: version, structure, routing, load order
    ├── memory/                    # HOT
    │   ├── MEMORY.md              # index only: live pointers + rules-by-trigger table (≤80 lines)
    │   ├── project_state.md       # current + last session (≤200 lines)
    │   ├── learnings/             # lessons keyed by trigger + a generated INDEX.md
    │   └── archive/               # COLD: old sessions, decision sources, action_log.md
    ├── issues/                    # the one backlog
    │   ├── ACTIVE.md · OPEN.md · PARKED.md    # generated views
    │   ├── <id>-<slug>.md         # one item per file
    │   └── archive/               # resolved / wont-fix
    └── docs/                      # WARM, grows as needed
        ├── ARCHITECTURE.md        # code map + index
        ├── product/ · architecture/ · decisions/ · reference/ · ops/
        └── CHANGELOG.md · roadmap.md   (when they exist)
```

Everything strata owns lives under `.strata/`. Like a lockfile, the folder states its format and version (`strata_version: 0.0.3` in the manifest), so it stays out of the way of everything else and any tool can read it. The adapters are thin pointers. `AGENTS.md` still has room for your own build, test, and style notes.

## The commands

### `/strata:init`

Sets up strata in a project, or upgrades an older layout. In Claude Code it is `/strata:init`; in Codex, `Skill(name='strata', args='init')`. A fresh project answers two questions (the project name, and whether it is a code or knowledge project), then gets the tree above, with `AGENTS.md` and `CLAUDE.md` written only if they are missing. If memory already exists in an older layout, init runs the matching step from [MIGRATIONS.md](MIGRATIONS.md) and archives the source before writing anything new.

### `/strata:save`

This is the closing command. It reads the session (resumption point, issue events, learnings, decisions, doc impact, finished external actions), routes each thing to its store, and shows one preview block before it writes:

```
Proposed changes for /strata:save:

NEW FILES:
- .strata/issues/20260609-02-router-drift.md  ← finding, full notes
- .strata/memory/learnings/bulk-renames.md  ← "before bulk renames…"
- .strata/docs/decisions/ADR-0003-queue-drain.md  ← promoted decision

UPDATES (frontmatter / sections):
- .strata/issues/20260601-01-flaky-probe.md: status in-progress → resolved

MOVES:
- .strata/issues/20260601-01-flaky-probe.md → issues/archive/

DELETIONS (section-only):
- project_state.md: roll session 12 → archive/2026-06-sessions-11-12.md

REGENERATED:
- issues/ACTIVE.md · OPEN.md · PARKED.md · learnings/INDEX.md · MEMORY.md trigger table
```

Invoking `/strata:save` is the confirmation. There is no second yes/no gate. It has guards: it never moves a git-dirty file, it checks decision-record numbers for collisions, it only deletes sections rather than whole files, and a re-run with nothing new proposes nothing.

### `/strata:load`

It loads shallow to deep (`MANIFEST` → `MEMORY` → `ACTIVE` → state), checks against git (`git status`, recent commits, spot-checks), then shows a six-line summary: last session, next action, active items, prerequisites, fired triggers, and any drift. State is a hint. The repo is the truth.

### `/strata:capture`

Use this during a session, while the work is fresh. Save is for the end. Reach for it when a command fails, when the agent retries with a workaround, when a brittle setup rule shows up, when you settle a decision, or when a finding is too useful to leave in the chat.

It writes or updates:

- an issue under `.strata/issues/` when there is work to close
- a learning under `.strata/memory/learnings/` when the value is a reusable rule
- both when a fixable problem also teaches a future lesson

It does not rebuild the generated views. `/strata:save` does that later, so `ACTIVE.md`, `OPEN.md`, `PARKED.md`, `learnings/INDEX.md`, and the `MEMORY.md` table stay in sync with the source files.

Catching a finding before it is lost is the point of `/strata:capture`, so it helps to not depend on remembering to run it. An optional hook (`hooks/`) makes capture automatic: it reminds the agent to write findings to `.strata/` before the context is compacted. It works on Claude Code and Codex, on Windows, macOS, and Linux. One shared Node script ([`hooks/strata-capture-guard.mjs`](hooks/strata-capture-guard.mjs)) adds the reminder at `SessionStart` and a last-chance one at `PreCompact`. It says nothing outside a strata project, and if it errors it exits cleanly, so it cannot stall a session.

- Claude Code: it ships in the plugin (`hooks/hooks.json`, picked up when the plugin is on). Nothing to set up. Turn it off with `/plugin disable strata`.
- Codex: plugins cannot carry hooks, so copy [`hooks/codex-hooks.sample.json`](hooks/codex-hooks.sample.json) to `~/.codex/hooks.json` (every project on the machine) or to a committed `<project>/.codex/hooks.json` (travels with the repo). Set the `commandWindows` field on Windows.

One limit: neither tool lets a hook force a save before compaction. `PreCompact` cannot make the agent act first. The hook reminds; the agent still does the capture. So strata stays a convention. More in [`hooks/README.md`](hooks/README.md).

## Installation

This is one repo with two plugin manifests. Claude Code reads `.claude-plugin/`, Codex reads `.codex-plugin/`, and both load the same `skills/strata/SKILL.md`. Nothing is duplicated.

### Claude Code (plugin)

`.claude-plugin/plugin.json` is the plugin manifest. `.claude-plugin/marketplace.json` lists this repo as a one-plugin marketplace (`source: "."`).

Install from GitHub:

```text
/plugin marketplace add belousov-petr/strata
/plugin install strata@belousov-petr
```

Under the plugin, Claude puts the plugin name in front of every command and skill:

- Commands: `/strata:init`, `/strata:save`, `/strata:load`, `/strata:capture`
- Skill: `Skill(name='strata:strata')`, with `args='init'` or `args='capture'`

Update after new commits, then restart Claude Code. An update does not rewrite the instructions already loaded in the running session.

```text
/plugin marketplace update belousov-petr
/plugin update strata@belousov-petr
```

Turn it off or remove it:

```text
/plugin disable strata
/plugin uninstall strata
```

For local work, load a clone for one session, or add it as a local marketplace:

```bash
git clone https://github.com/belousov-petr/strata.git
claude --plugin-dir ./strata            # this session only
# or, inside Claude Code:
#   /plugin marketplace add ./strata
#   /plugin install strata@belousov-petr
```

A local-directory install caches the plugin per version. After you edit a local clone, reinstall (`/plugin uninstall strata` then `/plugin install …`) to pick up the change. `update` does nothing for that kind of install.

Check the manifests before you publish:

```bash
claude plugin validate . --strict
```

### Codex (plugin)

The Codex manifest is `.codex-plugin/plugin.json`, which points at `skills/strata/`. Clone this repo into your Codex plugin source directory and install it through your Codex plugin marketplace. After you pull new commits, reinstall or update so Codex refreshes its copy, then start a new thread.

Codex calls the skill directly, with no plugin prefix:

```text
Skill(name='strata', args='init')
Skill(name='strata', args='capture')
Skill(name='strata')                    # rule lookup that drives the load/save flow
```

That bare `strata` is why the skill keeps `name: strata`. It is the name Codex and other tools rely on.

### Other tools

`AGENTS.md` is the entry point. Codex reads it on its own. For Gemini CLI, point the project context at `AGENTS.md` (the `settings.json` context setting, or an import line). Any tool that does not read `AGENTS.md` can use a thin adapter that points to `.strata/MANIFEST.md`.

## A few honest things

- Strata runs on convention. The skill's instructions and your habit are what keep the capture rule going. The optional hook reminds you at session start and before compaction, but it only reminds. It cannot force the save. The structure makes the right thing cheap, and it leaves the wrong thing possible.
- If `git status` and the state file disagree, trust git. `/strata:load` flags the mismatch, but the flag is only text on the screen.
- The save preview is a record of the plan. `/strata:save` writes right after it on its own, so a misclassified note can still move if the session read was wrong.
- Where a note belongs is still a judgment call. The simple tests (rule versus procedure versus fact, issue versus learning) handle most cases. When in doubt, leave it hot and let the next save sort it.
- The generated views are only as fresh as the last save. The items are the truth. The views are a copy with a rebuild step.

## What building this taught me

- I started by saving everything into one memory file at the end of a session. It grew every session, filled the context, and confused the agent more than it helped. So I split it up by the question each piece answers: session state, issues, learnings, decisions, specs, runbooks. A small map points to each file, and the agent opens one only when the task needs it. The whole thing started from wanting to save as much as possible, the decisions and especially the gotchas and lessons, without drowning in them.
- Do not rebuild git. Storing history in layers and seeing how the product changed over time is useful. Redoing what git already does well is wasted effort, so strata leans on git for history and adds only the layering git lacks. The hot, warm, and cold split is the idea worth keeping.
- Findings die in compaction. The first version was a plain skill that saved everything at the end of a session. On short sessions that was fine. On long ones with several compactions, the context behind a lesson was gone by the time I went to save it. Writing findings to disk while they are fresh is why this grew into a plugin with a capture step and an optional hook.
- Keep one source, and keep the hot path small. The rules live in one file, `MANIFEST.md`, with thin adapters pointing at it, so there is one copy to keep right. The always-loaded files stay small and point at the next action and the indexes, while the depth sits in the warm docs and loads on demand. Lessons are tied to the operation that triggers them, and the reasons behind decisions live in decision records, off the hot path. The longer write-up is in [docs/DESIGN.md](docs/DESIGN.md) and the [decision records](docs/decisions/README.md).

## Why the name

Strata means layers of rock. Your knowledge stacks up in layers as you work, recent on top and older underneath, and you can dig down to an old layer when you need it. That is the whole idea in one word.

## Contributing

If you have run this and found gaps, I want to hear about it. Open an issue or PR with what kind of project you ran it on, what the routing got wrong (or what the save preview let through), and what you would change.

## License

[MIT](LICENSE). Use it, fork it, ship it - credit appreciated but not required.

## Acknowledgments

The first version was drafted in [Claude Code](https://claude.com/claude-code). I designed the layer model and the routing rules, decided what knowledge goes where and why, and directed the work.

The pattern builds on prior work. For agent instructions and context: [agents.md](https://agents.md/) and [Anthropic's writing on context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents). For tiered memory: [Cline Memory Bank](https://docs.cline.bot/features/memory-bank), [Letta/MemGPT](https://www.letta.com/blog/agent-memory), and [ReasoningBank](https://arxiv.org/html/2509.25140v1). For decisions and docs: Michael Nygard's [decision records](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions), the [MADR](https://adr.github.io/madr/) format, incident-response playbooks, and [Diátaxis](https://diataxis.fr/start-here/).

Companion tool: [`/shakedown`](https://github.com/belousov-petr/shakedown), for finding what is broken in a project before you ship.

## Author

Petr Belousov

- GitHub: [@belousov-petr](https://github.com/belousov-petr)
- LinkedIn: [petrbelousov](https://www.linkedin.com/in/petrbelousov/)
