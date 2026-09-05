---
quick_id: 260905-kjb
phase: quick-260905-kjb
slug: stage-2-carryvarianceretention-knob-one-
date: 2026-09-05
type: execute
mode: quick
plan: "01"
wave: 1
worktree: false
autonomous: true
depends_on: []
requirements: [CVR-PARAM, CVR-WIRE, CVR-SEARCH]
files_modified:
  - packages/core/algorithms/sigma1/params.ts
  - packages/core/algorithms/sigma1/params.test.ts
  - packages/core/algorithms/sigma1/index.ts
  - packages/harness/searchSpace.ts
  - packages/harness/searchSpace.test.ts

estimate:
  tokens: 34000
  raw_tokens: 34000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "CVR-PARAM: `Sigma1Params.carryVarianceFactor` exists as a `readonly number`, defaults to exactly `1`, and its Zod entry is `.finite().positive().max(1).default(1)` — so every already-committed `data/algorithm-versions/vpr@8.0.0+*.json` file, none of which carries this key, still parses unchanged and resolves to the inert value `1`."
    - "CVR-PARAM: the field is DIMENSIONLESS (a unitless multiplier on a variance already in the right units), so it passes through `resolveSigma1Params` completely unchanged — it is NOT one of the five `*Rel` fields `Sigma1ResolvedParams` `Omit`s, exactly like `elimObservationNoiseMultiplier`."
    - "CVR-WIRE: in `carrySeason`'s per-component loop, a team WITH carried state (`oldTeamState !== undefined`) seeds EVERY modeled component's belief variance as `max(resolved.minConsistencyVariance, coldStartVariance * carryVarianceFactor)` — a UNIFORM per-team factor, applied without reference to the component's name."
    - "CVR-WIRE: at factor exactly `1` the seed is `coldStartVariance` via an EXPLICIT `=== 1` branch — provable inertness by an exact branch, never an algebraic identity that happens to cancel."
    - "CVR-WIRE: a team with NO `oldTeamState` keeps `coldStartVariance` unchanged at EVERY factor value, and `ADJUST_COMPONENT`'s pinned `{ mean: 0, variance: 0 }` branch is untouched at every factor value."
    - "CVR-WIRE: lines 1848-1849 (`carriedObserved` and the `consistency[name] = carriedObserved * consistencyDecayOverGap` accumulator) are UNTOUCHED — not edited, not hoisted, not re-expressed. Only the belief-variance seed on line 1847 moves."
    - "CVR-WIRE: at the default `1` the prediction stream across a real season boundary is BYTE-IDENTICAL to today's; at factor `0.3` it DIFFERS (the mechanism is wired, not decorative); and a SINGLE-SEASON replay at factor `0.3` is byte-identical (the gate is the season boundary, not the parameter)."
    - "CVR-WIRE: the mechanism's REACH is ALL modeled components of the incoming season, pinned by a test asserting that a component whose NAME DOES NOT SURVIVE the boundary still has its seeded variance moved. This is the inverse of the name-matched reach pin the original design carried, and pinning it is the entire point of this revision."
    - "CVR-SEARCH: `carryVarianceFactor` is registered searchable at `{ min: 0.05, max: 1, scale: \"log\" }`, and `SEARCH_EXCLUSIONS` / `SIGMA1_SEARCH_SPACE` still PARTITION `SIGMA1_PARAM_KEYS` exactly. Pinned counts move 15/14/29 -> 16/14/30."
    - "CVR-SEARCH: `screenGridFor` produces a strictly monotonic grid CONTAINING the default for this parameter even though its default sits AT the `max` bound — the first searchable parameter with a non-interior default, handled explicitly rather than by a coincidence."
    - "CVR-WIRE: `SIGMA1_CODE_VERSION` stays `8.0.0` and `STATE_SNAPSHOT_SHAPE_VERSION` stays `8`; the non-bump is RECORDED in `params.ts`'s version-history block with its reasoning, so a future reader cannot read the absence as an oversight."
    - "SCOPE: NO tuning run, NO sensitivity screen, NO backtest, NO promotion, NO publish and NO network call is performed. Registering the knob is the whole task."
  artifacts:
    - "packages/core/algorithms/sigma1/params.ts — the new field, its default, its schema entry with `.default(1)`, and the recorded NON-BUMP"
    - "packages/core/algorithms/sigma1/index.ts — the `carrySeason` belief-variance seed, with an exact `=== 1` branch"
    - "packages/core/algorithms/sigma1/params.test.ts — schema round-trip, inertness, wiring, boundary-gate control, no-carried-state branch, monotonicity, and all-components reach coverage"
    - "packages/harness/searchSpace.ts — one new bound with its two-result Stage-1 citation, plus `screenGridFor`'s at-endpoint-default handling"
    - "packages/harness/searchSpace.test.ts — pinned counts 16/14/30, with this task's entry appended to the running comment block"
  key_links:
    - "`Sigma1ParamsSchema`'s `.default(1)` -> every committed `vpr@8.0.0+*.json` file. Drop the default and all four files fail to parse at once, taking `digest.test.ts`, `cli.ts`, `tune.ts` and the publish path with them."
    - "`resolved.carryVarianceFactor === 1` -> `beliefs[name].variance = coldStartVariance`. This EXACT branch is the whole inertness proof and therefore the whole justification for not bumping `SIGMA1_CODE_VERSION`. Replace it with an algebraic form that merely evaluates to the same number and the non-bump loses its evidence."
    - "`oldTeamState !== undefined` (line 1829's `state.teams.get(team)`) -> the mechanism's reach. This is Stage 1's R2 condition, and it is TEAM-level, not component-level: it is true for every modeled component of a returning team regardless of whether that component's name existed last season. Narrow it to `oldTeamState?.consistency[name] !== undefined` and the knob collapses back to reaching `foulsCommitted` alone, which is exactly the defect this revision exists to fix."
    - "`SIGMA1_SEARCH_SPACE.carryVarianceFactor.max === 1 === DEFAULT_SIGMA1_PARAMS.carryVarianceFactor` -> `screenGridFor`'s interior-slot overwrite. Without the endpoint guard the grid gains a duplicated value and stops being strictly monotonic, which `searchSpace.test.ts` asserts directly."
  prohibitions:
    - "Do NOT bump `SIGMA1_CODE_VERSION`. It is DERIVED into `PROMOTED_VPR_VERSION_PATH` and `INCUMBENT_VERSION_PATH`, so a bump points both at files that do not exist and forces a re-promotion of all four committed version files — two of which are `paramSetsBySeason`-shaped and cannot be re-promoted via `--from-version` at all."
    - "Do NOT bump `STATE_SNAPSHOT_SHAPE_VERSION`. This task adds NO `Sigma1State` field — it reads carried state that already exists — so there is no stale-row failure mode to guard against, and a gratuitous bump would force a live-Worker re-seed for nothing."
    - "Do NOT DERIVE the factor from `reversionOverGap(carryMeanReversion, gap)`. That derived quantity is Stage 1's R2 and is a MEASURED NEGATIVE at its own value (~0.069 factor; -10.46 pooled SE-units, three seasons breaching the -2.0 SE floor). This task borrows R2's REACH CONDITION and its MULTIPLICATIVE SHAPE — both of which the measurement says nothing against — while making the value a free, gap-independent, searchable constant. Do not import `reversionOverGap` into `index.ts`, and do not make the factor a function of `gap`."
    - "Do NOT reintroduce Stage 1's R1 geometric/name-matched formulation (`coldStartVariance * (carriedSeed / coldStartVariance) ** r`, gated on `oldTeamState?.consistency[name]`). Planning established that its gate reaches only `foulsCommitted` at any real boundary, which is why this plan was revised away from it."
    - "Do NOT change lines 1848-1849's `carriedObserved` / `consistency[name]` accumulator in any way — not the formula, not by hoisting its `oldTeamState?.consistency[name]` read into a shared local. The revised seed does not need that value, so the correct diff leaves those two lines byte-identical. Do NOT touch `ADJUST_COMPONENT`'s pinned `{ mean: 0, variance: 0 }` branch. Stage 1 held both fixed and this task inherits that discipline."
    - "Do NOT regenerate or hand-edit any file under `data/algorithm-versions/`, `packages/core/algorithms/sigma1/fixtures/`, or `docs/publish-budget.md`. A digest mismatch is a finding about the code, never a fixture to refresh."
    - "Do NOT run a tuning run, sensitivity screen, backtest, promotion or publish. Do NOT make any network call — executor subagents have no network and those steps belong to the main context afterward."
    - "Do NOT run any command of the form `timeout N pnpm ...`. It swallows all output and exits 0, which reads as a false green. Use `npx vitest run` / `npx tsc --noEmit` directly and judge by the printed summary, not the exit code."
