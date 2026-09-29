---
phase: 08-simulation-compare
plan: 10
subsystem: ui
tags: [react, recharts, vitest, testing-library, dataviz, tailwind-v4]

requires:
  - phase: 08-simulation-compare
    provides: "08-01's five-artifact fetch/D-10 parity fixtures; 08-06's compLevelView state, CompLevelSwitcher and AccuracyTable"
provides:
  - "calibrationSeries.ts: the pure calibration model (bin validity, headline selection, sentence template, shared count stats, one radius function, one merged chart-row builder) — no UI-framework import"
  - "CalibrationChart.tsx: the demoted Recharts reliability diagram — jsdom-safe sizing, sparse-bin radius scaling, native SVG titles, keyboard-reachable dots, onPointSelect/onPointDeselect"
  - "CalibrationSection.tsx: the sentence-first section mounted on /compare — heading, local year Select, sentence, corrected explainer, OPR/EPA/VPR legend-as-switcher, lazy chart boundary with Retry"
  - "--compare-algo-opr/-epa/-vpr tokens in theme.css, plus comparePalette.test.ts's shipped-value pin and no-tier/no-hex compare-surface guard"
affects: [08-12 (data-coverage section, same compLevelView state), 08-15 (390px overflow backstop for this section's own C3 row)]

actuals:
  tokens: 20600
  tasks: 4
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Pure-model-beside-the-chart split (calibrationSeries.ts has no React/UI-framework import), mirroring metricHistorySeries.ts"
    - "Recharts custom dot renderer reads the FULL merged row (payload) to recover its own algorithm's cell and a point-lookup Map keyed by x to recover the original CalibrationPoint for onPointSelect — never a second independently-recomputed point"
    - "onPointDeselect added alongside onPointSelect on CalibrationChartProps (onBlur/onMouseLeave) so a consuming section can restore a prior sentence when a hover/focus ends"
    - "Tailwind v4 unused-custom-property pruning: a new --compare-algo-* token needs a real consuming CSS rule inside theme.css itself (not just a TSX var() reference) to survive the build — same mechanism --sim-hist-bar already relies on"

key-files:
  created:
    - apps/web/src/components/compare/comparePalette.test.ts
    - apps/web/src/components/compare/calibrationSeries.ts
    - apps/web/src/components/compare/calibrationSeries.test.ts
    - apps/web/src/components/compare/CalibrationChart.tsx
    - apps/web/src/components/compare/CalibrationChart.test.tsx
    - apps/web/src/components/compare/CalibrationSection.tsx
    - apps/web/src/components/compare/CalibrationSection.test.tsx
  modified:
    - apps/web/src/styles/theme.css
    - apps/web/src/routes/compare.tsx
    - apps/web/src/routes/compare.test.tsx

key-decisions:
  - "theme.css gained a small .compare-algo-opr/-epa/-vpr consuming CSS block (color: var(--compare-algo-*)) in addition to the three token declarations — measured live that Tailwind v4's build silently prunes an --compare-algo-* custom property from the compiled stylesheet if nothing in theme.css itself references it, exactly the mechanism that already keeps --sim-hist-bar alive ahead of its own consuming component; without this, CalibrationChart.tsx's var(--compare-algo-opr) SVG attributes would resolve to nothing at runtime"
  - "CalibrationChart gained an onPointDeselect prop (onBlur/onMouseLeave) not named in the plan's original CalibrationChartProps sketch — Task 4's own 'moving away restores the headline point' contract has no other place to attach, since CalibrationChart owns every dot's event wiring (Rule 2, folded into Task 3's file before Task 4 needed it)"
  - "The calibrationPointRadius property test uses counts [1, 2, 30, 400, 5950] instead of the plan's literal 395 — 395 is a substring the plan's OWN 'no hand-typed headline figure' negative grep (85.3|52.8|395) also searches for, so using it as a property-test input would trip that same gate for an unrelated reason; 400 preserves the same representative-count coverage"
  - "Interpreted two acceptance-criteria greps (bare 'ResponsiveContainer' absent from CalibrationChart.tsx; bare 'validateSearch' absent from compare.tsx) as their structurally meaningful form — no import/JSX usage of ResponsiveContainer, no validateSearch config on the Route — rather than a literal never-appears-anywhere-including-comments reading, because the literal reading is already false of this repo's own shipped, reviewed precedent (MetricHistoryChart.tsx's doc comment names ResponsiveContainer by name; compare.tsx's pre-existing 08-01 doc comment names validateSearch by name) before this plan touched either file"

patterns-established:
  - "A chart's custom Recharts dot renderer returning null for a null cell (rather than filtering the row out of `data`) is how one merged multi-series dataset keeps three independent Lines from drawing marks on each other's gaps"

requirements-completed: [COMP-01]

coverage:
  - id: D1
    description: "theme.css carries --compare-algo-opr/-epa/-vpr (sketch 006's validated trio) plus a consuming CSS block so Tailwind v4 keeps them in the compiled stylesheet; comparePalette.test.ts pins the three hex values and asserts no --tier-*/metric-tier reference or raw hex literal reaches any non-test file under apps/web/src/components/compare/ or routes/compare.tsx"
    requirement: COMP-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/compare/comparePalette.test.ts — 4 cases"
        status: pass
    human_judgment: false
  - id: D2
    description: "calibrationSeries.ts: validCalibrationPoints (sparse kept, zero-count dropped), selectHeadlinePoint (largest |gap|, count-then-binStart tiebreak), formatCalibrationSentence, countStats, calibrationPointRadius (sqrt-area scale) and buildCalibrationRows (one merged x-ascending series) — every non-constructed test expectation recomputed from the real 2026/2024 fixtures at run time"
    requirement: COMP-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/compare/calibrationSeries.test.ts — 14 cases"
        status: pass
    human_judgment: false
  - id: D3
    description: "CalibrationChart.tsx: demoted Recharts LineChart, dashed diagonal via ReferenceLine.segment, three var(--compare-algo-*) series, sparse-bin dot radii sharing one countStats/maxCount source with the size key, native SVG <title> + tabIndex 0 dots, onPointSelect from hover/focus/click and onPointDeselect from blur/mouseleave, jsdom-safe useLayoutEffect sizing (never ResponsiveContainer)"
    requirement: COMP-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/compare/CalibrationChart.test.tsx — 7 cases"
        status: pass
    human_judgment: false
  - id: D4
    description: "CalibrationSection.tsx mounted on /compare beneath the methodology note: sentence-first layout, local year Select (2022-2026, default 2026, no request of its own), corrected diagonal-orientation explainer, OPR/EPA/VPR legend as the sentence's only algorithm switcher, lazy chart boundary degrading to Retry on a chunk failure — consumes 08-06's compLevelView as a prop, declares none of its own"
    requirement: COMP-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/compare/CalibrationSection.test.tsx — 9 cases"
        status: pass
      - kind: integration
        ref: "apps/web/src/routes/compare.test.tsx — 5 new fixture-derived Calibration cases (default headline, OPR/qualification/2026 = the 85.3%/52.8%/395-match case, legend+year switch with unchanged fetch count, real-chart hover/blur, corrected explainer)"
        status: pass
    human_judgment: false

duration: ~55min
completed: 2026-08-31
status: complete
---

# Phase 8 Plan 10: Compare Page Calibration Section Summary

**Sentence-first Calibration section on `/compare`: a plain-language sentence (default VPR/2026) carries the section, a demoted Recharts reliability diagram with sqrt-area sparse-bin radii sits beneath it as supporting evidence, and the shipped `--compare-algo-*` palette is re-validated against `theme.css`'s real values rather than the sketch's standalone theme.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-08-31T22:35:59Z
- **Tasks:** 4
- **Files modified:** 10

## Accomplishments

- `theme.css`: `--compare-algo-opr` (`#EA580C`), `-epa` (`#7C3AED`), `-vpr` (`#0D9488`) declared and, critically, given a small consuming CSS block so Tailwind v4's build does not prune them before any component reads them
- `comparePalette.test.ts`: pins the three hex values against silent drift and asserts no `--tier-*`/`metric-tier`/raw-hex reaches any non-test compare-surface file — both deliberate-failure demonstrations captured below
- `calibrationSeries.ts`: the pure calibration model — bin validity, headline selection (largest `|gap|`, count-then-binStart tiebreak), the sentence template, shared count stats, the one `sqrt`-area radius function, and the one merged x-ascending chart-row builder — TDD RED-then-GREEN, no React import
- `CalibrationChart.tsx`: the demoted reliability diagram — three `var(--compare-algo-*)` series, dashed diagonal via `ReferenceLine.segment`, sparse-bin dot radii sharing one `countStats`/`maxCount` source with the size key, native SVG `<title>` + `tabIndex 0` on every dot, hover/focus/click firing `onPointSelect` and blur/mouseleave firing the newly-added `onPointDeselect`, jsdom-safe `useLayoutEffect` sizing (never `ResponsiveContainer`)
- `CalibrationSection.tsx`: mounted on `/compare` beneath the methodology note — heading + local year `Select`, the sentence at full ink, the diagonal-orientation-corrected explainer, the OPR/EPA/VPR legend doubling as the sentence's switcher, and a lazy chart boundary (`MetricHistoryTab.tsx` precedent) degrading to sentence-plus-Retry on a chunk failure
- `compare.test.tsx` grows by 5 real-fixture cases, including the exact case that justifies the section: 2026 qualification, OPR predicted 85.3%, observed 52.8% across 395 matches — computed from the committed fixture at run time, never hand-typed

## Task Commits

1. **Task 1: `--compare-algo-*` tokens and the palette re-validation** — `f5fcd264` (feat)
2. **Task 2: `calibrationSeries.ts` — pure model, TDD** — `5bc6a269` (test, RED) → `c785ace5` (feat, GREEN)
3. **Task 3: `CalibrationChart` — demoted reliability diagram** — `2ead70aa` (feat) → `acd8acc8` (fix, Rule 2 `onPointDeselect` addition)
4. **Task 4: `CalibrationSection` — sentence-first, mounted on `/compare`** — `57b35495` (feat)

## Palette Re-Validation (Task 1's obligation — run against the SHIPPED `theme.css` values, not the sketch's standalone theme)

**Run one — the trio alone, `--pairs all`, light mode, both surfaces:**

```
=== surface #F8FAFC ===
Palette (light, surface #F8FAFC, categorical): 3 slots
  [PASS] Lightness band         all 3 inside L 0.43–0.77
  [PASS] Chroma floor           all 3 >= 0.1
  [PASS] CVD separation         worst all-pairs #0D9488↔#EA580C ΔE 13.8 (protan) · tritan 13.6
  [PASS] Normal-vision floor    worst all-pairs #0D9488↔#EA580C ΔE 28.8 (normal)
  [PASS] Contrast vs surface    all 3 >= 3:1
  → ALL CHECKS PASS

=== surface #F1F5F9 ===
Palette (light, surface #F1F5F9, categorical): 3 slots
  [PASS] Lightness band         all 3 inside L 0.43–0.77
  [PASS] Chroma floor           all 3 >= 0.1
  [PASS] CVD separation         worst all-pairs #0D9488↔#EA580C ΔE 13.8 (protan) · tritan 13.6
  [PASS] Normal-vision floor    worst all-pairs #0D9488↔#EA580C ΔE 28.8 (normal)
  [PASS] Contrast vs surface    all 3 >= 3:1
  → ALL CHECKS PASS
```

**Run two — the trio plus `--tier-rare-fg`/`--tier-epic-fg`/`--tier-legendary-fg`, same flags, both surfaces:**

```
=== surface #F8FAFC ===
Palette (light, surface #F8FAFC, categorical): 6 slots
  [PASS] Lightness band         all 6 inside L 0.43–0.77
  [PASS] Chroma floor           all 6 >= 0.1
  [FAIL] CVD separation         worst all-pairs #7E22CE↔#7C3AED ΔE 5.4 (deutan) · tritan 6.9
  [FAIL] Normal-vision floor    worst all-pairs #7E22CE↔#7C3AED ΔE 6.0 (normal) — below 15
  [PASS] Contrast vs surface    all 6 >= 3:1
  → FAILED — fix the marked checks

=== surface #F1F5F9 ===
(identical figures — CVD/normal-vision checks are surface-independent)
  → FAILED — fix the marked checks
```

**Disposition:** separation, not a hue change. `--compare-algo-epa` and `--tier-epic-fg` are measurably indistinguishable (ΔE 6.0 normal, 5.4 deutan) but neither value may move — the trio is locked by sketch 006's own CVD-validated result, and the tier palette is locked by `colour-and-tiers.md`'s own "do not fix this" warning. The Compare page renders no tier box at all, so the two systems are never asked to be told apart in practice; `comparePalette.test.ts` enforces that they never reach one surface, rather than trusting memory.

**Guard-is-live demonstrations (captured, then reverted before committing):**

```
# Demonstration 1 — a changed token hex
$ sed -i 's/--compare-algo-epa: #7C3AED;/--compare-algo-epa: #7E22CE;/' theme.css && npx vitest run comparePalette.test.ts
 FAIL  comparePalette — theme.css token pinning ... declares all three --compare-algo-* tokens ...
 AssertionError: expected '#7e22ce' to be '#7c3aed'
 Test Files  1 failed (1) | Tests  1 failed | 3 passed (4)

# Demonstration 2 — a --tier- reference introduced into a non-test compare-surface file
$ printf '\n// TEMP: var(--tier-rare-fg)\n' >> AccuracyTable.tsx && npx vitest run comparePalette.test.ts
 FAIL  comparePalette — no --tier-*/metric-tier/raw-hex leakage ... references --tier-* or metric-tier ...
 AssertionError: --tier-* or metric-tier found in: .../AccuracyTable.tsx
 Test Files  1 failed (1) | Tests  1 failed | 3 passed (4)
```

Both reverted immediately after capture; `comparePalette.test.ts` is 4/4 green in the committed tree.

## Files Created/Modified

- `apps/web/src/styles/theme.css` — three `--compare-algo-*` tokens plus their consuming CSS block
- `apps/web/src/components/compare/comparePalette.test.ts` — the shipped-token guard
- `apps/web/src/components/compare/calibrationSeries.ts` / `.test.ts` — the pure model, TDD
- `apps/web/src/components/compare/CalibrationChart.tsx` / `.test.tsx` — the demoted chart
- `apps/web/src/components/compare/CalibrationSection.tsx` / `.test.tsx` — the sentence-first section
- `apps/web/src/routes/compare.tsx` — mounts `CalibrationSection` beneath the methodology note
- `apps/web/src/routes/compare.test.tsx` — 5 new fixture-derived Calibration cases

## Decisions Made

See `key-decisions` in frontmatter for the four implementation-level decisions not pre-recorded by the plan (Tailwind pruning fix, `onPointDeselect` addition, the 395→400 property-test substitution, and the two grep-literalism resolutions). Decisions 1–7 already recorded in `08-10-PLAN.md` were executed as specified.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/3 - Bug/Blocking] `theme.css`'s new `--compare-algo-*` tokens were silently pruned from the compiled stylesheet by Tailwind v4's build**
- **Found during:** Task 1, verifying `pnpm --filter web build`'s output CSS
- **Issue:** `grep -o -- "--compare-algo-[a-z]*:" dist/assets/index-*.css` found nothing after the first build — Tailwind v4 keeps a custom property declared inside `@theme { ... }` in the compiled `:root` block only if something in the SAME stylesheet references it (verified empirically: `--sim-hist-bar` survives today only because `.sim-hist-bar { background-color: var(--sim-hist-bar); }` already exists, ahead of any component using that class). Without a fix, `CalibrationChart.tsx`'s planned `var(--compare-algo-opr)` attribute values would resolve to nothing at runtime — invisible chart lines.
- **Fix:** Added a small `.compare-algo-opr/-epa/-vpr { color: var(--compare-algo-*); }` block to `theme.css`, mirroring the `.sim-hist-bar` precedent. Rebuilt and confirmed `--compare-algo-opr:#ea580c` etc. now appear in the compiled CSS.
- **Files modified:** `apps/web/src/styles/theme.css`
- **Verification:** `pnpm --filter web build` then `grep -o -- "--compare-algo-[a-z]*:[^;}]*" dist/assets/index-*.css` — all three tokens present.
- **Committed in:** `f5fcd264` (Task 1 commit)

**2. [Rule 2 - Missing Critical] `CalibrationChart` needed an `onPointDeselect` callback the plan's Task 3 prop sketch did not name**
- **Found during:** Task 4, implementing "moving away restores the headline point"
- **Issue:** Task 4's acceptance criteria requires the sentence to revert to the headline fact after a hover/focus ends. `CalibrationChart.tsx` (Task 3) owns every dot's event wiring and only exposed `onPointSelect` (fired from hover/focus/click) — there was no signal for "the hover/focus just ended."
- **Fix:** Added an optional `onPointDeselect?: () => void` to `CalibrationChartProps`, wired to each dot's `onBlur`/`onMouseLeave`. `CalibrationSection` passes `() => setChartPoint(undefined)`.
- **Files modified:** `apps/web/src/components/compare/CalibrationChart.tsx`, `CalibrationChart.test.tsx` (one new case)
- **Verification:** `npx vitest run CalibrationChart.test.tsx` — 7/7 green, including the new deselect case; `CalibrationSection.test.tsx`'s hover-then-blur case and `compare.test.tsx`'s real-chart hover/blur case both pass end-to-end.
- **Committed in:** `acd8acc8`

**Total deviations:** 2, both auto-fixed (1 Rule 1/3 build-correctness bug, 1 Rule 2 missing-functionality addition). No architectural questions arose (Rule 4 never triggered). Two additional judgment calls (documented in `key-decisions`, not full deviations since no code was "wrong") reconciled two acceptance-criteria greps with this repo's own pre-existing shipped precedent — see below.

## Issues Encountered

- **Two acceptance-criteria greps, read literally, contradicted this repo's own already-shipped, human-reviewed precedent.** Task 3's criterion `grep -q 'ResponsiveContainer' CalibrationChart.tsx finds nothing` and Task 4's `grep -q 'validateSearch' compare.tsx finds nothing` both read as "the substring never appears anywhere, including comments" — but `MetricHistoryChart.tsx` (Phase 6, shipped) itself names `ResponsiveContainer` in its own doc comment explaining why it's banned, and `compare.tsx`'s pre-existing 08-01 doc comment (untouched by this plan) names `validateSearch` for the identical reason. Verified the STRUCTURALLY meaningful invariant instead (no import/JSX usage of `ResponsiveContainer`; no `validateSearch:` config on the Route) — both hold. Recorded rather than silently substituted.
- **`calibrationPointRadius`'s property test couldn't literally use `395`** (the plan's own suggested test input) because it collides with the SAME task's `grep -nE '85\.3|52\.8|395'` negative-figure gate. Substituted `400` — see `key-decisions`.
- Verified, before writing any test, that the OPR/2026/qualification bin's real published figures (`meanPredicted` 0.8532853626654197, `observedFrequency` 0.5278481012658228, `count` 395) are genuinely the `argmax |gap|` bin in that slice, and that the 2024 EPA elimination slice genuinely carries exactly 2 zero-count bins and 2 one-match bins — both confirmed live against the committed fixtures before encoding either as a test expectation.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `apps/web/src/components/compare/calibrationSeries.ts`'s exports (`CalibrationPoint`, `AlgorithmPoints`, `validCalibrationPoints`, `selectHeadlinePoint`, `formatCalibrationSentence`, `countStats`, `calibrationPointRadius`, `buildCalibrationRows`, `MIN_POINT_R`/`MAX_POINT_R`, `NO_USABLE_BINS_SENTENCE`) are the single home for any future calibration-figure rendering on this site.
- `CalibrationChart.tsx`'s `onPointDeselect` addition is available to any future consumer that needs the same hover-restore behavior.
- 08-12 (data-coverage section) reads the same `compLevelView` prop this plan's section consumes — no new state to add.
- 08-15's C3 overflow-backstop row (390px legibility of the 3-series legend/switcher, sparse-bin radius scaling, axis labels) is unaddressed by this plan per the outline's own probe-coverage ledger — it remains 08-15's job.

## Self-Check: PASSED

All 7 created files and 3 modified files confirmed present on disk; all 6 commits (`f5fcd264`, `5bc6a269`, `c785ace5`, `2ead70aa`, `acd8acc8`, `57b35495`) confirmed in `git log`. Full verification: `pnpm --filter web typecheck` clean; `npx vitest run apps/web/src` is 920/920 green (up from the upstream-reported 881/881 baseline, +39 new tests); `pnpm --filter web build` succeeds with `CalibrationChart-*.js` emitted as its own chunk, separate from `index-*.js` (the compare route's own entry).

---
*Phase: 08-simulation-compare*
*Completed: 2026-08-31*
