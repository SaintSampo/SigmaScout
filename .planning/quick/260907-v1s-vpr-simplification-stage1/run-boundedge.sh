#!/usr/bin/env bash
# Stage 1c: are the bound EDGES choosing values that the data would not choose?
#
# Two parameters measured their optimum exactly AT their declared maximum:
#   attributionShrinkage      peaks at 0.9  (its max) on 2025 AND 2026
#   minConsistencyVarianceRel peaks at 0.03 (its max) on 2025
#
# A sweep that stops where the search space stops cannot tell you the search
# space is too small. This pushes both past their registered ceilings on every
# origin.
#
# REQUIRES a working-tree-only patch to params.ts (attributionShrinkage's Zod
# .max(0.9) -> .max(1)). That patch is reverted and the tree verified clean by
# the caller once these runs finish -- it is NOT committed and must never be.
set -u
cd "$(dirname "$0")/../../.." || exit 1
PROBE=.planning/quick/260907-v1s-vpr-simplification-stage1/probe.ts
VALUES="attributionShrinkage=0.9,0.95,0.98,1.0;minConsistencyVarianceRel=0.03,0.06,0.12,0.25"

run () {
  local season="$1" replay="$2"
  echo "=== BEGIN boundedge-${season} $(date +%H:%M:%S) ==="
  npx tsx "$PROBE" --season "$season" --replay "$replay" --explicit "$VALUES" \
    --batch 10 --out "reports/v1s-boundedge-${season}.json" 2>&1 | tail -30
  echo "=== END boundedge-${season} $(date +%H:%M:%S) ==="
  echo
}

run 2022 2019,2020,2022
run 2023 2020,2022,2023
run 2024 2022,2023,2024
run 2025 2023,2024,2025
run 2026 2024,2025,2026

echo "BOUND-EDGE SWEEP COMPLETE $(date +%H:%M:%S)"
