---
phase: 09-analytic-ranking-points-browser-side-simulation
plan: 09
subsystem: ranking-points
tags: [ranking-points, pre-schedule, rank-simulation, monte-carlo, closed-form, measurement, r2-artifacts]

requires:
  - phase: 09-analytic-ranking-points-browser-side-simulation
    provides: "09-04's `analyticRpPmf`, `convolvePmf`, `pmfMean`, `allianceBonusRpPmf`, `matchOutcomeDistribution` and the diagonal-joint independence precondition"
  - phase: 09-analytic-ranking-points-browser-side-simulation
    provides: "09-07's `simulateRanks` coupled draw, `SimMatchInput.outcome`, and the inclusion rule that must not tighten"
  - phase: 08-simulation-compare
    provides: "08-04's `continuousQuantile` — the ONE band-edge estimator both arms read through"
provides:
  - "`packages/core/rankingPoints/fieldAveraged.ts` — the field-averaged pre-schedule predictor: field statistics per event, field-averaged alliance moments, the per-match pmf through the shared `analyticRpPmf`, the N-fold season-total convolution, and the ONE solo-row `simulateRanks` input construction"
  - "`FieldAveragedPreScheduleArtifactSchema` — the ~1-5 KB rung-1 sidecar shape, `.parse`-gated, BUILT AND VALIDATED BUT NOT WIRED into any publish path"
  - "`buildFieldContributions` / `buildFieldAveragedPreScheduleArtifact` — template-free, filesystem-free builders that serve rosters the 6-100-team schedule-template grid cannot"
  - "`scripts/measureFieldAveragedRanks.ts` + `docs/models/field-averaged-presim.md` — the two-named-arms measurement, the acceptance criterion as code, and the script-written measurement record"
  - "A MEASURED, RECORDED FAIL of the rung-1 acceptance criterion, and the seed-noise floor that makes it readable"
affects: [09-10, rung-2, pre-schedule-simulation, D-19-licence-question]

actuals:
  tokens: 31000
  tasks: 4
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Field-averaged closed form: replace a Monte Carlo over schedule randomness with the distribution a random schedule induces"
    - "Same-arm seed-noise control alongside a two-arm comparison, barred from overruling the criterion"

key-files:
  created:
    - packages/core/rankingPoints/fieldAveraged.ts
    - packages/core/rankingPoints/fieldAveraged.test.ts
    - scripts/measureFieldAveragedRanks.ts
    - scripts/measureFieldAveragedRanks.test.ts
    - docs/models/field-averaged-presim.md
  modified:
    - packages/harness/pageArtifacts.ts
    - packages/harness/pageArtifacts.test.ts
    - packages/harness/preSchedule.ts
    - packages/harness/preSchedule.test.ts
    - packages/harness/publish.ts
    - packages/harness/browserSafeSchemas.test.ts
    - package.json

key-decisions:
  - "Rung 1 FAILED the pre-committed acceptance criterion on clauses 1 and 2. Delta B is `no-change`: concrete schedules stay primary, schedule generation is NOT deleted, nothing one-way happened."
  - "No threshold was changed after the run, the sample was not widened to find a passing one, and the run was not repeated with different flags."
  - "A seed-noise floor was added as a DIAGNOSTIC (deviation Rule 2) because without it a FAIL cannot be attributed between 'rung 1 genuinely differs' and 'the bar is unreachable at this draw count'. It is explicitly barred from overruling the criterion."
  - "D-19's schedule-template redistribution licence question is now LIVE for the first time, and is the developer's judgement rather than an agent's."

patterns-established:
  - "Per-event (never season-wide) field statistics, with POPULATION variance pinned in both directions by a test"
  - "A criterion frozen as named constants with its verbatim text, unit-tested at both boundaries on synthetic tables before it ever sees a real event"
  - "A measurement record written by the measuring script itself, never hand-transcribed"

requirements-completed: [D-16, D-17, D-18]

