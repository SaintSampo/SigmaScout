---
phase: quick-260911-l2k
plan: 01
subsystem: epa
tags: [epa, statbotics-fidelity, foul-model, week-one-aggregates, walk-forward]
status: complete
requires:
  - epa@9.0.0+baseline (the week-1 seal and EpaWeekOneState)
  - docs/models/statbotics-breakdown-reference.md sections 2, 14, 19b, 20
provides:
  - epa@10.0.0+baseline (foul term as a post-win-probability scalar)
  - STATE_SNAPSHOT_SHAPE_VERSION 14
  - frozen week-1 foulRate and noFoulMean
affects:
  - packages/core/algorithms/epa.ts
  - packages/core/algorithms/epaWeekOne.ts
  - packages/harness/stateSnapshot.ts
  - scripts/measureEpaDeviations.ts
tech-stack:
  added: []
  patterns: [one-shared-divide, refuse-dont-fudge, seal-once-two-records]
key-files:
  created: []
  modified:
    - packages/core/algorithms/epaWeekOne.ts
    - packages/core/algorithms/epa.ts
    - packages/harness/stateSnapshot.ts
    - scripts/measureEpaDeviations.ts
    - data/baselines/level1-digest-2026-09.json
    - docs/models/epa-statbotics-gap.md
    - docs/models/epa-divergences.md
decisions:
  - "foulsCommitted stays rated, published and carried; only its place in a prediction moved"
  - "The no-foul/foul split is taken from the SCORE, not from a component sum"
  - "Two populations: week-1 frozen after the seal, season-wide live before it"
  - "A degenerate rate is refused, never fudged with a substituted denominator"
  - "Mechanism 5 takes DELIBERATE DIFFERENCE, mechanism 8's label, rather than inventing a fourth"
metrics:
  duration: ~3h
  completed: 2026-09-11
actuals:
  tokens: 61000
  tasks: 3
  commits: 5
---

# Quick Task 260911-l2k: Adopt Statbotics' Foul Model Summary

EPA's foul term moved out of the margin and became one `(1 + foulRate)` scalar applied to both
alliances after the win probability, with the rate estimated from Statbotics' own week-1 population
— shipping as `epa@10.0.0+baseline`.

## The verdict, stated first

**Pooled season accuracy and Brier both IMPROVED: winner accuracy 0.74674 -> 0.74917 (+0.00243),
Brier 0.17142 -> 0.17072 (-0.00070).** That was not the goal and is not the justification — this
change was adopted for reproduction fidelity, and a regression would have been an equally
acceptable result. It is reported because it is what the measurement found.

**There are real regressions and they are not buried.** The ONSET window — each season's first 500
matches — got WORSE on accuracy, pooled 0.69225 -> 0.68695 (**-0.00530**), with 2019's onset the
worst single row in the measurement at **-0.03036**. Five of eight onset rows lost accuracy. Two
season rows also regressed: 2019 accuracy (-0.00147) and 2022 Brier (+0.00023).

The onset regression has a plain reading, offered as a reading and not as an excuse: early in a
season there is no frozen rate yet and the live pair is thin, and the retired cross-attribution was
doing some real separating work between two alliances that are otherwise identically rated at cold
start. Nothing was tuned, swept or adjusted after seeing any of these numbers.

## The exact predict-path change

Both alliances' `redOffensiveTotal` / `blueOffensiveTotal` are unchanged — they already excluded an
alliance's OWN `foulsCommitted`, which is exactly what makes them the no-foul quantity Statbotics
scales. What changed is what happens around them.

**BEFORE (`epa@9.0.0+baseline`)** — the foul term is INSIDE the margin:

```ts
const redScore  = redOffensiveTotal  + (blueComponents[FOULS_COMMITTED_COMPONENT]?.mean ?? 0);
const blueScore = blueOffensiveTotal + (redComponents[FOULS_COMMITTED_COMPONENT]?.mean  ?? 0);

const scale   = seasonScoreSd / (-EPA_K * Math.LN10);
const margin  = redScore - blueScore;          // <- carries BOTH foul means
const pRedWin = 1 / (1 + Math.exp(-margin / scale));
```

Red's and blue's foul means are different numbers, so this term moved the margin and therefore the
predicted winner, on every match of every season — the inverse of what Statbotics does.

**AFTER (`epa@10.0.0+baseline`)** — the margin is foul-free and the scalar lands afterwards:

```ts
const scale   = seasonScoreSd / (-EPA_K * Math.LN10);
const margin  = redOffensiveTotal - blueOffensiveTotal;   // <- no foul term at all
const pRedWin = 1 / (1 + Math.exp(-margin / scale));
assertValidPRedWin(pRedWin, `epa.predict (${match.matchKey})`);

const foulRate  = foulRateFor(state);          // ONE rate for the whole match
const redScore  = redOffensiveTotal  * (1 + foulRate);
const blueScore = blueOffensiveTotal * (1 + foulRate);
```

This is `main.py:125-130`'s order term for term (reference section 14). Because the multiplier is a
single scalar shared by both alliances it cannot change the sign of their difference, so fouls
cannot touch the predicted winner or the win probability — they inflate two published scores and
nothing else. `redComponents` / `blueComponents` are returned UNSCALED, matching how `AlliancePred`
carries an unscaled breakdown beside a scaled score.

The defining property is pinned **bitwise**, not approximately (`toBe`, not `toBeCloseTo`): across
foul pairs from `[0, 0]` to `[999999, 999998]`, `pRedWin` is identical. "Almost invariant" would
mean a foul term was still leaking into the margin somewhere.

## The cross-side direction test, and what makes it discriminating

An alliance's OWN raw `foulPoints` is the points it RECEIVED, and §2's cleaner reads that own field:
`foul_points = breakdown["foulPoints"] + breakdown["adjustPoints"]`. But every `breakdown/{year}.ts`
sets `result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints`, so an alliance's own raw value does
not survive into its own parsed record — it survives into the OPPONENT's. Red's foul side is
therefore `blueParsed.foulsCommitted + redParsed.adjust`: received-points half from the opponent's
slot, adjust half from its own.

**Asymmetric fixtures are necessary but NOT sufficient, and this is the trap worth recording.** Under
this particular reversal the two accumulator MEANS are invariant. Correct, red's foul side is
`blueFoul + redAdj` and blue's is `redFoul + blueAdj`; reversed, red's is `redFoul + redAdj` and
blue's is `blueFoul + blueAdj`. Both readings sum to the same total, and because the no-foul side is
the complement of a fixed pair of scores, its pooled mean is identical too. **A test asserting only
the two means passes against a reversed lookup.** I wrote that test first and it did pass both ways.

What separates them is how the same total is SPLIT:

| reading | red no-foul | blue no-foul | pooled mean | Welford `m2` |
|---|---|---|---|---|
| correct | 68 | 75 | 71.5 | **24.5** |
| reversed | 94 | 49 | 71.5 | **1012.5** |

So the discriminating assertions are the accumulator's `m2` — a function of the split rather than
the total — plus a second test that isolates a SINGLE alliance (blue is a ruling zero) so the
accumulator holds exactly one observation and its mean IS red's own no-foul value, 68 and not 94,
with no averaging to hide behind.

A note on how that test earned its keep: my first draft asserted 94 for the correct reading. The
implementation returned 68. The implementation was right and my mental model of which side's
`foulPoints` means what was backwards — the fixture arithmetic was corrected against §2, not the
code.

## How the week-1 foul rate is accumulated, frozen, and read before the freeze

`avg.py` writes `year.foul_mean` and `year.no_foul_mean` from the SAME `week_one_matches` list that
writes `score_sd` (reference section 20), so the rate is frozen by the seal `epaWeekOne.ts` already
owned — no second freeze mechanism was invented.

**The split**, per alliance, per §2, from values this repo already parses (no new breakdown field,
no season-map edit): foul side = opponent's parsed `foulsCommitted` + own parsed `adjust`; no-foul =
`score - foul side`. Taking the complement from the SCORE rather than summing own offensive
components makes `noFoulMean + foulMean == scoreMean` hold by construction, so
`(1 + rate) * noFoulMean` is exactly the inflation from a no-foul total to a real score. A season
whose component map did not span the whole score would have shifted the aggregate silently.

**Two exclusions**, both pinned by test: a ruling-zero alliance (the `2026bc2_sf14m1` shape is
`adjustPoints: -456` against a 0 score, which would inject a ~456-point garbage no-foul observation
into a constant every later prediction divides by), and an alliance whose breakdown did not PARSE
(the fallback path imputes components FROM these very means, so folding an imputed value back would
be circular).

**The freeze.** `sealWeekOneIfPast` now freezes two records in one call from one population, with
INDEPENDENT gates: `EPA_WEEK_ONE_MIN_OBS = 2` is `standardDeviation`'s contract and governs
`frozen`; `EPA_WEEK_ONE_MIN_FOUL_OBS = 1` is a mean's and governs `frozenFoul`. Either may come out
`null` while the other freezes, and `sealed` is set either way so neither is retried. A frozen record
is never reopened by a late week-1 arrival.

