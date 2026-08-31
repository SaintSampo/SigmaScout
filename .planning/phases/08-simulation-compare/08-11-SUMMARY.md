---
phase: 08-simulation-compare
plan: 11
subsystem: ui
tags: [react, simulation, monte-carlo, rank-distribution, event-page]

requires:
  - phase: 08-simulation-compare
    plan: "03"
    provides: "packages/core/algorithms/simulation/rankSimulation.ts — SimMatchInput/SimTeamBaseline interfaces, imported type-only, never called from this plan"
  - phase: 08-simulation-compare
    plan: "08"
    provides: "apps/web/src/lib/rewindGap.ts — REWIND_GAP_PERCENT/REWIND_GAP_VERDICT, the measured figure and verdict the caption renders"
  - phase: 08-simulation-compare
    plan: "09"
    provides: "apps/web/src/components/event/SimulationTab.tsx — the three-state panel shell and its layout stack's first mount position"
provides:
  - "apps/web/src/lib/simulationInputs.ts — buildSimulationInputs, the pure assembly layer between a parsed event artifact and 08-03's simulateRanks: D-13's at-or-after row selection, D-12's earned-RP precedence with its unit conversion and null contract, the A2 unknown-team fallback"
  - "apps/web/src/components/event/StartMatchPicker.tsx — the chronological, bounded-height start-match picker; the verdict-branching rewindCaptionText builder; the minted simulationScopeText disclosure line"
  - "SimulationTab.tsx now holds the selected start matchKey, mounts StartMatchPicker in the layout stack's first position, and renders the rewind-honesty caption immediately on a rewind selection"
  - "--sim-picker-selected-bg theme token (one additive color-mix derivation of --color-accent)"
affects: ["08-13 (RunControl reads SIMULATION_DRAWS and the reserved disabled prop)", "08-14 (rank table consumes SimulationInputs.baselines)", "08-15 (S1 overflow target corrected to 2022oncmp)"]

actuals:
  tokens: 19372
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "One shared ordering source (buildQualRows, wrapping mergeEventMatches) consumed by both the picker's rendered rows and the input-assembly slice, so a picker displaying one order can never simulate a different set of matches than the one shown"
    - "Selection held by matchKey and resolved against the CURRENT rows on every render (PD-06) rather than cleared on a miss — a transient refetch cannot permanently discard a reader's choice"
    - "A pure text-builder function (rewindCaptionText) that branches on an imported verdict enum rather than the sign of a number, so a caption can never assert a direction its own measurement did not produce"

key-files:
  created:
    - apps/web/src/lib/simulationInputs.ts
    - apps/web/src/lib/simulationInputs.test.ts
    - apps/web/src/components/event/StartMatchPicker.tsx
    - apps/web/src/components/event/StartMatchPicker.test.tsx
  modified:
    - apps/web/src/components/event/SimulationTab.tsx
    - apps/web/src/components/event/SimulationTab.test.tsx
    - apps/web/src/styles/theme.css

key-decisions:
  - "PD-01 applied: D-12 rule 1 (TBA's Ranking Score) is scoped to 'no played qualification row lies at or after the start' — not literal presence of rp — since applying it unconditionally would double-count RP the simulation is simultaneously re-drawing"
  - "PD-02/PD-03 applied: the rule-1 denominator is TBA's own record (wins+losses+ties) when present, else the counted prefix-appearance count; the product is rounded to the nearest integer exactly once (grep-verified: Math.round appears exactly 1 time in simulationInputs.ts)"
  - "PD-04 applied: a null actual RP is excluded from both the sum and the count, never coerced to zero; the team key lands in incompleteBaselineTeamKeys"
  - "PD-05 applied: a remaining row with no usable pmf pair is excluded and counted, never given a fabricated distribution"
  - "PD-06/PD-07/PD-08/PD-09 applied exactly as specified: matchKey-held selection resolved against current rows every render; default computed once in a lazy state initializer; isRewindStart is 'any played row at or after the start,' not the selected row's own played flag; disabled is named for its effect (inert), not its one known cause"
  - "The excluded-match and incomplete-baseline-team disclosure sentences in simulationScopeText are shipped as the plan's literal 'match(es)'/'team(s) have' template strings, since only the base sentence's singular/plural handling was explicitly required"

patterns-established:
  - "A caller assembling 08-03's SimTeamBaseline from a per-match average MUST document (and this plan is the one place that pays) the average-to-total unit conversion with an assertion distinguishing the converted value from the raw average — the exact 58-vs-4.83 shape this plan's tests enforce"

