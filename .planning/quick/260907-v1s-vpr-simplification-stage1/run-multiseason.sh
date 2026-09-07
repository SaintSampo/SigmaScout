#!/usr/bin/env bash
# Stage 1b driver: does the 2026 deletion list survive on the other origins?
#
# Serial by design -- each probe process peaks around 3.7 GB with batch 8, so
# running these concurrently would swap rather than finish faster.
#
# Replay windows mirror the 2026 run: the origin plus the two seasons before it
# (2021 does not exist). Every origin scores its OWN shipped parameter set as
# the baseline, so each verdict compares like with like.
set -u
cd "$(dirname "$0")/../../.." || exit 1
OUT=reports
PROBE=.planning/quick/260907-v1s-vpr-simplification-stage1/probe.ts

run () {
  local label="$1"; shift
  echo "=== BEGIN ${label} $(date +%H:%M:%S) ==="
  npx tsx "$PROBE" "$@" 2>&1 | tail -40
  echo "=== END ${label} $(date +%H:%M:%S) ==="
  echo
}

# Wave 1 -- the deletion gate. Cheap (9 configs each) and decisive: if `minimal`
# costs nothing on 2022-2025 too, the 11 deletions are real rather than
# 2026-shaped.
run combos-2022 --mode combos --season 2022 --replay 2019,2020,2022 --batch 9 --out "$OUT/v1s-combos-2022.json"
run combos-2023 --mode combos --season 2023 --replay 2020,2022,2023 --batch 9 --out "$OUT/v1s-combos-2023.json"
run combos-2024 --mode combos --season 2024 --replay 2022,2023,2024 --batch 9 --out "$OUT/v1s-combos-2024.json"
run combos-2025 --mode combos --season 2025 --replay 2023,2024,2025 --batch 9 --out "$OUT/v1s-combos-2025.json"

# Wave 2 -- full per-knob sensitivity on the two seasons that would form the
# Stage 2 tuning window. Long (~2h each); ordered so the more relevant season
# lands first if the machine is interrupted.
run sweep-2025 --season 2025 --replay 2023,2024,2025 --values 5 --batch 8 --out "$OUT/v1s-sensitivity-2025.json"
run sweep-2024 --season 2024 --replay 2022,2023,2024 --values 5 --batch 8 --out "$OUT/v1s-sensitivity-2024.json"

echo "ALL WAVES COMPLETE $(date +%H:%M:%S)"