**Pre-freeze**, the rate comes from a SEASON-WIDE expanding pair on `EpaState`
(`allianceNoFoulStats` / `allianceFoulStats`), mirroring exactly how `predict`'s SD denominator uses
season-wide `allianceScoreStats` before the seal. Using the week-1 accumulator as its own live
estimate was considered and rejected: null-week preseason play precedes week 1 in every season
(2024's null-week events start 2024-02-03, its week-1 events 2024-02-24), and every one of those
matches would then be predicted at a zero foul rate. Both pairs are RESET — not reseeded — at a
season boundary, because a foul rate is a property of one season's own rules and point values.

**When there is nothing usable**, `EPA_FALLBACK_FOUL_RATE = 0` applies and both scores publish at
their plain no-foul totals. `foulRateFrom` is the ONE divide and the ONE guard, called by both the
seal and the live read, and it REFUSES rather than fudges: non-finite input, a no-foul mean that is
not strictly positive, or a negative foul mean all return `null`. Upstream instead substitutes a
denominator — `(self.foul_mean or 0) / (self.no_foul_mean or 1)` — which silently publishes
`foul_mean` itself as a rate; this project declines to, following the `sealWeekOneIfPast` precedent.

## Before / after measurement

**Precondition identity check, verified BEFORE the script was run and before any number was seen:**
`data/diagnostics/epa-deviation-ablation.json` was confirmed identical to quick task 260911-j2w's
`after-` artifact (same `generatedAt` 2026-09-11T18:55:57.466Z, `epa` rows byte-identical by
`JSON.stringify`), and its pooled `epa` row read winner accuracy **0.7467351642020357**, Brier
**0.1714174227236459**, **1653** events — matching the plan's recorded figures exactly. It is
therefore a valid `epa@9.0.0+baseline` BEFORE and no re-run was needed. It was copied to
`before-epa-deviation-ablation.json` before the script overwrote the source path.

**Both sides come from the same published scorer in the same script**, so they are directly
comparable. Neither side may be differenced against any figure from a scratch scorer: a published
Brier counts ties and most scratch scripts do not, which manufactures a ~0.003 phantom shift.

**No confidence interval is claimed for this contrast.** BEFORE and AFTER are two RUNS, not two arms
in one run, because the change ships inside the baseline arm. The script's event-blocked paired
bootstrap compares ARMS WITHIN a run and does not apply across runs. These are point estimates.

### Season slices, event-blocked

| slice | events | acc before | acc after | delta | Brier before | Brier after | delta |
|---|---|---|---|---|---|---|---|
| 2016 | 136 | 0.71953 | 0.72405 | +0.00451 | 0.18621 | 0.18609 | -0.00011 |
| 2017 | 165 | 0.67177 | 0.67309 | +0.00132 | 0.20427 | 0.20336 | -0.00091 |
| 2018 | 179 | 0.73204 | 0.73756 | +0.00552 | 0.17978 | 0.17839 | -0.00139 |
| 2019 | 194 | 0.72141 | 0.71994 | **-0.00147** | 0.18338 | 0.18340 | **+0.00002** |
| 2022 | 184 | 0.77667 | 0.77785 | +0.00118 | 0.15495 | 0.15517 | **+0.00023** |
| 2023 | 185 | 0.75911 | 0.76251 | +0.00341 | 0.16271 | 0.16189 | -0.00082 |
| 2024 | 192 | 0.75441 | 0.75752 | +0.00310 | 0.16822 | 0.16680 | -0.00142 |
| 2025 | 204 | 0.77832 | 0.78058 | +0.00226 | 0.15707 | 0.15644 | -0.00062 |
| 2026 | 214 | 0.79363 | 0.79614 | +0.00251 | 0.15174 | 0.15068 | -0.00105 |
| **POOLED** | **1653** | **0.74674** | **0.74917** | **+0.00243** | **0.17142** | **0.17072** | **-0.00070** |

### Onset slices (each season's first 500 matches)

| slice | events | acc before | acc after | delta | Brier before | Brier after | delta |
|---|---|---|---|---|---|---|---|
| 2017 | 11 | 0.64503 | 0.63895 | **-0.00609** | 0.21403 | 0.21182 | -0.00221 |
| 2018 | 13 | 0.64930 | 0.65531 | +0.00601 | 0.21378 | 0.21463 | **+0.00085** |
| 2019 | 12 | 0.66802 | 0.63765 | **-0.03036** | 0.22457 | 0.22671 | **+0.00214** |
| 2022 | 12 | 0.75506 | 0.74494 | **-0.01012** | 0.17801 | 0.17490 | -0.00311 |
| 2023 | 18 | 0.69618 | 0.70221 | +0.00604 | 0.19351 | 0.19294 | -0.00057 |
| 2024 | 16 | 0.68839 | 0.68432 | **-0.00407** | 0.20673 | 0.20341 | -0.00332 |
| 2025 | 12 | 0.72581 | 0.71774 | **-0.00806** | 0.18941 | 0.18688 | -0.00253 |
| 2026 | 12 | 0.71026 | 0.71429 | +0.00402 | 0.18738 | 0.18531 | -0.00207 |
| **POOLED ONSET** | **106** | **0.69225** | **0.68695** | **-0.00530** | **0.20093** | **0.19957** | -0.00135 |

Scored populations are identical on both sides of every row (e.g. pooled 147,221 -> 147,221), so no
delta here is a population artifact. 2016 has no onset row — it is the cold-start season and crosses
no boundary.

**What this measurement does NOT separate, named as a limitation.** The run covers BOTH of Task 2's
changes: the foul placement (large, winner-changing) and the carry anchor's switch to the frozen
no-foul mean (small, boundary-only). A single run cannot decompose them. A decomposition would need
its own run and is not chartered here.

## Versions, and why each bump is load-bearing

**`epa.version` 9.0.0 -> `10.0.0+baseline`.** MAJOR, and the most straightforwardly major bump in
the file's list: every predicted winner can change. No published predicted score, win probability or
winner is guaranteed to be what 9.0.0 produced.

**`STATE_SNAPSHOT_SHAPE_VERSION` 13 -> 14. YES, it bumped, and it had to.**
`apps/worker/src/stateStore.ts`'s `readScopedState` filters rows by `algorithm_id` ONLY and never by
version, so bumping `epa.version` alone does not make a stale seeded row unreachable. A shape-13 EPA
league row would deserialize with the foul accumulators ABSENT, leaving the live Worker at a
permanently zero foul rate — publishing every predicted score at its plain no-foul total — while the
offline publisher applied the frozen week-1 rate. The two would disagree on every published
predicted score, all season, with no error, no NaN and no malformed row to find. **Worse than its
12 -> 13 sibling in one specific respect: a zero rate is a LEGAL rate (`EPA_FALLBACK_FOUL_RATE`), so
nothing downstream could flag it as suspicious.** The shape gate is the only thing that turns that
into a loud `LeagueRowShapeVersionError`. Deserialization reads the new fields straight through with
deliberately NO `??` default, for the same reason.

## What of R3 this closed, and what is still open

**CLOSED — R3 item 3.** `foul_mean` / `no_foul_mean` in `get_foul_rate()` is ADOPTED from week 2
onward as an EXACT target, live-estimated during week 1 alone.

**CLOSED — R3 residual gap 1.** That gap said closing it "needs a second, no-foul week-1
accumulator, which j2w deliberately did NOT build". This task built exactly that accumulator — it is
the same one the foul rate's denominator needs — and `carryRescaleRatioFor`'s numerator now reads
the frozen week-1 NO-FOUL mean, the quantity `get_constants` actually reads, falling back to the
frozen raw mean (9.0.0's behaviour, and upstream's own `or score_mean`) and then to the live unwind
(8.0.0's). `carryRescaleRatio`'s arithmetic was passed the new numerator and otherwise untouched;
its gate and `carryover.test.ts` stayed green with no expectation edited.

**STILL OPEN, and deliberately left visible:**

- **R3 items 4 and 5** — untouched. Item 4 (the 18 columns behind `get_mean_components()`) remains
  the largest single divergence inside R3.
- **R3 residual gaps 2 and 3** (renumbered 2 and 4) — `avg.py`'s 2025 processor-algae correction
  still not adopted; the frozen population can still be slightly smaller than upstream's offline
  `week_one_matches`.
- **A SMALLER RESIDUAL REPLACES old gap 1** rather than it vanishing: the raw-score accumulator
  folds every non-ruling-zero alliance, while the no-foul one additionally requires a PARSED
  breakdown, where upstream derives both from one list.
- **NEW residual, recorded rather than hidden:** that `Match.red_foul` / `red_no_foul` are written by
  §2's shared cleaner — and therefore that upstream's `red_foul` includes `adjustPoints` — is an
  INFERENCE from section 2, not a transcription. The module that writes those columns was never
  fetched. If the inference is wrong, this project counts `adjustPoints` on the foul side where
  upstream does not.
- **Mechanism 1's per-team foul entry.** Statbotics rates no foul entry at all; SigmaScout still
  does. Recorded under mechanism 1 rather than silently closed with mechanism 5.

Mechanism 5's nine rows moved `GAP` -> `DELIBERATE DIFFERENCE`, taking mechanism 8's label rather
than inventing a fourth, because the remainder (a week-1 live estimate of an L-01 aggregate) is
exactly mechanism 8's situation after j2w. The verdict matrix row, the tally and the section body
all moved together; the tally was **recounted from the table** (37 `ALREADY MATCHES`, 35 `GAP`,
27 `DELIBERATE DIFFERENCE`, 99 cells) rather than hand-adjusted.

## Deviations from plan

### [Rule 3 - Blocking] The winprob arms were rescaling an inflated margin

**Found during:** Task 3. **Issue:** `winProbabilityArm` recomputed `pRedWin` from
`base.redScore - base.blueScore`, which until this task WAS the shipped margin. It no longer is —
those scores are now `noFoulTotal * (1 + foulRate)` — so with a nonzero rate the arms were rescaling
a margin inflated by `(1 + foulRate)` and had stopped isolating the SD, which is their entire
purpose. **Fix:** reconstruct the no-foul margin bitwise from the UNSCALED component records, with
the same skip and the same sorted-key reduce `predictCore` itself uses. **Commit:** `cd3e946c`.

### [Escalated to the developer] A pre-registered measurement invariant, amended with approval

**Found during:** Task 3. The script aborted on its own PRE-REGISTERED INVARIANT: arm
`epa-winprob-season-sd` reported 2016 winner accuracy `0.7239688715953307` against baseline's
`0.7240466926070039`.

I diagnosed rather than worked around it. **One match in 148,094 across nine seasons** —
`2016ausy_qm14`, whose two alliances are mathematically equal (red no-foul `45.577777777777776`,
blue `45.57777777777778`); the margin of `-7.105e-15` is pure summation-order noise. The baseline's
scale gave `0.4999999999999999` -> blue; the season-SD arm's larger scale saturated `Math.exp()` to
exactly `1.0`, giving `pRedWin = 0.5` -> red under the `>= 0.5` tie convention. Per-season winner
differences: 2016 = 1, every other season = 0.

The invariant's prose ("a scale on the logistic cannot change `sign(margin)`") is true in exact
arithmetic; winner ACCURACY was a proxy that also picks up float saturation. **This was caused by
this task's change, legitimately:** removing the asymmetric foul cross-attribution stops separating
identically-rated alliances, so tied margins became common.

Because it is a rule deliberately labelled PRE-REGISTERED, I stopped and escalated rather than
editing it. **The developer approved Option A on 2026-09-11.** The guard now audits per MATCH and
counts a winner difference as a violation unless both probabilities sit within one ulp of 0.5 — a
TIGHTENING: the old rule could only say "some accuracy moved somewhere this season", the new one
names the offending match, and any wrapper that genuinely perturbed state evolution moves winners on
confidently-predicted matches and still fails loudly. The bound is `2^-53` (`Number.EPSILON / 2`),
**derived from the IEEE-754 mantissa width** — the spacing of doubles below 1.0, hence the ratio at
which `exp()` rounds to exactly 1 — not a tolerance picked to clear this match. Verified:
`Math.exp(2^-53) === 1` while `Math.exp(3 * 2^-53) !== 1`. The amendment, its evidence and the
approving authority are recorded IN PLACE at the rule. **Commit:** `361b40fe`.

### [Noted, not acted on — developer decision] 1.8% of matches now predict an exact tie

**2,667 of 148,094 matches** now predict an exactly-zero margin (per season 246 to 331), all
resolving to RED under `pRedWin >= 0.5`. Cause: with the asymmetric cross-attribution gone, two
identically-rated alliances — the common case early in a season — produce equal no-foul totals.
**Seen and accepted by the developer, not missed:** calling red on a true coin flip costs nothing in
expectation and Statbotics has the same property, so matching it is arguably correct. The tie
convention is UNCHANGED and this was not investigated further. Recorded in
`docs/models/epa-statbotics-gap.md` so a future reader who notices a red-heavy tail on tied matches
finds the explanation instead of re-opening it.

### [Scope boundary - not fixed] Concurrent session breakage

The Phase 9 session is actively working in this checkout. Logged, not touched, not staged:

- `scripts/measureRpCalibration.test.ts` fails in the working tree. Verified foreign:
  `git show HEAD:scripts/measureRpCalibration.ts` satisfies the assertion, their uncommitted
  518-line rewrite does not.
- Root `tsc --noEmit` now reports errors in `packages/core/rankingPoints/` (`analyticPmf.ts`,
  `marginals.ts`, `marginals.test.ts`). **Zero are in any file this task touched**; both typecheckers
  were clean at Task 2's commit.
- `docs/models/epa-statbotics-gap.md` mechanism 8's section body is STALE from j2w — it still
  describes the pre-j2w expanding-SD behaviour and does not mention the frozen week-1 adoption. Not
  fixed here: it is j2w's debt and outside this task's charter.

## Debts this task leaves unpaid

1. **A REPUBLISH IS OWED, AND NOW THREE TIMES OVER: `8.0.0`, `9.0.0`, and this one.** All three are
   unpaid. Every published EPA predicted score and win probability is stale until it is paid. No
   republish, no R2 write and no retune was run here.
2. **The live D1 EPA league row is at retired snapshot shape 13** against
   `STATE_SNAPSHOT_SHAPE_VERSION` 14 and must be RE-SEEDED before the Worker runs this version. This
   adds to the Worker shape blocker already tracked ahead of live events. **SEED FIRST, DEPLOY
   SECOND** — a deploy against un-re-seeded rows takes live folding down until the seed runs.
3. **`scripts/epaVsStatbotics.ts --check` against `data/baselines/epa-vs-statbotics-2026-09.json`
   was ALREADY failing before this task** (documented at the top of `docs/models/epa-divergences.md`).
   It will still fail. That is PRE-EXISTING, and it was deliberately NOT re-baselined here.

## Verification

- Step 0 baseline captured before any edit: **255 files / 4965 passed / 6 skipped / 0 failed**.
- After Task 1: full suite **4997 passed, 0 failed**; `level1Digest` green with a **zero-line**
  baseline diff — the tracer's real acceptance, proving a whole new state pathway was wired
  parse -> fold -> seal -> serialize -> deserialize without moving a single prediction.
- After Task 2: full suite **5035 passed**, the only failure a foreign file (above). Both
  typecheckers clean.
- Final: all 8 suites in this task's scope pass — **263 tests**, including the pRedWin-invariance
  test and the UNMODIFIED `level1Digest` gate.
- `data/baselines/level1-digest-2026-09.json`: exactly **2 lines** changed, both in the `epa` entry.
  `opr` (`4.0.0+baseline`, `223a3e0d...`) and `bpr` (`3.0.0+baseline`, `ee9acfec...`) were
  **recomputed and verified byte-identical**, not assumed. The `epa` digest was regenerated by
  replaying the baseline's own recorded slice, never hand-typed.
- `packages/bpr` and `experiments/phase-bpr`: **zero diff lines**. Its sealed holdout was not read,
  run or spent.
- `EPA_DIFFERENCE_IDS`: **zero changed lines**.
- No `.env` was read, rendered or passed to any command; `--env-file` was not used.
- All five commits staged by explicit pathspec; `git add -A` / `git add .` never used, and
  `git status` after each confirmed nothing foreign was absorbed.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 | `c0c0b76e` | Week-1 no-foul/foul accumulators, seal, serialization, shape 14 — every prediction bitwise unchanged |
| 2 | `57cef7a7` | The post-win-probability scalar, the carry anchor, `epa@10.0.0+baseline`, both docs |
| 3a | `cd3e946c` | Rule 3: winprob arms must use the model's own no-foul margin |
| 3b | `361b40fe` | The nine-season measurement, the approved guard amendment, the accepted-ties note |

`SUMMARY.md` and `STATE.md` are deliberately left uncommitted.

## Self-Check: PASSED

Files asserted present: `packages/core/algorithms/epaWeekOne.ts`, `packages/core/algorithms/epa.ts`,
`packages/harness/stateSnapshot.ts`, `scripts/measureEpaDeviations.ts`,
`before-epa-deviation-ablation.json`, `after-epa-deviation-ablation.json`. Commits asserted present
in `git log`: `c0c0b76e`, `57cef7a7`, `cd3e946c`, `361b40fe`.