coverage:
  - id: D1
    description: "A team's whole-season rank band is produced from its own belief plus its event's field statistics with NO schedule generated anywhere, via the same `analyticRpPmf` real matches run and an exact `convolvePmf` of `matchesPerTeam` copies"
    requirement: "D-16"
    verification:
      - kind: unit
        ref: "packages/core/rankingPoints/fieldAveraged.test.ts (11 cases, every expectation a hand-written literal)"
        status: pass
      - kind: integration
        ref: "npx tsx scripts/measureFieldAveragedRanks.ts --write-doc (six real events, 244 teams)"
        status: pass
    human_judgment: false
  - id: D2
    description: "`fieldAveraged.ts` is browser-safe, proven by the machine check that owns that property"
    verification:
      - kind: unit
        ref: "packages/harness/browserSafeSchemas.test.ts — FIELD_AVERAGED_ENTRY_POINT (test count 10 -> 11)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The rung-1 sidecar exists as a real, schema-validated, deterministic, TEMPLATE-FREE artifact with a measured byte size, and the live `PreScheduleArtifactSchema`/`preScheduleKey` are provably untouched"
    requirement: "D-16"
    verification:
      - kind: unit
        ref: "packages/harness/preSchedule.test.ts + packages/harness/pageArtifacts.test.ts (187 cases combined, all pass)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The acceptance criterion is code with its own boundary tests, evaluated on six real finished events with every team scored, both arms through the same `simulateRanks` and the same `continuousQuantile`"
    requirement: "D-17"
    verification:
      - kind: unit
        ref: "scripts/measureFieldAveragedRanks.test.ts (14 cases: both boundaries asserted PASSING, clause 3 proven signed, pooling proven not the mean of rates)"
        status: pass
      - kind: integration
        ref: "docs/models/field-averaged-presim.md (written by the run, not transcribed)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The one-way ship/no-ship call on the measured evidence"
    requirement: "D-16"
    verification: []
    human_judgment: true
    rationale: "Rung 1 FAILED the criterion, which is the ONE branch `09-CONTEXT.md`'s `<approvals>` block explicitly does NOT cover. The standing authorization is for deleting schedule generation (the SHIP branch), conditional on rung 1 MEETING the bar. A failing measurement routes to rung 2, which makes D-19's schedule-template redistribution licensing live — a judgement recorded as the developer's and never delegated."

duration: 88min
completed: 2026-09-11
status: complete
---

# Phase 9 Plan 09: Field-Averaged Pre-Schedule Prediction Summary

**The field-averaged closed form is built, browser-safe, schema-validated and 51.6x-79.5x smaller than the 20-schedule sidecar — and it FAILED the pre-committed rank-band agreement bar on two of three clauses, so nothing was deleted and the ladder's next rung is now the developer's call.**

## Performance

- **Duration:** ~88 min
- **Tasks:** 3 of 5 executed; Task 4's checkpoint routed to NO-SHIP; Task 5 performed its step-7 record only
- **Files created:** 5
- **Files modified:** 7

## The verdict, first

`npx tsx scripts/measureFieldAveragedRanks.ts --write-doc`, over six real finished events (2022on034, 2023gaalb, 2024caav, 2025cur, 2026joh, 2026txmca — rosters 14-76, one event per season 2022-2026, **244 teams, every team of every event scored**), both arms from one replay through the same imported `simulateRanks` and the same imported `continuousQuantile`:

| Clause | Outcome | Achieved | Required |
|---|---|---|---|
| 1 — median rank | **FAIL** | **32.8%** of 244 teams within 0.5 ranks; every team within 1.0: **false** | ≥ 95.0% and every team |
| 2 — band edges | **FAIL** | p10 **55.7%**, p90 **52.0%** within 1.0 ranks | ≥ 90.0% on **both** |
| 3 — no systematic shift | PASS | mean **signed** median difference **−0.0465** ranks | within ±0.25 |

**Worst single team:** `frc11269` at `2026joh`, median difference **7.59 ranks**.

**No threshold was changed after the run.** The criterion was frozen as named module-scope constants carrying its verbatim text in commit `4e85b304`-style discipline — specifically, in this plan it was written into `evaluateRungOneCriterion`'s doc comment and its constants **before** any real number existed, and unit-tested at both boundaries on synthetic tables (14 cases) before it was ever pointed at a real event. The sample was not widened to find a passing one and the run was not repeated with different flags.

### Per event (printed so a single bad event cannot hide inside the pool; the clauses are evaluated POOLED)

| Event | Season | Teams | Quals | Matches/team | Clause-1 rate | p10 rate | p90 rate | Mean signed median shift |
|---|---|---|---|---|---|---|---|---|
| `2022on034` | 2022 | 14 | 21 | 9 | 50.0% | 85.7% | 78.6% | −0.075 |
| `2023gaalb` | 2023 | 21 | 42 | 12 | 66.7% | 100.0% | 100.0% | −0.058 |
| `2024caav` | 2024 | 40 | 74 | 11 | 42.5% | 67.5% | 57.5% | +0.007 |
| `2025cur` | 2025 | 76 | 127 | 10 | 19.7% | 39.5% | 35.5% | −0.020 |
| `2026joh` | 2026 | 75 | 125 | 10 | 17.3% | 37.3% | 37.3% | −0.103 |
| `2026txmca` | 2026 | 18 | 36 | 12 | 77.8% | 100.0% | 94.4% | −0.004 |

