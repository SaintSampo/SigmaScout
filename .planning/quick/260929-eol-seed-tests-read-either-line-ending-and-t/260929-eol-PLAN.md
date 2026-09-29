---
id: 260929-eol
slug: seed-tests-read-either-line-ending-and-t
kind: quick
mode: inline
created: 2026-09-29
description: "Seed tests read publish.ts line-ending agnostic, and the alliance win probability figures are re-measured on the current corpus"
files_modified:
  - packages/harness/rpSeed.test.ts
  - packages/harness/sigmaSeed.test.ts
  - scripts/measureAllianceWinProbability.ts
  - apps/web/src/components/methodology/districtLedgerContent.ts
  - apps/web/src/components/methodology/districtLedgerContent.test.ts
autonomous: true
---

# Quick task 260929-eol: two local-only reds

1. With core.autocrlf true, the working copy of packages/harness/publish.ts is CRLF, and three
   structural regexes in the RP and Sigma seed tests are written for LF. Converting the one file
   would not survive the next checkout, so the tests normalise line endings where they read it.
2. The corpus-guarded alliance win probability test drifted after the 2026-09-28 corpus change
   (0.05554 against a recorded 0.05522). Re-measure with the recorded command and restate every
   constant, the methodology table and its pinned strings together.

Executed inline.
