---
id: 260929-fav
slug: field-averaged-per-team-share-under-the
kind: quick
mode: inline
created: 2026-09-29
description: "Field-averaged contributions price each team as a three-copy alliance, so a cold or thin team adds one team's share under the RP cold-team prior"
files_modified:
  - packages/harness/preSchedule.ts
  - packages/harness/preSchedule.test.ts
  - docs/models/field-averaged-presim.md
autonomous: true
---

# Quick task 260929-fav: one team's share in the field

260928-p8i recorded that under the RP cold-team prior `buildFieldContributions` over-weights cold
and thin teams by about the alliance size: a one-team `momentsFor` call hands a cold team the
league's whole-alliance mean and variance. Fix: price each team as an alliance of three copies of
itself and divide back (mean by 3, variance by 9). Warm teams are unchanged up to float rounding;
cold and thin teams get exactly the per-team share the prior gives them in a real match.
Measurement-only: nothing shipped reads this path.

Executed inline.
