---
phase: 08-simulation-compare
plan: 04
subsystem: ui
tags: [simulation, quantile-estimation, chart-geometry, theme-tokens, vitest]

requires:
  - phase: 08-simulation-compare
    plan: 03
    provides: "SimResult.rankHistograms (Int32Array per team, indexed rank-1) -- the exact ArrayLike<number> shape simQuantile.ts's continuousQuantile() consumes unconverted"
provides:
  - "apps/web/src/lib/simQuantile.ts -- continuousQuantile(), a verbatim, zero-import port of sketch 005's R type-7 continuous quantile estimator over binned rank histograms; the single source of every 10th/90th rank-band edge in the app"
  - "apps/web/src/lib/simAxis.ts -- PLOT_W (re-exported from matchAxis.ts), SIM_GEOMETRY's six locked geometry constants, the single continuous x(rank, teamCount) mapping, and three clamped derived-position functions (rankBandExtent, medianTickLeft, histBarExtent)"
  - "apps/web/src/styles/theme.css -- three additive neutral --sim-* custom properties (--sim-hist-bar, --sim-band-overlay, --sim-median-tick) plus their consuming utility classes, coupled to SIM_GEOMETRY.BAND_OPACITY by an assertion"
affects: [08-08 (Node control-run script imports continuousQuantile via tsx), 08-14 (renders the rank-distribution table using every export from both new modules and the three CSS classes), 08-15 (78-team overflow backstop exercises the clamp this plan proves)]

actuals:
  tokens: 8221
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Zero-import pure-arithmetic leaf module (simQuantile.ts) -- importable from both the browser bundle and a Node tsx script with no conversion, following rankSimulation.ts's (08-03) browser-safety discipline one level further (zero imports, not just Node-builtin-free)"
    - "One coordinate convention declared once in a file-level comment (simAxis.ts): rank r's visual centre is x(r); every mark (bar, band, tick) derives its position from that single function plus SIM_GEOMETRY, never a second hand-tuned position -- matchAxis.ts's allianceMarkPositions() pattern applied to a rank axis"
    - "Additive-only CSS token block verified by a zero-removed-lines diff gate, with new tokens consumed by thin utility classes in the same stylesheet (the .alliance-chip--*/.bonus-dot--* precedent) rather than left TSX-only"

key-files:
  created:
    - apps/web/src/lib/simQuantile.ts
    - apps/web/src/lib/simQuantile.test.ts
    - apps/web/src/lib/simAxis.ts
    - apps/web/src/lib/simAxis.test.ts
  modified:
    - apps/web/src/styles/theme.css

key-decisions:
  - "medianTickLeft's centering property is proven at a mid-table rank (20) rather than at rank 1, which the plan's <behavior> block used as its literal example. At rank 1, x(1, N) is always exactly 0 for any N > 1, so the tick's raw left edge (0 - MEDIAN_TICK_W/2 = -1) is always negative and the clamp always binds -- the centering equality (medianTickLeft + half == x(rank)) is mathematically unable to hold there for any nonzero tick width, regardless of clamp implementation. Rank 1's behavior is still fully covered by the separate 'never leaves the box' test the same bullet requires. Verified by hand: no clamp formula satisfying 'tick stays wholly inside the box' (the action text's own requirement) can also satisfy exact centering at a boundary rank."
  - "rankBandExtent clamps each raw edge into [0, PLOT_W] independently before computing width, rather than clamping the pre-computed span -- this is what makes 'left is always >= 0' and 'left + width is always <= PLOT_W' hold unconditionally by construction (proven for the two-team 235px-per-side overflow case and the degenerate one-team roster), not just for the three measured real events."

patterns-established:
  - "SIM_GEOMETRY.BAND_OPACITY <-> theme.css's --sim-band-overlay percentage coupling test, read off the shipped stylesheet via readFileSync + regex extraction (browserSafeSchemas.test.ts's HERE/resolve pattern) -- watched to fail once against a deliberate drift before being trusted"

requirements-completed: []

