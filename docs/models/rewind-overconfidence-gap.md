# Rewind-overconfidence gap (D-02's control run, 2026-08-31)

This is the single narrative home for D-02's required measurement: how much narrower the
Simulation tab's rank distribution comes out when its rewind start match is already played,
compared to an honest from-here forecast at the same match. D-01 lets the tab rewind into an
already-played qualification match — the only reason the feature is usable at all, since just 41
of 1,353 corpus events have any genuinely unplayed qualification match — and this document is
where that choice's cost stops being an adjective and becomes a number.

Every figure below traces to one committed source: the machine-readable ```json rewind-gap```
block at the bottom of this document, written by `scripts/measureRewindGap.ts --write-doc` and
guarded against drift from `apps/web/src/lib/rewindGap.ts` by a sync test in
`scripts/measureRewindGap.test.ts`.

## Headline verdict — read this first

**The rewind arm's rank spread comes out `narrower` — measured 10.85% narrower on average than a
true from-here forecast, over 15 paired measurements across 5 events.** The 10.85% mean clears the
measurement's own noise floor (0.62% mean, from re-simulating identical predictions under a
different seed) by roughly 17×, so this is a real effect, not Monte Carlo scatter dressed up as a
finding.

The effect is NOT uniform across an event. It is largest at the earliest rewind point — right
after the first qualification match, where the model has barely started learning about the
event's own teams — with per-event values there ranging 10.89% to 44.18% narrower. It shrinks
steadily as the chosen start match moves later into the event, and at the latest start point (2/3
of the way through qualifications) two of the five events (`2022tuis3`, `2023ctwat`) measure
slightly *negative* — the rewind arm was marginally *wider* than the honest forecast, though both
values (-8.55%, -3.70%) are well outside their own noise floors and are reported exactly as
measured, per D-02's explicit instruction that either direction is a legitimate finding. `2025cur`
breaks the otherwise-monotonic pattern (-4.23% at start=0, then +8.99% and +6.45%) — a reminder
that 15 measurements over 5 events is a small sample, not a smooth curve.

**Read plainly:** rewinding into a qualification match that has barely started is measurably
overconfident — a visitor's rank-distribution band there is meaningfully too narrow. Rewinding
into a match two-thirds of the way through an event carries little to no measurable overconfidence
— by that point the model has already learned most of what the remaining matches would teach it
anyway, so a from-here forecast and a rewind forecast end up close to indistinguishable, and can
even land on the other side of zero.

## What was measured

Two prediction sets, both produced by VPR (the tuned `vpr` algorithm — Simulation is VPR-only,
D-04), for the same set of remaining qualification matches at each of three start points across
five events:

- **The stored set** is what the harness already produces and what 08-02/08-05 publish onto
  played matches: each match's own as-of-that-match prediction. For a rewound start match, this
  has already absorbed results the simulation is pretending have not happened yet — matches after
  the start match were predicted only after the walk-forward replay had folded in every result up
  to that point.
- **The frozen set** is every remaining match predicted from ONE state, captured immediately
  before the chosen start match, with no fold-in of any result between predictions. The frozen arm
  is not an approximation of the honest from-here forecast — it IS the honest from-here forecast:
  `packages/harness/publish.ts`'s scheduled-match builder predicts every scheduled match from one
  shared per-algorithm state (the state after the last match actually played), so a captured
  pre-start-match state is exactly what the live path would use if these matches were genuinely
  unplayed (08-CONTEXT.md D-01, "the live case is exact and needs nothing").

Both sets are fed through the SAME imported `simulateRanks`
(`packages/core/algorithms/simulation/rankSimulation.ts`, 08-03) and the SAME imported
`continuousQuantile` (`apps/web/src/lib/simQuantile.ts`, 08-04) — neither is reimplemented,
wrapped, or approximated in the control script. A second copy of either would make the measured
gap describe the difference between two implementations rather than between two prediction sets.

## Method

