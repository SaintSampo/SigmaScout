---
phase: 10
slug: district-points-ledger
source: sketch 021 variant A (.planning/sketches/021-district-points-ledger/README.md, artifact https://claude.ai/artifact/9yjeRCMN13tD8XbmQBMKzZ version 5)
status: contract
created: 2026-09-25
---

# Phase 10 UI design contract

This phase's UI contract is sketch 021 variant A, rendered on real data and iterated with Jacob
through four rounds on 2026-09-25. The sketch README is the source of truth for layout, copy and
the status rule; `.claude/skills/sketch-findings-sigmascout/` is the source of truth for palette
tokens, the uncertainty display rules and chart craft. This file only lists the rules a verifier
can check, so the planner can lift them into `must_haves`.

## Layout (from the sketch)

- The Districts page tab formerly "District Locks" is labelled "Road to District Champs".
- One table: two rows per team (one per district event, week order), columns Team, Status,
  Event, Qualification, Alliance selection, Playoffs, Awards, Event total, Grand total (spans both
  rows). Sticky first column; horizontal scroll inside the card at 390px, page never pans.
- Above the table: the "Rewind to" slider with jump chips, the five status chips as filters with
  live counts and a definition tooltip, a definitions row, a team number search, a stat line.
- Clicking a blue cell opens a drawer row under that team: the cell's histogram beside the
  grand total histogram. Clicking again closes it. One drawer open at a time.
- Hairline separators only. No heavy rules (tried and dropped).

## UI Considerations

| Consideration | Status | Acceptance |
|---|---|---|
| A finished category is a grey cell with a single integer, never a range | covered | `DistrictLedger` renders `data-cell="final"` cells with text matching `/^\d+$/` |
| An open category cell is blue, is a `<button>`, and prints either a median plus "likely a to b" or a chance plus "~n if ..." | covered | component test asserts both text forms on fixture rows |
| No `±` glyph anywhere on the tab | covered | component test: rendered text contains no "±" |
| Status chips read exactly Prequalified, Locked, In range, Out of range, Locked out | covered | test pins the five labels; "Locked · award" variant when an award is the reason |
| Locked out chip uses the red status token; no other red on the tab | covered | token `--color-status-locked-out` (or the existing eliminated token) and a grep that no literal hex appears in the component |
| Rows are sorted by the median of the predicted grand total, finished teams by actual total | covered | test with a fixture where a lower-earned team has a higher median sorts above |
| Histogram drawer follows sketch 005: continuous 10th to 90th edges, median tick, fixed per-column scale | covered | reuses `continuousQuantile` from `rankRows.ts`; test pins band edges on a known pmf |
| The slider rewinds by match and reopens later categories of a finished event | covered | test: moving the slider before an event's last qual match turns its selection, playoff and award cells blue |
| The tab paints from the district artifact with no simulation for finished and unstarted events | covered | test: no Worker message is posted when every event is finished or unstarted |
| The old District Locks table and its status vocabulary ("Out of range" as eliminated, "Contending") no longer render | covered | test asserts absence of "Contending" and of the old header stats card |
| Reduced motion: the drawer opens without animation when `prefers-reduced-motion` | backstop | manual check in the UAT |
| Phone width: the table scrolls inside its card, the slider and chips wrap | backstop | e2e spec at 390px after deploy |

## Copy

- Definitions (exact): Prequalified "prequalified by FIRST"; Locked "mathematically qualified,
  no matter what, on district points or an award"; In range "if every team earned its median
  predicted points, this team would qualify"; Out of range "if every team earned its median
  predicted points, this team would not qualify"; Locked out "cannot earn enough district points
  to qualify".
- Legend key: "earned, final" and "still open · click for the histogram"; "likely = 8 of 10 runs
  land here · ~ = typical amount when it happens".
- Methodology copy for awards and the selection model follows `awardsContent.ts` voice rules:
  flat third person, no dash characters, no how or why sentences.
