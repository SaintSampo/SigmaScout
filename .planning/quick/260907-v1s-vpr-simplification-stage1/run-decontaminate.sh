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
#
# The screen ALREADY RAN 03:39-03:53, and its artifact then had the STANDING
# carryPriorYearShare override applied by hand (see that file's own
# survivorOverride block). That knob measures a Brier range of EXACTLY 0 on
# this window because it is structurally UNREACHABLE here, not inert: this
# task's own per-origin sweeps put it at 2.07 (2026), 3.26 (2025), 3.36 (2024)
# span/SE. The retune skill carries the override as a pre-committed rule.
#
# DISABLED rather than deleted, and the distinction is load-bearing: re-running
# the screen REGENERATES the artifact and silently drops the override. That
# already cost two restarts -- the first joint attempt ran 12 min on the
# un-overridden 10-knob file, and a second accidental screen run was killed
# mid-flight before it could overwrite the corrected artifact.
# DISABLED 2026-09-08 (see note below): run screen --stage screen --seasons 2019,2020 --values 5 --batch 4 \
#   --out "reports/sensitivity-screen-${STAMP}.json"

for origin in 2023 2024; do
  run "joint-origin${origin}" --stage joint --origin "$origin" \
    --evals 40 --batch 4 \
    --survivors "reports/sensitivity-screen-${STAMP}.json" \
    --incumbent data/algorithm-versions/vpr@11.0.0+rolling-2026-09e.json \
    --out "reports/tune-joint-origin${origin}-${STAMP}.json"
done

echo "DECONTAMINATION RUNS COMPLETE $(date +%H:%M:%S)"
