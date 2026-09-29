---
phase: 03-tuning-ranking-points-versioning
plan: 04
subsystem: algorithms
tags: [sigma1, kalman, adaptive-filtering, zod, vitest]

# Dependency graph
requires:
  - phase: 03-tuning-ranking-points-versioning
    provides: "03-01's Sigma1Params surface/makeSigma1 threading and DEFAULT_SIGMA1_PARAMS discipline; 03-03's Sigma1TeamState/RpTeamState extension pattern and the promoted committed version file this plan's schema change touches"
provides:
  - "packages/core/algorithms/sigma1/adaptation.ts: InnovationStats, emptyInnovationStats, foldInnovation, adaptationFactor -- D-05/D-07's innovation-driven per-team noise adaptation mechanism"
  - "Six new Sigma1Params fields (adaptationEnabled default false, adaptationEwmaAlpha, adaptationExponent, adaptationMinFactor/MaxFactor, adaptationMinObservations) wired through applyTeamProcessNoise and applyAllianceUpdate"
  - "sigma1Adaptive (harness id sigma1-adapt, paramSetName defaults-adapt): the adaptation-on registry counterpart to sigma1/sigma1Defaults, provenly scorable side by side with them in one harness pass"
  - "A proven adaptation-off identity: DEFAULT_SIGMA1_PARAMS and an adaptation-off params object with every OTHER adaptation field perturbed to an extreme value produce byte-identical prediction streams"
affects: [03-05-sensitivity-screen-joint-search, 03-06-final-integration]

actuals:
  tokens: 9280
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Adaptive-Kalman scalar factor as a pure leaf module (adaptation.ts) importing only Sigma1Params's TYPE from params.ts, never the reverse -- the same acyclic-leaf discipline params.ts's own header already established for its four self-owned constants"
    - "Exact-1.0-on-disabled-path as the provability mechanism for an inert feature flag: adaptationFactor returns the literal 1 (not a computed value that happens to equal 1) on both its disabled branches, which is what lets multiplication by it be asserted byte-identical rather than merely close"
    - "Alliance-level (not team-differentiated) normalized innovation computed once per component inside the existing per-component fold loop, then RMS-aggregated per team after the loop -- 'no second loop over the alliance,' mirroring how measurementNoise is already shared across an alliance-component's teammates"

key-files:
  created:
    - packages/core/algorithms/sigma1/adaptation.ts
    - packages/core/algorithms/sigma1/adaptation.test.ts
  modified:
    - packages/core/algorithms/sigma1/params.ts
    - packages/core/algorithms/sigma1/params.test.ts
    - packages/core/algorithms/sigma1/index.ts
    - packages/core/algorithms/sigma1/sigma1.test.ts
    - packages/harness/cli.ts
    - data/algorithm-versions/sigma1@2.0.0+tracer-check.json

key-decisions:
  - "The committed promoted version file (data/algorithm-versions/sigma1@2.0.0+tracer-check.json) was updated to carry the six new Sigma1Params fields at their inert defaults (adaptationEnabled: false, etc.) -- Sigma1ParamsSchema is z.strictObject, so the pre-existing committed file fails to parse the instant a required field is added. Adding the fields at their exact DEFAULT_SIGMA1_PARAMS values changes nothing behaviorally; digest.test.ts's real re-run against this file reproduced its committed predictionStreamSha256 bitwise unchanged, which is itself proof that adaptation-off is exact, not just a schema fix"
  - "packages/harness/cli.ts's ALGORITHMS registry has 6 entries after this plan (opr, epa, sigma1, sigma1-seasonsd, sigma1-normalcdf, sigma1-adapt), not the 7 the plan's acceptance criteria literally states. The plan's own <action> text only instructs adding ONE new entry (sigma1-adapt) beside the pre-existing 5; sigma1Defaults (id sigma1-defaults, exported by 03-01 but never registered) was never asked to be added by this plan's action text either. Read as a miscount in the acceptance criteria rather than an instruction to register sigma1Defaults too -- matching this project's established precedent of correcting the write-up to match the committed reality rather than forcing reality to match a slightly-off written number (STATE.md's identifiability-script precedent). Registering sigma1Defaults is left for whichever later plan (03-05/03-06) actually needs the isolated-defaults baseline row 03-01's own doc comment describes"

patterns-established:
  - "adaptation.test.ts's saturation tests assert toBe (exact equality) at both adaptationMinFactor/adaptationMaxFactor bounds, never toBeCloseTo -- the clamp must return the literal bound, proven not assumed (T-03-06)"
  - "params.test.ts's swingingSequence/swingingObservables fixture: a deliberately swinging (not steady) per-component value across enough matches to cross adaptationMinObservations with a genuinely non-unit mean squared normalized innovation -- the minimum fixture shape needed to observe adaptation's effect feed forward into a LATER match's Kalman gain, since applyProcessNoise only ever changes belief.variance directly, never belief.mean"