---

<objective>
Add ONE searchable Sigma1 hyperparameter, `carryVarianceFactor`, controlling how much belief
VARIANCE a returning team retains across a season boundary — a single UNIFORM per-team multiplier
on the cold-start variance prior, applied to every modeled component of the incoming season.
Default `1` is exactly today's full cold-start reset; values below 1 seed a returning team with
proportionally MORE confidence than a first-timer, which is the asymmetry the autopsy says VPR
is missing.

Purpose: `reports/autopsy-260905/FINDINGS.md` diagnosed VPR's accuracy deficit versus EPA as an
early-information deficit — VPR resets belief variance to the cold-start prior at every season
boundary while carrying an EPA-equivalent MEAN across it. Stage 1 (quick task 260905-jyf) tested
that diagnosis with two parameter-free candidate seed rules over a 2022-2026 walk-forward replay,
and returned a SPLIT result that this task's design is built directly on top of:

- **R1** (seed each component from its own carried, gap-decayed consistency) WON its pre-committed
  criteria — early-slice accuracy up on both 2023 (0.7402 -> 0.7413) and 2025 (0.7405 -> 0.7407),
  every season inside +/-0.4 SE overall, pooled Brier 0.1593 -> 0.1590 — but by a few hundredths of
  a point, an order of magnitude under the ~1.3pt EPA-vs-VPR early-slice gap it was aimed at.
