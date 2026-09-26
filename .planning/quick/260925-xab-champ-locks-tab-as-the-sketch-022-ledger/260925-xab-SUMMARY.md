---
quick_id: 260925-xab
date: 2026-09-26
description: >-
  Champ Locks tab as the sketch 022 ledger: District points and DCMP points as
  the two rows per team, champ tier statuses, the DCMP in the fetch and the
  chance runs, the shared ledger parts extracted
status: complete
---

# Champ Locks tab as the sketch 022 ledger — summary

Tasks 1 to 4 were the first executor; tasks 5 to 9 the second. Nine commits, dc9668fa through 8400aa10.

## Task 1 — the shipped row builder takes a tier, and the champ ledger's two row model

Commit `dc9668fa`. `districtLedgerRows.ts` became tier-aware without moving a byte of its district behaviour. `districtTierEvents(team)` is now `tierEvents(team, "district")`; `BuildDistrictLedgerRowsOptions` and `BuildDistrictEventInputOptions` each gained an optional `tier` defaulting to `"district"`, driving the event collection, the `maxEventPoints` ceilings and the tier handed to `playoffMilestoneFor`; `alliancesAreFinal` takes the expected bracket count rather than the literal eight so an undivisioned DCMP passes the same finished-list gate. The private `openCell` was exported as `openDistrictLedgerCell` so the champ module reads the same cell-form rule rather than copying it. The new pure `champLedgerRows.ts` runs `buildDistrictLedgerRows` twice over the same distributions, once per tier, then folds: the District points row sums each category across the team's district events (grey only when final at every one, otherwise the exact convolution), and the DCMP row is the dcmp pass's single row with its playoff milestone and selection routes carried through, becoming a `notInField` cell variant for a team outside the field. `mixFieldMembership` folds the chance of being in the field into the grand total and nowhere else (variant A). `champLedgerRows.test.ts` pins it over synthetic artifacts and the real 2026 PNW fixture (27 tests); `districtLedgerRows.test.ts` passes with no edits (75 tests).

## Task 2 — champ tier statuses from cmpSlots and the DCMP award qualifiers

Commit `e754d93f`. `champLedgerStatus.ts` mirrors `districtLedgerStatus.ts` and defines no lock rule of its own. The floor is derived by subtraction from the artifact's `pointTotal` across both tiers; the ceiling adds each open category's own tier maximum, at the 3x weight for the DCMP row, with no dcmp ceiling for a team outside the field. Award qualifiers are the DCMP's own consuming awards, each gated on its own category, with `awardKind` distinguishing `winner` from `award`. Two stated decisions: In range and Out of range are decided by rank inside the points pool (a cut-line rule would put both 182-point teams in range and 22 teams into 21 slots), and the champ tier reserves nothing and passes no pooled argument. Against the fixture at an all-final position the recompute reproduces the published census `{locked: 12, lockedAward: 8, contending: 2, eliminated: 104}` with zero disagreements, names `frc2046`/`frc2811`/`frc2910` as winners, reads Today's line as 182, and splits `frc3674` in range at rank 13 from `frc9450` out at rank 14. Twelve tests.

## Task 3 — the DCMP joins the fetch, the timeline and the two chance runs

Commit `009a1110`. `useDistrictLedgerData` gained two additive options defaulting to today's behaviour: `allowedEventKeys` widens the baked-sidecar filter beyond the district tier, and `tierByEvent` sets each event's simulation tier so the DCMP is priced at the 3x ceilings in the same Worker run under one signature. No publisher or timeline change was needed; a new test pins a dcmp-keyed event rewinding through its four stage steps. The new pure `champLedgerChances.ts` widens the district run's per-team marginal into the "to be there" chance by the district-tier verdicts (1 for locked and prequalified, 0 for locked out, the marginal for the two range verdicts, absent for an unranked team), composes the second run over the champ grand totals against `cmpSlots`, and narrows the result so a chance prints under In range and Out of range alone. `districtLedgerChances.ts` now exports `prepareChanceRanking` holding the four refusals unchanged; its suite passes untouched.

## Task 4 — extract the shipped ledger's presentational parts, unchanged

Commit `27a4144f`. A mechanical extraction. `LedgerParts.tsx` holds the class and timing constants, `StatusCell`, `StatusChips`, `CellKey`, `openCellLines`, `LedgerCell`, `TeamCell`, `DrawerCellPane`, `GrandTotalPlot`, `RewindSlider`, `ControlsCard`, `GrandTotalContent` and their helpers; two parameterizations with the district default (`StatusCell.awardLabel` for `Locked · winner`, `DrawerCellPane.tier` so the DCMP's outcome lists price at the 3x weight through the phase's single weight source). The diff to `DistrictLedger.tsx` is 755 deletions against 21 insertions, all of them the import block. `DistrictLedger.test.tsx` passes with no edits (74 tests).