coverage:
  - id: D1
    description: "continuousQuantile() -- verbatim port of sketch 005's R type-7 continuous quantile estimator, regressed against all three of sketch 005's worked examples to six decimal places (including the two exact-rational cases), the bounded-by-construction property, the 0.8-rank-unit minimum-width floor, the skip-empty-bins property, and hostile/degenerate input (NaN counts, zero-length histogram, mismatched draw totals, Int32Array input)"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/lib/simQuantile.test.ts -- 18 cases, all passing"
        status: pass
    human_judgment: false
  - id: D2
    description: "Three additive neutral --sim-* CSS custom properties (--sim-hist-bar, --sim-band-overlay, --sim-median-tick) and their consuming utility classes in theme.css, with zero existing token values changed and all three confirmed present in the built production stylesheet"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "grep gates over theme.css (documented in this SUMMARY's Verification Output section) + pnpm --filter web build, confirmed via grep against apps/web/dist/assets/*.css"
        status: pass
    human_judgment: false
  - id: D3
    description: "simAxis.ts -- PLOT_W re-exported (never restated), SIM_GEOMETRY's six locked geometry constants, the single continuous non-snapping x(rank, teamCount) mapping, and three clamped derived-position functions (rankBandExtent, medianTickLeft, histBarExtent) proven to keep every mark inside the plot cell at every integer rank for rosters of 2, 17, 39 and 78"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "apps/web/src/lib/simAxis.test.ts -- 26 cases, all passing, including a 136-position loop over histBarExtent's clamp and the BAND_OPACITY-to-theme.css coupling assertion"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-08-31
status: complete
---

# Phase 8 Plan 4: Band-edge math and rank-axis geometry (simQuantile.ts / simAxis.ts) Summary

**Two pure browser-safe modules -- `continuousQuantile()`, a verbatim zero-import port of sketch 005's R type-7 continuous quantile estimator, and `simAxis.ts`'s single `x(rank, teamCount)` mapping with three clamped derived-position functions -- plus three additive neutral `--sim-*` theme tokens, all landed and unit-proven before any component exists to hand-tune around them.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-31T18:29:12Z (STATE.md session start)
- **Completed:** 2026-08-31T18:40:41Z (Task 3 commit)
- **Tasks:** 3
- **Files modified:** 5 (2 new modules, 2 new test files, 1 additive stylesheet edit)

## Baseline (recorded before Task 1)

```
npx vitest run
Test Files  1 failed | 128 passed (129)
     Tests  2 failed | 2180 passed | 1 skipped (2183)
```

Both failures are `packages/harness/payloadBudget.test.ts`'s pre-existing accepted signed overrides (WINDOWS.md ledger #11 `teams/{year}` and ledger #15 team page) -- matches 08-03-SUMMARY.md's own recorded baseline exactly, confirming no drift since that plan.

`apps/web/src/components/team/matchAxis.ts` confirmed present and exporting `PLOT_W = 470` before Task 3.

## Accomplishments

- `continuousQuantile()` ported verbatim into `apps/web/src/lib/simQuantile.ts`, a zero-import module, and regressed against sketch 005's three real worked examples plus the bounded-by-construction, 0.8-rank-unit-floor, skip-empty-bins and hostile-input properties (18 tests).
- `apps/web/src/lib/simAxis.ts` ships the rank plot's single geometry source: `PLOT_W` re-exported from `matchAxis.ts` (never restated), `SIM_GEOMETRY`'s six locked constants, the continuous non-snapping `x()` mapping, and three clamped derived-position functions, proven to keep every mark inside the plot cell at every integer rank for rosters of 2, 17, 39 and 78 (26 tests).
- `theme.css` gained three additive neutral `--sim-*` tokens and their consuming utility classes, with a zero-removed-lines diff gate proving no existing token value changed, and all three confirmed present in the built production stylesheet.
- `SIM_GEOMETRY.BAND_OPACITY` and `--sim-band-overlay`'s declared percentage are coupled by an assertion that was watched to fail once against a deliberate drift (both numbers named in the failure message) before being trusted.

## Task Commits

1. **Task 1: Port `continuousQuantile()` verbatim and regress it against sketch 005's three worked examples** - `bc278782` (feat)
2. **Task 2: Add the three additive `--sim-*` neutral tokens and their consuming utility classes to `theme.css`** - `61cdb1c1` (feat)
3. **Task 3: `simAxis.ts` -- the re-exported `PLOT_W`, the locked geometry, the single continuous `x()` mapping, and the three clamped derived-position functions** - `74d23e9a` (feat)

## Observed RED steps (quoted, not claimed)

**Task 1**, against a deliberately integer-snapping `continuousQuantile()` body:

```
FAIL src/lib/simQuantile.test.ts > continuousQuantile — sketch 005's three worked examples (regression core) > team 95 and team 4564 produce DIFFERENT bands on both edges — integer snapping renders both as '2-3'
AssertionError: expected 2 not to be 2 // Object.is equality
```
9 of 18 assertions failed against the snapping body, including the locked-team case (`expected 1 to be close to 0.600402`) and the exact-rational cases (`expected 2 to be 1.8`) -- genuine numeric mismatches, not a module-not-found error.

**Task 3**, against a deliberately rounding `x()` with an unclamped `rankBandExtent()`:

```
FAIL src/lib/simAxis.test.ts > x(rank, teamCount) — the single rank-to-pixel mapping > maps a band edge at the mathematical bounds outside the plot box — the fact the clamp exists for
AssertionError: expected +0 to be close to -6.184, received difference is 6.184, but expected 0.0005

FAIL src/lib/simAxis.test.ts > rankBandExtent(p10, p90, teamCount) — the clamped band > a two-team event does not paint outside its cell, despite raw extents of -235px and 705px
AssertionError: expected +0 to be -235 // Object.is equality
```
11 of 26 assertions failed, including the continuous-input midpoint case and the two-team clamp case specifically named by the plan's acceptance criteria.

## Coupling-assertion hand verification (watched to fail once)

Temporarily changed `--sim-band-overlay`'s percentage from `18%` to `19%` in `theme.css`, ran the coupling test in isolation, reverted:

```
FAIL src/lib/simAxis.test.ts > --sim-band-overlay token coupling — the one case that reads a file off disk > SIM_GEOMETRY.BAND_OPACITY * 100 equals the percentage declared inside --sim-band-overlay in the shipped theme.css
AssertionError: theme.css declares 19% but SIM_GEOMETRY.BAND_OPACITY * 100 is 18: expected 19 to be 18
```
Confirmed `git status`/`git diff` clean on `theme.css` after reverting (the change was never staged or committed).

## Port faithfulness (hand-checked once, as required)

`continuousQuantile()`'s body against the sketch source
(`.claude/skills/sketch-findings-sigmascout/sources/005-rank-distribution/index.html:149-162`):

| Expression | Sketch (JS) | Port (TS) | Changed? |
|---|---|---|---|
| target | `p * draws` | `p * draws` | No |
| skip condition | `if (m === 0) continue;` | `if (m === undefined \|\| m === 0) continue;` | **Yes -- the one documented adaptation** |
| frac | `(target - cum) / m` | `(target - cum) / m` | No |
| return | `(i + 1) - 0.5 + frac` | `i + 1 - 0.5 + frac` | No (identical arithmetic; parens were not operator-precedence-significant) |
| terminal | `dist.length + 0.5` | `dist.length + 0.5` | No |

The one difference is `noUncheckedIndexedAccess`'s `number | undefined` read, handled with an explicit `undefined` check rather than `?? 0` or `as number` (this repo's standing rule against substituting a zero for an absent value, 07-08's T-07-08-13), documented in a comment beside the check.

## Verification Output

```
npx vitest run apps/web/src/lib/simQuantile.test.ts
Test Files  1 passed (1)
     Tests  18 passed (18)

npx vitest run apps/web/src/lib/simAxis.test.ts
Test Files  1 passed (1)
     Tests  26 passed (26)

pnpm --filter web typecheck
$ tsc --noEmit -p tsconfig.json
(exit 0, no diagnostics)

pnpm --filter web build
(succeeds; --sim-hist-bar, --sim-band-overlay, --sim-median-tick each confirmed present
in apps/web/dist/assets/*.css via grep)

npx vitest run  (full repo, post-plan)
Test Files  1 failed | 130 passed (131)
     Tests  2 failed | 2224 passed | 1 skipped (2227)
```
The 2 failures are the same pre-existing accepted `payloadBudget.test.ts` overrides recorded in the baseline above -- zero new failures. 2224 - 2180 = 44 new passing tests (18 + 26), matching exactly.

**Grep gates (all printed counts as required, not summarised):**

| Gate | Command target | Result |
|---|---|---|
| simQuantile.ts has zero imports | `grep -cE '\bfrom[...]'` (code lines only) | `0` |
| simQuantile.ts has no snapping call | `grep -cE 'Math\.(round\|floor\|ceil\|trunc)\|toFixed\|\|0'` | `0` |
| simQuantile.ts has no forbidden coercion | `grep -cE '\?\?[[:space:]]*0\|as number'` | `0` |
| simQuantile.ts exports exactly one symbol | `grep -c 'export '` | `1` |
| theme.css diff is purely additive | `git diff -U0 \| grep -cE '^-[^-]'` | `0` |
| Three --sim-* tokens declared exactly once | `grep -cE '^[[:space:]]*--sim-...'` | `3` |
| Every token resolves through an existing neutral | `grep -c 'var(--color-text-'` | `3` |
| --sim-band-overlay is 18% | `grep -c 'color-mix(...18%...)'` | `1` |
| --sim-hist-bar is 55% | `grep -c 'color-mix(...55%...)'` | `1` |
| Three consuming classes exist | `grep -cE '^\.sim-...\{'` | `3` |
| No --compare-algo-* token added early | `grep -c 'compare-algo'` | `0` |
| simAxis.ts never restates 470 | `grep -cE '\b470\b'` (code lines only) | `0` |
| simAxis.ts references matchAxis.js | `grep -c 'matchAxis.js'` | `1` |
| simAxis.ts has no snapping call | `grep -cE 'Math\.(round\|floor\|ceil\|trunc)\|toFixed'` | `0` |
| simAxis.ts produces no display string | `grep -cE 'return [\`"'"'"']\|String(\|.join('` | `0` |

