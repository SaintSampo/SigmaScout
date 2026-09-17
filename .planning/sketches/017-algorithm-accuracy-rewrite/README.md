---
sketch: 017
name: algorithm-accuracy-rewrite
question: "How should the Algorithm accuracy page (/methodology/compare) be cut down: new words only, tables all the way down, or one screen with details on demand?"
winner: "A"
tags: [copy, methodology, compare, accuracy, calibration, coverage, de-ai, tables]
---

# Sketch 017: Algorithm Accuracy Rewrite

## Design Question
Fourth page in the methodology "de-AI" pass (014 Acknowledgments, 015 awards, 016 EPA vs
Statbotics). Unlike those, this page is mostly live tables. Its prose lives in component constants:
`MethodologyNote.tsx` (near tie caption, cold start explanation, "Brier by season" sentence),
`CalibrationSection.tsx` (explainer), `DataCoverageTable.tsx` (two explainers, headings),
`coverageRows.ts` (column labels), and the route's `<h1>Compare`.

## Finding while sketching
`exclusionCounts.coldStart`, `missingResult` and `quarantined` are **zero in all five seasons and
all three views** of the live artifacts (checked 2026-09-17). The page spends a full paragraph
(`COLD_START_EXPLANATION`) on a rule that has excluded no matches, and three of the eight coverage
columns are always zero.

## How to View
open .planning/sketches/017-algorithm-accuracy-rewrite/index.html

## Variants
- **Now** — the live page, combined view, live numbers. Leader pills computed with the same rules
  as `lib/compareTie.ts` (2023 and 2026 winner accuracy are too close to call).
- **A: Same layout, new words** — real title ("Algorithm accuracy", matching the hub card), a two
  sentence lead, three notes become one, short explainers, hyphen free column labels.
- **B: Tables all the way down** — "how to read it" key table, the three calibration cards become
  one side by side table, coverage drops the three always zero columns.
- **C: One screen, details on demand** — accuracy table up top, one calibration sentence per
  algorithm, the calibration table and the coverage section behind disclosures.

## What to Look For
- Whether the calibration mini charts earn their space (A keeps them, B and C drop them).
- Whether hiding always zero coverage columns is acceptable on a page whose job is honesty. If
  taken, the columns must reappear on their own when any value goes above zero.
- "No-call" is renamed "even odds prediction" in all three; "candidate matches" becomes "all matches".

## Implementation notes for whichever wins
- Several of these strings are pinned verbatim in tests as a "copywriting contract"
  (`DATA_COVERAGE_HEADING`, `DATA_COVERAGE_EXPLAINER_D09`, `NEAR_TIE_CAPTION`,
  `COLD_START_EXPLANATION`, `CALIBRATION_EXPLAINER`). Expect test edits in
  `MethodologyNote.test.tsx`, `DataCoverageTable.test.tsx`, `CalibrationSection.test.tsx`,
  `coverageRows.test.ts`, `AccuracyTable.test.tsx` (it asserts words like tune/holdout never
  appear inside the table) and the e2e specs, which are live only and drift.
- The calibration range label is built with an en dash in `calibrationCards.ts` (`rangeLabel`);
  a no dash rule needs that changed to " to ".
- The mock's calibration headline picks the valid bin nearest 70%; the app does the same.

## Outcome (2026-09-17)
**Winner: A, same layout with new words, with two amendments from Jacob:** leave the calibration
bar charts alone, and drop the "Which matches are scored" (data coverage) section entirely.

Shipped: h1 "Algorithm accuracy" plus a two sentence lead (`compareCopy.ts`), the three grey notes
collapsed to one static highlight sentence (`MethodologyNote.tsx` no longer reads artifacts), a
short calibration explainer, and `DataCoverageTable.tsx` / `coverageRows.ts` deleted with their
tests. The artifact still publishes the coverage fields; nothing on the web reads them now.

Left alone on purpose: the calibration cards, including the en dash in their range labels
("70–80%"), since Jacob said not to touch them.
