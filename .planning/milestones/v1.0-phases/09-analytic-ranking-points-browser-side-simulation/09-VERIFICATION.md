---
phase: 09-analytic-ranking-points-browser-side-simulation
verified: 2026-09-12T03:45:00Z
status: gaps_found
score: 2/4 goal clauses verified
behavior_unverified: 1
overrides_applied: 0
gaps:
  - truth: "The pre-schedule simulation is priced in the visitor's browser"
    status: failed
    reason: >-
      Nothing moved into the browser under any reading. The deployed bundle
      (assets/index-CQxeLLOS.js) contains zero RP pricing code; the live sidecar
      is still 20 offline-priced schedules plus baked histograms; the client path
      is still decodePreScheduleResult, which unpacks precomputed histograms and
      performs no draws. The D-16 redesign that was substituted for this clause
      was measured twice and NO-SHIP'd both times.
    artifacts:
      - path: "packages/core/rankingPoints/fieldAveraged.ts"
        issue: "Built, browser-safe, tested - but unwired. publish.ts contains no call to it (only two comment references)."
      - path: "apps/web/src/lib/preScheduleResult.ts"
        issue: "Still the baked decoder. Zero browser compute; no Web Worker run on the pre-schedule stop."
      - path: "packages/harness/publish.ts:154"
        issue: "PRESIM_SCHEDULE_COUNT is still 20; Jacob's 2026-09-12 decision to ship at 1,000 is not applied."
      - path: "https://data.sigmascout.org/v1/presim/2026casnv/bpr@3.0.0+baseline.json"
        issue: "216,909 bytes, keys include `schedules` (20) and no `scheduleCount`. Client reads roster + baked only."
    missing:
      - "A browser-side pricing or drawing path for the pre-schedule stop (Option A, B or C of docs/simulation-architecture.md section 5 - none implemented)"
      - "OR an accepted alternative construction (rung 2 generator), which is blocked on D-19's licensing judgement - explicitly Jacob's, never delegated, still unanswered"
  - truth: "The live Worker stops stripping ranking points"
    status: partial
    reason: >-
      The stripping defect is structurally fixed and proven by a non-vacuous
      live-vs-offline digest parity test, and the shape-15 rows are seeded and the
      Worker deployed. But the path has never executed in production, and the one
      production measurement taken of it says a realistic mid-event tick costs
      ~13 ms p50 / ~28 ms p90 in Phase A alone against a 10 ms sustained budget.
    artifacts:
      - path: "apps/worker/src/scheduled.ts:1253"
        issue: "Reprices predict + 2x bandFor + a full analyticRpPmf over EVERY still-upcoming match, every tick. Measured as the dominant term."
    missing:
      - "Either a real live event exercising the shape-15 + RP path, or a CPU fix landed before one (rp-fold-exceeds-worker-cpu-budget)"
      - "An RP-ablated probe run, so the share of the overrun attributable to Phase 9's own addition is a number rather than an inference"
deferred:
  - truth: "Bonus probabilities no longer under-predict (F2/F3)"
    addressed_in: "Dispositioned, not deferred"
    evidence: >-
      Measured in 09-05/09-06, reverted under the pre-committed D-09 bar, retested
      2026-09-12 (negative binomial helps, -0.002898 pooled Brier over 510,838 obs,
      21/3/0) and DECLINED ON COST by Jacob. Closed disposition, not an open gap.
  - truth: "F4 (dependence between threshold variables), F12 (2019 completeRocket), F13, F8/F9 (OPR/EPA cold-start), F10's display half"
    addressed_in: "Explicitly out of scope"
    evidence: "ROADMAP.md 'Out of scope' block and 09-CONTEXT.md deferred section; all five predate the phase and were named as excluded before planning."
behavior_unverified_items:
  - truth: "The live Worker stops stripping ranking points"
    test: "Open a live window on a real 2026 event and let the cron tick run through quals."
    expected: "Published event rows carry redRpPmf/blueRpPmf as they play, D1 shape-15 rows deserialize without LeagueRowShapeVersionError, and wrangler tail shows cpuTime off the 10 ms pin sustained across the weekend."
    why_human: "Requires an actual live event. live-windows.json reads windows:[] - every green cron tick since the seed returns before reading a league row, so cron history is green for a reason unrelated to the question."