**Clamp loop coverage (histBarExtent):** 136 positions checked (2 + 17 + 39 + 78 integer ranks across the four tested roster sizes) -- every one contained within `[0, PLOT_W]`.

## Files Created/Modified

- `apps/web/src/lib/simQuantile.ts` - `continuousQuantile()`, zero-import verbatim port of sketch 005's estimator
- `apps/web/src/lib/simQuantile.test.ts` - 18-case regression suite
- `apps/web/src/lib/simAxis.ts` - `PLOT_W`, `SIM_GEOMETRY`, `x()`, `rankSlotWidth`, `rankBandExtent`, `medianTickLeft`, `histBarExtent`, `RankMarkExtent`
- `apps/web/src/lib/simAxis.test.ts` - 26-case geometry contract suite
- `apps/web/src/styles/theme.css` - three additive `--sim-*` tokens + three consuming utility classes (53 lines added, 0 removed)

## Decisions Made

See `key-decisions` in frontmatter: (1) `medianTickLeft`'s centering property is tested at a mid-table rank (20) rather than the plan's literal rank-1 example, since the clamp is mathematically always binding at rank 1 for any nonzero tick width -- rank 1 is still fully covered by the separate box-containment test. (2) `rankBandExtent` clamps each raw edge independently into `[0, PLOT_W]` before computing width, which is what makes the box-containment guarantee unconditional rather than tuned to the three measured events.

## Deviations from Plan

### Auto-fixed Issues

None requiring a Rule 1/2/3 fix -- both items above are test-design judgment calls within Task 3's own `<behavior>` block (the plan's prose example at rank 1 was mathematically inconsistent with its own "tick stays wholly inside the box" requirement in the same task's `<action>` text), not defects in shipped code. No production logic was changed to accommodate this; only the test's chosen example rank differs from the plan's literal illustration, with the underlying property (centering, when unclamped) still fully proven.

---

**Total deviations:** 0 auto-fixed; 1 documented test-design judgment call (see Decisions Made).
**Impact on plan:** None on scope or correctness -- all `must_haves.truths`, prohibitions, and the full `<verification>` block are satisfied as written.

## Issues Encountered

None.

## Known Stubs

None. No component reads these modules yet (08-14 is the first consumer, next wave) -- both modules are complete, fully-tested leaf implementations with nothing deferred within their own stated scope.

## Threat Flags

None. This plan's own `<threat_model>` register (T-08-04-01 through T-08-04-06) covers every surface introduced -- hostile-histogram termination, non-finite-pixel-to-CSS-length, band-width spoofing via snapping or double-applied opacity, and an accidental `theme.css` token edit -- and no new surface outside that register was found during implementation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 08-08's Node control-run script can `import { continuousQuantile } from "../../apps/web/src/lib/simQuantile.js"` under `tsx` with zero conversion -- the module has zero runtime imports, verified by grep.
- 08-14 (rank-distribution table render) can import every export from both `simQuantile.ts` and `simAxis.ts` unchanged, plus apply `.sim-hist-bar`/`.sim-band-overlay`/`.sim-median-tick` directly -- no further plumbing needed.
- 08-14 owns the one flagged planner assumption this plan carries forward: visual confirmation, against a real 1000-draw distribution, that centring all three plot layers on `x(r)` (rather than reproducing sketch 005's half-slot rendering offsets) reads correctly. This is `chart-craft.md`'s "render it and look at it" step, deliberately not claimed as settled by unit tests alone.
- 08-15's 78-team overflow backstop is already exercised by this plan's `rankBandExtent`/`histBarExtent` tests at N=78, giving it a proven starting point rather than an unverified one.

## Self-Check: PASSED

All 5 modified/created files confirmed present on disk with the expected changes (`apps/web/src/lib/simQuantile.ts`, `apps/web/src/lib/simQuantile.test.ts`, `apps/web/src/lib/simAxis.ts`, `apps/web/src/lib/simAxis.test.ts`, `apps/web/src/styles/theme.css`); all 3 task commits (`bc278782`, `61cdb1c1`, `74d23e9a`) confirmed in `git log --oneline`.

---
*Phase: 08-simulation-compare*
*Completed: 2026-08-31*
