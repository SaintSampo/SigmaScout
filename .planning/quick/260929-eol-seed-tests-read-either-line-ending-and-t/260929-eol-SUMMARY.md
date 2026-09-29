---
id: 260929-eol
slug: seed-tests-read-either-line-ending-and-t
kind: quick
status: complete
completed: 2026-09-29
subsystem: tests and methodology
key-files:
  modified:
    - packages/harness/rpSeed.test.ts
    - packages/harness/sigmaSeed.test.ts
    - scripts/measureAllianceWinProbability.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/methodology/districtLedgerContent.test.ts
decisions:
  - "Fix the tests, not the file: autocrlf rewrites publish.ts as CRLF on every checkout, so only a line-ending agnostic read lasts."
  - "Every constant came from the test's own measurement path at full precision; the page figures are those constants formatted as the page already formats them."
owed: []
---

# Quick task 260929-eol: two local-only reds

Re-measured 2026 with the recorded command, 20,048 scored matches (was 19,792):

| Measure | Was | Now |
|---|---|---|
| Mean absolute gap | 0.0552 | 0.0555 |
| Median absolute gap | 0.0417 | 0.0420 |
| 90th percentile gap | 0.1224 | 0.1227 |
| Different winners | 4.44% | 4.49% |
| Browser Brier | 0.1462 | 0.1464 |
| Published Brier | 0.1443 | 0.1445 |
| Sign only Brier | 0.2112 | 0.2114 |

The full root suite is green locally: 305 files, 7,127 passed, 1 skipped.