human_verification:
  - test: "Open a live window on a real 2026 event and let the cron tick run through quals."
    expected: "Played rows carry RP; cpuTime stays off the 10 ms pin."
    why_human: "No live event exists to observe; the deployed-path behaviour cannot be exercised from a test harness."
  - test: "Decide D-19 - whether cheesy-arena schedule templates may be redistributed to browsers."
    expected: "A recorded yes/no, which unblocks or forecloses rung 2."
    why_human: "09-CONTEXT.md states this judgement is the developer's and was never delegated. No agent in this phase has read or reasoned about the licence."
  - test: "Decide what the pre-schedule band's caption says while it is served at n=20."
    expected: "Raise the count to 1,000 (already decided, not applied), re-caption, or hide the view."
    why_human: "Trades published honesty against shipping speed; the measurement informing it is already done (live-preschedule-band-is-mostly-sampling-noise)."
---

# Phase 9: Analytic Ranking Points & Browser-Side Simulation - Verification Report

**Phase Goal (ROADMAP.md:590):** "Ranking points are predicted by an exact closed form instead of a
4000-draw Monte Carlo, their accuracy is published rather than merely computed, the live Worker
stops stripping them, and the pre-schedule simulation is priced in the visitor's browser."

**Verified:** 2026-09-12
**Status:** gaps_found
**Re-verification:** No - initial verification
**Scope source:** `.planning/todos/pending/ranking-points-audit.md` (F1-F13) and
`docs/simulation-architecture.md`, per ROADMAP.md:594. No v1 requirement IDs map to this phase.

---

## Verdict per goal clause

| # | Goal clause | In tree | In production | Verdict |
|---|---|---|---|---|
| 1 | Exact closed form replaces the 4000-draw Monte Carlo | yes | yes | **VERIFIED** |
| 2 | RP accuracy is published, not merely computed | yes | yes | **VERIFIED** |
| 3 | The live Worker stops stripping RP | yes | deployed, never exercised; one measurement says it will not survive a weekend | **NOT PROVEN** |
| 4 | The pre-schedule simulation is priced in the visitor's browser | no | no | **FAILED** |

**Score: 2/4.**

---

## Clause 1 - exact closed form instead of a 4000-draw Monte Carlo: VERIFIED

**In tree.** `packages/core/rankingPoints/distribution.ts` no longer exists. `analyticPmf.ts`
(902 lines) is its replacement, and it contains no `Math.random`, no `mulberry32`, no
`boxMullerPair`, no `fnv1a32`, and no draw loop - its only imports are types, `constants.ts`,
`moments.ts` and `marginals.ts`. Every named deletion from roadmap deliverable 2 is gone from
source: `rpPmfForMatch`, `CHOLESKY_RIDGES`, `clampCrossCovariance`, `buildJointModel`,
`rpMonteCarloSeed`, `rpMonteCarloDraws`, `RP_MONTE_CARLO`. The only surviving hits are (a) a
historical comment in `apps/worker/src/bundleSmoke.ts` naming what it replaced and (b)
`data/algorithm-versions/vpr@11.0.0+*.json`, which are frozen parameter files for the retired VPR
algorithm - neither is live code.

**Exactness precondition holds.** `empiricalMoments.ts:217` still emits
`scoreCrossCovariance: names.map(() => 0)` and a diagonal `varianceBlock`, so the joint the closed
form integrates really is the fully-independent one the Monte Carlo was sampling. The closed form
is exact *relative to that model*; the model's independence assumption remains a known, deliberate
approximation (F4, explicitly out of scope).

