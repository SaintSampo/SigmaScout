---
phase: quick-261006-lxp
plan: 01
subsystem: web / Locks tabs (District Locks, Champ Locks)
tags: [ui, sketch-025, drawer, svg, histogram, locks]
status: complete
requires: [sketch 025 variant A, districtHistGeometry adapter, ledgerCutoffDisplay, openCellLines]
provides: [ledgerVerdict.ts verdict model, LedgerVerdictDrawer.tsx, SVG DistrictPointHistogram, grid DistrictOutcomeList, theme.css verdict block]
affects: [DistrictLedger.tsx, ChampLocksLedger.tsx, LedgerParts.tsx, districtLedgerCopy.ts, theme.css, e2e districts-ledger.spec.ts]
tech-stack:
  added: []
  patterns: [pure model builder plus thin renderer, responsive SVG with class-only colours, CSS subgrid outcome rows]
key-files:
  created:
    - apps/web/src/components/districts/ledgerVerdict.ts
    - apps/web/src/components/districts/ledgerVerdict.test.ts
    - apps/web/src/components/districts/LedgerVerdictDrawer.tsx
    - apps/web/src/components/districts/LedgerVerdictDrawer.test.tsx
  modified:
    - apps/web/src/components/districts/districtLedgerCopy.ts
    - apps/web/src/components/districts/districtLedgerCopy.test.ts
    - apps/web/src/components/districts/districtHistGeometry.ts
    - apps/web/src/components/districts/districtHistGeometry.test.ts
    - apps/web/src/components/districts/DistrictPointHistogram.tsx
    - apps/web/src/components/districts/DistrictOutcomeList.tsx
    - apps/web/src/components/districts/LedgerParts.tsx
    - apps/web/src/components/districts/DistrictLedger.tsx
    - apps/web/src/components/districts/ChampLocksLedger.tsx
    - apps/web/src/components/districts/DistrictLedger.test.tsx
    - apps/web/src/components/districts/ChampLocksLedger.test.tsx
    - apps/web/src/components/districts/districtLedgerOutcomes.ts
    - apps/web/src/styles/theme.css
    - apps/web/e2e/districts-ledger.spec.ts
decisions:
  - "The Locks drawer is one verdict pane per clicked cell (sketch 025 variant A): eyebrow, headline, tiles, note, one chart, and a source line on totals only"
  - "The grand total headline reads a withheld range call first, then the printed chance, then the guarantees and Declined, else the likely range (open arm)"
  - "Band and hatched zone use the adapter's band extent with no extra half slot (sketch correction 1)"
  - "The Team column is no longer sticky on either Locks tab"
metrics:
  duration: ~25 min
  completed: 2026-10-06
actuals:
  tokens: 34400
  tasks: 3
  commits: 3
---

# Phase quick-261006-lxp Plan 01: The verdict-first drawer on both Locks tabs Summary

A blue cell on District Locks and Champ Locks now opens one verdict pane built by a pure `buildVerdictModel`. The pane has an eyebrow, a one-line answer ("Qualifies in N of 100 runs.", or the cap, field or outcome sentence), two or three figure tiles, the note "likely = 8 of 10 runs", and one chart. The chart is either a responsive 560-unit SVG histogram with touching binned bars, a dashed "cutoff ~N" line and its hatched likely zone, or labelled chance bars with "pts" units. Totals also get one source line. The captions, the second grand total plot and both contribution tables are gone, and the Team column scrolls with the table.

## Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| 1 | 7e0d0534 | feat(261006-lxp): verdict copy, plotW geometry and the verdict model |
| 2 | e005b59d | feat(261006-lxp): SVG histogram, outcome bars and the verdict drawer |
| 3 | 5d3eac0d | feat(261006-lxp): one verdict pane on both Locks tabs, team column unpinned |

Nothing pushed. No `.planning` file committed.

## Deliberate departures from the sketch (all four, as the plan requires)