requirements-completed: []

coverage:
  - id: D1
    description: "Each team carries a recency-weighted innovation statistic (InnovationStats) that scales its own process noise within a documented, exactly-clamped [adaptationMinFactor, adaptationMaxFactor] range, defaulting to off and to an exact factor of 1 when off or below the observation floor"
    requirement: ALGO-05
    verification:
      - kind: unit
        ref: "packages/core/algorithms/sigma1/adaptation.test.ts (11 tests: cold-start factor, exact clamp saturation at both bounds, both disabled paths return exactly 1, foldInnovation purity and non-finite refusal)"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-07's granularity (one scalar per team, shared across components, never per-component) is enforced structurally: the header documents why, and the RMS-aggregation code path is the only place a per-team factor is produced"
    requirement: ALGO-05
    verification:
      - kind: unit
        ref: "grep -c D-07 packages/core/algorithms/sigma1/adaptation.ts == 3 (module header cites the rejected per-team-per-component alternative and why)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Adaptation-off is bitwise identical to the pre-adaptation module: DEFAULT_SIGMA1_PARAMS and an adaptation-off params object with every OTHER adaptation field perturbed to an extreme value produce byte-identical prediction streams over a multi-match, multi-event synthetic sequence"
    requirement: ALGO-05
    verification:
      - kind: unit
        ref: "packages/core/algorithms/sigma1/params.test.ts#adaptation-off is bitwise identical to the pre-adaptation module (D-08, plan 03-04 Task 2) -- 3 tests: off-vs-default identity, on-vs-off difference, on/off individual reproducibility"
        status: pass
      - kind: unit
        ref: "packages/harness/digest.test.ts#promoted algorithm version reproducibility (D-15/SC-5) -- the committed sigma1@2.0.0+tracer-check.json version (adaptationEnabled: false) re-runs bitwise unchanged after this plan's schema change"
        status: pass
    human_judgment: false
  - id: D4
    description: "adaptation-on and adaptation-off are registered as two harness entries (sigma1, sigma1-adapt) and scorable side by side in one run"
    requirement: ALGO-05
    verification:
      - kind: integration
        ref: "pnpm harness --seasons 2024-2024 --algorithm sigma1,sigma1-adapt --out reports/adapt-smoke (real corpus run: 17029 matches replayed for EACH id, exits 0, artifact.algorithms == [sigma1, sigma1-adapt], artifact.slices carries entries for both ids)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The published team-page consistency spread (teamMetrics) is NOT touched by adaptation -- documented at the definition site, and unchanged code confirms it structurally (adaptation only ever multiplies applyTeamProcessNoise's q, never reads/writes consistency or covariance)"
    requirement: ALGO-05
    verification:
      - kind: unit
        ref: "packages/core/algorithms/sigma1/sigma1.test.ts's pre-existing teamMetrics — honest-variance check suite (unmodified assertions, still passing)"
        status: pass
    human_judgment: false
  - id: D6
    description: "No test in this plan asserts a direction for which of on/off scores better -- the comparison is deliberately deferred to plan 03-05, and the prohibition is honored structurally, not just by omission"
    requirement: ALGO-05
    verification: []
    human_judgment: true
    rationale: "This is a negative claim (absence of an assertion) that automated tests cannot themselves verify -- confirmed by manual review of every new test added in this plan's two commits, none of which reads or compares Brier/accuracy/score-quality between the on and off streams."

duration: 55min
completed: 2026-08-15
status: complete
---

# Phase 3 Plan 4: Innovation-Driven Per-Team Noise Adaptation Summary

**Sigma1 gained a classical adaptive-Kalman mechanism — one bounded, innovation-driven process-noise scaling factor per team — registered as a harness-scorable on/off pair, with adaptation-off proven bitwise identical to the pre-adaptation module end to end**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-08-15T03:10:00Z
- **Completed:** 2026-08-15T04:05:00Z
- **Tasks:** 2
- **Files modified:** 8 (across both task commits)

## Accomplishments