- **R2** (scale the cold-start prior by `reversionOverGap(carryMeanReversion, gap)`, a per-team
  uniform factor) closed NEGATIVE at -10.46 pooled SE-units, with three seasons breaching the
  -2.0 SE floor.

So the direction is validated and the dose is not: R1 was too weak to matter and R2's own derived
factor (~0.069) was far too aggressive. This task registers the dose as a free searchable constant
so the next joint re-tune selects it on measurement instead of the plan guessing it.

Output: one new schema-defaulted, provably-inert `Sigma1Params` field wired end to end through
`carrySeason`, registered searchable, fully tested, with the `SIGMA1_CODE_VERSION` non-bump
recorded. Implementation and tests only — the sensitivity screen, joint tune, and any promotion
run afterward from the main context and are explicitly out of scope.

WHY THIS PLAN WAS REVISED, and the second structural fact the tasks below encode rather than leave
to be rediscovered:

1. **The original name-matched semantics were invalidated during planning, and this is the
   replacement.** The first draft of this plan followed R1's shape: an interpolation exponent gated
   on `oldTeamState?.consistency[name] !== undefined`. FRC component names are season-specific, so
   that gate is `undefined` for nearly every component at every real boundary. Checked across all
   five seasons' `OWN_FIELD_COMPONENT_MAP` plus `FOULS_COMMITTED_COMPONENT`: the only names
   surviving a consecutive-season boundary are `adjust` (pinned at `{ mean: 0, variance: 0 }` and
   excluded) and `foulsCommitted`. A knob that can only ever move ONE component's seed is not worth
   a tune run — and it very likely explains why R1's measured effect was real but tiny. The knob is
   therefore re-specified with R2's TEAM-level gate (`oldTeamState !== undefined`), which provably
   reaches every modeled component, while keeping the value free and searchable rather than derived
   from `reversionOverGap` as R2 did. R2's negative is evidence about R2's VALUE, not about its
   reach condition or its multiplicative shape; those are what this task inherits.
2. **This is the first searchable parameter whose default sits AT a bound.** Default 1 IS the
   `max` of the `[0.05, 1]` bound, and `screenGridFor` currently overwrites the interior grid slot
   nearest the default — which would duplicate 1 at an interior index and break the strict
   monotonicity `searchSpace.test.ts` asserts. Task 2 handles that explicitly. (The original draft
   hit the same defect at the `min` end; the guard is unchanged in substance, only in which
   endpoint triggers it.)
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./.claude/CLAUDE.md

@.planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/260905-jyf-RESULTS.md
@.planning/quick/260904-v9n-add-the-elim-r-multiplier-and-a-within-s/260904-v9n-SUMMARY.md