## Verification after task 4

`npx vitest run` from the repo root: 296 test files passed, 6786 tests passed, 1 skipped (a pre-existing corpus-absence guard), zero failures. `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json` both clean.

## Deviations (tasks 1 to 4)

1. `districtLedgerRows.ts` exports `openDistrictLedgerCell`, which the plan did not name, so the champ District points row carries the same cell-form assignment rather than a second copy of it.
2. `districtLedgerChances.ts` was edited though Task 3's file list omits it: `prepareChanceRanking` extracted unchanged, `reconcileAdvancementChances`' status parameter widened to a structural lookup. Its suite passes untouched.
3. An unavailable DCMP subtotal makes the champ grand total unavailable rather than falling back to a district-only figure. The orchestrator found this would blank every grand total for the whole district season, because the artifact names the DCMP only through TBA registrations that exist after qualification; task 5 replaces it with an explicit "district only" fallback (see below).
4. `champFieldMembership` reads `"open"` for every team before the DCMP starts, the plan's acceptance reading. Task 5 refines it: at "now" a dcmp-tier registration is a qualification and reads in.
5. `buildChampLedgerRows` takes an explicit `dcmpStarted` option, defaulting to the dcmp event's own `state` block at "now"; the tab supplies the position-aware value.
6. `districtFieldMembershipChances` omits unranked teams from its map rather than carrying `undefined` values.
7. The two fixture-reading tests locate the fixture by walking up from `process.cwd()`, because under jsdom `import.meta.url` is an `http://` URL that `readFileSync` refuses.
8. `ControlsCard`'s `statLine` prop is typed as `DistrictLedgerStatLine` rather than a `ReturnType`.
9. One test was added to `districtTimeline.test.ts` pinning a dcmp key on the rail.

## Task 9 — the Road to District Champs tab is renamed District Locks

Commit `2b071540`. Jacob, 2026-09-26. `DISTRICT_LEDGER_TAB_LABEL` reads "District Locks" and the phrase is gone from every `.ts`, `.tsx`, `.md` and `.css` file under `apps`, `docs`, `scripts` and `packages`: the methodology prose and its figure pin, the methodology card blurb, the error boundary's noun, the e2e describe titles and comments, `docs/simulation-architecture.md`, the tenets script's console header, the theme comments and every code comment. The URL id `road-to-district-champs`, `DISTRICT_TABS`, `DEFAULT_DISTRICT_TAB`, the `road-to-district-champs-panel` test id and every `?tab=` link are untouched, and the `DISTRICT_TABS` comment states that split. One test needed more than a rename: `districts.test.tsx` asserted no tab was labelled "District Locks", so it now asserts the whole tab strip (`["District Locks", "Champ Locks"]`).

## Task 5 — the Champ Locks tab renders the two row ledger

Commit `55903b08`. `ChampLocksLedger.tsx` is `DistrictLedgerContent`'s structure with the row loop replaced: two rows per team, the nine sketch 022 columns, the Status and Grand total cells spanning both, the Source cell's row label and small line, and the shipped controls card, rewind slider, status chips, caveat and provenance paragraph, all from `LedgerParts.tsx`. The event list, the timeline, the fetch set and the stage map run over both tiers; the DCMP is priced at the 3x ceilings in the same Worker run. The memos are ordered so the district run's marginal becomes the "to be there" chance, that chance weights the grand total, and only then does the champ run rank those totals against `cmpSlots`. Today's line comes from the champ status model, which reproduces the artifact's own 182.

Two orchestrator adjustments landed inside this task. **The pre-registration window**: `remainingEvents` comes from TBA registrations and a team registers for its District Championship only after it qualifies, so for most of a district season nothing on the artifact names the DCMP. The DCMP row now reads "not yet priced" in all five cells, the grand total falls back to the district-only convolution labelled "district only", the statuses still compute from one whole hypothetical DCMP ceiling on the artifact's own `maxRemainingChamp` gates, and the champ chance is suppressed rather than answered with a different question. **Field membership at "now"**: a dcmp-tier registration is a qualification at the live position and reads "in"; an unregistered team reads "open", never "out"; a rewound position keeps everyone the district verdict has not settled at "open". Each of the three cases has its own test.

## Task 6 — the champ ledger drawer lists the DCMP outcomes

Commit `4884686d`. `ChampDrawerRow` and a local `ChampContributionList`, built from task 4's extracted panes. A DCMP cell is one event, so its Playoffs and Awards drawers list the shipped named outcomes priced at the 3x weight (90/60/39/21 and 30/24/15 for 2026), with a veteran's Rookie All Star row omitted. A District points cell is a sum over several events, so `DrawerCellPane` gained a `namedOutcomes` flag and that row keeps the histogram. The grand total drawer draws its plot once beside a two row contribution list whose DCMP row prints the field chance it is weighted by, and reads "not yet priced" where nothing was predicted.