- `adaptation.ts` implements D-05's innovation-driven adaptation: each team's own recency-weighted EWMA of squared normalized innovation (`InnovationStats`) drives a bounded scaling factor (`adaptationFactor`) applied to that team's process noise — `emptyInnovationStats()` cold-starts at the "assume correctly specified" prior of exactly `1.0`, and the factor clamps EXACTLY at `adaptationMinFactor`/`adaptationMaxFactor` (asserted with `toBe`, never `toBeCloseTo`).
- D-07's one-scalar-per-team granularity is structural: `sigma1/index.ts`'s `applyAllianceUpdate` computes each alliance-component's normalized innovation once (an alliance-level quantity, mirroring how `measurementNoise` is already shared across teammates), then RMS-aggregates across `componentOrder` per team AFTER its existing per-component loop completes — no second loop over the alliance, matching the plan's explicit instruction.
- Both the within-event AND event-boundary process-noise magnitudes are scaled by the same per-team factor (`applyTeamProcessNoise`), so adaptation's effect does not depend on the event calendar.
- Adaptation-off is proven bitwise identical to the pre-adaptation module: a dedicated test builds `DEFAULT_SIGMA1_PARAMS` and an adaptation-off params object with every OTHER adaptation field perturbed to an extreme value, and asserts byte-identical `JSON.stringify`d prediction streams over a multi-match synthetic sequence. A companion test proves adaptation-on genuinely differs from adaptation-off for at least one match (the mechanism is wired, not decorative), and both streams are individually reproducible.
- `sigma1Adaptive` (harness id `sigma1-adapt`) is registered in `cli.ts`'s `ALGORITHMS` alongside `sigma1`, proven against a real 2024 corpus run: `pnpm harness --seasons 2024-2024 --algorithm sigma1,sigma1-adapt` exits 0, replays 17,029 matches for each id, and the artifact carries distinguishable slices for both.
- The published team-page consistency spread (`teamMetrics`) is provably untouched — the function's code is unmodified by this plan, and a header comment now states why: adaptation only ever scales `applyTeamProcessNoise`'s `q`, never reads or writes `consistency`/`covariance`.
- No test in this plan asserts a direction for which of on/off scores better — that comparison is plan 03-05's two independent equal-budget searches, and plan 03-06's verdict per D-08's pre-committed response to a negative result.

## Task Commits

Each task was committed atomically:

1. **Task 1: Innovation-driven per-team noise adaptation** — `5651cd77` (feat)
2. **Task 2: Register the on/off pair and prove adaptation-off changes nothing** — `f70d2e6f` (feat)

**Plan metadata:** commit pending (this SUMMARY + STATE.md/ROADMAP.md/REQUIREMENTS.md update)

## Files Created/Modified

- `packages/core/algorithms/sigma1/adaptation.ts` — `InnovationStats`, `emptyInnovationStats`, `foldInnovation` (EWMA fold of squared normalized innovation, refuses non-finite input per T-03-12), `adaptationFactor` (exact-1 on both disabled paths, exact clamp otherwise)
- `packages/core/algorithms/sigma1/adaptation.test.ts` — 11 pure unit tests covering cold start, exact clamp saturation at both bounds, both disabled paths, and `foldInnovation` purity/finiteness
- `packages/core/algorithms/sigma1/params.ts` — six new `Sigma1Params` fields (`adaptationEnabled` default `false`, `adaptationEwmaAlpha`, `adaptationExponent`, `adaptationMinFactor`/`MaxFactor`, `adaptationMinObservations`), matching `Sigma1ParamsSchema` entries
- `packages/core/algorithms/sigma1/params.test.ts` — the D-08 adaptation-off identity test suite (off-vs-default byte-identity with extreme-perturbed other fields, on-vs-off difference, on/off individual reproducibility) plus two hand-built `Sigma1TeamState` fixtures updated with the new required `innovationStats` field
- `packages/core/algorithms/sigma1/index.ts` — `Sigma1TeamState.innovationStats`; `coldStartTeamState`/`carrySeason` seed/reset it via `emptyInnovationStats()`; `applyTeamProcessNoise` scales `q` by `adaptationFactor(...)`; `applyAllianceUpdate` computes per-component normalized innovation and RMS-folds it into each team's `innovationStats` in its existing per-component pass; `teamMetrics` gains a comment documenting it is untouched by adaptation; `sigma1Adaptive` exported (id `sigma1-adapt`, `paramSetName: "defaults-adapt"`, `adaptationEnabled: true`)
- `packages/core/algorithms/sigma1/sigma1.test.ts` — four pre-existing hand-built `Sigma1TeamState` fixtures updated with the new required `innovationStats` field (no assertion changes)
- `packages/harness/cli.ts` — imports and registers `sigma1Adaptive` as `"sigma1-adapt"` in `ALGORITHMS` (6 entries total)
- `data/algorithm-versions/sigma1@2.0.0+tracer-check.json` — the committed promoted version file gains the six new `Sigma1Params` fields at their inert defaults (Rule 1 fix, see Deviations)

## Decisions Made

See `key-decisions` in frontmatter. The two consequential ones:

