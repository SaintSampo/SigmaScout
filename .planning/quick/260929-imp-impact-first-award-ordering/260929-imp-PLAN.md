---
id: 260929-imp
slug: impact-first-award-ordering
kind: quick
mode: executor
created: 2026-09-29
description: "Impact award ordering sorts on prior Impact wins first, with a walk-forward priorImpactWins count on every district award profile and tables re-measured under the new ordering"
autonomous: true
---

# Quick task 260929-imp: the Impact ordering sorts on prior Impact wins first

Jacob, 2026-09-29: "do items 3, 4 and 5", where item 4 is "stronger Impact-first award ordering".

## Why

`packages/core/districts/awardOrderingTables.ts` prices a team's chance of winning Impact from its
POSITION in the event's ordering by total prior judged awards. Its own header records what that
leaves on the table: season 2026, position 1, the one-number ordering wins 17.99% (136 of 756),
while the award-type-first ordering (prior Impact wins, then prior judged awards, then team number)
wins 26.06% (197 of 756). It was held back only because it needs a second per-team count,
`priorImpactWins`, on every district artifact. Jacob has now made that trade.

## What to build

1. **One ordering function in core.** Move the award-type-first comparator into
   `awardOrderingTables.ts` (it currently lives as `orderFieldByImpactHistory` in
   `scripts/measureAwardOrderingTables.ts`). The Impact position lookup uses it. The Rookie All
   Star ordering is unchanged (`orderFieldByDecoration` among rookies). The measurement script, the
   committed tables and the ledger draw must all read the SAME function, as they do today.
2. **Re-measure the Impact tables under the new ordering** for every registered season, walk-forward
   exactly as now (a season-Y table is fit only on district-tier events from seasons before Y, and
   a team's counts use only seasons strictly before the event's own). Write the committed literals
   from the script's printed output, never by hand. Keep the old one-number ordering as the printed
   REFERENCE line, so the gap stays visible in the other direction. The residual and Rookie All
   Star tables should not move; if they do, stop and report why.
3. **Schema.** `DistrictAwardProfile` in `packages/harness/pageArtifacts.ts` gains optional
   `priorImpactWins` (int, nonnegative), documented like `priorJudgedAwards`.
4. **Publisher.** `scripts/publishDistricts.ts` computes `priorImpactWins` per team, walk-forward,
   with the same counting rule the measurement script uses (distinct year and event instances of
   award type 0, seasons strictly before the artifact's season). Share the counting helper rather
   than copying it.
5. **Ledger draw.** `packages/core/districts/ledgerSimulation.ts` (around the ordering entries near
   line 350) and `apps/web/src/components/districts/districtLedgerRows.ts` (around line 501) carry
   `priorImpactWins` through. If ANY roster team's profile lacks it, take the base-rate fallback,
   exactly as a missing `priorJudgedAwards` does today: the committed tables are measured under the
   new ordering, and pairing them with the old ordering would misprice position 1.
6. **Methodology copy.** Wherever the site describes the Impact ordering or quotes its position-1
   figure (`apps/web/src/components/methodology/awardsContent.ts`,
   `apps/web/src/components/methodology/districtLedgerContent.ts`), update it to the new ordering and
   the re-measured figure, with the tests that pin those strings. Voice: flat third person, no
   hyphen or dash characters, short sentences.
7. **Header comments.** Rewrite the "WHAT THIS ORDERING LEAVES ON THE TABLE" block to say the
   award-type-first ordering now ships, with both figures.

## Constraints

- No award prediction ever reaches `locks.ts`. `pnpm measure:ledger-tenets` must still report both
  tenets 0 with unchanged totals.
- No network of any kind: no publish, no deploy, no push, no R2 or D1. Never read, cat or echo
  `.env`. The main session runs the Worker deploy and the republish.
- Worktrees are disabled; work on the main tree. Stage by explicit path only, never `git add -A`.
- DO NOT TOUCH these files, which the main session is editing in parallel:
  `apps/web/src/components/districts/districtLedgerCopy*`,
  `apps/web/src/components/districts/districtLedgerOutcomes*`,
  `apps/web/src/components/districts/LedgerParts.tsx`, `packages/harness/preSchedule*`,
  `scripts/measureFieldAveragedRanks*`, `docs/models/field-averaged-presim.md`,
  `.planning/STATE.md`, `.planning/sketches/`.
- Do not write SUMMARY.md or STATE.md. Return the full SUMMARY.md text as your final message.

## Verification

- `npx vitest run` from the repo root (not from apps/web), all green.
- `npx tsc --noEmit` at the root, and with `-p apps/web`, `-p apps/worker`,
  `-p apps/web/tsconfig.e2e.json`.
- `pnpm measure:ledger-tenets`: both tenets 0.
- A publisher dry run to a local folder (no upload), for example
  `npx tsx scripts/publishDistricts.ts --years 2026-2026 --dry-run --local-out data/local-publish/imp`,
  confirming `priorImpactWins` is present on 2026pnw's award profiles, the district budget test
  passes, and the PNW verdict census is unchanged (locked 42, lockedAward 8, eliminated 76).
- Report the new 2026 position-1 Impact figure and the old one side by side.
