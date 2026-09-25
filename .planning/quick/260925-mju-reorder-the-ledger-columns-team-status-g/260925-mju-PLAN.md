---
id: 260925-mju
slug: reorder-the-ledger-columns-team-status-g
kind: quick
mode: inline
created: 2026-09-25
description: "Reorder the ledger columns: Team, Status, Grand total, Event, Event total, Qualification, Alliance selection, Playoffs, Awards"
files_modified:
  - apps/web/src/components/districts/DistrictLedger.tsx
  - apps/web/src/components/districts/districtLedgerCopy.ts
  - apps/web/src/components/districts/districtLedgerCopy.test.ts
autonomous: true
---

# Quick task 260925-mju: Jacob's column order

Jacob, 2026-09-25, with a mock: the grand total moves next to the status so a team's two
totals read before its per-event detail, and the event total moves in front of the four
categories. New order: Team, Status, Grand total, Event, Event total, Qualification, Alliance
selection, Playoffs, Awards. The team, status and grand total cells still span the team's rows.

Executed inline: the label list, the centred-header rule (text columns are now 0, 1 and 3), and
both row shapes (the ordinary two-row team and the no-events team) in `DistrictLedger.tsx`.
