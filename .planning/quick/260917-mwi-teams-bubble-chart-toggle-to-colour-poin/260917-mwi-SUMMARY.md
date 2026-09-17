---
status: complete
quick_id: 260917-mwi
commits:
  - 29ab1781
  - 9e81ab98
  - 652086cd
  - 25805725
  - f60dfe21
  - 658fec1a
---

# 260917-mwi: Teams bubble chart "Colour by" toggle — Summary

The Teams bubble chart gains a two-segment "Colour by" control (Total / Sigma Score). Sigma Score
mode tints each point by the rarity tier already published on the row's `sigma` metric entry.
Geometry, axes, omission counts and hit-testing are unchanged. No pipeline change.

## What changed

- `teamsBubbleModel.ts`: `buildBubbleModel(rows, colorBy = "total")` with
  `BubbleColorBy = "total" | "sigma"`. Sigma mode reads only `row.sigmaTier`; both `"common"` and
  `undefined` map to `"neutral"` (`toneForSigmaTier`), which is what the existing
  "Common / unranked" key label already says. No tier is ever derived from a value in the web app.
- `TeamsBubbleChart.tsx`: `colorBy` / `onColorByChange` props (both optional, like `onSelectTeam`).
  The control follows `CompLevelSwitcher`'s idiom: `role="group"` of `Button`s, `aria-pressed`,
  `aria-labelledby` the visible "Colour by" span, labels from `metricDisplayLabel(TOTAL_KEY)` and
  `SIGMA_AXIS_LABEL`. It is a SIBLING of `bubble-chart-key`, not a child, because a test pins that
  row's children by equality. Absent in the no-Sigma state (OPR/EPA). `colorBy` reaches
  `pathByTone` only through the model identity; the memo stays keyed on `[model, plot]` and the
  at-most-four-paths invariant holds.
- `searchParams.ts` / `teams.tsx`: `tint: z.literal("sigma").optional().catch(undefined)`, mirroring
  `chart`. The Total segment writes `undefined`, so default URLs are byte-identical to before.
- Tests: the two axis-title `getByText` assertions were SCOPED to `within(getByRole("img"))`, not
  weakened, since the segment labels now share their text. +5 model, +9 component, +2 search param,
  +5 route tests. Two mutations (default flipped to sigma; `"common"` passed through) each caught.

## Verification

- Four task-owned test files: 97/97 (re-run by the orchestrator). Root and web `tsc` clean.
- Real-browser check by the orchestrator against live 2026 SPR data (local vite, Playwright,
  desktop 1400px and phone 390px): clicking Sigma Score adds `tint=sigma` and keeps
  `year/algorithm/chart/sortDir`; tone groups regroup (neutral 1847 / rare 925 / epic 739 /
  legendary 188); the control wraps under the key row at phone width with no horizontal scroll.
- What the live picture shows: under the CURRENT published tiers almost no team above a Total of
  about 250 is tinted at all. That is the defect 260917-jzh fixes; this view will only look right
  once the spr@5.0.0+baseline republish lands.
- No e2e spec added (no existing bubble-chart spec to extend). Live e2e should be rerun after deploy.

## Found during this task, NOT fixed (belongs to 260917-jzh)

`packages/harness/level1Digest.test.ts` is red: the committed
`data/baselines/level1-digest-2026-09.json` records SPR (entry id `bpr`) at `4.0.0+baseline` and
260917-jzh bumped it to `5.0.0+baseline`. The 260917-jzh executor's "3 unrelated failures" gate
report missed it. Precedent (b8eb402e, the 4.0.0 bump) moved ONLY the version string and left the
sha256 untouched; doing the same here and re-running the gate would also prove `predict()` is
unchanged. The orchestrator's edit of that guarded file was denied by the permission classifier, so
it is left for Jacob to approve or make.
