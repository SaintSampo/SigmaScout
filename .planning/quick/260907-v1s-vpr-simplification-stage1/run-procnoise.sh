#!/usr/bin/env bash
# Stage 1d: the last untested lead -- the process-noise ordering constraint.
#
# `processNoiseEventBoundaryRel > processNoiseWithinEventRel` is enforced by
# both isValidParamSet and the Zod schema. On 2026 that constraint BOUND: the
# top of the within-event bound was rejected as invalid while the accuracy
# trend was still climbing, so the one-at-a-time sweep stopped short of the
# model's preference rather than at it. A constraint that truncates a sweep
# looks exactly like a flat knob.
#
# Both terms are z.number().finite() in the schema -- only the ORDERING is
# enforced -- so this needs no source patch, unlike Stage 1c.
set -u
cd "$(dirname "$0")/../../.." || exit 1
PROBE=.planning/quick/260907-v1s-vpr-simplification-stage1/probe.ts

run () {
  local season="$1" replay="$2"
  echo "=== BEGIN procnoise-${season} $(date +%H:%M:%S) ==="
  npx tsx "$PROBE" --mode procnoise --season "$season" --replay "$replay" \
    --batch 10 --out "reports/v1s-procnoise-${season}.json" 2>&1 | tail -32
  echo "=== END procnoise-${season} $(date +%H:%M:%S) ==="
  echo
}

run 2026 2024,2025,2026
run 2025 2023,2024,2025
run 2024 2022,2023,2024
run 2023 2020,2022,2023
run 2022 2019,2020,2022

echo "PROCNOISE SWEEP COMPLETE $(date +%H:%M:%S)"
