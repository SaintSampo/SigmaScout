---
task: bpr-display-only-phase-components
status: complete
date: 2026-09-08
depends_on: 260908-b4t-fresh-2023-blind-model
predictions_changed: false
equivalence_matches_compared: 152757
equivalence_mismatches: 0
published: false
---

# BPR display-only phase components

BPR now publishes `phaseAuto` / `phaseTeleop` / `phaseEndgame` alongside `total`.
**Predictions are untouched, and that is measured rather than asserted.**

## The isolation claim, and its proof

Replaying all ten seasons through the new module and through the pre-change
module at HEAD, side by side:

```
matches compared     : 152,757
prediction mismatches: 0
```

Every `pRedWin`, `redScore`, `blueScore` and `variance` is bit-identical, and
the predictor's league state (`logTau`, `scale`, `scaleCount`) never diverged at
any season boundary. The sealed 78.05% still describes exactly what ships.

The isolation is structural, not a convention: phase filters live in their own
`BprState.phaseTeams` map, and `predict` reads only `teams`. Four permanent
tests pin it -- most directly, one that replaces every phase rating with
nonsense and asserts the prediction is unchanged.

## Why display-only

A component split has to read per-season `score_breakdown` field names, and for
2023-2026 those were holdout schema. Making them a prediction input would cost
the 2025-2026 split -- the last clean holdout before 2027 -- on a hypothesis
worth naming honestly:

**EPA and VPR both already predict from components** (`epa.ts` sums
`state.teamComponents`; `sigma1/index.ts` sums via `allianceOffensiveTotal`), and
BPR -- which models the total directly and has no components -- beats both on
every published season. Component structure is not what drives winner accuracy
here. Decided 2026-09-08: show them, don't predict from them.

## Design

Three independent filters per team, one per phase, running the same
rank-weighted Kalman math and the same frozen hyperparameters as the total
filter, each with its own online point scale (2026: auto 71.7, teleop 182.1,
endgame 79.8 points per alliance).

Teams are ranked WITHIN the phase. The best auto robot on an alliance is not
necessarily its best robot overall, and reusing the total's ordering would
misattribute exactly the specialists a user looks this up for. That is also why
the cheaper option -- splitting the total by each team's observed share of
alliance output -- was rejected despite guaranteeing the three sum to the total.

`stepScale` and `foldRatings` were extracted from `update` rather than copied, so
a phase can never drift onto slightly different math than the quantity it
decomposes. The total path is bit-identical through the refactor (see above).

## Do the three sum to the total?

Close, but not exactly -- they are independent estimates with independent
shrinkage. Measured over 3,477 teams with all three phases in 2024, against a
mean total of 28.29 points per team:

| |sum - total| | points |
|---|---|
| median | 0.89 |
| p95 | 2.87 |
| max | 9.04 |

Signed mean -0.44, i.e. a slight systematic under-sum. About 3% at the median.
Left un-renormalized deliberately: forcing them to add up would misrepresent
three independent measurements as a decomposition of one.

## Not measured is not zero

A phase key is ABSENT until that phase's scale has been established by at least
one successfully parsed breakdown -- never published as `0`. "Not measured" and
"scores nothing in auto" are different claims. This covers matches with no
breakdown at all and breakdowns that fail their season schema (measured at ~21%
of offseason matches that carry one). Two tests pin each case.

## Surfaces

No web change was needed: the team page, event Breakdown tab and teams table all
key off the metric NAMES (`phaseAuto` etc.), with no per-algorithm gating, and
`HISTORY_PERCENTILE_METRIC_KEYS` already covers all three -- so BPR's phases get
percentile tier boxes on the same terms as VPR's.

## Not done

- **Not published.** Republish is pending and will also carry the no-call fix
  from `260908-b4t` addendum 2, which lowers BPR's 2016 accuracy by ~1.0pp.
- `packages/harness/publish.ts` and `seasonParamSets.test.ts` /
  `algorithmIdentity.test.ts` fail only under full-suite contention; all three
  pass in isolation (6/6, 11/11).
