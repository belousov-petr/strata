---
trigger: <when this applies — operation-keyed, e.g. "before pushing to a shared branch">
applies-when: <glob or area — optional; delete this line if not needed>
origin: success | failure
hot: false   # true only for a broad/frequent rule worth loading every session (MEMORY.md table); default false = INDEX.md only. Keep the hot set small.
match:       # optional: regexes tested against a Bash command; when one fits, a hook shows this lesson right before the command runs. Single quotes. Delete if not needed.
  - '<regex>'
paths:       # optional: globs from the project root, tested against edited files and paths a command names. Delete if not needed.
  - '<glob>'
---

**Lesson:** <1–3 sentences. Imperative. What to do or avoid, and the one-line why.>
