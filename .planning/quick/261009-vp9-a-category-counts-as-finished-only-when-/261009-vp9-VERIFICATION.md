---
phase: quick-261009-vp9
verified: 2026-10-10T00:00:00Z
status: human_needed
score: 13/14 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps: []
human_verification:
  - test: "Decide whether the cascade may read a lower category final from a higher category's proof alone"
    expected: "Either accept it (TBA derives alliance points from the qualification ranking and playoff points from the alliances, so a later layer cannot land before an earlier one), or harden the rule so Alliance selection and Qualification need their own points even when Playoffs or Awards are final"
    why_human: "Four named tick sequences (below) take a Locked back on all four series when a points layer lands before the layer it is computed from. Whether TBA can ever publish them in that order is unverified, and the plan fixed the cascade as the rule (D1)."
  - test: "First live district weekend or championship after the Worker deploy"
    expected: "No team shown Locked at one tick and not Locked at a later tick on either Locks tab or in the published districtLock and champLock"
    why_human: "When TBA posts points during an event is not verified. Both cases (minutes late, or only when the event ends) are walked by tests, neither is observed."
---

# Quick task 261009-vp9 Verification Report

**Goal:** at the LIVE position a category counts as finished only when the event's state says so AND the points that prove it are in the rows (both Locks tabs and the published verdicts); the awards flag waits for every consuming award the event gives; the four championship winner places are released only once a Winner is recorded; two readings never mixed; history views do not move.
**Verified:** 2026-10-10, HEAD e44472a3, tree clean apart from the two untracked quick task directories.
**Status:** human_needed. No FAILED truth and no blocker. One WARNING that needs a decision, one unverified external fact.
**Re-verification:** No, initial.

