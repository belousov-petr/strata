#!/usr/bin/env bash
# Repo lints for strata v3. Run from anywhere: bash tests/lint.sh
# Checks: legacy tokens, size budgets, canonical states/types consistency,
# template placeholder hygiene, internal link integrity.
set -uo pipefail
cd "$(dirname "$0")/.."

FAIL=0
fail() { echo "FAIL: $1"; FAIL=1; }
ok()   { echo "ok:   $1"; }
json_ok() {
  local f="$1"
  if command -v node >/dev/null 2>&1; then
    node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$f" >/dev/null 2>&1
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool "$f" >/dev/null 2>&1
  elif command -v python >/dev/null 2>&1; then
    python -m json.tool "$f" >/dev/null 2>&1
  else
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 1. Legacy tokens (.ai/, open_action_items, MEMORY-MAP, GEMINI, /save-point,
#    /load-point, docs/parked, feedback_*).
#    - templates/: zero tolerance (scaffolded into new projects).
#    - operational files (SKILL, commands, DESIGN): allowed only on lines that
#      reference legacy detection / migration context.
#    - historical surface (README, MIGRATIONS, CHANGELOG, decisions/): exempt —
#      they document the past on purpose.
# ---------------------------------------------------------------------------
LEGACY='\.ai/|open_action_items|MEMORY-MAP|GEMINI|/save-point|/load-point|docs/parked|feedback_'

SKILL_DIR=skills/strata
TEMPLATES_DIR="$SKILL_DIR/templates"

if grep -rnE "$LEGACY" "$TEMPLATES_DIR"/ >/dev/null 2>&1; then
  fail "legacy tokens in templates/:"
  grep -rnE "$LEGACY" "$TEMPLATES_DIR"/
else
  ok "templates/ free of legacy tokens"
fi

CONTEXT='legacy|Legacy|fingerprint|MIGRATIONS|v1|v2'
for f in "$SKILL_DIR/SKILL.md" commands/save.md commands/load.md docs/DESIGN.md; do
  bad=$(grep -nE "$LEGACY" "$f" | grep -vE "$CONTEXT" || true)
  if [ -n "$bad" ]; then
    fail "legacy tokens outside guard/migration context in $f:"
    echo "$bad"
  else
    ok "$f legacy tokens only in guard/migration context"
  fi
done

# Nothing else outside the historical surface may mention legacy tokens at all.
stray=$(grep -rlE "$LEGACY" --include="*.md" . \
  --exclude-dir=.git --exclude-dir=.remember --exclude-dir=decisions --exclude-dir=issues \
  --exclude=README.md --exclude=MIGRATIONS.md --exclude=CHANGELOG.md \
  --exclude=SKILL.md --exclude=save.md --exclude=load.md --exclude=DESIGN.md \
  2>/dev/null | grep -v "^./$TEMPLATES_DIR/" || true)
if [ -n "$stray" ]; then
  fail "legacy tokens in unexpected files: $stray"
else
  ok "no legacy tokens outside the historical surface"
fi

# ---------------------------------------------------------------------------
# 2. Save autosave + immediate capture + flat migration contracts
# ---------------------------------------------------------------------------
SAVE_SURFACE=("$SKILL_DIR/SKILL.md" commands/save.md commands/capture.md README.md docs/DESIGN.md)
if grep -nF "Confirm? (y/n)" "${SAVE_SURFACE[@]}" >/dev/null 2>&1; then
  fail "save surface still contains Confirm? (y/n):"
  grep -nF "Confirm? (y/n)" "${SAVE_SURFACE[@]}"
else
  ok "save surface has no Confirm? (y/n) prompt"
fi

if grep -qF "Invoking \`/strata:save\` is the confirmation" commands/save.md README.md; then
  ok "strata:save autosave contract documented"
else
  fail "strata:save autosave contract missing"
fi

if [ -f commands/capture.md ]; then
  ok "/strata:capture command exists"
else
  fail "/strata:capture command missing"
fi

for f in "$SKILL_DIR/SKILL.md" README.md commands/save.md commands/load.md; do
  if grep -qF "/strata:capture" "$f"; then
    ok "$f mentions /strata:capture"
  else
    fail "$f missing /strata:capture guidance"
  fi
done

if grep -qF "Skill(name='strata', args='capture')" "$SKILL_DIR/SKILL.md" README.md; then
  ok "Codex capture entry point documented"
else
  fail "Codex capture entry point missing"
fi

if grep -qF "## Rung 0: flat → v3" MIGRATIONS.md && \
   grep -qF "source-flat-project-state" MIGRATIONS.md "$SKILL_DIR/SKILL.md"; then
  ok "flat memory migrates with provenance archive"
else
  fail "flat memory migration/provenance contract missing"
fi

if [ -f .codex-plugin/plugin.json ] && \
   grep -qF '"name": "strata"' .codex-plugin/plugin.json && \
   grep -qF '"skills": "./skills/"' .codex-plugin/plugin.json; then
  ok "Codex plugin manifest points at ./skills/"
else
  fail "Codex plugin manifest missing or not pointed at ./skills/"
fi

# ---------------------------------------------------------------------------
# 2b. Claude Code plugin: manifest + marketplace + namespaced commands
# ---------------------------------------------------------------------------
if [ -f .claude-plugin/plugin.json ] && \
   json_ok .claude-plugin/plugin.json && \
   grep -qF '"name": "strata"' .claude-plugin/plugin.json; then
  ok "Claude plugin.json present, valid JSON, name strata"
else
  fail "Claude plugin manifest (.claude-plugin/plugin.json) missing or invalid"
fi

if [ -f .claude-plugin/marketplace.json ] && \
   json_ok .claude-plugin/marketplace.json && \
   grep -qF '"name": "strata"' .claude-plugin/marketplace.json && \
   grep -qF '"source": "."' .claude-plugin/marketplace.json; then
  ok 'Claude marketplace.json present, valid JSON, lists strata at source "."'
else
  fail "Claude marketplace manifest (.claude-plugin/marketplace.json) missing or invalid"
fi

# Claude plugin.json version tracks the Codex plugin.json version
cver=$(grep -m1 '"version"' .codex-plugin/plugin.json  | sed -E 's/.*"version"[^"]*"([^"]+)".*/\1/')
pver=$(grep -m1 '"version"' .claude-plugin/plugin.json | sed -E 's/.*"version"[^"]*"([^"]+)".*/\1/')
if [ -n "$pver" ] && [ "$pver" = "$cver" ]; then
  ok "Claude plugin.json version ($pver) matches Codex plugin.json"
else
  fail "plugin version mismatch: Claude=$pver Codex=$cver"
fi

# the three commands resolve to /strata:save | /strata:load | /strata:capture
for c in save load capture; do
  if [ -f "commands/$c.md" ] && grep -qiE "^name:[[:space:]]*$c[[:space:]]*$" "commands/$c.md"; then
    ok "commands/$c.md present (name: $c -> /strata:$c)"
  else
    fail "commands/$c.md missing or its 'name:' is not '$c'"
  fi
done

# commands, skill, AND scaffolded templates must not re-introduce the bare,
# un-namespaced slash names (templates scaffold into every project — a stale
# bare name there propagates to all installs).
if grep -rnE '/strata-(save|load|capture)\b' commands/ "$SKILL_DIR/SKILL.md" "$TEMPLATES_DIR" >/dev/null 2>&1; then
  fail "old bare /strata-<verb> slash names leaked into commands/, SKILL.md, or templates/:"
  grep -rnE '/strata-(save|load|capture)\b' commands/ "$SKILL_DIR/SKILL.md" "$TEMPLATES_DIR"
else
  ok "no bare /strata-<verb> names in commands/, SKILL.md, or templates/"
fi

# official validator, when the CLI is available (best-effort; CI may lack it)
if command -v claude >/dev/null 2>&1; then
  if claude plugin validate . --strict >/dev/null 2>&1; then
    ok "claude plugin validate . --strict"
  else
    fail "claude plugin validate . --strict reported problems:"
    claude plugin validate . --strict 2>&1 | sed 's/^/      /'
  fi
else
  echo "skip:  claude CLI not found — skipping 'claude plugin validate'"
fi

# ---------------------------------------------------------------------------
# 2c. Capture-guard hook (shared script + Claude plugin hooks.json + Codex sample)
# ---------------------------------------------------------------------------
if [ -f hooks/strata-capture-guard.mjs ]; then
  ok "hooks/strata-capture-guard.mjs present"
else
  fail "hooks/strata-capture-guard.mjs missing"
fi
for j in hooks/hooks.json hooks/codex-hooks.sample.json; do
  if [ -f "$j" ] && json_ok "$j"; then ok "$j present + valid JSON"; else fail "$j missing or invalid JSON"; fi
done
if grep -qF 'strata-capture-guard.mjs' hooks/hooks.json; then
  ok "Claude hooks.json wires the guard script"
else
  fail "Claude hooks.json does not reference the guard script"
fi

# ---------------------------------------------------------------------------
# 3. Size budgets
# ---------------------------------------------------------------------------
mem_lines=$(wc -l < "$TEMPLATES_DIR/memory/MEMORY.md")
if [ "$mem_lines" -le 80 ]; then ok "templates/memory/MEMORY.md ${mem_lines} lines (<=80)"; else fail "templates/memory/MEMORY.md ${mem_lines} lines (>80)"; fi

skill_lines=$(wc -l < "$SKILL_DIR/SKILL.md")
if [ "$skill_lines" -le 350 ]; then ok "$SKILL_DIR/SKILL.md ${skill_lines} lines (<=350)"; else fail "$SKILL_DIR/SKILL.md ${skill_lines} lines (>350, bloated)"; fi

# ---------------------------------------------------------------------------
# 4. Canonical states/types — identical strings everywhere they appear
# ---------------------------------------------------------------------------
TYPES='bug | improvement | debt | task | feature | initiative'
STATUSES='open | in-progress | parked | resolved | wont-fix'
SEVERITY='high | med | low'
ORIGIN='success | failure'

require() { # require <string> <file...>
  local s="$1"; shift
  for f in "$@"; do
    if grep -qF "$s" "$f"; then ok "'$s' in $f"; else fail "'$s' missing from $f"; fi
  done
}
require "$TYPES"    docs/DESIGN.md "$TEMPLATES_DIR/MANIFEST.md" "$SKILL_DIR/SKILL.md" "$TEMPLATES_DIR/issues/README.md" "$TEMPLATES_DIR/issues/_TEMPLATE.md"
require "$STATUSES" docs/DESIGN.md "$TEMPLATES_DIR/MANIFEST.md" "$SKILL_DIR/SKILL.md" "$TEMPLATES_DIR/issues/README.md" "$TEMPLATES_DIR/issues/_TEMPLATE.md"
require "$SEVERITY" docs/DESIGN.md "$TEMPLATES_DIR/MANIFEST.md" "$SKILL_DIR/SKILL.md" "$TEMPLATES_DIR/issues/README.md" "$TEMPLATES_DIR/issues/_TEMPLATE.md"
require "$ORIGIN"   docs/DESIGN.md "$TEMPLATES_DIR/MANIFEST.md" "$SKILL_DIR/SKILL.md" "$TEMPLATES_DIR/memory/learnings/_TEMPLATE.md"

# No drifted variants ("medium" used as a value, in frontmatter or tables)
if grep -rnE 'severity:.*\bmedium\b|\|\s*medium\s*\|' "$SKILL_DIR"/ docs/DESIGN.md >/dev/null 2>&1; then
  fail "drifted severity vocabulary ('medium' as a value) found:"
  grep -rnE 'severity:.*\bmedium\b|\|\s*medium\s*\|' "$SKILL_DIR"/ docs/DESIGN.md
else
  ok "no drifted severity vocabulary"
fi

# ---------------------------------------------------------------------------
# 5. Template placeholder hygiene — only {{PROJECT_NAME}} and {{INIT_DATE}}
# ---------------------------------------------------------------------------
unknown=$(grep -rhoE '\{\{[A-Z_]+\}\}' "$TEMPLATES_DIR"/ | sort -u | grep -vE '^\{\{(PROJECT_NAME|INIT_DATE)\}\}$' || true)
if [ -n "$unknown" ]; then fail "unknown placeholders in templates: $unknown"; else ok "template placeholders limited to PROJECT_NAME/INIT_DATE"; fi

# ---------------------------------------------------------------------------
# 6. Internal links resolve (relative .md links in the doc surface)
# ---------------------------------------------------------------------------
for f in README.md MIGRATIONS.md CHANGELOG.md docs/DESIGN.md docs/decisions/README.md; do
  dir=$(dirname "$f")
  while IFS= read -r link; do
    target="${link%%#*}"
    [ -z "$target" ] && continue
    if [ ! -e "$dir/$target" ]; then fail "$f -> broken link: $link"; fi
  done < <(awk '/^```/{f=!f; next} !f' "$f" | grep -oE '\]\(([^)#:]+\.md[^)]*)\)' | sed -E 's/^\]\(//; s/\)$//' | grep -v '^http')
  ok "$f internal links checked (code fences excluded)"
done

echo
if [ "$FAIL" -eq 0 ]; then echo "LINT PASS"; else echo "LINT FAIL"; exit 1; fi
