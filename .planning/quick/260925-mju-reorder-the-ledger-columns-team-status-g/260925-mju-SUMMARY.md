---
id: 260925-mju
slug: reorder-the-ledger-columns-team-status-g
kind: quick
status: complete
completed: 2026-09-25
subsystem: apps/web
key-files:
  modified:
    - apps/web/src/components/districts/DistrictLedger.tsx
    - apps/web/src/components/districts/districtLedgerCopy.ts
    - apps/web/src/components/districts/districtLedgerCopy.test.ts
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
decisions:
  - "The centred-header rule became a set of text-column indexes (0, 1, 3) instead of an index threshold, since the numeric Grand total column now sits between two text columns."
  - "The no-events row keeps the same shape: Team, Status, Grand total, then one muted cell spanning the remaining six columns."
  - "Folded in at Jacob's request: the rookie bonus is printed in the Team cell (+10 or +5 rookie bonus) and in the grand total drawer caption, with a methodology paragraph; the math already included it in the grand total and the floors."
owed: []
---

# Quick task 260925-mju: the ledger's columns in Jacob's order

Team, Status, Grand total, Event, Event total, Qualification, Alliance selection, Playoffs,
Awards. Team, Status and Grand total span each team's rows as before; the drawer row still spans
every column. 182 district tests green, web typecheck clean; the live e2e spec pins no header
order and counts cells by test id, so it is unaffected.