Every event replayed **cold, target season only** (assumption A-FA3, the default). Pre-target replayed match counts: 236 (2023gaalb), 2664 (2026txmca), and the counterparts printed per event.

### The seed-noise floor — the number that makes the FAIL readable

**This is a DIAGNOSTIC. It is not part of the criterion and was not used to overrule it.**

The baked arm's own priced schedules, re-simulated at two seeds *neither of which is the published one*, compared to **itself**:

| Event | Baked-vs-itself: teams within 0.5 ranks | mean \|Δmedian\| | Rung-1 clause-1 rate |
|---|---|---|---|
| `2022on034` | 100.0% | 0.11 | 50.0% |
| `2023gaalb` | 85.7% | 0.29 | 66.7% |
| `2024caav` | 67.5% | 0.46 | 42.5% |
| `2025cur` | 55.3% | 0.63 | 19.7% |
| `2026joh` | 64.0% | 0.53 | 17.3% |
| `2026txmca` | 100.0% | 0.17 | 77.8% |
| **pooled** | **68.4%** | **0.478** | **32.8%** |

Two things this says, and both matter to whoever reads the checkpoint:

1. **The bar as written is not reachable by ANY method at 1,000 draws.** The baked arm cannot clear 95%-within-half-a-rank against *itself*; it manages 68.4%. A criterion set in rank units at half a rank is finer than what 1,000 draws resolve on a 40-to-76-team field whose 10th-90th band spans 40 ranks.
2. **Rung 1 is nonetheless genuinely worse than seed noise, on every one of the six events.** 32.8% against a 68.4% floor is not an artefact of an unreachable bar — there is a real per-team difference between the two constructions on top of the noise. So the FAIL is not merely "the bar was impossible"; it is also "rung 1 differs".

The aggregate diagnostics show *where* it does not differ: mean season-total RP per team agrees to ~0.1 RP on every event, and mean band width agrees to within ~1.3 ranks. The distributions are right in aggregate; it is the **per-team** placement that moves.

| Event | Mean season RP/team (baked → field-avg) | Mean band width (baked → field-avg) |
|---|---|---|
| `2022on034` | 16.95 → 17.03 | 7.62 → 8.34 |
| `2023gaalb` | 18.59 → 18.55 | 15.73 → 15.55 |
| `2024caav` | 16.07 → 16.01 | 20.28 → 21.53 |
| `2025cur` | 26.15 → 26.09 | 40.59 → 41.89 |
| `2026joh` | 22.21 → 22.14 | 40.27 → 40.70 |
| `2026txmca` | 28.78 → 28.70 | 12.81 → 13.09 |

## Assumption A-FA1 — measured, not asserted

The score half rests on `allianceScore = Σ member totals + C`, under which the per-season additive constant cancels out of the field-averaged mean score difference. Measured on every played qualification match of every sampled event:

| Event | Alliances | Mean | SD | Max abs | SD as a fraction of the model's own score uncertainty |
|---|---|---|---|---|---|
| `2022on034` | 42 | 3.0932 | 1.8265 | 6.5359 | 0.2056 |
| `2023gaalb` | 84 | **−0.0000** | **0.0000** | **0.0000** | **0.0000** |
| `2024caav` | 148 | 3.4500 | 1.7088 | 8.3067 | 0.1763 |
| `2025cur` | 254 | 10.6976 | 5.5624 | 28.0126 | 0.2610 |
| `2026joh` | 250 | **40.1438** | **24.7396** | **148.2082** | **0.3142** |
| `2026txmca` | 72 | 1.1076 | 2.1509 | 6.6455 | 0.0557 |

