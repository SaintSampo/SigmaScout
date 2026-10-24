---
id: 2027-season-before-the-game
created: 2026-10-24
source: quick 261024-lfa
priority: high
due: 2027-01 (kickoff), and in any case before the first 2027 event, 2027-02-20
---

# 2027: from a roster-only season to a game season

## Why this matters

Since quick task 261024-lfa, 2027 is a roster-only season: the site lists its 216 events and their
rosters, and nothing else. Its game rules come out at kickoff in January 2027. The day they are
registered, the roster-only path and the live-window filter lift together, so the order of the steps
below matters. `docs/worker-operations.md`, section "A season before its game: 2027", explains the
mechanism.

## Items

**(a) The January rules work, then the rebaseline, in that order.**

- Register the 2027 score-breakdown component map and the 2027 RP rule module (see
  `locks-first-live-2027-watch.md` items 8 and 11).
- Registering them lifts the roster-only path (`isRosterOnlySeason(2027)` turns false) and the window
  filter in `buildLiveWindowsManifest` at the same moment. From then on any manifest build lists 2027
  windows, and the Worker would try to fold 2027 events against a D1 seed with no 2027 state.
- So rebaseline with 2027 as the final season (carry from 2026, seed from 2027) BEFORE any
  `publishLiveWindows` run and before the first 2027 event, 2027-02-20 (its probe window would open
  2027-02-19).
- Then delete or retarget `pnpm publish:roster-seasons`. Its pin in
  `packages/harness/publish.rosterOnly.test.ts` fails on purpose once no roster-only season is left
  in `publish:seasons`.

**(b) Districts.** `pnpm publish:districts` gains 2027 only after the 2027 district point model,
bracket, pay rule and award slate are registered. Until then it stays `--years 2016-2020,2022-2026`.

**(c) Web.**

- Move `DEFAULT_SEASON` (`apps/web/src/lib/seasons.ts`) to 2027 when 2027 has results to open on.
- `PODIUM_SEASONS` (`apps/web/src/lib/homePodium.ts:31`) and `DEFAULT_CALIBRATION_YEAR`
  (`apps/web/src/components/compare/CalibrationSection.tsx:31`) are literals. Decide whether each
  moves.
- `AS_OF_PRICEABLE_SEASONS` (`apps/web/src/components/districts/asOfRewind.ts:614`) and
  `BONUS_RP_BY_SEASON` (`apps/web/src/lib/bonusRp.ts:31`) follow the 2027 RP rules.

**(d) Roster freshness.**

- `event_teams` is upsert-only (`packages/corpus/db.ts`, `upsertEventTeam`, about :1394-1401). A team
  that withdraws from an event stays listed.
- Reconciliation (per event, drop the rows missing from TBA's 200 answer during the
  `--event-teams-only` pass) is deferred on purpose. It would change `event_teams` for every season,
  and the district bake and Locks read that table.
- `scripts/rebaseline.ts` ingests only the clock year (`new Date().getUTCFullYear()`, about :170). A
  rebaseline before 2027-01-01 therefore republishes 2027 from the corpus as it stands, without a 2027
  ingest. `pnpm publish:roster-seasons` is the refresh until then.

**(e) Week 0.**

- A roster-only season with any played match refuses to publish (the preflight in `publish.ts`). So a
  2027 Week 0 played before the rules land stops `pnpm publish:roster-seasons` with that message. The
  fix is the rules work in (a), not a bypass.
- The research inventory for 261024-lfa flags that a season whose only played matches are Week 0
  can throw in `aggregateScores` (`packages/harness/score.ts:279-286`, called from the compare write
  in `publish.ts`). The first 2027 compare write will meet this in February. Check it before then.

**(f) TBA normalization.** `.planning/research/PITFALLS.md:107` says to re-verify TBA normalization
per season. Do that on the first 2027 score breakdowns.
