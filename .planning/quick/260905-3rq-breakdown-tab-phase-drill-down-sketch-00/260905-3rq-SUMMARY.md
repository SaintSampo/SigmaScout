---
quick_id: 260905-3rq
status: complete
date: 2026-09-05
commit: 32733ee1
---

# Summary: Breakdown tab phase drill-down (sketch 009-A) + sortable columns

## What changed

`BreakdownTab.tsx` rebuilt to sketch 009 winner A with the user's follow-up decisions:

- **Collapsed default** (VPR/EPA): Team #, Team Name, Total, Auto, Teleop, Endgame,
  Fouls Committed — seven columns, measured zero horizontal scroll at 1440px against the
  live `2026alhu` artifact. The phase columns are the PUBLISHED
  `phaseAuto`/`phaseTeleop`/`phaseEndgame` metrics (value + spread + percentile verified
  live), so they carry real tier boxes.
- **Drill-down**: a group-band header row with one toggle per phase (`aria-expanded`,
  accent ink); expanding swaps the phase column for its component columns in place.
  Expansion is `useState` only — deliberately NOT a URL param (user decision).
- **Sorting** (sketch B folded in, user decision): every metric header is a sort button
  using `TeamsTable.tsx`'s exact affordance (button-in-th, `aria-sort`, accent ▲/▼);
  missing-key-last and team-number tie-break rules generalized from the fixed Total sort
  (`sortBreakdownRows`); collapsing the group owning the active sort key resets to Total
  descending.
- **Fallback**: rows pass through `withDerivedGroupMetrics`, so a stale pre-260904-7id
  EPA cache renders an honest value-only phase cell (no ±, no tier).
- **OPR untouched** (user decision): flat Total-only table, no group row, no sort UI.
- Skeleton mirrors the collapsed-default column set.

## Verification

- 509 tests across the event component suite + route + metric libs pass, including new
  suites: collapsed column set, expand/collapse swap, sort click/flip/reset,
  derived-vs-published phase cells, missing-key/tie unit rules, OPR unchanged.
- Browser (vite + `VITE_ARTIFACT_ORIGIN` proxy + Playwright, live 2026alhu data):
  collapsed scrollWidth == clientWidth (866px, no scroll); Teleop expands under its
  band; Auto header click re-sorts descending with the arrow moving; 390px mobile keeps
  the pinned team-number column. Screenshots delivered in-session.

## Notes

Executed inline by the orchestrator (sketch/design context resident; the visual pass
needs the main context's browser tooling). Commits staged by explicit path only — a
retune/republish agent shares this checkout.