1. **The committed promoted version file needed the six new fields added at their exact default values** — `Sigma1ParamsSchema`'s `z.strictObject` throws on a missing required key, and the file predates this plan. Adding the fields at `DEFAULT_SIGMA1_PARAMS`'s own values changes nothing behaviorally; `digest.test.ts`'s real re-run reproduced the committed `predictionStreamSha256` bitwise unchanged — this is itself independent proof that the adaptation wiring is inert at its default, not merely a schema patch.
2. **The registry ends up with 6 entries, not the 7 the plan's acceptance criteria literally states.** The plan's own `<action>` text only instructs adding one entry (`sigma1-adapt`); it never mentions registering `sigma1Defaults` (exported by 03-01, still unregistered). Read as a miscount in the acceptance criteria rather than unstated scope, following this project's established precedent of correcting the write-up to match the committed, tested reality.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Sigma1TeamState's new required `innovationStats` field broke every pre-existing hand-built test fixture**
- **Found during:** Task 1, running `pnpm typecheck` after adding `innovationStats` to `Sigma1TeamState`
- **Issue:** `Sigma1TeamState` is a required-field interface; adding `innovationStats` without a default made every hand-built literal object of that shape (four in `sigma1.test.ts`, two in `params.test.ts`) fail to typecheck.
- **Fix:** Added `innovationStats: emptyInnovationStats()` to each of the six hand-built fixtures, importing `emptyInnovationStats` into both test files. No assertion in either file changed.
- **Files modified:** `packages/core/algorithms/sigma1/sigma1.test.ts`, `packages/core/algorithms/sigma1/params.test.ts`
- **Verification:** `pnpm typecheck` exits 0; both files' full pre-existing test suites pass unmodified.
- **Committed in:** `5651cd77` (Task 1 commit)

**2. [Rule 1 - Blocking bug] The committed promoted version file failed strict schema validation after the params surface grew**
- **Found during:** Task 1, running `pnpm test -- packages/core/algorithms/sigma1`, which pulled in `packages/harness/digest.test.ts`
- **Issue:** `data/algorithm-versions/sigma1@2.0.0+tracer-check.json`'s `params` object predates this plan's six new `Sigma1Params` fields. `PromotedVersionSchema`'s `Sigma1ParamsSchema` (`z.strictObject`) rejects any params object missing a required key, so `digest.test.ts` failed to even parse the fixture before this plan's changes.
- **Fix:** Added the six fields to the committed JSON at their exact `DEFAULT_SIGMA1_PARAMS` values (`adaptationEnabled: false`, etc.) — the same values the schema now requires everywhere. Since `adaptationFactor` returns exactly `1` on the disabled path, this changes nothing about the version's actual behavior.
- **Files modified:** `data/algorithm-versions/sigma1@2.0.0+tracer-check.json`
- **Verification:** `digest.test.ts`'s real re-run against the corpus reproduced the committed `predictionStreamSha256` and headline metrics bitwise unchanged — proof, not assumption, that adding the inert fields did not alter the version's replay.
- **Committed in:** `5651cd77` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 3, 1 Rule 1)
**Impact on plan:** Both necessary for correctness (typecheck/test would otherwise fail). No scope creep — same literal values everywhere they were added, no behavior change, both confirmed by the full test suite passing (426/426) and a real corpus run.

## Issues Encountered

- The first draft of the adaptation-off identity test reused the plan's pre-existing 3-match `combinedObservables` fixture (from 03-01), but no team in that short sequence ever crosses `adaptationMinObservations` (default 3) within a single season before a carry resets it — so an "adaptation-on differs from off" assertion against that fixture would have been vacuously true-by-luck or silently false. Built a dedicated longer, deliberately swinging 6-match fixture (`swingingSequence`/`swingingObservables`) instead, sized specifically so a team's `innovationStats.count` reaches the observation floor mid-sequence and its factor has room to diverge from exactly 1 before the sequence ends — verified the "differs" assertion actually exercises the divergent code path by running the real test (not merely asserting it should).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `adaptation.ts`'s mechanism and both registry entries (`sigma1` off, `sigma1-adapt` on) are ready for plan 03-05's two independent, equal-budget optimizer searches (D-06) — one search per mode, compared best-vs-best, never a single shared search.
- `adaptationEnabled` is declared and documented as a MODE excluded from the one-at-a-time sensitivity screen's sweep (03-05 must search it as two separate runs, never as a swept dimension inside one run) — the field's own doc comment in `params.ts` states this explicitly for the screen to find.
- Per this plan's own scope boundary (and matching the ALGO-04/ALGO-06/ALGO-08 precedent already established in STATE.md's decision log), **ALGO-05 is intentionally NOT marked complete in REQUIREMENTS.md** — this plan builds the mechanism and the registry pair only; the actual "harness validates adaptation improves holdout score" claim ALGO-05 describes is plan 03-05's comparison and plan 03-06's recorded verdict.
- No blockers for 03-05 or 03-06.

---
*Phase: 03-tuning-ranking-points-versioning*
*Completed: 2026-08-15*

## Self-Check: PASSED

Both created files verified present on disk (`adaptation.ts`, `adaptation.test.ts`); both task commit hashes (`5651cd77`, `f70d2e6f`) verified present in git log.
