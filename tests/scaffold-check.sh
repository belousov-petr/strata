#!/usr/bin/env bash
# Scaffold validation for strata layout_version 3: simulate `strata init` (code project) into
# a throwaway temp dir per SKILL.md section 7, then assert the result matches the
# DESIGN.md tree. Run from anywhere: bash tests/scaffold-check.sh
set -uo pipefail
cd "$(dirname "$0")/.."

FAIL=0
fail() { echo "FAIL: $1"; FAIL=1; }
ok()   { echo "ok:   $1"; }

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
TPL=skills/strata/templates
NAME="Scaffold Test"
DATE=$(date +%Y-%m-%d)

# --- simulate init (code project), per the SKILL.md section 7 mapping ---------
mkdir -p "$T/.strata/memory/learnings" "$T/.strata/memory/archive" \
         "$T/.strata/issues/archive" \
         "$T/.strata/docs/product" "$T/.strata/docs/architecture" \
         "$T/.strata/docs/decisions" "$T/.strata/docs/reference" "$T/.strata/docs/ops"

cp "$TPL/AGENTS.md"  "$T/AGENTS.md"
cp "$TPL/CLAUDE.md"  "$T/CLAUDE.md"
cp "$TPL/MANIFEST.md" "$T/.strata/MANIFEST.md"
cp "$TPL/memory/MEMORY.md"            "$T/.strata/memory/"
cp "$TPL/memory/project_state.md"     "$T/.strata/memory/"
cp "$TPL/memory/learnings/INDEX.md"   "$T/.strata/memory/learnings/"
cp "$TPL/memory/learnings/_TEMPLATE.md" "$T/.strata/memory/learnings/"
cp "$TPL/memory/archive/ARCHIVE.md"   "$T/.strata/memory/archive/"
cp "$TPL/memory/archive/action_log.md" "$T/.strata/memory/archive/"
cp "$TPL/issues/README.md" "$TPL/issues/_TEMPLATE.md" "$TPL/issues/ACTIVE.md" \
   "$TPL/issues/OPEN.md" "$TPL/issues/PARKED.md" "$T/.strata/issues/"
mkdir -p "$T/.strata/inbox"
cp "$TPL/inbox/.gitignore" "$T/.strata/inbox/.gitignore"
cp "$TPL/docs/ARCHITECTURE.md" "$T/.strata/docs/"
for d in product architecture decisions reference ops; do
  cp "$TPL/docs/$d/README.md" "$T/.strata/docs/$d/"
done

# substitute placeholders in every copied file
find "$T" -name "*.md" -exec sed -i "s/{{PROJECT_NAME}}/$NAME/g; s/{{INIT_DATE}}/$DATE/g" {} +

# --- assertions ----------------------------------------------------------------
expected=(
  "AGENTS.md" "CLAUDE.md"
  ".strata/MANIFEST.md"
  ".strata/memory/MEMORY.md" ".strata/memory/project_state.md"
  ".strata/memory/learnings/INDEX.md" ".strata/memory/learnings/_TEMPLATE.md"
  ".strata/memory/archive/ARCHIVE.md" ".strata/memory/archive/action_log.md"
  ".strata/issues/README.md" ".strata/issues/_TEMPLATE.md"
  ".strata/issues/ACTIVE.md" ".strata/issues/OPEN.md" ".strata/issues/PARKED.md"
  ".strata/docs/ARCHITECTURE.md"
  ".strata/docs/product/README.md" ".strata/docs/architecture/README.md"
  ".strata/docs/decisions/README.md" ".strata/docs/reference/README.md"
  ".strata/docs/ops/README.md"
  ".strata/inbox/.gitignore"
)
for p in "${expected[@]}"; do
  if [ -f "$T/$p" ]; then ok "$p"; else fail "missing from scaffold: $p"; fi
done
for d in ".strata/issues/archive" ".strata/memory/archive" ".strata/memory/learnings"; do
  if [ -d "$T/$d" ]; then ok "$d/ (dir)"; else fail "missing dir: $d"; fi
done

# no unsubstituted placeholders
left=$(grep -rl "{{" "$T" 2>/dev/null || true)
if [ -n "$left" ]; then fail "unsubstituted placeholders remain: $left"; else ok "all placeholders substituted"; fi

# version stamp present and machine-checkable
if grep -q "^layout_version: 3$" "$T/.strata/MANIFEST.md"; then
  ok "layout_version: 3 stamped in MANIFEST.md"
else
  fail "layout_version: 3 missing from MANIFEST.md"
fi

# project name actually landed
if grep -q "$NAME" "$T/.strata/MANIFEST.md"; then ok "project name substituted"; else fail "project name not substituted"; fi

# scaffold itself carries no legacy tokens
if grep -rnE '\.ai/|open_action_items|MEMORY-MAP|GEMINI|/save-point|/load-point|docs/parked|feedback_' "$T" >/dev/null 2>&1; then
  fail "legacy tokens inside the scaffold:"
  grep -rnE '\.ai/|open_action_items|MEMORY-MAP|GEMINI|/save-point|/load-point|docs/parked|feedback_' "$T"
else
  ok "scaffold free of legacy tokens"
fi

# scaffolded MEMORY.md within hot budget
ml=$(wc -l < "$T/.strata/memory/MEMORY.md")
if [ "$ml" -le 80 ]; then ok "scaffolded MEMORY.md ${ml} lines (<=80)"; else fail "scaffolded MEMORY.md ${ml} lines (>80)"; fi

echo
if [ "$FAIL" -eq 0 ]; then echo "SCAFFOLD PASS"; else echo "SCAFFOLD FAIL"; exit 1; fi
