#!/usr/bin/env bash
# Repo lints for strata v3. Run from anywhere: bash tests/lint.sh
# Checks: legacy tokens, size budgets, canonical states/types consistency,
# template placeholder hygiene, internal link integrity.
set -uo pipefail
cd "$(dirname "$0")/.."

FAIL=0
fail() { echo "FAIL: $1"; FAIL=1; }
ok()   { echo "ok:   $1"; }

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
for f in "$SKILL_DIR/SKILL.md" strata-save.md strata-load.md docs/DESIGN.md; do
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
  --exclude-dir=.git --exclude-dir=.remember --exclude-dir=decisions \
  --exclude=README.md --exclude=MIGRATIONS.md --exclude=CHANGELOG.md \
  --exclude=SKILL.md --exclude=strata-save.md --exclude=strata-load.md --exclude=DESIGN.md \
  2>/dev/null | grep -v "^./$TEMPLATES_DIR/" || true)
if [ -n "$stray" ]; then
  fail "legacy tokens in unexpected files: $stray"
else
  ok "no legacy tokens outside the historical surface"
fi

# ---------------------------------------------------------------------------
# 2. Save autosave + immediate capture + flat migration contracts
# ---------------------------------------------------------------------------
SAVE_SURFACE=("$SKILL_DIR/SKILL.md" strata-save.md strata-capture.md README.md docs/DESIGN.md)
if grep -nF "Confirm? (y/n)" "${SAVE_SURFACE[@]}" >/dev/null 2>&1; then
  fail "save surface still contains Confirm? (y/n):"
  grep -nF "Confirm? (y/n)" "${SAVE_SURFACE[@]}"
else
  ok "save surface has no Confirm? (y/n) prompt"
fi

if grep -qF "Invoking \`/strata-save\` is the confirmation" strata-save.md README.md; then
  ok "strata-save autosave contract documented"
else
  fail "strata-save autosave contract missing"
fi

if [ -f strata-capture.md ]; then
  ok "/strata-capture command exists"
else
  fail "/strata-capture command missing"
fi

for f in "$SKILL_DIR/SKILL.md" README.md strata-save.md strata-load.md; do
  if grep -qF "/strata-capture" "$f"; then
    ok "$f mentions /strata-capture"
  else
    fail "$f missing /strata-capture guidance"
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