requirements-completed: [EVNT-07]

coverage:
  - id: D1
    description: "buildSimulationInputs converts TBA's Ranking Score to an integer earned-RP TOTAL before it crosses 08-03's boundary — verified both against hand-built adversarial fixtures (58 for rp=4.83/record=10-2-0) and against real published bytes (frc5902 at 2023nhgrs: rp=1.12, record=3-5-0 -> earnedRpSum=9, matchesPlayed=8)"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/lib/simulationInputs.test.ts — 29 tests, every D-12 rule branch named by rule number"
        status: pass
      - kind: other
        ref: "node fetch of v1/event/2023nhgrs/vpr@2.1.0+tuned-2026-08.json via tsx — printed and recorded in this SUMMARY"
        status: pass
    human_judgment: false
  - id: D2
    description: "A null actual-RP value is excluded from both a team's sum and its count, never coerced to zero, and its key lands in incompleteBaselineTeamKeys"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/lib/simulationInputs.test.ts#'a team whose prefix rows carry actual RP of 3, null and 5 yields earnedRpSum 8 and matchesPlayed 2, average 4'"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every qualification row at or after the start passes through with no offseason/surrogate/quarantine flag read anywhere in code; a row with no pmf pair is excluded and counted, never fabricated"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/lib/simulationInputs.test.ts — PD-05 describe block, 4 tests"
        status: pass
      - kind: other
        ref: "grep -vE '^[[:space:]]*(\\*|//|/\\*)' apps/web/src/lib/simulationInputs.ts | grep -cEi 'surrogate|offseason|quarantin' -> 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "The start-match picker renders a chronological, terse, bounded-height (320px) list with Played/Upcoming status, the em-dash convention for a missing sortTime, click-to-select, and PD-09's inert-while-disabled treatment"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/StartMatchPicker.test.tsx — 26 tests, including the 134-row 2022oncmp bounded-panel render"
        status: pass
    human_judgment: false
  - id: D5
    description: "The rewind-honesty caption renders the moment a rewind start is selected, before Run, carrying 08-08's measured figure and verdict, never a placeholder, never an unearned direction"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/StartMatchPicker.test.tsx — rewindCaptionText describe blocks (all three verdicts, magnitude-absolute, no-placeholder)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/event/SimulationTab.test.tsx#'selecting a played row shows the caption immediately'"
        status: pass
    human_judgment: false
  - id: D6
    description: "The picker mounts in the layout stack's first position, defaults to the first genuinely-unplayed match where one exists, holds selection by matchKey resolved against current rows every render, and no Web Worker is constructed anywhere in this plan"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/components/event/SimulationTab.test.tsx — 12 new Task-3 tests plus a whole-file global-Worker-constructor spy asserting zero calls"
        status: pass
      - kind: other
        ref: "npx vitest run apps/web/src -> 987/987 passing (920 baseline + 67 new), 0 failing"
        status: pass
    human_judgment: false

duration: ~90min
completed: 2026-08-31
status: complete
---

# Phase 8 Plan 11: Start-match picker, simulation input assembly, and the rewind-honesty caption Summary

**A chronological start-match picker (`StartMatchPicker.tsx`) and a pure input-assembly module (`simulationInputs.ts`) resolve D-12's already-earned-RP precedence and D-13's at-or-after match selection, and the panel now shows 08-08's measured rewind-overconfidence caption (10.8% narrower, verdict `narrower`) the moment a played start match is chosen.**

## Baseline Capture (recorded before Task 1)