## Observable truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | D1 rule: one pure `corroboratedCategoryFinality`, never closes what the state leaves open, absent state all open, finals event keeps state reading for Qual and Alliance | VERIFIED | `packages/core/districts/categoryCorroboration.ts` read in full. Matches the plan line by line. Test file passes. |
| 2 | D1 presence facts: winner value per tier, finals value, alliance above 0, remainingEvents-only event is in the map and proven nothing | VERIFIED | Code read. No row-array mutation anywhere (grep), so the `WeakMap` keyed on the `teams` array cannot go stale. |
| 3 | D2 published: one reader, `publishedCategoryFinality(teams, key, state, season)`, feeds ceilings, floors, pooled pool, Winner gate and both reservations | VERIFIED | `districtRankingsMerge.ts` read in full. `districtEventCategoryFinality` is no longer imported there. `dcmpStillAhead`, `unexplainedDistrictCeilings`, `openAtPlayedRows`, `pooledDistrictPoints`, `reservedDistrictSlots`, `reservedChampSlotsAtNow`, `awardQualifiedSets` all go through it. |
| 4 | D2 browser, two readings: grey cells and every lock-math reader on the number; run, bracket facts, timeline, rail, not-picked note on the field | VERIFIED | Every `row.stage.final` consumer in `districtLedgerStatus.ts` and `champLedgerStatus.ts` reads the rows (number). `deriveStageFromState` remains only in the field readers: tab Now maps, fetch sets, `inProgress*`, `districtMilestones.ts`, `champLedgerChances.ts` (Awards flag only), `champLedgerRows.ts:1274` (started). Joint proof gate refuses `stageNotEligible` unless row stage `qual && alliance && !award`. Field overlay takes `liveStageByEvent`. |
| 5 | R19: run takes TBA's playoff and award numbers as known only where `pointsFinal`; run signature folds known points by value | VERIFIED | `buildDistrictEventSimulationInput` diff read. `districtRunSignature` folds `knownElimPoints`, `knownAwardPoints` and played elims by value, so a landing number re-fires the run. |
| 6 | Live rows rewound stop: intersect with Now's number reading; stop at or after Now is a copy of Now | VERIFIED | `districtStageAtPosition` read: `positionIndex >= nowIndex` returns the Now map; earlier stops AND with Now. |
| 7 | D3 staged walk, take backs | VERIFIED (with the WARNING below) | My own engine, see "Take-back walks". |
| 8 | D6 awards flag: district Impact, championship all four, division none, 60 min listed / 12 h not listed, hindsight unchanged | VERIFIED | Own spot checks (below), Worker 12 h and catch-up tests pass, publisher comparison clean. |
| 9 | D6 winner hold, both sides | VERIFIED | Own variants (below). |
| 10 | D4 history does not move | VERIFIED | Independent baseline at 9db0c2e1 (git archive, not the executor's files): four sweeps identical, publisher comparison clean, cutoff no drift, orchestrator take back check 0. |
| 11 | D5 docs and copy | VERIFIED | `docs/worker-operations.md` carries the rule, both readings, both unverified cases, the release note. Methodology copy has no dash characters. The docs do NOT state the cascade limit under the WARNING. |
| 12 | Scope fence | VERIFIED | `git diff 9db0c2e1..HEAD` is empty for `stateStore.ts`, `pageArtifacts.ts`, `publishDistricts.ts`, `districtMilestones.ts`, `districtTimeline.ts`, every `scripts/measure*`, migrations. |
| 13 | Worker contracts | VERIFIED | New code sits inside the per-district `try`. No new `counter.spend`, D1 read or write. Bundle builds; source map has 0 `corpus`, 0 `better-sqlite3`, 0 `node:` sources. |
| 14 | Goal as stated: a category counts as finished only when ITS OWN points are in the rows | UNCERTAIN (WARNING) | The cascade reads Alliance selection and Qualification final from Playoffs' or Awards' proof, with no points of their own. Take backs when a layer lands before the one it derives from. See WARNING. |

## WARNING: the cascade reads a lower category final without its own points

D1 fixes the cascade (Playoffs final implies Alliance selection and Qualification final; the awards flag implies all four). It holds for every order in which the points arrive in the order TBA computes them. It does not hold if a later layer lands first.

Engine `vp9-verify/engine.mts` (scratchpad), `2026orore`, all other events finished, atoms: `qs` 50 played, `qd` all played, `sp` alliances picked, `pd` playoffs done, `P0` provisional qualification points, `Pq` final qualification points, `Pa` alliance points, `Pe` playoff points, `Pw` award points, `L` awards listed, `ST` list unchanged 60 minutes.

| Sequence | Published districtLock | Published champLock | District Locks tab | Champ Locks tab | First loss |
|---|---|---|---|---|---|
| N1 `qs P0 qd Pq sp pd Pe Pa L Pw ST` (playoff points before alliance points) | 4 | 2 | 4 | 2 | `frc1778` locked at `Pe`, contending at `Pa` |
| N2 `qs P0 qd sp Pa Pq pd Pe L Pw ST` (alliance points before final qualification points) | 2 | 0 | 2 | 0 | `frc1983` locked at `Pa`, contending at `Pq` |
| N3 `qs P0 qd Pq sp Pa pd L Pw ST Pe` (award points and a 60 minute settled list before playoff points) | 1 | 1 | 1 | 1 | `frc5920` locked at `ST`, eliminated at `Pe` |
| N4 `qs P0 qd sp pd Pe Pq Pa L Pw ST` | 4 | 2 | 4 | 2 | `frc1778` locked at `Pe`, contending at `Pa` |
| N5 `qs P0 qd Pq sp Pa pd Pe L Pw ST` (physical order, control) | 0 | 0 | 0 | 0 | none |

The same N1 to N4 on the pre-task code (9db0c2e1) give 4/3/4/3, 4/1/4/1, 4/3/4/3, 4/3/4/3 and the control N5 gives 3/2/3/2. So the task removes every take back of the physical order and some, not all, of the reordered ones. Free-order fuzz (points layers in any order, 1120 runs) shows 534 violating runs, every one with a layer landing before the layer it is computed from.

Why it is a WARNING and not a blocker: alliance points are computed from the qualification ranking and playoff points from the alliances, so TBA cannot publish a playoff row with no alliance row, and the awards flag needs a judged award, award points and 60 unchanged minutes. I could not verify that against TBA (nothing live has been observed). `categoryCorroboration.ts` and `docs/worker-operations.md` state the cascade but not this assumption.

Decision for Jacob. Accept and add one sentence to the module header and the operations doc, or harden: make Alliance selection need `alliancePoints` and Playoffs need `winnerPlayoffPoints` even when a higher category is final, with the awards flag the only cascade source. The census says every one of 1019 events with picked alliances has an alliance row, so a finished event is unaffected; the 105 local events with no picked alliances would need the flag clause kept.

## Take-back walks (hunt item 3)

Engine written from scratch against `applyDistrictRankings`, `applyDistrictEventState`, `recomputeDistrictVerdicts`, `buildDistrictLedgerRows`, `computeDistrictLedgerStatuses`, `buildChampLedgerRows`, `computeChampLedgerStatuses` only. A world model of per event state, per layer arrival, awards list and settle fact generates each payload and tick. Series checked per team: published `districtLock` (locked, lockedAward), published `champLock` (plus prequalified), District Locks tab at Now, Champ Locks tab at Now.

| Walk | Runs | Take backs |
|---|---|---|
| Physical layer order (`Pq` before `Pa` before `Pe` before `Pw`), state facts and `P0`, `L`, `ST` interleaved at random, each of 8 PNW events, plus 6 two event interleavings at different stages, two worlds (pncmp finished; pncmp rows removed so the DCMP is still ahead) | 4200 | 0 |
| `2026pncmp` as the walked event, physical order | 300 | 0, end state equals baseline |
| Synthetic two event district (60 teams, `2026orore` + `2026wasam` only, dcmpSlots 10, 18, 30), different stages, random interleaving | 450 | 0 |
| Idempotence: a no-op state tick after every tick of 100 walks | 1100 checks | 0 differences |
| The same physical walks on the pre-task code (9db0c2e1) | 560 | 458 violating runs. The walk bites. |
| End state of every physical walk equals the baseline on `districtLock`, `champLock`, `pointTotal`, both ceilings | checked on spot walks | 0 differences |

Reordered orders: see the WARNING table. A state regression (`REG` sets alliances picked and playoffs done back to false after points landed, then they are re-set) takes locks back in 80 of 160 runs on the new code and 132 of 160 on the old code. That is the state reopening a category, which both versions do; the flags that never un-post are only `awardsPosted`. Informational, not introduced by this task.

## Awards flag (hunt item 4), own checks

`applyDistrictEventState` with hand built lists on `2026orore` and `2026pncmp`:

- district: Impact + judged, 60 min set: true; not settled: false; no Impact, 60 min only: false; no Impact, 12 h set: true; Impact listed but only the 12 h set (no 60 min): false; Winner and Finalist only: false.
- championship: Impact, Winner, EI, RAS + judged, 60 min: true; missing RAS or Winner, 60 min: false; missing RAS, 12 h: true.
- a flag already true stays true; hindsight: judged only true, points only true, neither false.
- Late award walks, own code: the list sits unsettled, 2 h unchanged, then the missing award arrives and settles. Late Impact at all 8 PNW events and late Impact, Winner, EI, RAS at `2026pncmp`: flag false on the first four ticks, true on the last, 0 take backs on all four series (12 walks).
- Division: covered by the committed merge test ("a division ... rises in the 60 minute set, records nothing") and `eventAwards` unit tests; I did not build my own divisioned artifact. No local artifact has a division key without its finals key.
- The 12 hour path through the watch and the catch up: `scheduled.district.test.ts` has the 11 h 59 / 12 h boundary for a member event, the catch up at 12:15 UTC, and `2026pncmp` through the real tick. All pass.

## Winner hold (hunt item 5), own variants on `2026pncmp`

Champ Locks tab `reservedSlots` and the published champ lock counts:

| State | Tab reserved | Published champLock |
|---|---|---|
| playoffs done, winner row in, Winner not recorded, flag false | 11 | 5 locked |
| same, Winner recorded | 7 | 3 lockedAward, 6 locked |
| playoffs done, no winner row, Winner recorded | 11 | held (all contending/eliminated) |
| flag true, no Winner recorded (the 2020 shape) | 0 | released |
| flag true, Winner recorded | 0 | released |
| playoffs open | 11 | held |

No state has the four places both unheld and unconsumed. A finished championship with no Winner record is released by the flag, on both sides. `measureChampTenets` over the ten 2020 seasons and all 109 seasons is identical to the independent baseline.

## History gates (hunt item 6)

Independent baseline: `git archive 9db0c2e1` into the scratchpad with the data directory linked (links removed afterwards, repo data intact).

| Gate | Result |
|---|---|
| `measureLedgerSettledTenets` | identical to the pre-task code and to the planner's 8fb29c8a run, `VIOLATIONS: none` |
| `measureLedgerTenets` | identical to both, 109 seasons, 4022 positions, tenets A and B 0 |
| `measureChampTenets` | identical to both, Locked on points shown 6836, Locked out shown 271340, `VIOLATIONS: none` |
| `measureChampJointLocks` | identical to the pre-task code (differs from the planner's 8fb29c8a run by the 261009-tx9 commits, as the SUMMARY says), `VIOLATIONS: none` |
| `measureChampCutoff --check-history` | `no drift` for both generated files |
| `orch_takeback.mts` | `championships 48, stops 412, take-backs 0` |
| Publisher dry run, 9db0c2e1 against HEAD, `r9x-compare.mjs` | `artifacts 109 | differing 0 | carried events 1124 | awardsPosted true before 1124 after 1124 | flips 0 | qualifyingAwards entries before 3251 after 3251` then `R9X COMPARE CLEAN` |

## Required commands

| Command | Result |
|---|---|
| `npx vitest run apps/worker packages/harness packages/core/districts apps/web/src/components/districts apps/web/src/components/methodology scripts` | 179 files, 4799 tests passed, nothing skipped |
| `tsc --noEmit` root, web, web e2e, worker | all exit 0 |
| `npx wrangler deploy --dry-run --outdir <scratch>` from `apps/worker` | builds, 1357 KiB / 250 KiB gzip. Source map: 98 repo sources, `categoryCorroboration.ts`, `eventAwards.ts`, `districtRankingsMerge.ts`, `districtRefresh.ts` present, 0 `corpus`, 0 `better-sqlite3`, 0 `node:` |

## Anti-patterns

None found: no `TBD`, `FIXME`, `XXX` introduced; no stubs. No file outside the declared list changed.

## Release note for the orchestrator

The SUMMARY's note holds and the docs carry it: deploy the Worker only when no district or championship event sits between playoffs done and awards posted, because the first tick under the rule can raise rivals' ceilings at such an event. Hand the first live weekend to the human items in the frontmatter.

_Verified: 2026-10-10_
_Verifier: Claude (gsd-verifier)_
