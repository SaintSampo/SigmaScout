---
phase: quick-261014-ol7
plan: 01
subsystem: web / methodology
tags: [methodology, locks, alliance-selection, weighted-draft, charts]
status: complete
requires:
  - packages/core/districts/pickPositionTables.ts (PICK_POSITION_COUNTS, quick 261014-ol6)
  - .planning/quick/261014-mji-measure-a-random-pick-draft-against-the-/261014-mji-SUMMARY.md (measured scores)
provides:
  - /methodology/alliance-picks, "Predicting alliance picks"
  - a seventh methodology hub card (after district points)
  - the district points page's alliance selection section now names the weighted draft and the new page
affects:
  - apps/web/src/components/methodology/districtLedgerContent.ts
key-files:
  created:
    - apps/web/src/routes/methodology.alliance-picks.tsx
    - apps/web/src/routes/methodology.alliance-picks.test.tsx
    - apps/web/src/components/methodology/AlliancePicksPage.tsx
    - apps/web/src/components/methodology/alliancePicksContent.ts
    - apps/web/src/components/methodology/alliancePicksContent.test.ts
  modified:
    - apps/web/src/components/methodology/methodologyCardData.ts
    - apps/web/src/components/methodology/methodologyCardData.test.ts
    - apps/web/src/components/methodology/MethodologyCards.tsx
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/methodology/districtLedgerContent.test.ts
decisions:
  - "The pick table chart reads PICK_POSITION_COUNTS at its newest season key (2027: 2016 to 2026, 7,896 first and 7,896 second picks); the caption's seasons and counts are computed from the module, never pasted."
  - "Scores use the 261014-mji pooled rows at four decimals (Brier, log loss) and two for calls right, because the calls right gap is 0.22 points."
  - "Charts use the site's neutral histogram treatment and slate and ink tokens told apart by shape (hollow ring for best SPR left, filled dot for the weighted draft); the site has one light theme."
  - "Calibration notes are placed from the perfect line's geometry with leaders, after a fixed offset collided on a phone."
metrics:
  duration: "about 45 minutes"
  completed: 2026-10-14
  tasks: 3
  files: 10
actuals:
  tasks: 3
  commits: 2
---

# Quick 261014-ol7: a methodology page for the weighted pick draft

Jacob asked for the weighted pick draft explainer artifact to become a methodology page, briefer than the artifact but keeping its interactive parts. Built in its own worktree (SigmaScout-ol7, branch quick/261014-ol7) while 261014-ol6 ships the draft itself.

**/methodology/alliance-picks ("Predicting alliance picks"): a short lead, an interactive pick table chart read from the committed PICK_POSITION_COUNTS, the measured scores against best SPR left and best rank left, an interactive said versus happened chart, and four things the model leaves out. The district points page now points to it.**

## What was built
- Route `/methodology/alliance-picks`, h1 "Predicting alliance picks"; a seventh hub card after Predicting district points ("How the Locks simulation makes each alliance pick, and how that scores against real drafts.").
- The pick table: First pick / Second pick toggle, Teams left slider 2 to 40 (default 29), bars cut to the line and rescaled, a stat line (best team left, one of the best 3), hover tooltips, a table view. Caption computed from the module.
- How it scores: pooled 2023 to 2026, 485 events, 17,412 teams: best SPR left 0.1327 / 0.6197 / 86.73%; weighted draft 0.0917 / 0.2886 / 86.95%; best qualification rank left 0.1865 / 0.8672 / 81.35%; one sentence that the weighted draft scored better on all three in every season.
- Said versus happened: two hollow points for best SPR left with "1 in 5 picked" and "1 in 10 not picked", 12 filled points for the weighted draft, dashed perfect line, legend, tooltips, table view.
- What it leaves out: the SPR gap; one table for every captain and event; declines; backup robots.
- District points page: "Picks are taken in rating order among the teams still available." replaced by "Each pick is drawn from a table of where real picks sat in the line of teams still available, sorted by rating. That table and how it scores are on the Predicting alliance picks page." The agreement table stays.

## Verification
- `npx vitest run apps/web/src/components/methodology apps/web/src/routes/methodology` (worktree root): 15 files, 287 passed.
- Typechecks root, apps/web, apps/web e2e: exit 0 (route tree generated with `npx vite build`).
- Local `vite preview`, Playwright desktop 1280 and phone 390: no SVG text overlaps, no page errors, no horizontal page overflow; the results table scrolls inside its own wrapper on a phone. The orchestrator looked at the desktop screenshot.

## Deviations
1. `MethodologyCards.tsx` and `methodologyCardData.test.ts` changed too: the hub destructures cards by position.
2. Calibration notes placed from the line's geometry (the artifact's fixed offsets collided on a phone).
3. Neutral chart colors told apart by shape, per the site's accent rule.
4. "Today's fixed order" is labelled "Best SPR left, every time", because the page presents the weighted draft as live.

## Open items
- The page describes the weighted draft as live; it must merge and push together with 261014-ol6.
- `districtLedgerContent.ts` still says "Once qualification is over the ranking is settled, so the cell prints the exact points and the alliance the draft gives that team." That becomes false with the weighted draft; handed to 261014-ol6, which audits the settled draft assumption in code.

## Commits
- 003f034a feat: a Predicting alliance picks methodology page for the weighted draft
- b9d14d91 docs: the district points page says picks are drawn from the pick table and names the new page

## Self-Check: PASSED