@packages/core/algorithms/sigma1/params.ts
@packages/harness/searchSpace.ts
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: End-to-end carryVarianceFactor — registered, wired through carrySeason, proven inert at 1 and proven wired at 0.3 across all modeled components</name>
  <files>packages/core/algorithms/sigma1/params.ts, packages/core/algorithms/sigma1/index.ts, packages/core/algorithms/sigma1/params.test.ts</files>
  <read_first>
    packages/core/algorithms/sigma1/params.ts (the `Sigma1Params` interface tail around `elimObservationNoiseMultiplier` at ~line 755-780, `DEFAULT_SIGMA1_PARAMS` at ~835-883, and `Sigma1ParamsSchema` at ~931-967 — three sites, one field each, and the elim field is the exact template to mirror)
    packages/core/algorithms/sigma1/index.ts lines 330-390 (`leagueConsistencyFor` and `seedConsistencyFor`) and lines 1775-1875 (`carrySeason`'s resolve, gap guard, and the per-component loop — the ONE edit site is line 1847, `beliefs[name] = { mean: share, variance: coldStartVariance }`, with `oldTeamState` already in scope from line 1829 and lines 1848-1849 left alone)
    packages/core/algorithms/sigma1/params.test.ts lines 1-120 (the `match` / `rawBreakdown2024Uniform` fixture helpers) and lines 582-700 (the `elimSequence` / `elimObservables` / schema-default / inert / wired / gated test group — this task's test group mirrors its structure exactly)
    packages/core/algorithms/sigma1/scale.ts lines 85-150 (`Sigma1ResolvedParams`'s `Omit` list and `resolveSigma1Params` — confirm a dimensionless field passes through untouched)
  </read_first>
  <behavior>
    - Schema: an object omitting `carryVarianceFactor` parses and resolves to exactly `1`.
    - Schema: `0` is rejected (the domain is the OPEN-closed interval, `.positive()`); `-0.1` is rejected; `1.5` is rejected (`.max(1)`); `NaN` and `Infinity` are rejected; `0.05`, `0.3`, `0.75` and `1` are accepted.
    - Inertness: `DEFAULT_SIGMA1_PARAMS` and an explicit `carryVarianceFactor: 1` produce byte-identical prediction streams over a replay that CROSSES a season boundary.
    - Wiring: `carryVarianceFactor: 0.3` over that same cross-boundary replay produces a stream that differs from the default for at least one prediction.
    - Boundary gate: `carryVarianceFactor: 0.3` over a SINGLE-SEASON, no-boundary replay is byte-identical to the default — the gate is `carrySeason`, not the parameter's mere presence.
    - No-carried-state branch: a team that appears in the carry result but NOT in `state.teams` has every seeded belief variance bitwise equal to `coldStartVariance` at `carryVarianceFactor: 0.05`, i.e. bitwise equal to the factor-1 run.
    - ALL-COMPONENTS reach (the assertion this revision exists for): for a returning team at `carryVarianceFactor: 0.3`, EVERY modeled component of the incoming season has seeded variance equal to `max(minConsistencyVariance, itsColdStartVariance * 0.3)` — including at least one component whose NAME IS ABSENT from the outgoing season's component map, asserted by name. A regression that re-narrows the gate to per-component carried evidence turns this red on that name.
    - Pinned branch: `adjust` remains exactly `{ mean: 0, variance: 0 }` at every factor value tested.
    - Monotonicity: for a returning team's modeled component, seeded variance at factor 0.25 is strictly less than at 0.5, which is strictly less than at 1.
  </behavior>
  <action>
    Register the field in `params.ts` at its three sites, mirroring `elimObservationNoiseMultiplier`'s
    treatment exactly (that field is the established template for a dimensionless, schema-defaulted,
    provably-inert knob).

    Interface: add `readonly carryVarianceFactor: number;` with a doc comment that states, in this
    order: (i) what it is — a UNIFORM PER-TEAM multiplier on the cold-start belief-variance prior,
    applied ONLY in `carrySeason` and ONLY to a team that has carried state, and applied to EVERY
    modeled component of the incoming season without reference to that component's name; (ii) that
    `1` is exactly today's behaviour via an explicit branch, and that values below 1 seed a returning
    team with proportionally more confidence than a first-timer — the asymmetry the autopsy says VPR
    lacks; (iii) that it is DIMENSIONLESS (a unitless multiplier on a variance already in the right
    units) and therefore passes through `resolveSigma1Params` unchanged rather than being one of the
    five `*Rel` fields the `Omit` removes — name `elimObservationNoiseMultiplier` as the precedent;
    (iv) the MOTIVATION with BOTH Stage 1 measurements, citing quick task 260905-jyf — R1's
    name-matched seed improved early-slice accuracy on 2023 (0.7402 -> 0.7413) and 2025
    (0.7405 -> 0.7407), every season inside +/-0.4 SE, pooled Brier 0.1593 -> 0.1590, validating the
    DIRECTION; R2's uniform factor closed negative at -10.46 pooled SE-units at its own derived value
    of ~0.069, saying the DOSE was far too aggressive rather than that the shape was wrong;
    (v) why the reach condition is TEAM-level and not component-level — FRC component names are
    season-specific, so a per-component carried-evidence gate reaches only `foulsCommitted` at any
    real boundary, which is a knob not worth tuning; this field deliberately uses R2's team-level
    gate so it reaches every modeled component; (vi) that the VALUE is free and searchable and must
    never be re-derived from `reversionOverGap(carryMeanReversion, gap)` — that specific derivation
    is what measured negative.

    Default: `carryVarianceFactor: 1` in `DEFAULT_SIGMA1_PARAMS`, with a one-line comment saying
    exactly `1` is a full cold-start reset — today's behaviour — until the re-tune says otherwise.
    Do NOT derive it from an imported constant — unlike the reproduce-Phase-2 fields around it, this
    number is a deliberate inert default with no prior constant to drift from, and saying so in the
    comment is what keeps that file's derive-never-retype rule honest.

    Schema: `carryVarianceFactor: z.number().finite().positive().max(1).default(1)` with a comment
    noting that `.default(1)` is what lets every already-committed `vpr@8.0.0+*.json` file — none of
    which carries this key — still parse and resolve inert, the same argument the elim fields'
    defaults carry; that `.positive()` excludes `0`, which would seed a returning team at zero
    variance (perfect certainty after a layoff — the exact claim `seedConsistencyFor`'s floor exists
    to refuse); and that `.max(1)` is a real constraint rather than decoration — a factor above 1
    would mean trusting a returning team LESS than a first-timer, which is the opposite of the
    hypothesis this stage is testing and is not a question this knob is asking. Do NOT add an
    object-level `.check(...)` invariant — this field has no cross-parameter relationship.

    Then wire the single edit site in `index.ts`'s `carrySeason` per-component loop: line 1847,
    `beliefs[name] = { mean: share, variance: coldStartVariance }`. Leave the `coldStartVariance`
    computation on 1846, the `ADJUST_COMPONENT` early-continue above it, and BOTH accumulator lines
    below it (1848's `carriedObserved` and 1849's `consistency[name]`) completely untouched — the
    revised seed does not read carried consistency at all, so those two lines must be byte-identical
    in the diff. Do NOT hoist anything out of them.

    The seed itself: when `resolved.carryVarianceFactor === 1` OR `oldTeamState === undefined`, the
    variance is `coldStartVariance` unchanged — an EXPLICIT equality branch on the factor, which is
    the entire inertness proof and therefore the entire basis for Task 3's non-bump. Do not replace
    it with an algebraic form that merely happens to evaluate to the same number for factor 1.
    Otherwise the variance is
    `Math.max(resolved.minConsistencyVariance, coldStartVariance * resolved.carryVarianceFactor)`.
    `oldTeamState` is already in scope at line 1829 (`state.teams.get(team)`) — read it directly,
    and note in a comment that this is the TEAM-level gate and that narrowing it to
    `oldTeamState?.consistency[name] !== undefined` would silently re-collapse the knob's reach to
    `foulsCommitted` alone.

    One degenerate-input finding to CARRY FORWARD as a comment rather than as a branch, and to state
    honestly: `coldStartVariance` is NOT provably positive. It is
    `Math.max(params.minConsistencyVariance, leagueConsistencyFor(...))`, `minConsistencyVariance` is
    `minConsistencyVarianceRel * scoreVariance`, and `minConsistencyVarianceRel`'s schema entry is a
    bare `z.number().finite()` with no positivity constraint — so a hand-constructed parameter set can
    drive it to zero or below, even though no SEARCHED set can (that bound's `min` is 1e-4) and no
    promoted set does. Under the REVISED multiplicative form this can no longer produce `Infinity` or
    `NaN`, because there is no division — and when `coldStartVariance` is zero the expression collapses
    to `max(minConsistencyVariance, 0)`, which is `coldStartVariance` itself, so the degenerate case is
    self-neutralising and needs no guard. Record exactly that reasoning in a comment at the seed,
    including the `minConsistencyVarianceRel` non-positivity fact, so that anyone who later reintroduces
    a division-shaped (geometric) form knows the base is not safe to divide by and must add the
    `> 0` guard the multiplicative form made unnecessary.

    Finally add the test group to `params.test.ts`, after the elim group, following that group's
    structure. It needs two replay helpers and a state-level probe:
    a two-season helper that folds several 2024 matches with `rawBreakdown2024Uniform` breakdowns,
    calls `algorithm.carrySeason(state, { fromSeason: 2024, toSeason: 2025, isColdStart: false })`,
    then records predictions for upcoming 2025 matches; the existing single-season all-`qm`
    `swingingObservables` helper reused unchanged for the no-boundary control; and a probe that
    returns the post-`carrySeason` state so the seeded variances can be read per component by name.
    Three fixture requirements the assertions depend on, each of which will silently produce a false
    PASS if missed — state the reason for each in a comment beside the fixture:
    (a) the red and blue teams must accumulate DIFFERENT totals in 2024, because a zero predicted
    margin pins `pRedWin` at 0.5 regardless of variance under `predictive-variance` link mode, so a
    symmetric fixture cannot show the wiring effect;
    (b) the monotonicity assertion needs a component whose `coldStartVariance * 0.25` is still ABOVE
    `minConsistencyVariance`, or the floor binds and the three values tie instead of ordering;
    (c) the ALL-COMPONENTS reach assertion must name a component present in the 2025 component map
    and ABSENT from the 2024 one — that specific name is what distinguishes this design from the
    name-matched one it replaced, so assert on it by name rather than by iterating anonymously
    (iterate over every modeled component too, but keep the named assertion as the regression pin).
    For the no-carried-state branch, construct a team that reaches `carryResult.teamPointTotals`
    without being in `state.teams` — the `priorSeasonRatings` two-season carry (D-16/D-17) is the
    intended route. If that turns out to be unreachable in a test fixture, REPORT it as a finding and
    pin the branch by constructing the state directly with that team omitted from `teams`; do not
    delete the case.
    Cover every case in `<behavior>` above; prefer the state-level probe for monotonicity, the
    no-carried-state branch, the all-components reach and the `adjust` assertions, and the
    stream-level helpers for inertness, wiring and the boundary gate.
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
    <automated>npx vitest run packages/core/algorithms/sigma1/params.test.ts packages/core/algorithms/sigma1/sigma1.test.ts packages/core/algorithms/sigma1/scale.test.ts</automated>
  </verify>
  <done>`npx tsc --noEmit` is clean. Every behavior above has a passing test. The factor-1 stream across a season boundary is byte-identical to the default; the factor-0.3 stream differs; the single-season factor-0.3 control is byte-identical. The all-components reach test names a 2025-only component explicitly and passes, and lines 1848-1849 are byte-identical in the diff. `sigma1.test.ts` passes unmodified, or — if a hand-built `Sigma1Params` literal there needs the new required field — with only that mechanical addition (a Rule 3 blocking fix, recorded as a deviation).</done>
</task>

<task type="auto">
  <name>Task 2: Register the search bound, teach screenGridFor about an at-bound default, move the pinned counts</name>
  <files>packages/harness/searchSpace.ts, packages/harness/searchSpace.test.ts</files>
  <read_first>
    packages/harness/searchSpace.ts lines 95-300 (the `SIGMA1_SEARCH_SPACE` entries with their per-bound justification comments, the removed-bound notes for `shrinkagePriorMatches` and `elimObservationNoiseMultiplier` that establish the recording convention, and `screenGridFor`'s doc comment plus its interior-slot overwrite loop)
    packages/harness/searchSpace.test.ts lines 78-200 (the pinned-count test with its running comment block, the default-inside-bound test, and the two `screenGridFor` grid tests that assert strict monotonicity and default containment)
    packages/harness/tune.ts — grep for `screenGridFor` and read each call site, to confirm no consumer assumes the default lands at an INTERIOR grid index
  </read_first>
  <action>
    Add `carryVarianceFactor: { min: 0.05, max: 1, scale: "log" }` to `SIGMA1_SEARCH_SPACE`,
    placed to keep the object readable next to the other carry knobs, with a bound comment in the
    file's established style — stating which end is meaningful and why, not just the numbers. The
    comment MUST cite BOTH of quick task 260905-jyf's results, because each fixes one end:

    - `max: 1` is exactly today's full cold-start reset AND the default, so the search can always
      decline the mechanism outright. Say plainly that a keep-incumbent verdict is a genuinely
      plausible outcome here and would NOT be a defect: R2 — a uniform per-team factor of this same
      shape, at a derived value of ~0.069 — closed NEGATIVE at -10.46 pooled SE-units with three
      seasons breaching the -2.0 SE floor, so the only positive evidence for the mechanism is R1's
      win, which reached only `foulsCommitted` and was worth a few hundredths of a point.
    - `min: 0.05` is set deliberately just BELOW R2's derived ~0.069 so the search can walk back into
      the region that already measured negative rather than being fenced away from it — a search that
      reaches that region and still prefers 1 is informative, not wasted.
    - The TARGET is the moderate region roughly 0.2-0.8, which NOTHING has tested: R2 probed ~0.069
      (too aggressive) and today's code sits at 1 (no retention at all). This bound is what exposes
      that gap to measurement.

    `log` rather than `linear` because the parameter is a multiplicative magnitude spanning a 20x
    range, and a 2x change down at 0.05-0.1 is as meaningful a change in retained uncertainty as
    0.5 -> 1.0 is — which a log grid encodes and a linear one does not. `log` is also representable
    here precisely because the schema's `.positive()` keeps `0` out of the domain.

    Then handle the at-bound default in `screenGridFor`. Its interior-slot overwrite exists so a
    parameter cannot dodge evaluation at its own default; when the default already EQUALS `min` or
    `max`, the grid contains it exactly (both endpoints are pinned to the declared bounds two lines
    earlier), so the overwrite has nothing to buy and instead writes a duplicate into an interior
    slot — destroying the strict monotonicity `searchSpace.test.ts` asserts and handing the screen
    two identical grid points. Return the grid before the overwrite loop in that case, with a
    comment giving that reasoning and naming `carryVarianceFactor` as the first parameter to hit it.
    Write the guard against BOTH endpoints, not just `max` — the reasoning is symmetric and a future
    at-`min` default must not silently reintroduce the defect. Update the function's own doc comment,
    which currently claims every parameter in `SIGMA1_SEARCH_SPACE` has an interior default — that
    sentence is now false and its `valueCount >= 3` justification needs restating: three points still
    hold both endpoints and one interior slot, which is what the minimum is actually for. Verify from
    the `tune.ts` call sites that nothing downstream assumes an interior default index; if something
    does, that is a finding to report, not a thing to work around silently.

    Move the three pinned literals in `searchSpace.test.ts` to 16 searchable / 14 exclusions / 30
    param keys, and append this task's entry to that test's running comment block in the same voice
    as the entries above it: 29 -> 30 fields and 15 -> 16 searchable, exclusions unchanged at 14,
    naming the new key as `carryVarianceFactor`, because the one new field is a numeric knob the
    accuracy-primary objective can see directly — it scales a seeded belief variance, hence the
    predictive variance, hence `pRedWin`. Note that it is the first searchable parameter whose
    default sits at a bound (the `max` end) rather than interior, and that `screenGridFor` now
    handles that explicitly.
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
    <automated>npx vitest run packages/harness/searchSpace.test.ts packages/harness/promoteOverride.test.ts packages/harness/promotedOverrides.test.ts packages/harness/legacyParams.test.ts</automated>
  </verify>
  <done>The partition test, the pinned-count test at 16/14/30, the default-inside-bound test, and both `screenGridFor` grid tests (strict monotonicity at `valueCount` 5 and 3, default contained in both) pass with `carryVarianceFactor` in the searchable set. `promoteOverride.test.ts`'s pinned boolean-key list is UNCHANGED — the new field is numeric — and passes. `legacyParams.test.ts` passes: its migrations construct through `Sigma1ParamsSchema.parse`, so the schema default fills the new field with no migration edit.</done>
</task>

<task type="auto">
  <name>Task 3: Record the non-bump, confirm nothing else moved, and run the repo-wide gates</name>
  <files>packages/core/algorithms/sigma1/params.ts</files>
  <precondition>`data/corpus.sqlite` exists in the repo root, so `digest.test.ts` runs on the corpus-backed path rather than its skip path. If it is absent, halt and report — the non-bump has no evidence without it.</precondition>
  <read_first>
    packages/core/algorithms/sigma1/params.ts lines 355-411 (the `NOT BUMPED at ELIM-R/ELIM-OFF` D-3 entry — the exact structure this task's entry mirrors: apply the two triggers by name, show neither fires, name the instrument that proves it, and state what WOULD earn a bump later)
  </read_first>
  <action>
    Append a NON-BUMP entry to `SIGMA1_CODE_VERSION`'s version-history block, immediately after the
    ELIM-R/ELIM-OFF entry and before the `export const` line, following that entry's structure
    rather than inventing a new one. It must apply this file's own two bump triggers by name and
    show that neither fires: (a) the parameter SHAPE changed such that `z.strictObject` makes an old
    file unparseable — does not fire, because the one new field carries `.default(1)`, so every
    already-committed `vpr@8.0.0+*.json` file, none of which carries the key, still parses and
    resolves inert; (b) the observable OUTPUT changed — does not fire, because the seed path takes
    an explicit `carryVarianceFactor === 1` equality branch at the default and returns
    `coldStartVariance` bitwise unchanged,
    with `params.test.ts`'s byte-identical cross-boundary stream as the assertion. Name the evidence
    as evidence rather than assertion: `digest.test.ts` reproducing all four committed
    `vpr@8.0.0+*.json` prediction-stream digests and headline metrics bitwise under the new code,
    the same instrument every prior bump used to justify bumping, here used to justify not bumping.
    Record that `STATE_SNAPSHOT_SHAPE_VERSION` deliberately stays at 8 — this task adds no
    `Sigma1State` field, it only tests for the presence of a team state that already exists, so there
    is no stale-row deserialization hazard and no live-Worker re-seed is owed. Close with the standard
    forward clause: the moment a promoted parameter set carries a `carryVarianceFactor` below `1`,
    that promotion IS a real model change, trigger (b) fires, and it earns its own
    `SIGMA1_CODE_VERSION` bump under this block's normal rules — this task only REGISTERS the knob.

    Then confirm, don't assume, that nothing else needs to move: check that `stateSnapshot.ts` does
    not serialize any `Sigma1Params`-derived value that would now be missing, and that
    `git diff --stat` across all three commits touches only the five files in `files_modified` plus
    any Rule-3 blocking fixes — in particular that `data/algorithm-versions/`,
    `packages/core/algorithms/sigma1/fixtures/`, `reports/` and `docs/` are untouched.

    Run the gates from the REPO ROOT, never from `apps/web` (the root scope is ~167 test files, the
    `apps/web` scope is ~77, and an 8-day red CI has hidden in that gap before). Judge every run by
    its printed summary line, never by the exit code.
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
    <automated>npx vitest run packages/harness/digest.test.ts</automated>
    <automated>npx vitest run</automated>
  </verify>
  <done>`npx tsc --noEmit` is clean. `digest.test.ts` runs corpus-backed — confirmed from real per-test durations in the hundreds of milliseconds rather than the near-instant skip path — and all four committed `vpr@8.0.0+*.json` files reproduce their prediction-stream digests and headline metrics bitwise, with no version file and no digest edited. The full repo-root `npx vitest run` is green, read from its summary line. `SIGMA1_CODE_VERSION` is still `8.0.0`, `STATE_SNAPSHOT_SHAPE_VERSION` is still `8`, and the non-bump is recorded in `params.ts` with its reasoning. `git diff --stat` shows only the planned files.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| committed `data/algorithm-versions/*.json` -> `Sigma1ParamsSchema` | Four already-shipped files are re-parsed by a schema this task changes. |
| tuner artifact (`reports/*.json`) -> `screenGridFor` | `tune.ts`'s `loadSurvivors` reads parameter names as raw STRINGS out of a JSON artifact, bypassing the type system. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-kjb-01 | Tampering | `Sigma1ParamsSchema` vs the four committed version files | high | mitigate | Zod `.default(1)` on the new field; `digest.test.ts` re-parses and bitwise-reproduces every committed file as Task 3's acceptance gate. |
| T-kjb-02 | Tampering | `carrySeason`'s belief-variance seed | high | mitigate | An explicit `=== 1` equality branch, verified by a byte-identical cross-boundary prediction stream, so the default path cannot drift into an approximate reproduction of today's behaviour. |
| T-kjb-03 | Denial of Service | `screenGridFor` with an at-bound default (now the `max` end) | medium | mitigate | Endpoint guard before the interior-slot overwrite, written against both endpoints, covered by the existing strict-monotonicity grid tests at `valueCount` 5 and 3. |
| T-kjb-04 | Tampering | `coldStartVariance` reaching zero on a hand-constructed parameter set | low | accept | `minConsistencyVarianceRel`'s schema entry is a bare `z.number().finite()`, so the base is not provably positive. The revised MULTIPLICATIVE seed has no division, so no `Infinity`/`NaN` can reach a belief, and at a zero base the expression collapses to `coldStartVariance` itself. Accepted with the non-positivity fact recorded in-code at the seed, so a future geometric reformulation cannot silently reintroduce the division hazard. |
| T-kjb-05 | Information Disclosure | new field, tests, and search bound | low | accept | No secrets, no I/O, no network, no new dependency, and no package-manager install — so no legitimacy gate applies. |
</threat_model>

<verification>
1. `npx tsc --noEmit` from the repo root is clean.
2. `npx vitest run` from the repo ROOT (~167-file scope, not the ~77-file `apps/web` scope) is
   green, judged by the printed summary line.
3. `digest.test.ts` runs corpus-backed and reproduces all four committed `vpr@8.0.0+*.json`
   digests bitwise — the load-bearing proof of the non-bump.
4. The mechanism is proven INERT at the default `1` by a byte-identical cross-boundary prediction
   stream, and proven WIRED at factor 0.3 by a stream that differs — with a single-season control
   at factor 0.3 proving the gate is the season boundary rather than the parameter's presence.
5. The mechanism's reach is pinned as ALL modeled components of the incoming season, including at
   least one component named in the to-season map and absent from the from-season map.
6. `git diff --stat` touches only the five files in `files_modified` plus any recorded Rule-3
   blocking fixes. `data/algorithm-versions/`, `packages/core/algorithms/sigma1/fixtures/`,
   `reports/` and `docs/` are untouched.
</verification>

<success_criteria>
- One new parameter, `carryVarianceFactor`, exists, defaults to exactly 1, is schema-defaulted over
  the domain (0, 1], and is correctly partitioned into the search space with real recorded
  justification for its bound citing BOTH Stage 1 results.
- The season-boundary belief-variance seed scales the cold-start prior by a UNIFORM per-team factor,
  floored at `minConsistencyVariance`, for every modeled component of a returning team.
- The default path is bitwise today's behaviour, by an explicit `=== 1` branch, proven on a stream.
- The no-carried-state branch and the pinned `adjust` branch are untouched at every factor value,
  and `carrySeason`'s consistency accumulator lines are byte-identical in the diff.
- `SIGMA1_CODE_VERSION` stays 8.0.0, `STATE_SNAPSHOT_SHAPE_VERSION` stays 8, and the non-bump is
  recorded with its reasoning.
- No version file, digest, fixture, report or published artifact is regenerated or edited.
- No tuning run, screen, backtest, promotion, publish or network call is performed.
</success_criteria>

<output>
Do NOT write `260905-kjb-SUMMARY.md` yourself — the `Write` tool is blocked on SUMMARY files for
subagents, and routing around it via Bash is not acceptable. Return the full summary text in your
final message for the orchestrator to write, and do not commit anything under `.planning/`.

Commit code atomically per task with `feat(quick-260905-kjb): ...` messages.

The returned summary must carry forward, for the developer:
- The follow-ups this task deliberately does NOT do, which run from the MAIN context because
  executor subagents have no network: a fresh sensitivity screen including `carryVarianceFactor`,
  the joint re-tune per origin against the live `vpr@8.0.0+rolling-2026-09b` incumbent, and any
  promotion — noting that promoting a factor below 1 is a real model change that earns a
  `SIGMA1_CODE_VERSION` bump.
- The REACH, stated plainly and as the reason this plan was revised mid-flight: the knob is gated on
  the team having carried state, NOT on a per-component name match, so it moves EVERY modeled
  component's seeded variance for a returning team. The name-matched alternative (Stage 1's R1 shape)
  was measured during planning to reach only `foulsCommitted` and was rejected for that reason.
  Whoever reads the tune result needs to know which of the two shapes was actually tuned.
- The PRIOR EVIDENCE is split and points both ways: R1's win validated the direction but was worth
  only a few hundredths of a point, and R2 — this same uniform-factor shape at a derived ~0.069 —
  closed negative at -10.46 pooled SE-units. A keep-incumbent verdict (factor stays at 1) from the
  joint search is therefore a plausible outcome and would NOT be a defect in this implementation.
  The untested region this task exists to expose is roughly 0.2-0.8.
</output>
