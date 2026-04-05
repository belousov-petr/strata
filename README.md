# Savepoint

A pair of [Claude Code Skills](https://docs.anthropic.com/en/docs/claude-code/skills) that save and restore your project state across sessions. When you're juggling multiple active projects and it's getting hard to remember the details -- what you did, what you decided, what's left -- these handle the bookkeeping so you don't lose context between sessions.

![Savepoint](Savepoint.png)

## The problem

You're deep in a session. You've made decisions, tried approaches that didn't work, discovered gotchas, left something half-done. Then you close the session. Next time you open the project, Claude asks: "What would you like to work on?" And you're back to explaining everything from scratch.

It gets worse with multiple projects. Three active codebases, each with their own state, their own "where was I?" moment. The details blur together. You forget what you tried last time. You repeat dead ends. You lose the thread.

## What it does

Two commands. One saves, one restores.

```
/save-point
```

Captures what happened in the current session -- what was done, what was decided and why, what was rejected, what's left to do, and where to pick up next time. Writes it to Claude Code's persistent memory so it survives between sessions.

```
/load-point
```

Reads the saved state at the start of a new session, verifies it's still current against the actual repo, and gives you a summary with the next action ready to go.

## What gets captured

The state file isn't a changelog or a code dump. It's structured to answer the questions a fresh session would otherwise ask you:

- Where you left off -- the last thing completed, the immediate next action, any prerequisites (env vars, services to start, manual steps), uncommitted changes
- Current state -- what works, what doesn't, test counts, build status
- Session history -- numbered sessions with phases, decisions, and reasoning
- Environment requirements -- services, env vars, and tools discovered during work
- Architecture overview -- only if it changed or this is the first session
- Constraints and gotchas -- the non-obvious things that would bite someone who didn't know
- Open items -- prioritized by urgency
- Rejected approaches -- what was tried and why it failed, so nobody goes down that road again

## How the save works

When you run `/save-point` (or say "wrap up", "save state", "let's stop here"), it:

1. Reads the existing memory index and any previous state file
2. Reviews what was done in the current session -- actions, decisions, experiments, failures, verifications
3. Captures the exact resumption point with enough detail that a fresh session can start working without asking
4. Writes a structured `project_state.md` with all sections above
5. Updates the memory index
6. Checks other memory files for anything this session made outdated and corrects them
7. Updates the project README if functionality changed
8. Re-reads the saved state and verifies it's actually usable

That last step is intentional. A state file that looks complete but can't actually orient a fresh session is worse than no state file -- it gives false confidence.

## How the load works

When you start a new session and run `/load-point` (or say "continue", "pick up where I left off"), it:

1. Reads the state file and memory index
2. Orients from the "WHERE WE LEFT OFF" section
3. Verifies the state is still current by checking `git status`, recent commits, and whether referenced files still exist
4. Presents a summary with the next action ready

If the state conflicts with what's actually in the repo -- say, the state mentions uncommitted changes but the working tree is clean -- it tells you instead of silently acting on stale information. The repo is truth; the state file is a hint.

## Installation

### Claude Code (CLI or Desktop)

Copy the skills to your commands directory:

```bash
git clone https://github.com/belousov-petr/savepoint.git
cp savepoint/save-point.md ~/.claude/commands/save-point.md
cp savepoint/load-point.md ~/.claude/commands/load-point.md
```

Or download directly:

```bash
curl -o ~/.claude/commands/save-point.md \
  https://raw.githubusercontent.com/belousov-petr/savepoint/main/save-point.md
curl -o ~/.claude/commands/load-point.md \
  https://raw.githubusercontent.com/belousov-petr/savepoint/main/load-point.md
```

Restart Claude Code. The skills appear as `/save-point` and `/load-point`.

### Verify installation

```
/save-point
```

You should see Claude begin reading your project's memory and assembling the state capture.

## Usage

### Saving state

At the end of a session:

```
/save-point
```

Or just say it:

```
Save where we are
Wrap up for today
Let's stop here, save state
```

### Loading state

At the start of a session:

```
/load-point
```

Or:

```
Continue where we left off
What were we doing?
Pick up from last time
```

### What you see on load

```
Last session (2026-04-03): Added OAuth2 login with PKCE, abandoned passport.js approach
Next up: Fix flaky token refresh test (timing issue in tests/auth/refresh.test.ts)
Prerequisites: REDIS_URL must be set, Redis running locally
Open items: Session expiry logic half-done in middleware
```

Ready to continue, or do you want to work on something else?

## Common mistakes the skill prevents

| What goes wrong without it | How savepoint handles it |
|---|---|
| Repeating approaches that already failed | Captures rejected approaches with reasoning |
| Forgetting env vars or services needed | Dedicated environment requirements section |
| Vague resumption ("continue working on auth") | Forces a specific next action with file paths |
| Losing track of uncommitted changes | Explicitly captures scope of uncommitted work |
| Stale README after changes | Checks and updates README as part of save |
| State file says one thing, repo shows another | Load verifies against git before acting |

## What it deliberately does not save

- Code patterns you can get by reading the source
- Commit history you can get from git log
- Stack traces and temporary file paths
- Full codebase structure scans
- Anything that won't be true next session

The state file captures decisions and status, not code. If you can derive it from the current project state, it doesn't belong in the save.

## Why this exists

I was running multiple projects with Claude Code at the same time and kept losing context between sessions. The first five minutes of every new session went to re-explaining what happened last time, what was tried, what failed. Worse, without a record of rejected approaches, I'd sometimes watch Claude go down the same dead end twice.

It started as a manual checklist I'd paste at the end of sessions. Then I noticed the checklist was always the same, and I was still forgetting things. So I turned it into a skill -- same structure, same checks, every time. The verification step got added after I once saved a state file that looked fine but was missing the one gotcha that would have saved me 20 minutes the next day.

## Contributing

I'm open to contributions. The areas where input would help the most:

If you've used savepoint and found that something important was missing from the state capture, that's exactly the kind of feedback that makes this better. Same goes for ideas on making the saved state more useful when loading -- the gap between "technically saved" and "actually helpful next session" is where the real work is. If you see ways to make the process faster or less verbose, those are welcome too.

Open an issue or PR with what you'd change and why.

## License

This work is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

You can use, share, and adapt these skills for any purpose, including commercially, as long as you give appropriate credit.

## Author

Petr Belousov -- AI governance by day, AI builder by night.

- GitHub: [@belousov-petr](https://github.com/belousov-petr)
- LinkedIn: [petrbelousov](https://www.linkedin.com/in/petrbelousov/)
