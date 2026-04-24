# Action Log — {{PROJECT_NAME}}

Append-only log of completed actions that produced an external artifact (upstream PR/issue, email sent, comment posted, external API action with a durable URL). Cold tier — not auto-loaded, grepped on demand.

Format per entry:

```markdown
## YYYY-MM-DD — <short session label>
- **<item-id>** — <what was done> (<external-link>). <one-line why it mattered>.
```

What does NOT qualify (keep noise out):
- Internal code edits — that's `git log`
- File reorganization — that's session narrative
- Session-internal decisions — that's ADR territory

---

_No entries yet._
