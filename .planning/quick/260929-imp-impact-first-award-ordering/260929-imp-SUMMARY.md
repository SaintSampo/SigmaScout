---
id: 260929-imp
slug: impact-first-award-ordering
kind: quick
status: complete
completed: 2026-09-29
subsystem: districts/awards
key-files:
  modified:
    - packages/core/districts/awardOrderingTables.ts
    - packages/core/districts/awardOrderingTables.test.ts
    - packages/core/districts/ledgerSimulation.ts
    - packages/core/districts/ledgerSimulation.test.ts
    - scripts/measureAwardOrderingTables.ts
    - scripts/measureAwardOrderingTables.test.ts
    - packages/harness/pageArtifacts.ts
    - packages/harness/pageArtifacts.test.ts
    - packages/harness/districtRankingsMerge.test.ts
    - scripts/publishDistricts.ts
    - scripts/publishDistricts.test.ts
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerRows.test.ts
    - apps/web/src/components/methodology/awardsContent.ts
    - apps/web/src/components/methodology/awardsContent.test.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/methodology/districtLedgerContent.test.ts
decisions:
  - "The Impact ordering is award type first: prior Impact wins, then prior judged awards, then ascending team number. orderFieldByImpactHistory lives in core awardOrderingTables.ts, and the measurement script and the ledger draw both read it."
  - "Rookie All Star ordering unchanged. After re-measurement the Rookie All Star and residual tables are identical to the committed ones in all seven registered seasons."
  - "All or nothing, per count: a field where any team lacks priorImpactWins takes the base-rate path, exactly as a missing priorJudgedAwards does. It never pairs the old ordering with tables measured under the new one."
  - "ZERO_AWARD_PROFILE carries priorImpactWins 0, so an unprofiled guest team never takes its field off the ordering path."
  - "The publisher imports the measurement script's priorImpactWinCount (distinct year and event wins of award type 0, seasons strictly before) rather than copying it."
  - "The methodology pages state the new ordering and its figures only; the replaced 17.99% stays off the page."
owed: []
---

# Quick task 260929-imp: the Impact ordering sorts on prior Impact wins first

The Impact award cell is now priced from a team's position in an ordering that sorts on prior
Impact wins first. Every district award profile publishes a walk-forward `priorImpactWins` count.
Executed by a gsd-executor; this summary is its returned text, written by the main session.

## Measured figures, position 1 Impact, new against old

| Season | New | Old |
|---|---|---|
| 2019 | 23.04% of 230 | 16.96% |
| 2020 | 26.06% of 330 | 18.48% |
| 2026 | 26.06% (197 of 756) | 17.99% (136 of 756) |

2026 position 2: 14.42% (was 13.10%). 2026 tail from eleventh down: 0.45% (was 0.56%). The Rookie
All Star tables and the residual tables did not move.

## What changed

1. **Core ordering.** `orderFieldByImpactHistory` moved from the measurement script into
   `awardOrderingTables.ts`; the Impact table is measured with it and the ledger draw orders with it.
2. **Re-measured Impact tables** for 2019, 2020 and 2022 to 2026, walk-forward, written
   programmatically from the script's JSON output. The old one-number ordering is the printed
   REFERENCE line. The corpus-guarded test re-measures every season.
3. **Schema.** `DistrictAwardProfile` gains optional `priorImpactWins`.
4. **Publisher.** `buildSeasonAwardContext` computes it over the prior-instance index it already
   uses for `priorJudgedAwards`.
5. **Ledger draw.** Both counts are required on every team, else the base-rate path.
6. **Methodology copy.** Both pages state the new ordering and 26.1%.
7. **Header comments** rewritten to say the award-type-first ordering ships, with both figures.

## Verification

- Executor: full root vitest 7,123 passed, 1 skipped, 4 failed in files that import nothing this
  task touched (see below). All four typechecks clean. Ledger tenets both 0 with unchanged totals.
  Publisher dry run: all 126 2026pnw profiles carry `priorImpactWins` (26 above zero), position 1
  logged at 0.2606 on n=756, PNW census unchanged (42 / 8 / 76), district budget tests pass.
- Main session rerun: 65 affected files, 1,790 tests green; root, web and Worker typechecks clean.

## Deferred, not caused by this task

- `rpSeed.test.ts` and `sigmaSeed.test.ts` fail on the main tree only, because the working copy of
  `packages/harness/publish.ts` is CRLF and those tests regex for LF (the known CRLF trap). CI checks
  out LF.
- `measureAllianceWinProbability.test.ts` is corpus-guarded and now measures 0.05554 against a
  recorded 0.05522 after the 2026-09-28 corpus change. It skips in CI, which has no corpus.

## Rollout (main session)

Worker deploy first, since its `DistrictArtifactSchema.parse` would strip `priorImpactWins` from live
merges; then the district republish; then the Pages deploy through the push.