1. **08-09's exported surface, as found.** `SimulationTab.tsx` exported `SimulationTab`, `SimulationTabProps`, `SimulationTabSkeleton`, `hasSimulatableRankInputs`, `SIMULATION_PRE_RUN_BODY`, `SIMULATION_STACK_TESTID`, `SIMULATION_PRE_RUN_TESTID` — all present exactly as the plan expected. The three-branch order (empty / unavailable / layout stack) and the two commented mount positions (picker, run control) were present and unrestructured; this plan filled the first position only, exactly as instructed.
2. **08-08's measured figure, verbatim.** `REWIND_GAP_PERCENT = 10.848394210456348`, `REWIND_GAP_VERDICT = "narrower"` (clears its own 0.619% mean noise floor by ~17x). The caption branch that **actually ships is `narrower`** — see below.
3. **08-05's republish ledger, two lines (quoted from 08-09-SUMMARY.md's own baseline capture):**
   - D-12 fallback: `2024auwarp` — 47 played `qm` rows, `actualRedRp`/`actualBlueRp` present (key-count 47, zero nulls) on all of them, **zero teams carrying `rp`**.
   - Per-season `playedActualRpNullCount` (from 08-05-SUMMARY.md's Republish ledger table): every **RP-eligible** event shows `0` (2024casf, 2022ilpe, 2023cur, 2023nhgrs, 2024new, 2025flta, 2026vache). Three **offseason** (RP-INeligible) events show nonzero nulls: `2023cnsh` 58, `2024vabrb` 16, `2025isios` 43. Since D-12's fallback only fires when Ranking Score is absent — the offseason population — the null rate is real but concentrated exactly where the RP model already does not run; on every event this plan's picker is reachable on (RP-eligible), the null rate measured to date is 0. PD-04's null-exclusion branch is defence for a state the corpus does not currently contain on a reachable event, not dead code — a future season could still produce one.
4. **Pre-edit failing-test-name set.** `npx vitest run apps/web/src` → **62 test files passed (62), 920 tests passed (920)**. The failing-test-name set is EMPTY.
5. **`--sim-` grep, before this plan.** `--sim-hist-bar`, `--sim-band-overlay`, `--sim-median-tick` (08-04's block). This plan appended a fourth entry, `--sim-picker-selected-bg`, in the same block.
6. **The four published fields, confirmed live** against `v1/event/2023nhgrs/vpr@2.1.0+tuned-2026-08.json`: `playedQm: 52`, `bothPmfOnPlayed: 52`, `actualRpKeyCount: 52`, `nullCount: 0` — every played qualification row carries both pmfs and both actual-RP keys, none null.

## Which caption branch actually shipped

**`narrower`** — the measured verdict. `StartMatchPicker.test.tsx` exercises all three branches (`narrower`, `wider`, `indistinguishable`); the `wider` and `indistinguishable` branches remain fully tested and unshipped, ready if a future re-measurement lands differently.

## The three real-artifact checks, with their numbers

**`2023nhgrs`** (the precedence-1 path and the default-selection rule), via `buildQualRows`/`buildSimulationInputs` run directly under `tsx`:
- Qualification row count: **78** (52 played, 26 unplayed).
- Default start key: **`2023nhgrs_qm53`**.
- `isRewindStart` at the default: **`false`**.
- `remainingMatches.length`: **26**. `excludedMatchKeys.length`: **0**.
- `frc5902` baseline: **`earnedRpSum: 9, matchesPlayed: 8`**, source `ranking-score-with-record`, against a published `rp` of 1.12 and record 3-5-0 (`round(1.12 * 8) = 9`, and `9/8 = 1.125`, within 0.005 of 1.12).
- Starting at the FIRST qualification row: `remainingMatches.length` **78**, every baseline **0/0**.

**Rule-1 vs. rule-2 comparison at `2023nhgrs`'s default start (the one point where the two answer the same question):** all **39/39 teams show a diff of exactly 0** (min 0, max 0, mean 0). At this event's default start point, TBA's Ranking Score and the summed per-match actual RP agree perfectly for every team — the default start point is, by construction, the boundary right after the last played match, so the prefix rule-2 sums over exactly the same matches TBA's own Ranking Score was computed from. No systematic disagreement to report at this event.

**`2024auwarp`** (D-12's rule-2 whole-event data state): played `qm` count **47**, teams carrying `rp` **0**, `qm` rows carrying both pmfs **0** — exactly matching 08-05's ledger. Default start key: **`null`** (no unplayed qualification row — the event is fully played). Since `hasSimulatableRankInputs` is also false here (zero pmfs anywhere), **08-09's unavailable state is what a reader actually sees on this event; the picker never mounts.** This object proves D-12's rule-2 fallback DATA state exists in production, not that the tab runs on it.

**`2022oncmp`** (the corrected S1 overflow target — see flagged assumption below): **134 played qualification rows, 0 unplayed, 67 teams**, all 134 rows carry both pmfs. Default start key: **`null`** (fully played — no picker pre-selection). As a supplementary scenario (since the default resolves to nothing), starting at the LAST row (`2022oncmp_qm134`, a genuine rewind since that row is itself played): `isRewindStart: true`, `remainingMatches.length: 1`, `excludedMatchKeys.length: 0`, `incompleteBaselineTeamKeys.length: 0`. The highest-`rp` team, `frc2056` (`rp: 3.83`, record 12-0-0), gets baseline `earnedRpSum: 46, matchesPlayed: 12` via the `summed-actual-rp` path (rule 2, since the start is a rewind) — `46/12 = 3.8333`, matching the rule-1 product `round(3.83 * 12) = 46` exactly, another point of full agreement between the two arithmetic paths.

## Minted copy strings (flagged planner assumption 3)

Not present in `08-UI-SPEC.md`'s Copywriting Contract, fixed here for a future `ui-phase` pass to adopt:

- `simulationScopeText`'s base sentence: `Simulating {count} qualification match(es) from {label} onward, {draws} draws.` (with correct singular/plural for the match count).
- The excluded-match clause: `{n} further qualification match(es) carry no predicted ranking-point distribution and are not simulated.`
- The incomplete-baseline clause: `{m} team(s) have an earlier match with no recorded ranking points, so their starting totals are incomplete.`
- `rewindCaptionText`'s `wider` second sentence: ` Rank spreads here run about {X}% wider than a true from-here forecast.`
- `rewindCaptionText`'s `indistinguishable` second sentence: ` The measured difference in rank spread was inside the measurement's own noise, so this measurement can't say how much that changes the rank spread here.`

Also flagged: the shipped `START_MATCH_PICKER_HINT` says "matches after it" verbatim (the Copywriting Contract's own text) while D-13 actually simulates the chosen match and everything after it — shipped unchanged per the plan's explicit instruction, since silently deviating from an approved copy row would be worse than this small imprecision in a pre-selection hint.

## Post-edit failing-test-name set, compared to baseline

`npx vitest run apps/web/src` after all edits: **64 test files passed (64), 987 tests passed (987)**. The failing-test-name set is still **EMPTY** — identical to the baseline's empty set. 67 new tests were added (29 in `simulationInputs.test.ts`, 26 in `StartMatchPicker.test.tsx`, 12 in `SimulationTab.test.tsx`); no pre-existing test name changed status. The one 08-09 assertion whose CONTENTS moved (not its pass/fail status): `"the layout stack testid is present and the pre-run paragraph is its descendant"` now renders alongside a picker above the paragraph, but its own assertions (stack contains pre-run testid) were untouched and still pass unmodified — no existing assertion body needed editing.

## The `theme.css` diff

```diff
+  /*
+   * Start-match picker's selected-row background (08-11, UI-SPEC's Color
+   * section: an accent-tinted background for the selected row). A
+   * purpose-specific `color-mix` derivation of `--color-accent`, not a new
+   * hue — CONTEXT forbids any `--color-*`, `--accent`, `--alliance-*` or
+   * `--tier-*` VALUE change this phase (08-04's precedent for this exact
+   * situation). The selected row's left border uses `--color-accent`
+   * directly and needs no token of its own.
+   */
+  --sim-picker-selected-bg: color-mix(in srgb, var(--color-accent) 8%, transparent);
```

Exactly one added custom property, zero changed values. Confirmed to survive the Lightning CSS build: `pnpm --filter web build`'s output CSS carries the token three times — the `:root` `color-mix` declaration, its pre-computed `@supports`-gated hex fallback, and the `.bg-\[var\(--sim-picker-selected-bg\)\]` utility class Tailwind generated from `StartMatchPicker.tsx`'s own consumption.

## Performance

- **Duration:** ~90 min
- **Tasks:** 3 (all `type="auto" tdd="true"`)
- **Files created:** 4 (`simulationInputs.ts`, `simulationInputs.test.ts`, `StartMatchPicker.tsx`, `StartMatchPicker.test.tsx`)
- **Files modified:** 3 (`SimulationTab.tsx`, `SimulationTab.test.tsx`, `theme.css`)

## Task Commits

1. **Task 1 (RED): `simulationInputs.test.ts`** — `2bb0e1c1` (test)
2. **Task 1 (GREEN): `simulationInputs.ts`** — `9bf62879` (feat)
3. **Task 2 (RED): `StartMatchPicker.test.tsx`** — `a66d3ee7` (test)
4. **Task 2 (GREEN): `StartMatchPicker.tsx` + `theme.css`** — `e3bb78ac` (feat)
5. **Task 3 (RED): `SimulationTab.test.tsx` extension** — `08c7d559` (test)
6. **Task 3 (GREEN): `SimulationTab.tsx` mount** — `8740bade` (feat)

## Files Created/Modified

- `apps/web/src/lib/simulationInputs.ts` — `buildSimulationInputs`, `buildQualRows`, `findStartIndex`, `isRewindStart`, `defaultStartMatchKey`, `SIMULATION_DRAWS`, `BaselineSource`, `SimulationInputs`
- `apps/web/src/lib/simulationInputs.test.ts` — 29 tests over every D-12 branch, D-13's boundary, the null contract, A2, and the no-mutation guard
- `apps/web/src/components/event/StartMatchPicker.tsx` — the picker component, `rewindCaptionText`, `simulationScopeText`, the copy-constant contract
- `apps/web/src/components/event/StartMatchPicker.test.tsx` — 26 tests over row anatomy, selection/inert behaviour, the disclosure line, all three caption verdicts, and the 134-row bounded panel
- `apps/web/src/components/event/SimulationTab.tsx` — mounts `StartMatchPicker` and the rewind caption; adds the selected-`matchKey` state
- `apps/web/src/components/event/SimulationTab.test.tsx` — 12 new tests plus a whole-file global-`Worker`-constructor spy
- `apps/web/src/styles/theme.css` — one added token, `--sim-picker-selected-bg`

## Decisions Made

See `key-decisions` in frontmatter — every `PD-01` through `PD-11` was applied exactly as the plan specified; no substantive deviation from the planner's decisions was needed. The one interpretive call made at implementation time (not flagged as a planner assumption, since it followed directly from the plan's own literal wording): `simulationScopeText`'s excluded-match and incomplete-baseline-team sentences ship the plan's literal `match(es)`/`team(s) have` template strings rather than resolving singular/plural grammatically — the plan's `<action>` explicitly required grammatical singular/plural handling only for the BASE sentence ("with correct singular and plural forms for a one-match scope"), and said nothing about the two appended disclosure sentences.

## Deviations from Plan

None — plan executed exactly as written. Every `must_haves.truths`, both prohibitions, and the full `<verification>` block are satisfied as tested and as run against real published bytes.

## Issues Encountered

One in-flight correction during Task 2's first draft, caught before commit: the plan's action text named "the vertical overscroll-containment utility"; the first draft used Tailwind's `overscroll-contain` (both axes) before being corrected to `overscroll-y-contain` (vertical only) to match the plan's literal instruction. No behavioural regression — caught during review of the plan text against the draft, before the RED/GREEN commit split.

## User Setup Required

None — no external service configuration required. No `.env` was read, printed, copied or interpolated at any point in this plan's execution; every real-artifact check was an unauthenticated GET against the public artifact origin (`https://data.sigmascout.org`).

## Next Phase Readiness

- **Routed to 08-13:** `SIMULATION_DRAWS` is exported from `simulationInputs.ts` and should be imported rather than retyped for the run control's live counter and completion summary. `StartMatchPickerProps.disabled` is the reserved seat for freezing the picker mid-run (currently passed `false` with a comment naming 08-13 as the wiring plan). The selected `matchKey` and the assembled `SimulationInputs` both already live in `SimulationTab`'s state for the Run handler to read.
- **Routed to 08-14:** `SimulationInputs.baselines` is what `simulateRanks` consumes. `excludedMatchKeys`/`incompleteBaselineTeamKeys` are already disclosed on the picker's scope line, so the rank table need not repeat them.
- **Routed to 08-15:** the measured correction that `2024wvrox` is offseason (TBA event type 99) and publishes no distributions at all — unreachable through the UI, since 08-09's unavailable state renders there instead of a picker. `2022oncmp` (134 played qualification rows, confirmed live) is the real S1 overflow target; `2023cur` (78 teams, 130 quals, per 08-05's ledger) is the real S3 target. This plan ships the bounded panel STRUCTURE (134-row render assertion, confirmed scroll-container classes) but not the real touch-interaction evidence — that remains 08-15's job.
- **Routed to a future `ui-phase` pass:** the three minted copy strings (the scope-line base sentence and its two disclosure clauses, and the two un-contracted rewind-caption verdict sentences), the picker hint's "after it" vs. D-13's "at or after" imprecision, and EVNT-07's still-`unclassified` probe row (unresolved — deliberately absent from `must_haves` in every form, per the spec-less probe fallback's never-auto-dismiss rule).
- **Explicit confirmations:** no published field, schema, R2 object, `ROUNDING_RULE` entry, npm dependency, shadcn block or existing theme-token VALUE was changed. No Web Worker was constructed anywhere in this plan (grep-verified on every new/edited file, plus a whole-suite global-`Worker`-constructor spy in `SimulationTab.test.tsx` recording zero calls). `simulateRanks` was never called. `.env` was never read, printed, copied or interpolated.

---
*Phase: 08-simulation-compare*
*Completed: 2026-08-31*

## Self-Check: PASSED