1. **Band and zone edges.** The sketch draws the band from `x(p10 - 0.5)` to `x(p90 + 0.5)`. Its own `quantile()` already returns slot-edge positions, so that widens the band by one slot. Here the band and the hatched zone both go through `pointVerdictBandExtent` (the adapter's `pointBandExtent`, floored at 3 units) with no extra shift. The difference is under a pixel on the 426-slot grand total and 24px on the 23-slot qualification axis.
2. **The cap label.** The sketch sets `top = 6` when no cutoff is drawn, then puts the cap label at `top - 7`, which is y = -1 and outside the viewBox. Here `top` is 20 whenever a cutoff or a cap label is drawn, so "22 cap" renders at y = 13.
3. **The hatch legend item** appears only when the hatched zone is drawn. A midpoint-rule cutoff has no likely range, so its legend has four items, not five.
4. **Eyebrow titles.** On the District tab, per-event cells read "{Column title} at {short event name}" ("Qualification at Live Event · 100 Nickname 100"). Champ subtotals read "District subtotal" or "DCMP subtotal". Every other cell keeps the plain column title.

## e2e specs to rerun after deploy (not run here; Playwright targets the live site)

- `apps/web/e2e/districts-ledger.spec.ts`. This is the only spec that touches the Locks drawer or the Team column. The 390px test was renamed to "the table's own region is the only horizontal scroller and the Team column scrolls with it", and it now asserts `after.x < before.x - 1`. A grep of `apps/web/e2e` for drawer, caption, outcome, contribution, verdict and team-cell strings found nothing else. The sticky references in other specs are about event and team tables, not the Locks ledger.

## Verification

- Full root suite: `npx vitest run` from the repo root reported **339 files passed, 7812 tests passed, 1 skipped**. The skip is the corpus-conditional `it.skip` in `packages/core/algorithms/breakdown/reconciliation.test.ts`. It is pre-existing and fires when the local corpus is absent.
- Typechecks: `npx tsc --noEmit` (root), `-p apps/web/tsconfig.json` and `-p apps/web/tsconfig.e2e.json` all printed no errors. The web typecheck was also clean after Task 1 and after Task 2. No type error came up at any point, so none needed triage.
- The deletion regex gate over `apps/web/src` prints **0**. `<VerdictDrawer` appears once in `DistrictLedger.tsx` and once in `ChampLocksLedger.tsx`.
- Per-task counts: Task 1 ran 3 files and 97 tests. Task 2 ran the 5 named files with 157 tests. DistrictLedger.test.tsx has 87 tests and ChampLocksLedger.test.tsx has 26.
- The grep guard (`districtHistGeometry.test.ts`) passes against the rewritten `DistrictPointHistogram.tsx`: with comments stripped, the file never names the shared rank geometry module, and it imports `./districtHistGeometry.js`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The grep guard could not read the file through `new URL(..., import.meta.url)`**
- **Found during:** Task 1
- **Issue:** Under the jsdom test environment `import.meta.url` is not a `file:` URL, so `readFileSync(new URL(...))` threw.
- **Fix:** The guard now uses `resolve(dirname(fileURLToPath(import.meta.url)), "DistrictPointHistogram.tsx")`, the pattern `LocksMilestonePicker.test.tsx` already uses.
- **Commit:** 7e0d0534

**2. [Rule 1 - Test fixture] The touching-bars test needed adjacent drawn bins**
- **Found during:** Task 2
- **Issue:** Each synthetic lump fit inside a single 5-value bin, so no two drawn bars were neighbours.
- **Fix:** The 240 lump was widened across three bins (236 to 247).
- **Commit:** e005b59d

**3. [Rule 1 - Escaping] Regex backslashes were stripped by a Bash heredoc**
- **Found during:** Task 3
- **Issue:** The Champ test rewrites lost their `\d` escapes and the tests failed.
- **Fix:** The literals were repaired with a script file. All Champ tests then passed with the intended regexes.
- **Commit:** 5d3eac0d

### Choices within the plan's latitude

- `buildVerdictModel` throws two named errors, `MissingGrandVerdictError` and `MissingTotalContextError`.
- The District grand total test opens up to two teams: one whose Status cell prints "N% chance", plus one printing "<5% chance" where such a team exists. This guarantees the "same N as the Status cell" check actually runs.
- The rewound Champ test picks a team whose field chance prints under 99%. Every team still prints a "to be there" line at a field chance of exactly 1, but the pane correctly drops the suffix at 1, so such a team would not test it.
- The `TEAM_CELL_CLASS` unit pin sits at the end of the DistrictLedger drawer describe.
- The new verdict exports are imported through a second import statement in `districtLedgerCopy.test.ts`.
- TDD gates: tests and code for each task share one commit, as the plan prescribes one commit per task. No separate RED commits were made.

## Follow-ups (not done, out of scope)

- `LedgerCutoffView.tier` and its plumbing in `predictedCutoff.ts` and `ledgerRangeState.ts` are untouched as instructed, but the field no longer has a reader. Its only reader was the deleted drawer caption choice.
- `pointBarExtent` and `pointAxisTicks` in `districtHistGeometry.ts` are now used only by their own tests, since the histogram uses the verdict helpers. `districtLedgerOutcomePoints` is kept as the plan requires but has no production caller.
- The cell key legend still reads "still open · click for the histogram". The plan did not ask for that to change, but an outcome cell now opens bars rather than a histogram.

## Known Stubs

None.

## Threat Flags

None. T-lxp-01 is mitigated: every drawer string is a React text child, nothing uses `dangerouslySetInnerHTML`, and the SVG pattern id is `useId()` with every character outside `[A-Za-z0-9_-]` stripped. T-lxp-02 is mitigated: `.env` was never read.

## Self-Check: PASSED

- All four created files exist on disk.
- Commits 7e0d0534, e005b59d and 5d3eac0d are present in `git log`.