**Wiring.** `analyticRpPmf` is called from `packages/harness/sigmaScoutLayer.ts:336` (the offline
publisher's one write path) and `apps/worker/src/scheduled.ts:1158` (the live tick). Two call
sites, one function - the "one write path for level-2 fields" rule the module was extracted to
enforce.

**D-07's required mitigation is real.** The Monte Carlo equivalence check was declined by the
developer, so unit tests had to carry the correctness burden. They do: `analyticPmf.test.ts` has a
`Task 1 tracer (2026)` block and a `Task 2 (D-07's remaining six mechanism classes)` block, and the
nested-threshold trap has its own non-vacuous case - `P(both) == P(supercharged)` with an explicit
assertion that the two thresholds are not degenerate-equal, which is the exact thing that would
silently pass if they were treated as independent.

**In production.** Live `v1/event/2026casnv/bpr@3.0.0+baseline.json`, generation
`b23d214d-9af0-48f5-a907-3903c2d06f44`, `computedAt 2026-09-12T01:06:14.953Z`: 74 of 74 played
qualification rows carry a 7-entry `redRpPmf`/`blueRpPmf` pair. Spot-parsed, the pmfs are genuine
distributions (e.g. `qm44` red = `[0.38271, 0.39339, 0.04924, 0.08099, 0.08325, 0.01042, 0]`), not
point masses - exactly one row in 74 (`qm1`, the cold-start match) is degenerate.

**D-12 (level-1 byte-identical) corroborated independently of the SUMMARY.** `git log --` on
`data/baselines/level1-digest-2026-09.json` shows the freeze commit (`47df877d`, 09-01) and then
only two later commits, both from the *concurrent EPA workstream* (`3f36e582`, `57cef7a7`). **No
Phase 9 commit touched the level-1 digest baseline**, and `level1Digest.test.ts` passes at HEAD
(5/5). That is stronger evidence than the SUMMARY's assertion, because it rules out the failure
mode where a leak is absorbed by rebaselining.

---

## Clause 2 - accuracy published rather than merely computed: VERIFIED

**In tree.** `attachRpCalibration` (`publish.ts:1664`) attaches a committed measurement onto
qualification slices only, matched by `(season, algorithmId)`. `CompareSliceSchema.rpCalibration`
is in `pageArtifacts.ts:1711`. A test at `publish.test.ts:4811` greps every
`buildCompareArtifact({` call site in `publish.ts` and requires each to pass an `rpCalibration:`
key - so a second call site added later cannot silently omit it.

**Rendered, not just carried.** `RpCalibrationSection` is imported and rendered at
`apps/web/src/routes/methodology.compare.tsx:196`, inside a real card with a per-bonus
`predicted X% -> actual Y%` row, a deviation chart, mandatory sample counts, and a `small sample`
tag. Absence renders a sentence and no `%` anywhere, so "not measured" cannot be misread as
"measured at 0%".

**In production - parsed as JSON, not a status check.** `v1/compare/2026.json` at generation
`b23d214d` carries `rpCalibration` on all three qualification slices (`bpr` 91,146 scored;
`epa`/`opr` 80,370 each) and correctly on none of the six elimination/combined slices. Checked
across four further years, every one at the same generation with 3/3 qualification slices
populated:

| season | bpr bonus | predicted | observed |
|---|---|---:|---:|
| 2016 | `breach` | 0.025 | 0.700 |
| 2019 | `completeRocket` | 0.000 | 0.047 |
| 2023 | `sustainabilityBonus` | 0.048 | 0.243 |
| 2025 | `autoBonus` | 0.179 | 0.625 |
| 2026 | `supercharged` | 0.041 | 0.081 |

**This is the clause being met, not a finding against it.** The published scorecard tells the truth
about numbers the site was already shipping - including F12's `completeRocket` at a literal 0.000
against an observed 4.7%. The whole point of F1 was that these were invisible; they now are not.

**Deployed.** `https://sigmascout.org/methodology/compare` serves `assets/index-CQxeLLOS.js`, which
contains `Bonus ranking point accuracy has not been measured for this artifact yet.` and the
`predicted ...%, actual ...%` chart title template. The component is in the shipped bundle, and the
data it reads is live at the key it reads it from.

*(Aside, checked and dismissed: `epa` and `opr` report byte-identical bonus figures. That is
correct, not a copy bug - the bonus marginals are algorithm-independent, and `epa`/`opr` share the
same Swing-Factor gate, so they score the identical observation set. `bpr` differs precisely
because Sigma Score changed its gate: 30,382 vs 26,790 observations.)*

---

## Clause 3 - the live Worker stops stripping RP: NOT PROVEN

**What is genuinely delivered, and it is not small.**

- `buildEventMatchRow` now lists `redRpPmf`/`blueRpPmf` (`scheduled.ts:563-564`), and so do the
  upcoming and elimination row builders (`:594`, `:715`). The structural incapacity F5 named is
  gone.
- The Worker builds a real accumulator: `RpMomentsAccumulator.fromBeliefs(rpRuleModule,
  readRpBeliefs(rows))` at `scheduled.ts:1117-1118`, and calls `analyticRpPmf` at `:1158`.
- `STATE_SNAPSHOT_SHAPE_VERSION = 15` (`stateSnapshot.ts:389`), a new field - VPR's retired
  `rpBeliefs` was not reused.
- **The parity test is the real thing, not a shape check.** `apps/worker/test/scheduled.rp.test.ts`
  drives `runTick` over a prior event and then a live event one match per tick, and asserts the
  live pmf stream's digest EQUALS an independent offline `SigmaScoutLayer` replay's digest **for
  all three published algorithms**, with explicit non-vacuity guards on *both* arms ("two empty
  streams digest identically"). It also pins that RP costs zero additional D1 subrequests.
- All of it is green: `npx vitest run apps/worker/test/scheduled.rp.test.ts
  packages/core/rankingPoints` -> 11 files, 722 tests passed. Full repo-root suite -> **263 files,
  5,462 passed, 4 skipped, 0 failed.**

**What is not proven.** `live-windows.json` reads `windows: []`. The tick returns before it ever
reads a league row, so no green cron tick since the seed says anything about shape 15, about
`LeagueRowShapeVersionError`, or about RP. The phase's own `09-VALIDATION.md` already lists "Live
event RP survives a real tick" as a manual-only verification with the criterion "`cpuTime` stays
off the 10ms pin".

**And there is counter-evidence.** `rp-fold-exceeds-worker-cpu-budget` deployed
`apps/worker/src/stateProbe.ts` against live D1 at this generation, 60 invocations:

| load | p50 | p90 | max |
|---|---|---|---|
| 2 folded / 60 upcoming (realistic mid-quals shape) | **13 ms** | **28 ms** | 29 ms |

I confirmed the mechanism the probe blames. `scheduled.ts:1253` really does loop every
still-upcoming match every tick, running `predict` + two `bandFor` + a full `analyticRpPmf`. The
10 ms budget is sustained-rate, not per-invocation - which is why a p50 above it for a whole event
weekend is the 2026-08-28 outage's exact shape.

**One correction to the attribution, which I am recording because it cuts against the todo's
framing, not for it.** `git log -S "upcomingPredictions"` shows the upcoming-repricing loop predates
this phase (introduced at `dabe9acd`, extended at `63596da3` for the Match Band). Phase 9
(`dc30636e`) added `analyticRpPmf` *into* an already-expensive loop. The probe has `folded` and
`upcoming` knobs but no RP-ablation flag, so **how much of the overrun Phase 9 itself added is
currently unquantified.** Going 0 -> 60 upcoming costs ~7 ms p50; even if RP were half of that, the
tick-shaped p50 (~10-11 ms) still sits on the pin.

**Verdict.** The stripping defect is fixed and the fix is well-tested. The clause as written - "the
live Worker stops stripping them" - describes a production behaviour at a live event, and that
behaviour has never occurred. Presence and wiring are verified; runtime behaviour is not, and the
only production measurement of it is negative. This is not a pass.

---

## Clause 4 - the pre-schedule simulation is priced in the visitor's browser: FAILED

**Nothing was moved into the browser, under any reading of "priced".**

`docs/simulation-architecture.md` section 5 offers three ways to do this: Option A (ship the priced
schedules, browser runs the draws), Option B (browser generates schedules and prices them), Option
C (ship per-team RP parameters, browser builds alliance moments). **None was implemented.** Neither
was the substitute the phase adopted - D-16's field-averaged predictor, which would have removed
schedule generation rather than moved it.

Evidence, each checked directly:

| Check | Result |
|---|---|
| `grep analyticRpPmf apps/web/src` | no hits |
| `grep -c "analyticRpPmf\|negativeBinomial"` in deployed `assets/index-CQxeLLOS.js` | **0** |
| `apps/web/src/lib/preScheduleResult.ts` | still `decodePreScheduleResult`; header states "no fetch, no Worker, no Monte Carlo - this function only unpacks them" |
| live `v1/presim/2026casnv/bpr@3.0.0+baseline.json` | **216,909 bytes**; keys include `schedules` (20 entries), `baked.draws` 1000, `scheduleCount` **undefined** |
| `grep fieldAveraged packages/harness/publish.ts` | two comment references, **zero call sites** - the predictor is committed and unwired, exactly as the 09-09 checkpoint says |
| `PRESIM_SCHEDULE_COUNT` (`publish.ts:154`) | **20**. Jacob's 2026-09-12 decision to ship at 1,000 is not applied |
| deployed bundle caption | `Computed ahead of time across ${e} randomly generated schedules, ${t} draws in total.` - templated from the artifact's own 20/1000 |

The visitor's browser still performs **zero** compute on the pre-schedule stop. It downloads
216 KB, reads ~7 KB of it (`roster` + `baked`), discards the rest, and renders precomputed
histograms.

**The rung-1 no-ship was correct and is not what I am faulting.** It failed at n=20 (32.8% vs a 95%
bar) and was re-run at n=4,000 where the bar resolves - 41.4% against a binding floor of 98.4%,
worst team 3.33 ranks against a floor of 0.71, failing structurally and worsening with roster size.
That is a properly-conducted negative result, and the decision to keep the predictor committed as
rung 2's baseline is right. **The gap is that the goal clause depended on a redesign that did not
land, and no fallback path to the browser was taken instead.**

**What did land for the pre-schedule stop, and it is real but it is a different claim.** D-20's
housekeeping shipped: the sidecars are re-keyed from retired `vpr` to the three published ids, the
`--presim-from-season 9999` sentinel is gone (now `2026`, with a drift tripwire in
`publish.test.ts`), and 641 sidecars were written. I verified the stop is live and reachable under
the client's own key on all three published algorithms. The pre-schedule view went from **dark** to
**serving** in this phase. That is not "priced in the visitor's browser."

**And the surface that did go live is of doubtful published honesty.** At the shipped n=20 the
binding resampling floor is 27.0% of teams agreeing within half a rank between two runs of the
identical construction, worst team 10.61 ranks - while the caption reads as a confident statement
of method. Options are recorded and the decision is Jacob's; it is not an agent's to make and I am
not making it. I am recording that a published surface is currently mostly estimation noise.

---

## Roadmap deliverables 3 and 4 - reverted, and that is in order

Deliverable 3 (win RP from the published `pRedWin`, closing F6; discrete tie model, closing F7) and
deliverable 4 (right-skewed marginals) were built, measured, and reverted under the
**pre-committed** D-09 bar, which is what D-10 prescribes ("the closed form ships
unconditionally... the acceptance bar governs only the modelling changes"). I confirmed the revert
in production rather than taking it on the record's word: live `2026casnv_qm3` carries
`pRedWin 0.4922` against `matchOutcomePmf` `[0.46745, 0, 0.53255]` - the F6 coherence gap is still
there, and the tie entry is identically zero, so F7's branch still never fires. Both match what the
record says shipped.

The marginal arm's first verdict was later shown to rest on a bug (`clauseProbability` discarding
the declared family; 24 of 30 cells structurally unable to respond). The retest ran, found negative
binomial **helps** (-0.002898 pooled Brier, 510,838 obs, 21 improved / 3 regressed / 0 tied), and
Jacob **declined it on cost**. That is a closed disposition by the decision-owner, not an open gap,
and I am not reopening it.

---

## Anti-patterns

126 non-planning `.ts`/`.tsx` files changed between `3cbf7783~1` and HEAD.

| Scan | Result |
|---|---|
| `TBD` / `FIXME` / `XXX` | **none** |
| `TODO` / `HACK` / `PLACEHOLDER` / "not yet implemented" | 3 hits, all benign: a test fixture constant `RP_PLACEHOLDER_FIELDS`, a doc-comment heading "WHY A SOLO ROW IS THE RIGHT SHAPE AND NOT A HACK", and a binary-matched test file |

No debt-marker gate failures.

---

## Behavioural checks run

| Check | Command | Result | Status |
|---|---|---|---|
| RP + Worker RP tests | `npx vitest run apps/worker/test/scheduled.rp.test.ts packages/core/rankingPoints` | 11 files, 722 passed | PASS |
| D-12 level-1 invariance | `npx vitest run packages/harness/level1Digest.test.ts` | 5 passed | PASS |
| Whole suite, repo root | `npx vitest run` | 263 files, 5,462 passed, 4 skipped, 0 failed | PASS |
| Live compare artifact | GET + JSON parse, 5 seasons | `rpCalibration` on 3/3 qual slices each | PASS |
| Live event artifact | GET + JSON parse, 3 algorithms | bpr 74/74 pmfs; opr/epa 59/74 (cold-start gate, out of scope) | PASS |
| Live presim sidecar | GET + JSON parse | 20 schedules, baked 1000 draws, no `scheduleCount` | PASS (and is the clause-4 evidence) |
| Deployed web bundle | GET + string grep | RP section present; RP pricing absent | PASS |
| Live-event Worker tick | - | no live window exists | SKIP -> human |

No probes under `scripts/*/tests/probe-*.sh` exist in this repo; the phase's runnable check is the
Vitest suite plus the deployed `stateProbe`, which requires credentials and a deploy and was
therefore read from its recorded run rather than re-run here.

---

## F1-F13 disposition, checked against code rather than taken from the audit's own table

| Finding | Audit's claim | My check |
|---|---|---|
| F1 | CLOSED | **Confirmed** - live in 5/5 seasons checked, rendered component in the deployed bundle |
| F2/F3 | measured, fixes reverted, then declined on cost | **Confirmed** as a closed disposition by the decision-owner |
| F4 | still open | Confirmed out of scope; `empiricalMoments.ts:217` still zero cross-covariance |
| F5 | CLOSED, not exercised in production | **Confirmed closed in code; "not exercised" understates it** - see clause 3's CPU measurement |
| F6/F7 | closed in mechanism, reverted in ship | **Confirmed in live bytes** (`pRedWin` != pmf-implied; tie entry identically 0) |
| F8/F9 | still open for OPR/EPA | **Confirmed in live bytes** - opr/epa 59/74, bpr 74/74 on the same event |
| F10 | upstream closed, display half open | Confirmed; display threshold unchanged |
| F11 | CLOSED | **Confirmed** - sidecars keyed to the three published ids and reachable under the client's own key |
| F12 | still open | **Confirmed, and now published**: live 2019 `completeRocket` predicted 0.000 vs observed 0.047 |
| F13 | still open | Out of scope, unchanged |

---

## Gaps summary

**The phase did not achieve its goal. It achieved two of four clauses cleanly, left a third
delivered-but-unproven with negative evidence against it, and missed the fourth entirely.**

The closed form is real, exact, deterministic, tested against hand-computed expectations for all
seven mechanisms including the nested-threshold trap, and live in production. The accuracy scorecard
is real, published across all ten seasons and all three algorithms, rendered by the deployed bundle,
and honest about the numbers that embarrass the model. Those two clauses are met without
qualification, and the engineering behind them is better than the goal strictly required.

**Clause 4 is the miss, and it is not a matter of degree.** No line of pricing or drawing code runs
in the visitor's browser for the pre-schedule stop. The ladder's rung 1 was measured honestly and
failed structurally; rung 2 is blocked on D-19, a licensing judgement that is explicitly the
developer's and has never been answered; and no fallback to the architecture doc's Option A - which
that document itself calls cheap, low-risk and already-inputs-on-the-wire - was taken. What shipped
in this area was housekeeping that took the pre-schedule stop from dark to live, which is valuable
and is not the clause.

**Clause 3 is a real fix whose production behaviour is unknown and probably bad.** It should not be
counted as achieved on the strength of a green test suite when the project's own validation document
named the live-tick CPU behaviour as the thing to check, and the only time anyone checked it, it
came back at 13 ms p50 against a 10 ms sustained budget.

**What would close the phase:**

1. **Clause 4 - one of:** implement Option A (browser runs the draws from the already-shipped
   priced schedules); or get D-19 answered and ship rung 2; or, if browser-side pricing is no longer
   wanted, amend the goal clause in ROADMAP.md to say what was actually intended and re-verify
   against that. The third is legitimate - the phase's own `09-CONTEXT.md` already restates this
   clause as "redesigned to need no schedule generation at all", which is a different claim from the
   roadmap's - but it must be an explicit amendment, not a silent reading.
2. **Clause 3 - either** land a CPU fix (the four directions are priced in
   `rp-fold-exceeds-worker-cpu-budget` and the probe can measure any of them) **or** run a real live
   event and observe the tick. The second is not available on demand in September, so the first is
   the only one that can close before a season starts.
3. **Not required to close the goal, but live on a published surface:** decide what the pre-schedule
   band says while it is served at n=20 (the count decision to ship at 1,000 is already made and
   simply not applied).

---

_Verified: 2026-09-12_
_Verifier: Claude (gsd-verifier)_
