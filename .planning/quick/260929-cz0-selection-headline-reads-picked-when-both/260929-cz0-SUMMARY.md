---
id: 260929-cz0
slug: selection-headline-reads-picked-when-both
kind: quick
status: complete
completed: 2026-09-29
subsystem: apps/web
key-files:
  modified:
    - apps/web/src/components/districts/districtLedgerOutcomes.ts
    - apps/web/src/components/districts/districtLedgerOutcomes.test.ts
decisions:
  - "The rule uses the cell's own Math.round(p * 100), so the chooser and the printed digits cannot disagree."
  - "A captain chance that prints as 1% still names captain, even with no pick at all: a route beside a printed number is honest."
owed:
  - "Live check after the Pages deploy: no Alliance selection cell reads captain ~0% on 2026pnw rewound to 2026wayak qm30."
---

# Quick task 260929-cz0: no route named beside a zero

`districtSelectionHeadline` returns picked when both route chances round to 0%. Two tests pin the
boundary (3 in 1,000 reads picked, 6 in 1,000 reads captain at 1%). 480 district web tests green,
web typecheck clean.
