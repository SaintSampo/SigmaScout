#!/usr/bin/env bash
# Re-tune the three acceptance origins still fitted to a model that no longer
# exists, so all five are fresh, blind, and current under 11.0.0.
#
# WHY EACH ONE:
#   2022  fitted 260906 with attributionShrinkage 0.844 AND maxTeamKalmanGain
#         0.959 selected TOGETHER -- that pairing is what the 260906 commit
#         claimed closed 80% of the EPA gap. 11.0.0 deleted the cap and kept
#         the shrinkage, so 2022 currently ships half of a jointly-optimised
#         setting. This is the sharpest of the three.
#   2026  fitted 260905 with adaptation ENABLED; that mechanism is deleted.
#   2025  same as 2026.
#
# 2023 and 2024 are deliberately ABSENT: they were re-fitted today under
# 11.0.0 (vpr@11.0.0+rolling-2026-09f) and re-running them would discard a
# blinded result for no reason.
#
# ORDER is failure-tolerant, not arbitrary: 2022 first because it carries the
# concrete defect, then 2026 because it is the live season, then 2025. If this
# is interrupted, the most valuable runs have already landed.
#
# SURVIVORS: reuses the 260908-decon screen artifact and does NOT regenerate
# it. That file carries a hand-applied carryPriorYearShare override (a standing
# pre-committed rule -- the knob is structurally unreachable on the 2019/2020
# screen window, not inert), and re-running the screen would silently drop it.
# Screening on 2019/2020 is strictly prior to all three origins.
#
# EVALS raised 40 -> 80. The "67 evaluations is not a search" finding is about
# the OPTIMIZER, which this does not change, but doubling coverage is the cheap
# half of the mitigation and costs ~25 extra minutes per origin. The new
# winnerSeparability field reports whether the extra budget actually bought a
# distinguishable winner rather than leaving it to faith.
set -u
cd "$(dirname "$0")/../../.." || exit 1
STAMP=260908-r3
SURVIVORS=reports/sensitivity-screen-260908-decon.json
INCUMBENT=data/algorithm-versions/vpr@11.0.0+rolling-2026-09f.json

for origin in 2022 2026 2025; do
  echo "=== BEGIN joint-origin${origin} $(date +%H:%M:%S) ==="
  npx tsx packages/harness/tune.ts --stage joint --origin "$origin" \
    --evals 80 --batch 4 \
    --survivors "$SURVIVORS" \
    --incumbent "$INCUMBENT" \
    --out "reports/tune-joint-origin${origin}-${STAMP}.json" 2>&1 | tail -25
  echo "=== END joint-origin${origin} $(date +%H:%M:%S) ==="
  echo
done

echo "REMAINING-ORIGIN RETUNE COMPLETE $(date +%H:%M:%S)"
