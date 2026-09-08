#!/usr/bin/env bash
# De-contaminate the incumbent's 2023 and 2024 parameters.
#
# THE DEFECT (gate 5, quick task 260907-v1s): the live pinned set's parameters
# for 2023 and 2024 were selected on the window 2022/2023/2024 -- a window
# CONTAINING both origins. So on those two origins every properly blinded
# candidate has been scored against an incumbent that already saw the season.
# A contaminated set has no valid claim to the pin.
#
# `--origin` DERIVES the selection window and carries all four blindness gates,
# so 2023 resolves to 2019/2020/2022 and 2024 to 2020/2022/2023 -- strictly
# prior in both cases. That derivation is the whole point: naming the window by
# hand (`--seasons`) would carry only gates 3 and 4.
#
# A fresh SCREEN is required first. The committed survivors artifact
# (reports/sensitivity-screen-260906.json) names eight knobs that 11.0.0 either
# deleted or moved into SEARCH_EXCLUSIONS, and `screenGridFor` refuses an
# unsearchable key by design -- so reusing it would abort rather than silently
# search a stale space.
#
# Runs alongside another session's republish: read-only on the corpus, writes
# only to reports/. NOTHING IS PROMOTED HERE -- re-promotion touches
# data/algorithm-versions/, which that publish reads, so it waits.
set -u
cd "$(dirname "$0")/../../.." || exit 1
STAMP=260908-decon

run () {
  local label="$1"; shift
  echo "=== BEGIN ${label} $(date +%H:%M:%S) ==="
  npx tsx packages/harness/tune.ts "$@" 2>&1 | tail -25
  echo "=== END ${label} $(date +%H:%M:%S) ==="
  echo
}

# Screen on 2019/2020 -- strictly prior to BOTH origins, so one screen is
# leak-free for both (the earliest-origin rule from the retune skill).
run screen --stage screen --seasons 2019,2020 --values 5 --batch 4 \
  --out "reports/sensitivity-screen-${STAMP}.json"

for origin in 2023 2024; do
  run "joint-origin${origin}" --stage joint --origin "$origin" \
    --evals 40 --batch 4 \
    --survivors "reports/sensitivity-screen-${STAMP}.json" \
    --incumbent data/algorithm-versions/vpr@11.0.0+rolling-2026-09e.json \
    --out "reports/tune-joint-origin${origin}-${STAMP}.json"
done

echo "DECONTAMINATION RUNS COMPLETE $(date +%H:%M:%S)"