One threaded, offseason-inclusive season replay (`buildSeasonStream(..., { includeOffseason: true
})`, matching `publish:seasons`' own stream composition) from `COLD_START_SEASON` (2022) through
the newest target season, with each algorithm's state carried across season boundaries via
`carrySeason` exactly as `publishSeasons`/`runSeasons` do. The newest target season's stream is
truncated immediately after its last target match — nothing after it affects any measurement.

At each of three start points per event (qual fractions 0, 1/3, 2/3 — `START_POINT_FRACTIONS`),
the match immediately preceding the start match is registered as a "boundary." Inside the single
`WalkForwardSimulator.runAll` pass's `onMatchComplete` callback, the moment a boundary match
completes, every remaining match for that job is predicted from that just-completed state, with no
further fold-in — this produces the frozen set. The stored set is read directly off the SAME
`runAll` pass's own per-match records, restricted to the target event's own qualification rows — no
second pass, so there is no second chance for the two arms to diverge from what a single replay
produced.

Both arms are seeded from the SAME value with two freshly constructed `mulberry32` generators, so
they consume the identical draw stream and the comparison is paired: a difference in measured band
width is attributable to the predictions and to nothing else. A `null` per-match actual RP is
never coerced to `0` when building each job's already-earned-RP baseline (`buildBaselines`). A
match whose prediction lacks either RP pmf is excluded from BOTH arms (the union of each arm's own
exclusions), never from one arm alone.

**Noise-floor control.** For every job, the stored predictions are simulated a SECOND time under a
different seed (`DEFAULT_SEED + NOISE_CONTROL_SEED_OFFSET`) — the apparent gap between these two
runs of IDENTICAL predictions is that job's `noiseFloorPercent`, measured through the identical
code path as the real comparison. `classifyVerdict` derives the headline verdict from a stated
rule: `"indistinguishable"` when `|meanNarrowingPercent| <= meanNoiseFloorPercent` (inclusive on
the humble side), `"narrower"` when the mean narrowing exceeds the noise floor on the positive
side, `"wider"` on the negative side.

## Event sample

All five verified present in `data/corpus.sqlite` with zero null `red_rp_earned`/`blue_rp_earned`
on their played `qm` rows before this plan was written, and re-asserted by the driver at run time:

| Event | Season | Name | Week | Event type | Played quals | Roster |
|---|---|---|---|---|---|---|
| `2022tuis3` | 2022 | Izmir Regional | 0 | 0 (Regional) | 57 | 31 |
| `2023ctwat` | 2023 | NE District Waterbury Event | 1 | 1 (District) | 76 | 38 |
| `2024nysu` | 2024 | Hudson Valley Regional | 1 | 0 (Regional) | 80 | 48 |
| `2025cur` | 2025 | Curie Division | — | 3 (Championship Division) | 127 | 76 |
| `2026sccmp` | 2026 | FIRST South Carolina State Championship | 5 | 2 (District Championship) | 62 | 31 |

The frame this sample sits in: 1,349 corpus events have played quals, of which 955 are
non-offseason. Across non-offseason events the qual count runs 15 to 134 (the sample covers 57 to
127) and the largest roster anywhere in the corpus is 78 (the sample reaches 76, at `2025cur`).
`2024wvrox`, the corpus's largest event by qual count (135), is deliberately **not** in the sample:
it is an offseason event, and an offseason event's own roster and schedule are unrepresentative of
what a visitor will actually be looking at.

## Results

Every figure below is transcribed verbatim from the ```json rewind-gap``` block at the bottom of
this document — the block itself is the source of truth; this table is a readable rendering of it,
not a second measurement.

| Event | Start index | Remaining matches | Teams | Frozen mean band width | Stored mean band width | Narrowing | Noise floor |
|---|---:|---:|---:|---:|---:|---:|---:|
| `2022tuis3` | 0 | 57 | 31 | 24.3528 | 13.5936 | **44.18%** | 1.10% |
| `2022tuis3` | 19 | 38 | 31 | 9.6524 | 8.3498 | 13.49% | 0.85% |
| `2022tuis3` | 38 | 19 | 31 | 5.9607 | 6.4703 | -8.55% | 0.55% |
| `2023ctwat` | 0 | 76 | 38 | 18.8316 | 12.8289 | 31.88% | 0.04% |
| `2023ctwat` | 25 | 51 | 38 | 10.0082 | 9.0219 | 9.86% | 0.29% |
| `2023ctwat` | 50 | 26 | 38 | 5.6647 | 5.8742 | -3.70% | 0.40% |
| `2024nysu` | 0 | 80 | 48 | 24.1768 | 21.5431 | 10.89% | 0.94% |
| `2024nysu` | 26 | 54 | 48 | 14.3806 | 13.2227 | 8.05% | 0.45% |
| `2024nysu` | 53 | 27 | 48 | 7.9835 | 7.6939 | 3.63% | 0.11% |
| `2025cur` | 0 | 127 | 76 | 12.7658 | 13.3064 | -4.23% | 0.16% |
| `2025cur` | 42 | 85 | 76 | 10.9503 | 9.9655 | 8.99% | 1.01% |
| `2025cur` | 84 | 43 | 76 | 6.1143 | 5.7197 | 6.45% | 1.51% |
| `2026sccmp` | 0 | 62 | 31 | 8.7512 | 6.6897 | 23.56% | 0.75% |
| `2026sccmp` | 20 | 42 | 31 | 5.8350 | 5.0793 | 12.95% | 0.52% |
| `2026sccmp` | 41 | 21 | 31 | 3.9893 | 3.7788 | 5.27% | 0.63% |

**Headline aggregate** (15 measurements, 5 events): mean narrowing **10.85%**, range -8.55% to
44.18%, mean noise floor 0.62%, 0 matches excluded on either arm, 0 teams with an incomplete
baseline, verdict **`narrower`**.

## Limitations

- **The already-earned-RP baselines come from the corpus's own raw per-match actual RP
  (`redRpEarned`/`blueRpEarned`), not from TBA's surrogate- and DQ-adjusted Ranking Score.** This
  is identical in both arms and so cannot bias the measured GAP, but it does mean the *absolute*
  band widths reported here are not the site's own — the Simulation tab's real baselines follow
  D-12's TBA-Ranking-Score-first precedence, which this control script does not reproduce (the
  corpus has no per-event Ranking Score at the point in the season this script replays from).