## Task 7 — the pre Phase 10 champ table is deleted

Commit `99bf25d2`. `DistrictLocksTab.tsx`, `DistrictLocksTab.test.tsx`, `districtLocksHeaderStats.ts` and `districtLocksHeaderStats.test.ts` are gone, 1,049 deletions against 21 insertions. The grep for the four old names across `apps`, `packages`, `scripts` and `docs` is empty. The e2e spec's three champ test ids are replaced by the ledger's own and its champ panel test asserts the two row ledger positively.

## Task 8 — methodology, verification, screenshots

Commit `8400aa10`. One paragraph appended to the `how-district-points-work` section: the tab predicts each team's finish in the race for the district's FIRST Championship slots by adding the championship's own four categories to the district season total, the championship row shows what a team would earn if it is there before the field is set, and where the field has not been published the row reads not yet priced and the grand total is the district season alone. It passes the voice gate. Jacob may want to edit it; it lives in `apps/web/src/components/methodology/districtLedgerContent.ts`.

The screenshot pass found and fixed two layout defects before the commit: the uncapped Source cell pushed the Awards column off a 1440px screen, and the shared `TableCell`'s `whitespace-nowrap` made the small line overflow its cap. The cell is now capped at 230px and wraps, and the DCMP row's small line is its week and stage (`Wk 6 · final`).

## Verification after task 8

`npx vitest run` from the repo root: 295 test files passed, 6,800 tests passed, 1 skipped, zero failures. All four typechecks clean: the root, `apps/web/tsconfig.json`, `apps/web/tsconfig.e2e.json` and `apps/worker/tsconfig.json`. `npx tsx scripts/measureLedgerTenets.ts`: 109 seasons, 4,022 stage positions, 921,658 team-positions, tenet A 130,718 shown with 0 violations, tenet B 190,854 shown with 0 violations, every figure identical to 260925-pl6's census.

Eight screenshots at 1440 and 390 over four positions are committed under `screenshots/` with a README. They were taken with no network: the built app served locally, every `/v1/**` request answered from `data/fixtures/phase10` by a Playwright route handler. The "now" shot with all-final state blocks is the acceptance render: Today's line 182, `Locked 20 / In range 1 / Out of range 1 / Locked out 104`, `Locked · winner` on 2046 and 2910, the em dash in all five DCMP cells of the 75 teams outside the field. The fixture's own vintage (before `state`, `awardProfile` and `bakedEvents`) is why the as-published shot is a wall of "not available"; the District Locks tab renders that artifact the same way today.

## Deviations (tasks 5 to 9)

1. `routes/districts.test.tsx` was repointed in task 5 rather than task 7, so `main` was never red between commits.
2. Task 9's "no tab is labelled District Locks" assertion became an equality pin on the whole tab strip.
3. Three comments in the four doomed files collided on the rename and were reworded before the deletion.
4. The champ trigger's label now comes from `CHAMP_LEDGER_TAB_LABEL` rather than a literal.
5. `notYetPriced` is a fifth cell kind rather than a reuse of `unavailable`: a prediction never attempted and one attempted and refused are different statements, and the em dash already means a third thing.
6. `ChampLedgerTeam.grandTotal` is typed `DistrictLedgerCell`.
7. A new gap, `teamsWithDistrictOnlyGrandTotal`, suppresses the champ advancement run entirely while it is non-empty, so the chance line stays absent rather than silently zero.
8. `computeChampLedgerStatuses` takes an optional `districtLockedOut` set; absent, every team gets the hypothetical DCMP ceiling, the safe direction.
9. `stageWordKey` was added to `LedgerParts.tsx` and `eventStartedAtPosition` to `districtTimeline.ts`, both with tests. `TeamCell`'s prop widened to a structural type.
10. `DrawerCellPane` gained a `namedOutcomes` flag.
11. The "DCMP quals done, rewound" screenshot could not be taken without a `2026pncmp` event artifact or presim sidecar; `ChampLocksLedger.test.tsx` covers that position against a synthetic artifact through the real Worker protocol.
12. At 390px a team's two rows are about 90px each, taller than the district tab's, because the District points row's small line wraps inside its cap. Recorded as an observation, not fixed.

## Left for the orchestrator

The live e2e suite against sigmascout.org after deploy; the push and deploy themselves. The stat line's "Today's line (floor)" and the histogram's dashed line are being replaced by a predicted cutoff in the follow-up quick task Jacob requested on 2026-09-26.
