---
id: 260929-fav
slug: field-averaged-per-team-share-under-the
kind: quick
status: complete
completed: 2026-09-29
subsystem: packages/harness
key-files:
  modified:
    - packages/harness/preSchedule.ts
    - packages/harness/preSchedule.test.ts
    - docs/models/field-averaged-presim.md
decisions:
  - "Three copies of the team rather than a new accumulator method: no production code changes, and the prior's own roster scaling produces the per-team share."
  - "The warm-team pin moved from exact equality to 12 decimal places, because three copies divided back can differ from one team in the last bit."
owed: []
---

# Quick task 260929-fav: one team's share in the field

A new prior-on test pins a cold team at the league alliance mean over 3 and variance over 9, and a
thin team at its own mean with variance over 9. 16 files, 861 tests green across the preSchedule,
field-averaged script and ranking-points suites. The doc's caveat now says the path is corrected
and that its recorded figures predate the correction. The script still replays without the Sigma
carry, a separate caveat this task does not touch.
