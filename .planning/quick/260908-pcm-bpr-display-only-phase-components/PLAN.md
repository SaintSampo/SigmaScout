---
task: bpr-display-only-phase-components
status: in-progress
date: 2026-09-08
depends_on: 260908-b4t-fresh-2023-blind-model
---

# BPR display-only phase components

Publish `phaseAuto` / `phaseTeleop` / `phaseEndgame` for BPR on the team page,
the teams index and the event page. **Predictions are not touched.**

## Why display-only

BPR has no components at all: `teamMetrics` emits `total` and nothing else. That
was forced by the 2023-blind constraint -- a component split has to read
per-season `score_breakdown` field names, and the 2023-2026 names were holdout
schema.

The predictive version of this would cost the 2025-2026 split, which is the last
clean holdout before 2027. Decided 2026-09-08: spend nothing. Components become
a display surface, predictions stay on `totalPoints`, and the sealed 78.05%
keeps describing the predictor because the phase state feeds nothing.

Supporting evidence for not spending the split: EPA and VPR BOTH predict from
components (`epa.ts` sums `state.teamComponents`; `sigma1/index.ts` sums via
`allianceOffensiveTotal`), and BPR -- which models the total directly and has no
components -- beats both on every published season. Component structure is not
what drives winner accuracy here.

## Design

**Structural isolation, not a convention.** Phase state lives in a SEPARATE map
on `BprState` (`phaseTeams`), never inside `teams`. `predict` reads `teams`;
the display path reads `phaseTeams`. A reviewer can see the isolation from the
type, and a test pins it.

Three independent filters per team, one per phase, running the SAME rank-weighted
Kalman math and the SAME frozen hyperparameters as the total filter, each with
its own online point scale. Teams are ranked WITHIN the phase -- the best auto
robot is not necessarily the best overall.

Phase observations come from `tryParseBreakdownPair` (the shared, tested helper
EPA and VPR already use) summed over `componentsInGroup(season, group)`.

**Why not the cheap alternative.** Splitting the total rating by each team's
observed share of alliance output would guarantee the three sum to the total and
cost 3 numbers of state. Rejected: attribution would be alliance-level, so an
endgame specialist who always plays with auto-heavy partners gets credited for
their partners' auto. That is exactly the team a user looks this up for.

**Summation.** `auto + teleop + endgame` should land near `total` but will not
equal it exactly (independent filters, independent shrinkage). Groups exclude
`adjust` and `foulsCommitted` by design, and BPR's own signal is
`totalPoints - foulPoints`, so the residual is `adjust` plus filter disagreement.
Measure it before shipping; renormalize only if it is visibly wrong.

## Budget -- measured, not projected

Team artifacts are per-algorithm, so the 94.3%-of-ceiling object
(`frc3538/2024/vpr@...`, 377,250 B) is VPR's and irrelevant here.

| | BPR today | VPR today | ceiling |
|---|---|---|---|
| `team/frc3538/2024` | 187,070 B | 377,250 B | 400,000 B |
| metric keys | `total` | 17 | -- |
| metrics bytes/history row | 56.6 | 827.2 | -- |

Metric history is per-match (234 rows for that team-season), so 3 phase metrics
add ~150 B/row ~= +35 KB -> ~222 KB, 55% of ceiling. Confirm against a real
dry-run before publishing.

## Tasks

1. Extract `viewOfMap` / the Kalman fold so total and phase share one
   implementation rather than a copy.
2. Add `phaseTeams` + per-phase scale to `BprState`; fold in `update`.
3. Emit the three metrics from `teamMetrics`.
4. **Equivalence test: predictions bit-identical to pre-change BPR** over a real
   match stream. This is the test that makes "display-only" true rather than
   claimed.
5. `carrySeason` carries phase state on the same rule as the total.
6. `serializeBprState` / `deserializeBprState` round-trip the new state.
7. Missing/malformed breakdown: leave phase state untouched and emit NO phase
   metrics. Never publish a zero that reads as "this team scores nothing in
   auto".
8. Dry-run one season; check real sizes; measure the summation residual.

## Not in scope

- Any change to `predict`, `BPR_PARAMS`, or the published version string's
  meaning as a predictor.
- Tuning the phase filters. They reuse the frozen knobs unchanged; there is no
  design data for phase-specific tuning that would not spend the holdout.