**Read honestly:** the *mean* is the constant `C`, and A-FA1 is right that it cancels. The **SD is not a constant and does not cancel** — it is a genuinely non-additive component of BPR's alliance score, worth up to **0.31 of the model's own score uncertainty** on 2026joh. On `2023gaalb` the residual is **exactly zero** (BPR's 2023 alliance score is the exact sum of member totals), and that is also the event where rung 1 does best relative to its own noise floor. **This is the first thing rung 2 — or any repair of rung 1 — should look at.** The measurement exists for exactly this, and the number is recorded whether or not anyone likes it.

## Artifact size — measured on real artifacts, not quoted

| Event | Baked bytes | Field-averaged bytes | Ratio | Field bytes/team | Baked `schedules` block |
|---|---|---|---|---|---|
| `2022on034` | 52,351 | 1,014 | 51.6× | 72.4 | 98.0% |
| `2023gaalb` | 104,902 | 1,368 | 76.7× | 65.1 | 98.2% |
| `2024caav` | 186,301 | 2,344 | 79.5× | 58.6 | 97.3% |
| `2025cur` | 410,707 | 5,393 | 76.2× | 71.0 | 96.1% |
| `2026joh` | 374,772 | 4,877 | 76.8× | 65.0 | 95.8% |
| `2026txmca` | 103,776 | 1,392 | 74.6× | 77.3 | 98.6% |

D-16's "~2-3 KB versus ~265 KB" target is **met and beaten** on size: 1,014-5,393 bytes against 52,351-410,707. The `schedules`-block fraction is **computed here**, not carried forward from `docs/simulation-architecture.md`'s recorded 95.4% — the measured range is 95.8%-98.6%, i.e. that recorded figure was, if anything, slightly conservative.

## Delta B's resolution

**Delta B: `no-change`.**

The noun that would have become primary — the per-team field-averaged season-total RP pmf `{roster[], matchesPerTeam, perTeamPmf[]}` — does **not** become primary. Concrete priced schedules remain primary, schedule generation is **not** deleted, `PreScheduleArtifactSchema` is untouched, `preSchedule.ts`'s schedule-based builder is intact, `publish.ts`'s presim call site is unchanged, and no client file was edited. Nothing built in Tasks 1-3 was reverted: the predictor, its schema, its builders and its measurement record all stand, unwired, as **the evidence rung 2 will be scored against**.

**Delta A is NOT owned here and applies either way.** The sidecar's algorithm-key segment moving off retired `vpr` to a `PUBLISHED_ALGORITHM_IDS` member is unconditional and belongs to **09-10**. This plan did not touch `preScheduleKey` — proven by an equality pin on the literal key string (`v1/presim/2023gaalb/bpr@3.0.0+baseline.json`) added in Task 2, which passes.

## The ladder's next rung, and D-19

**The ladder advances to rung 2** (D-17): self-generated random schedules at ~20 KB, testing whether cheesy-arena's balanced-grid structure actually matters to final rank bands or is merely tradition.

**Rung 2's target, stated as a measured number rather than a goal:** clause 1's pooled within-0.5 rate must reach **≥ 95%** from rung 1's **32.8%**, and clause 2's edge rates must reach **≥ 90%** from **55.7% / 52.0%**. Clause 3 already passes at **−0.0465** and rung 2 must not break it.

**Two things rung 2's planner should weigh before building anything**, both recorded above and neither a decision this plan may take:

1. **The bar may need re-deriving alongside the draw count.** The baked arm's own 68.4% seed-noise floor means no construction clears 95%-within-half-a-rank at 1,000 draws. Whether that means raising the draw count, restating the tolerance, or both is a judgement, not a measurement, and it must be taken *before* rung 2's numbers are seen — the same discipline that made this plan's bar trustworthy.
2. **The A-FA1 residual's standard deviation is a concrete, named suspect** — largest exactly where rung 1 does worst (2026joh) and zero exactly where it does best (2023gaalb).

**D-19's schedule-template redistribution licence question is now LIVE for the first time.** `09-CONTEXT.md` is explicit that this judgement is the developer's and not an agent's. No licence file was read, quoted, summarised or reasoned about anywhere in this plan's execution.

`docs/models/field-averaged-presim.md` is the baseline rung 2 will be scored against.

## The 09-10 content contract

09-10 republishes **the EXISTING `PreScheduleArtifactSchema` shape**, unchanged by this plan:

- **Artifact type / schema:** `PreScheduleArtifact` / `PreScheduleArtifactSchema` (`packages/harness/pageArtifacts.ts`) — the 20-schedule form, exactly as it was before this plan.
- **Key form:** `preScheduleKey` is **unchanged** — `v1/presim/{eventKey}/{algorithmId}@{version}.json`. The algorithm-id segment moving off retired `vpr` is 09-10's own **Delta A** and applies on both branches of this plan's checkpoint. The segment stays `bpr` (the BPR→SPR rename is another agent's).
- **Ordering:** the sidecar must still be uploaded **BEFORE** its event artifact (artifacts-before-index). That chaining is already in place at the call site (`publish.ts` ~line 3137: the event upload is chained behind the sidecar upload, so the two never race) and this plan did not touch it.
- **Measured per-event byte size, as a starting number for 09-10's payload-budget re-measurement** (the shipping shape, i.e. the baked column above): **52,351 / 104,902 / 186,301 / 410,707 / 374,772 / 103,776** bytes for the six sampled events. Note that `2025cur` at 410,707 bytes exceeds the `event` page kind's 350,000-byte ceiling in magnitude — the presim sidecar deliberately lives **outside** `payloadBudget.test.ts`'s `PAGE_KINDS` list (`preScheduleKey`'s own doc comment says so), so no budget test governs it, but the number is recorded here because 09-10 is the plan that will look at it.
- **Reminder:** `docs/publish-budget.md` is **hand-transcribed** on this project. `publish:seasons` prints its budget summary and does **not** write it, and the budget tests stay red until a human copies the numbers across.

## The F8/F9 observation — what was seen, and that NOTHING was changed

Both observed while working in `sigmaScoutLayer.ts`; **neither was touched.** F8/F9 is out of scope for the entire phase, it is the chain that disables the Simulation tab today, and it is exactly the kind of thing an opportunistic fix would get credit for with no measurement behind it.

1. **`#rpFieldsFor`'s band-variance gate** (`packages/harness/sigmaScoutLayer.ts:272`) reads `if (redBandVariance === undefined || blueBandVariance === undefined) return {};` — an alliance with any team lacking a band figure produces **no RP fields at all**, silently. Left exactly as found.
2. **`consistencyByTeam()`'s coverage difference** (`sigmaScoutLayer.ts:149-152`): for BPR it returns `#sigma.scoreByTeam()`, which has an entry for **every team the layer has ever seen**; for OPR and EPA it returns `#swing.swingByTeam()`, which **omits any team below two played matches**. That difference is precisely why the all-or-nothing roster rule is checked against the map rather than assumed — and it is why `buildFieldContributions` checks membership rather than trusting coverage. Left exactly as found.

## Task commits

1. **Task 1 (TRACER), part 1 — the predictor** — `a2ab8d66` (feat)
2. **Task 1 (TRACER), part 2 — both arms end to end** — `fead2344` (feat)
3. **Task 2 — the shippable content, schema + builders + measured bytes** — `4bca2654` (feat)
4. **Task 3 — the measurement, the criterion as code, the FAIL** — `d0e6cfb2` (measure)
5. **Plan metadata (this SUMMARY)** — see the final commit

**Task 4** (`checkpoint:decision`, one-way) reached and **routed to NO-SHIP**; returned to the orchestrator rather than decided here — see "Checkpoint" below.
**Task 5** performed its **step 7 only** (this record). No file in its `<files>` list was touched.

## Files created / modified

**Created**
- `packages/core/rankingPoints/fieldAveraged.ts` — the browser-safe field-averaged predictor: `ALLIANCE_SIZE`, `FieldTeamContribution`, `FieldStatistics`, `fieldStatistics`, `FieldAveragedAlliancePair`, `fieldAveragedAllianceMoments`, `fieldAveragedMatchPmf`, `seasonTotalPmf`, `fieldAveragedRankInputs`, `InvalidMatchesPerTeamError`
- `packages/core/rankingPoints/fieldAveraged.test.ts` — 11 cases, every expectation a hand-written literal
- `scripts/measureFieldAveragedRanks.ts` — the two-named-arms measurement and the criterion as code
- `scripts/measureFieldAveragedRanks.test.ts` — 14 cases on synthetic quantile tables
- `docs/models/field-averaged-presim.md` — **written by the script**, never hand-edited

**Modified**
- `packages/harness/pageArtifacts.ts` — `FieldAveragedPreScheduleArtifactSchema` + its inferred type added. `PreScheduleArtifactSchema`, `PreScheduleMatchSchema` and `preScheduleKey` untouched.
- `packages/harness/preSchedule.ts` — `FieldContributionInputs`, `buildFieldContributions`, `FieldAveragedPreScheduleBuildParams`, `buildFieldAveragedPreScheduleArtifact` added. Schedule generation untouched.
- `packages/harness/publish.ts` — one word: `makeRankingPointFiller` is now `export`ed. No behaviour change.
- `packages/harness/browserSafeSchemas.test.ts` — `FIELD_AVERAGED_ENTRY_POINT` registered (test count 10 → 11)
- `packages/harness/preSchedule.test.ts`, `packages/harness/pageArtifacts.test.ts` — new cases only; every pre-existing case still passes unmodified
- `package.json` — one script entry, `measure:field-averaged`, placed beside `measure:rewind-gap` with **no** environment-file flag

## Baseline captures

**Recorded as OUTPUT, never as an exit code**, before Task 1:

| Check | Result |
|---|---|
| `npx vitest run packages/core/rankingPoints ... apps/web/src/lib/api/preSchedule.test.ts` (the four scoped runs, combined) | **14 files passed, 762 tests passed, 0 failing** |
| `npx vitest run` (repo root) | **254 files passed, 4948 passed, 4 skipped, 0 failing** — well above the 167-file floor; a 77-file run would mean it was started from `apps/web` |
| `npx tsc --noEmit` | **clean** |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | **clean** |
| `packages/harness/browserSafeSchemas.test.ts` alone | **10 tests** (now 11) |

**09-04's shipped exported names** (`grep -n "^export" packages/core/rankingPoints/analyticPmf.ts`): `MarginalResolutionTally`, `emptyMarginalResolutionTally`, **`convolvePmf`**, `AllianceBonusRp`, `allianceBonusRpPmf`, `RpOutcomeDistribution`, `RpOutcomeInput`, `matchOutcomeDistribution`, `AnalyticRpPmfInput`, `AnalyticRpPmfResult`, **`pmfMean`**, `pmfStandardDeviation`, **`analyticRpPmf`**. `convolvePmf` and `pmfMean` both present — **no HALT**.

**`RpLayerConfig` / `RP_LAYER_CONFIG_DEFAULT` are GONE** — 09-06's D-06 collapse deleted the whole selectable-config surface, and `analyticPmf.test.ts` now carries a case asserting those names appear on no code line. `analyticRpPmf`'s input therefore has **no `config` and no `pRedWin` field**. This plan followed 09-06's shipped shape and introduced no parallel name. (See "Deviations".)

**09-07's `toSimMatchInput`** is at `preSchedule.ts` with its fifth `outcome?: SimMatchOutcomeInput` parameter present, as 09-07 shipped it. `SimMatchInput` = `{ redTeamKeys, blueTeamKeys, redRpPmf, blueRpPmf, outcome? }`. Untouched by this plan.

**Corpus re-assertion, all six sample events** (read-only, `selectMatchesChronological` + `selectScheduledMatches`) — every number matches the plan's pinned table exactly:

| Event | Season | Quals | Roster | `event_type` | Unplayed quals |
|---|---|---|---|---|---|
| `2022on034` | 2022 | 21 | 14 | 1 | 0 |
| `2023gaalb` | 2023 | 42 | 21 | 1 | 0 |
| `2024caav` | 2024 | 74 | 40 | 0 | 0 |
| `2025cur` | 2025 | 127 | 76 | 3 | 0 |
| `2026joh` | 2026 | 125 | 75 | 3 | 0 |
| `2026txmca` | 2026 | 36 | 18 | 1 | 0 |

No drift. The script re-asserts all of this at run time and throws naming the drift if any differs.

**Schedule templates on disk:** `14_9.csv`, `21_12.csv`, `40_11.csv`, `76_10.csv`, `75_10.csv`, `18_12.csv` — **all six present**.

**`workflow.use_worktrees`: `false`** in `.planning/config.json`, confirmed and unchanged. This plan reads the gitignored `data/corpus.sqlite`, which does not merge back out of a worktree.

**Wave coordination:** `git log --oneline -15` at start showed 09-06 and 09-07 landed and **no 09-08 commits**. No overlap with any path in this plan's `files_modified`. (Note: another session on this same checkout created untracked `scripts/statboticsComponentMaps.ts` / `.test.ts` during execution; neither was staged by this plan, and they account for one of the three new test files the full-suite count grew by.)

## Verification (final)

| Check | Result |
|---|---|
| `npx vitest run packages/core/rankingPoints/fieldAveraged.test.ts packages/harness/browserSafeSchemas.test.ts` | 2 files, **22 passed** (11 + 11) |
| `npx vitest run packages/harness/preSchedule.test.ts packages/harness/pageArtifacts.test.ts` | 2 files, **187 passed** |
| `npx vitest run scripts/measureFieldAveragedRanks.test.ts` | **14 passed** |
| `npx vitest run` (repo root) | **257 files passed, 5001 passed, 4 skipped, 0 failing** — against the 254/4948/4/0 baseline: **+3 files, +53 tests, zero new failures** |
| `npx tsc --noEmit` | **clean** |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | **clean** |
| `npx tsx scripts/measureFieldAveragedRanks.ts --write-doc` | completed across all six events, printed a terminal `FAIL` |
| `grep -c "FIELD_AVERAGED_ENTRY_POINT" packages/harness/browserSafeSchemas.test.ts` | **3** |
| `grep -vE "^\s*(//\|\*\|/\*)" packages/core/rankingPoints/fieldAveraged.ts \| grep -cE "Math\.random\|crypto\.getRandomValues"` | **0** — the module draws no random number of its own |
| Both arms' histograms sum to the same draw count | asserted in-script, per team, per event — no mismatch |

**Structural sanity:** no histogram failed its draw-count assertion, no quantile fell outside `[0.5, teamCount + 0.5]`, and no event produced a `null` field-averaged artifact where the baked arm succeeded. The FAIL is a verdict, not a bug.

## Decisions made

- **Delta B is `no-change`** (see above). `add-alongside` was never on the table — D-16 is explicit that schedule generation is deleted entirely, not kept alongside, and two shapes under one key is exactly what the client parser cannot serve.
- **The seed-noise floor was added.** Without it the FAIL is uninterpretable and the checkpoint briefing would present a bare number. It is labelled a diagnostic in the code, in the printed output and in the written document, and it is explicitly barred from overruling the criterion (T-09-09-09).
- **`Test 4`'s `FieldStatistics` is constructed by hand rather than through `fieldStatistics`.** The plan's behaviour spec asked for "all variances zero, with two DIFFERENT score means so the outcome is decided", which is unsatisfiable through the real path — a *population* variance over a roster that includes the team is zero only when every score mean is equal. Building the statistics directly is the only construction that exercises the intended degeneracy (a fully determined outcome with no uncertainty anywhere), and the test says so in a comment.
- **`Test 1`'s boundary tables use alternating signs.** An all-positive table at 114×0.5 + 6×1.0 has a mean signed shift of 0.525 and fails clause 3 — correctly, but for a reason unrelated to what the case is testing. Alternating signs isolate clause 1.

## Deviations from plan

### 1. [Rule 3 — Blocking] `RpLayerConfig` / `RP_LAYER_CONFIG_DEFAULT` no longer exist

- **Found during:** baseline capture, before Task 1
- **Issue:** The plan's cross-plan contract table lists `RpLayerConfig` and `RP_LAYER_CONFIG_DEFAULT` among the names `fieldAveragedMatchPmf` would pass to `analyticRpPmf`. 09-06's D-06 collapse deleted the entire selectable-config surface; `analyticPmf.test.ts` now asserts those names appear on no code line of `analyticPmf.ts`, and `AnalyticRpPmfInput` carries neither `config` nor `pRedWin`.
- **Fix:** Followed 09-06's shipped shape, per the plan's own instruction ("If a name differs, use 09-04's and introduce no parallel name"). `fieldAveragedMatchPmf(contribution, stats, ruleModule, eventType)` takes no config parameter. The plan's HALT condition applies only to `convolvePmf`/`pmfMean`, both of which are present.
- **Files:** `packages/core/rankingPoints/fieldAveraged.ts`
- **Verification:** `npx tsc --noEmit` clean; 11 unit cases pass

### 2. [Rule 2 — Missing critical functionality] The seed-noise floor diagnostic

- **Found during:** Task 3, reading the first full-sample verdict
- **Issue:** A bare "clause 1: 32.8%" cannot be attributed between "rung 1 genuinely differs from the baked path" and "half a rank is finer than 1,000 draws resolve". Task 4's checkpoint briefing is required to present the verdict honestly, and it cannot without that number. `scripts/measureRewindGap.ts` carries the same idea in its own `NOISE_CONTROL_SEED_OFFSET`.
- **Fix:** Added `measureSeedNoiseFloor`, which re-simulates the **baked** arm's own priced schedules at two seeds — neither of them the published one, so the two sides are symmetric — and compares them to each other. Labelled a diagnostic in the code, the printed output and the document, and explicitly barred from overruling the criterion.
- **Files:** `scripts/measureFieldAveragedRanks.ts`, `docs/models/field-averaged-presim.md`
- **Verification:** the pooled floor is 68.4%, and it materially changes how the FAIL reads — see "The seed-noise floor" above
- **Committed in:** `d0e6cfb2`

### 3. [Rule 3 — Blocking] `selectMatchesChronological` takes an options object, not a season number

- **Found during:** Task 1
- **Issue:** A season-number positional argument type-errors and silently returns the whole corpus under `tsx`.
- **Fix:** `selectMatchesChronological(db, { eventKey })`, and the unplayed-qualification cross-check moved to `selectScheduledMatches(db, { eventKey })` — `selectMatchesChronological` returns played rows only, so a `redScore === null` filter over it can never fire.
- **Files:** `scripts/measureFieldAveragedRanks.ts`
- **Verification:** `npx tsc --noEmit` clean; the re-assertion correctly reproduces all six events' pinned numbers

---

**Total deviations:** 3 auto-fixed (2 × Rule 3 blocking, 1 × Rule 2 missing critical functionality)
**Impact on plan:** None on scope. Deviations 1 and 3 are upstream-shape corrections. Deviation 2 adds a diagnostic that makes the plan's own checkpoint briefing possible, and is fenced so it cannot weaken the criterion.

## Prohibitions — held

- **Rung 2 was NOT implemented, partially or entirely.** No self-generated random schedule, no Fisher-Yates for schedule building, no balanced-grid reimplementation.
- **D-19's licence question was NOT answered, researched or acted on.** No licence file was read, quoted, summarised or reasoned about.
- **No off-diagonal `varianceBlock` entry and no non-zero `scoreCrossCovariance` was constructed** (F4 untouched). `fieldAveragedAllianceMoments` builds a strictly diagonal block and an all-zero cross-covariance, asserted entry-for-entry in Test 2 and Test 2b; `analyticRpPmf`'s `assertIndependencePrecondition` throws on either and never fired.
- **No downstream exclusion or inclusion rule was tightened.** `simulationInputs.ts` was not opened. The client still returns `null` for an absent sidecar. No client file was edited at all.
- **F8/F9 unchanged** — recorded above, changed nowhere.
- **F4, F12, 2022 `cargoBonus`, F13, F10's display threshold** — all untouched.
- **`.env` was never `Read`, `cat`'d, `echo`'d, copied or interpolated**, not even to confirm a key is set. Nothing in this plan takes a credential: **no network request, no R2 object read/written/listed/deleted, no manifest bump, no Worker deploy, no D1 access, no publish command**, and the `package.json` entry added carries **no environment-file flag**. The corpus was opened **read-only** via `openCorpusReadOnly` on every path.
- **No BPR→SPR rename.** The key segment stays `bpr`.
- **`simulateRanks`, `continuousQuantile`, `analyticRpPmf`, `marginals.ts` and every season rule module were consumed, never edited.**
- **No display change.** `simQuantile.ts`, `simAxis.ts`, `rankRows.ts` and `RankDistributionTable.tsx` were not opened for edit.
- **No package-manager install occurred.** No `npm`/`pnpm`/`pip`/`cargo` install ran and no dependency was added to or removed from any `package.json` — the one change to that file is a script entry. **The Package Legitimacy Gate therefore did not apply**, and no `[ASSUMED]`/`[SUS]` legitimacy checkpoint was required. Recorded rather than omitted so a later audit can tell "no installs" from "installs not checked".

## Known stubs

None. Nothing in this plan is a placeholder: the predictor, the schema, the builders and the measurement are all complete and tested. The field-averaged path is **unwired by decision**, not unfinished — Task 4's checkpoint routed to NO-SHIP, which is exactly what "built, measured, not promoted" is supposed to look like.

## Checkpoint

Task 4's blocking one-way `checkpoint:decision` was reached and **routes to NO-SHIP**, which `09-CONTEXT.md`'s `<approvals>` block names as one of the two branches its standing authorization explicitly does **not** cover. The authorization is for deleting schedule generation — the SHIP branch — and is conditional on rung 1 **meeting** the criterion. It did not.

Nothing one-way was performed. The decision is returned to the developer.

## Self-Check: PASSED

- Every file claimed created exists on disk (6/6).
- Every commit hash claimed exists in `git log` (5/5).
- `git diff --name-only` across this plan's commits is a **strict subset** of the plan's `files_modified` frontmatter: 13 paths, all listed there, and **no `apps/web/` path and no `publish.test.ts`** — which is what proves the one-way work was genuinely not performed rather than performed and partially reverted.
- Task 5's commit (`821a8bc8`) touched **only** `09-09-SUMMARY.md` — a set-equality check on the no-ship branch's own acceptance criterion.