- **15 measurements over 5 events is a small sample.** The range (min/max narrowing) is reported
  beside the mean rather than the mean alone, and the per-event, per-start-point table below lets a
  reader see the full spread rather than only its average.
- **1000 draws carries Monte Carlo scatter**, which is exactly what the noise-floor control exists
  to quantify — reported per job and averaged in the headline `meanNoiseFloorPercent`.
- **A mean over teams can hide a distribution in which a few teams move much more than the
  average.** This document reports the mean band width per job, not a per-team breakdown.
- **This measurement is VPR-only.** OPR and EPA carry no RP pmfs at all (D-04) and so cannot be
  measured by this method.
- **A narrower band is a statement about the spread of the forecast, never a statement that the
  forecast is better or worse.** Overconfidence is a property of the forecast's own stated
  uncertainty, not of its accuracy.

## Does this trigger the sidecar-checkpoint phase?

08-CONTEXT.md's deferred "sidecar checkpoint simulation artifact" idea would add a separate
`v1/sim/{eventKey}/...` object family holding frozen prediction sets at ~10 checkpoints per event
(~38 KB/event, VPR-only, ~35 MB total), letting the start-match picker snap to the checkpoint
at-or-before the chosen match so the rank distribution never rewinds into a match the model has
already absorbed.

**This measurement's own finding is a genuine trigger, not a clean "no."** The effect is real
(clears its own noise floor by roughly 17× on average) and, at the earliest rewind points, large
enough to matter for a site whose whole premise is honest uncertainty — a visitor rewinding to
just after qm1 sees a rank band measured 10.89% to 44.18% narrower than the honest forecast would
be. But the effect is also not uniform: by two-thirds of the way through an event it has shrunk to
single digits and, in two of five events, crossed to a small negative value. A visitor rewinding
deep into an event — arguably the more common interaction, since most of an event's matches have
already been played by the time most visitors look at it — sees a much smaller distortion than one
rewinding to the very start.

**Recommendation (not a decision — routed to a future `/gsd-discuss-phase`):** the measured gap is
large enough at early-event rewinds to be worth the ~35 MB / ~38 KB-per-event cost the deferred
idea already priced, but the cost-benefit case is strongest specifically for early-event rewinds,
not uniformly across an event. A future discussion should weigh a narrower version of the sidecar
idea — checkpoints concentrated in the first third of an event's qualification schedule, where
this measurement shows the overconfidence is largest, rather than ~10 checkpoints spread evenly
across the whole event — against simply captioning the tab with this document's own measured
figure and verdict (which 08-11 already does, via `apps/web/src/lib/rewindGap.ts`) and leaving the
underlying mechanism unchanged. This document does not decide between them.

