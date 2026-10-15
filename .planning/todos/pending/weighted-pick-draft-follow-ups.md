---
id: weighted-pick-draft-follow-ups
created: 2026-10-15
source: quick 261014-i1c, 261014-mji, 261014-ol6, 261014-qv2
priority: medium
due: item 1 before the first 2027 district event (2027-03); the rest when convenient
---

# Follow ups from the weighted pick draft and joint event draws

Shipped 2026-10-14 (origin/main 789bd6e6): every Locks simulation draws each alliance pick from walk forward pick position tables, and the advancement run draws each event jointly, so the District Locks cutoff range holds 179 of 205 backtest positions (87%, inside the 72% to 88% band). These are the known gaps left behind, none of them a regression.

## 1. Live season: events priced from a sidecar are still drawn independently (do before 2027 week 1)

The joint draw needs each event's total per team per run. Events the browser simulates or bakes have it; an unstarted event in a LIVE season is priced from a published presim sidecar, which holds only marginals. So at a live season start the cutoff range for those events falls back to the independent draw and runs wide again (the weighted draft alone read 194 of 205, 95%). The offseason is unaffected (no sidecar is bake eligible). Fix options: add per run totals to the sidecar (an artifact change: version bump and republish), or bake those events in the browser. The fallback is visible in `independentEventKeys` (`apps/web/src/components/districts/districtLedgerChances.ts`).

## 2. The Champ Locks champ run draws district points independently

Only the Champ tab's district run (its field chances) reads the joint draw; the champ run itself still draws each team's district points on its own, and the core refuses joint input in champ mode (`packages/core/districts/advancementChance.ts`). Decide whether to extend the joint draw there, and measure with `scripts/measureChampCutoff.ts` and `measureLocksInRange.ts` first.

## 3. The District Locks table runs wider than its container at desktop width

The Playoffs column grew from 157 px to 184 px when the box gained the best guess finish (261014-i1c). The table already overflowed its 1150 px container on the live site at a Round 3 stop (1192 px, Awards partly hidden); it now overflows by about 69 px. Measured at 1440 px on 2026 FIM Livonia Round 3.