## Reproducing this measurement

```
npx tsx scripts/measureRewindGap.ts --write-doc
```

The corpus is a local, gitignored input (`data/*` is never committed) — the block below records
`corpusIdentity` (a path) and `corpusMatchCount` (a row count) as the reproducibility handle this
project already uses elsewhere for exactly this reason. Re-running the command above against a
corpus in the same state reproduces the recorded figures exactly; a corpus in a different state
(a re-ingest that changed one of the five target events) is caught loudly by the driver's own
qual-count/roster-size assertion before it can silently produce a different number under this same
document.

```json rewind-gap
{
  "measuredAt": "2026-08-31T21:30:31.398Z",
  "algorithmId": "vpr",
  "algorithmVersion": "2.1.0+tuned-2026-08",
  "corpusIdentity": "data\\corpus.sqlite",
  "corpusMatchCount": 98598,
  "draws": 1000,
  "seed": 20260830,
  "events": [
    {
      "eventKey": "2022tuis3",
      "season": 2022,
      "qualCount": 57,
      "rosterSize": 31,
      "startPoints": [
        {
          "startIndex": 0,
          "startMatchKey": "2022tuis3_qm1",
          "remainingMatchCount": 57,
          "excludedMatchCount": 0,
          "teamCount": 31,
          "frozenMeanBandWidth": 24.352780867502585,
          "storedMeanBandWidth": 13.593591105418112,
          "narrowingPercent": 44.18053864411849,
          "noiseFloorPercent": 1.099590513144073
        },
        {
          "startIndex": 19,
          "startMatchKey": "2022tuis3_qm20",
          "remainingMatchCount": 38,
          "excludedMatchCount": 0,
          "teamCount": 31,
          "frozenMeanBandWidth": 9.652401481960009,
          "storedMeanBandWidth": 8.349848658261301,
          "narrowingPercent": 13.494598480317382,
          "noiseFloorPercent": 0.8462906838274924
        },
        {
          "startIndex": 38,
          "startMatchKey": "2022tuis3_qm39",
          "remainingMatchCount": 19,
          "excludedMatchCount": 0,
          "teamCount": 31,
          "frozenMeanBandWidth": 5.960715832403787,
          "storedMeanBandWidth": 6.470326425814221,
          "narrowingPercent": -8.549486466710535,
          "noiseFloorPercent": 0.5540579687070987
        }
      ]
    },
    {
      "eventKey": "2023ctwat",
      "season": 2023,
      "qualCount": 76,
      "rosterSize": 38,
      "startPoints": [
        {
          "startIndex": 0,
          "startMatchKey": "2023ctwat_qm1",
          "remainingMatchCount": 76,
          "excludedMatchCount": 0,
          "teamCount": 38,
          "frozenMeanBandWidth": 18.831632613165265,
          "storedMeanBandWidth": 12.828855209381603,
          "narrowingPercent": 31.876032880904326,
          "noiseFloorPercent": 0.035416859769838896
        },
        {
          "startIndex": 25,
          "startMatchKey": "2023ctwat_qm26",
          "remainingMatchCount": 51,
          "excludedMatchCount": 0,
          "teamCount": 38,
          "frozenMeanBandWidth": 10.00822292797919,
          "storedMeanBandWidth": 9.021855952081319,
          "narrowingPercent": 9.855565598367756,
          "noiseFloorPercent": 0.28536695691363806
        },
        {
          "startIndex": 50,
          "startMatchKey": "2023ctwat_qm51",
          "remainingMatchCount": 26,
          "excludedMatchCount": 0,
          "teamCount": 38,
          "frozenMeanBandWidth": 5.664739207375515,
          "storedMeanBandWidth": 5.874211565650325,
          "narrowingPercent": -3.6978288074069816,
          "noiseFloorPercent": 0.3961273150597715
        }
      ]
    },
    {
      "eventKey": "2024nysu",
      "season": 2024,
      "qualCount": 80,
      "rosterSize": 48,
      "startPoints": [
        {
          "startIndex": 0,
          "startMatchKey": "2024nysu_qm1",
          "remainingMatchCount": 80,
          "excludedMatchCount": 0,
          "teamCount": 48,
          "frozenMeanBandWidth": 24.176771459733065,
          "storedMeanBandWidth": 21.543091984754735,
          "narrowingPercent": 10.893429171735274,
          "noiseFloorPercent": 0.9386518716930964
        },
        {
          "startIndex": 26,
          "startMatchKey": "2024nysu_qm27",
          "remainingMatchCount": 54,
          "excludedMatchCount": 0,
          "teamCount": 48,
          "frozenMeanBandWidth": 14.380583948331179,
          "storedMeanBandWidth": 13.222668335579224,
          "narrowingPercent": 8.05193736855399,
          "noiseFloorPercent": 0.4525187261046313
        },
        {
          "startIndex": 53,
          "startMatchKey": "2024nysu_qm55",
          "remainingMatchCount": 27,
          "excludedMatchCount": 0,
          "teamCount": 48,
          "frozenMeanBandWidth": 7.983460468172699,
          "storedMeanBandWidth": 7.69394846360096,
          "narrowingPercent": 3.626397421593345,
          "noiseFloorPercent": 0.11171117163488922
        }
      ]
    },
    {
      "eventKey": "2025cur",
      "season": 2025,
      "qualCount": 127,
      "rosterSize": 76,
      "startPoints": [
        {
          "startIndex": 0,
          "startMatchKey": "2025cur_qm1",
          "remainingMatchCount": 127,
          "excludedMatchCount": 0,
          "teamCount": 76,
          "frozenMeanBandWidth": 12.765811542395038,
          "storedMeanBandWidth": 13.306425721860428,
          "narrowingPercent": -4.2348594734460825,
          "noiseFloorPercent": 0.15624894513315313
        },
        {
          "startIndex": 42,
          "startMatchKey": "2025cur_qm43",
          "remainingMatchCount": 85,
          "excludedMatchCount": 0,
          "teamCount": 76,
          "frozenMeanBandWidth": 10.950268751777367,
          "storedMeanBandWidth": 9.965548500552476,
          "narrowingPercent": 8.992658294939641,
          "noiseFloorPercent": 1.0052847167178438
        },
        {
          "startIndex": 84,
          "startMatchKey": "2025cur_qm85",
          "remainingMatchCount": 43,
          "excludedMatchCount": 0,
          "teamCount": 76,
          "frozenMeanBandWidth": 6.114302566353784,
          "storedMeanBandWidth": 5.719650884194349,
          "narrowingPercent": 6.454565796778712,
          "noiseFloorPercent": 1.514322001692022
        }
      ]
    },
    {
      "eventKey": "2026sccmp",
      "season": 2026,
      "qualCount": 62,
      "rosterSize": 31,
      "startPoints": [
        {
          "startIndex": 0,
          "startMatchKey": "2026sccmp_qm1",
          "remainingMatchCount": 62,
          "excludedMatchCount": 0,
          "teamCount": 31,
          "frozenMeanBandWidth": 8.751207846616927,
          "storedMeanBandWidth": 6.68974064855816,
          "narrowingPercent": 23.55637340799415,
          "noiseFloorPercent": 0.7481550654666509
        },
        {
          "startIndex": 20,
          "startMatchKey": "2026sccmp_qm21",
          "remainingMatchCount": 42,
          "excludedMatchCount": 0,
          "teamCount": 31,
          "frozenMeanBandWidth": 5.834990996610848,
          "storedMeanBandWidth": 5.079279101326192,
          "narrowingPercent": 12.951380657204062,
          "noiseFloorPercent": 0.5180097027619399
        },
        {
          "startIndex": 41,
          "startMatchKey": "2026sccmp_qm42",
          "remainingMatchCount": 21,
          "excludedMatchCount": 0,
          "teamCount": 31,
          "frozenMeanBandWidth": 3.9892646768419247,
          "storedMeanBandWidth": 3.7788465160142133,
          "narrowingPercent": 5.274610181901681,
          "noiseFloorPercent": 0.628924674419055
        }
      ]
    }
  ],
  "headline": {
    "meanNarrowingPercent": 10.848394210456348,
    "minNarrowingPercent": -8.549486466710535,
    "maxNarrowingPercent": 44.18053864411849,
    "meanNoiseFloorPercent": 0.619378478203013,
    "measurementCount": 15,
    "eventCount": 5,
    "excludedMatchCount": 0,
    "incompleteBaselineTeamCount": 0,
    "verdict": "narrower"
  }
}
```
