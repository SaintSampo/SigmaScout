---
phase: quick-261013-lve
verified: 2026-10-13T22:30:00Z
status: passed
score: 8/8 must-haves verified
behavior_unverified: 0
gaps: []
---

# Quick Task 261013-lve Verification Report

**Goal:** `PLAYOFF_POOL`, the upper bound the District Locks pooled test uses for all playoff points one district tier event can hand out, becomes the PROVEN maximum under TBA's pay rule (216; 214 under the 2023 rule) for a roster of at most four robots an alliance, where it was a measured 213.
**Verified at:** HEAD 0ce59192 on `main` (09cd8660, 0ce59192 unpushed). **Re-verification:** No.
**Status: PASSED.** Every number below was produced by my own runs. Scratch files are in `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad/lve-verify/`. Nothing in the repo was edited, committed, pushed or deployed (`git status` shows only the task's untracked directory).

## 1. Is 216 really the maximum? My own search

`lve-verify/search.mts` and `cheats.mts`. I typed my own eight alliance double elimination bracket (M1 to M13 plus a best of three final; it shares nothing with `BRACKET_SETS` or the task's search), enumerated all 2^13 semifinal outcomes times 4 Finals series (32,768 brackets), and priced only through the public `playoffPointsPaid(season, "district", 8, rows)`. Each alliance was given a roster, and for every credited win I chose which three of the roster were on the field. Per alliance the search is exhaustive over 4^wins lineups (up to 4,096). The sum of the per alliance bests is then re-priced as one joint call per bracket.

| roster | 2023 rule | 2024, 2025, 2026 | method |
|---|---|---|---|
| 3 robots | 210 | 210 | exhaustive (nothing is rounded) |
| **4 robots** | **214** (12,288 brackets reach it; least bracket best 212) | **216** (16,384 reach it; least 214) | exhaustive per alliance, all 32,768 brackets |
| 4 robots, hill climb with 60 random restarts per alliance | 214 | 216 | independent method, same answer |
| random JOINT search, 300,000 brackets a season, rosters 3 to 4 drawn per alliance, every lineup random, 20% of brackets with a tie replay renumbering | 214 | 216 | never above |

**No total above 216 with a roster of at most four and a legal bracket. Nothing is above the bound.** A bracket at the 2024 on maximum (outcome 4096, Finals 2-0), as the search printed it: the champion won 3 semifinals and 2 Finals matches and was paid 92 (62 shared over its three semifinal wins with a different robot of its four sitting out each win, plus 30 for the Finals); the finalist 62 (lineup [0,2,3],[0,1,3],[0,1,2] over three wins); third place 40; fourth place 22; the other four alliances 0. 92+62+40+22 = 216. In 2023 the champion is paid exactly 90 (30 over 5 or 6 wins leaves no part share): 90+62+40+22 = 214.

Cheating the assumptions one at a time:

| cheat | what the pay function / search gave |
|---|---|
| five robots an alliance | 217 (2023 rule) and 220 (2024 on), hill climb; equals the task's pinned "not taken" numbers |
| six robots / eight robots (hill climb, a floor) | 219 and 222 / 221 and 224 (the closed form says 222 and 225 for no limit) |
| a robot credited on two alliances | REFUSED (`undefined`): unpriceable, nothing to count |
| a tie and its replay | a tie has no row. Finals numbered 1,3,4 (tie as match 2) prices identical to 1,2,3. 20% of the random joint brackets carried a renumbered replay: maximum unchanged (216) |
| Finals going to three matches (2-1) | in every enumerated bracket (2 of the 4 Finals series); the loser's one Finals win pays nothing; no total above the bound |
| a third Finals win, both alliances at 2 Finals wins, or two decisive rows in one single match semifinal | REFUSED |
| the alliance winning through the lower bracket with the most semifinal wins (4 semifinal wins plus 2 Finals wins, found by search) | 90 over all 4,096 roster-four lineups in both rules, below the 92 of the 3 win champion. Not a breach |
| a row crediting FOUR robots (illegal, premise 3) | the pay function would price an all-four-on-field event at 280. This is the premise "three robots are credited per decisive row", measured below |

## 2. The roster premise

Stated in the header (premise 4: at most four robots paid on one alliance; FIRST's one backup rule; it names 217/220 and 222/225 as the numbers not taken) and held by `scripts/securedPlayoffCorpus.test.ts`. My own query (`roster.cjs`, `data/corpus.sqlite`, read only, district tier = `event_type 1` with a `district_key`, 2023 to 2026, 420 events: 418 with 8 alliances, 2 with none):

- distinct robots credited with a decisive sf or f win per alliance: 0 at 836 alliances, 2 at 1, **3 at 2,395, 4 at 112, 5 at 0** (3,344 alliances). By season at four: 29, 19, 22, 42.
- robots on the winning side of a decisive row: 3 at 6,365 of 6,365 rows.
- alliance pick list lengths: 3 at 3,058, 4 at 286, never 5 or more.
- championship tier (event types 2 and 5) for reference: 19 alliances at four, none at five.

The task's own run counts 132 at four over all 507 events with an alliance list; mine is 112 district tier plus 19 championship tier (131) because I split by tier. No count at five anywhere. The premise holds in the corpus, and is an external rule (FIRST's), which the header says plainly.

## 3. The corpus

`REQUIRE_LOCAL_DATA=1 npx vitest run scripts/securedPlayoffCorpus.test.ts --reporter=verbose`: `Tests 8 passed (8)`. The printed line of the bound test:

`[playoff pool bound] pool 216, bound by rule {"allWins":214,"semifinalWins":216}, eight alliance events 491, the most a district tier event's rule total has read 212`

Totals in base points (the pay rule over every robot): 2023 district tier 94 events: 210 x 82, 211 x 12; 2024 on district tier 324 events: 210 x 261, 211 x 57, 212 x 6; dcmp tier 2023 divisions 210 x 9 / 211 x 1, single 210 x 7, 2024 on divisions 210 x 26 / 211 x 4, single 210 x 18 / 211 x 8. **The largest real total is 212 (six events); none above the bound, none above 212.** The fit table is exact (2,255 of 2,255 teams in 2023, 7,837 of 7,837 in 2024 on, district tier; 0 above, 0 below). Robots credited per decisive row: 3 at 7,540 of 7,540; robots with a win per alliance: 0 at 994, 3 at 2,842, 4 at 132.

## 4. Every reader of `PLAYOFF_POOL`

Grep over `*.ts`/`*.tsx` (excluding tests, node_modules, .planning): two readers, both read-only users.

- `packages/core/districts/pointPool.ts:465` in `eventRemainingPool` (`if (!event.final.elim) total += PLAYOFF_POOL`).
- `packages/core/districts/pooledLockInputs.ts:221` as the cap of the netting (`Math.min(inFloors, PLAYOFF_POOL)`), and the import at `:102`.

Consumers of the pooled result: `apps/web/src/components/districts/districtLedgerStatus.ts:553` (`pooledLockInputs(pooledEntries, playoffPointsInFloors)`) and `packages/harness/districtRankingsMerge.ts:688` `pooledDistrictPoints` (publisher and Worker; district tier rows only, `row.tier === "district"` at `:693`). **No reader multiplies by a tier weight and none is on the dcmp path** (the Champ ledger only mentions `pooledLockInputs` in a comment, `champLedgerStatus.ts:42`). The pool enters `locks.ts` only as `minimumToEliminate > pooled.remainingPoints` (`locks.ts:228`), so a larger pool can only turn Locked into In range, never the reverse. The netting cap going from 213 to 216 does not subtract more: it is added to `wholePool` and netted by at most the same constant, so the remainder is exactly 3 larger. `git diff e0e8856e HEAD` on `pooledLockInputs.ts` shows no code line, only comments.

## 5. Effect and history (gates run by me, outputs in `lve-verify/final`)

`bash d7r/gates.sh lve-verify/final` ran on a clean tree at HEAD 0ce59192; all eight gates exited 0. Compared with the executor's base (taken at e0e8856e, `lve/base`) and, separately, with an independent pool 213 tree I built from `git archive 09cd8660` (`lve-verify/tree-a`) using `pool_diff.mts`.

- `gates_compare_lve.sh ... pool` last lines: `joint: identical to the base (1304 lines)`, `champ: identical to the base (129 lines)`, `cutoff: no drift for both generated files`, `takeback: championships 48, stops 412, take-backs 0`, `now: identical on both tabs (artifacts 109 teams 16345)`, `UL3 COMPARE CLEAN`, `R9X COMPARE CLEAN` (109 artifacts, differing 0, flips 0), `LVE GATES AS EXPECTED (pool)`. The two Champ sweeps, the cutoff files, the take back check and the Now dump are byte identical to the base (my own `diff`, not only the compare script).
- District Locks settled sweep: `all 48 events 418 stops 2926: Locked on points 38771 -> 38705`, Locked out 83,667 unchanged (final `settled.txt`). Ledger sweep all-seasons: Locked 76,964 to 76,909, In range 318,013 to 318,068 (the 55 are exactly the lost ones), `Both tenets hold`, `VIOLATIONS: none`, `SKIPPED (0)`.
- My own independent diff (`final/pool_diff.txt`, tree at 09cd8660 vs HEAD): `pool A 213, pool B 216`; `ALL STOPS | 2926 | 38771 | 38705 | gained 0 | LOST 66`; per stop lost 8, 8, 9, 15, 14, 9, 3; `of the lost team stops: Locked again by the event's last stop under B 63; not Locked at any later stop of that event under B 3`; `take backs inside an event under B 0; status differences other than a Locked on points lost 0`; all 66 held by the pooled argument alone. Locked out: 83,667 both.

Soundness reading: a larger pool took away 66 pooled locks, added none, and took none back inside an event (a lock that is shown stays; the 66 are displays no longer shown). That is the safe direction.

## 6. Tests and typechecks

`REQUIRE_LOCAL_DATA=1 npx vitest run packages/core/districts scripts/districtLocksNoTakeBack.test.ts scripts/districtLocksStagedReplay.test.ts scripts/measureLedgerTenets.test.ts`: `Test Files 31 passed (31)`, `Tests 893 passed (893)`, exit 0, no skips (the task's 39 files / 1,020 tests includes more paths than the set I was given). `scripts/securedPlayoffCorpus.test.ts` alone: 8 passed.

`npx tsc --noEmit && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && npx tsc --noEmit -p apps/worker/tsconfig.json`: `TYPECHECKS CLEAN`.

Debt marker scan (`TBD`, `FIXME`, `XXX`) over every file changed since e0e8856e: none.

## 7. The Worker

`npx --no-install wrangler deploy --dry-run --outdir lve-verify/wr-out` from `apps/worker`: exit 0, `Total Upload: 1369.41 KiB / gzip: 252.16 KiB`, bindings unchanged. The bundle (`scheduled.js`) contains `mostPlayoffPointsPaid`, `MOST_PLAYOFF_POINTS_PAID_BY_RULE` and `PLAYOFF_POOL = Math.max(...)` (three PLAYOFF_POOL occurrences); `playoffPointsPaid` and `securedPlayoffPoints` are not in it. Evaluating the module gives `PLAYOFF_POOL 216 {"allWins":214,"semifinalWins":216}`; at three robots 210, five 217/220, nine 222/225. Behaviour change in the Worker: only the pooled test's pool, 3 larger for every district tier event whose Playoffs category is open, so a published `districtLock` of `locked` can be withheld where the pooled argument alone held it. Nothing changes at Now for a finished season (every pool 0; publisher comparison clean). A Worker deploy is owed; no republish.

## 8. Headers

`pointPool.ts` header (read in full) states: which pools are proven (selection, from the formula; playoffs, from the pay rule) and which measured (awards by rookie count; qualification's three phantom attendees); the derivation (62 / 40 / 22 / 30 per rule, 216 and 214); the five premises each with its test; the numbers not taken (217 and 220 at five robots, 222 and 225 with no limit) and that three robots read 210; that seasons before 2023 are a measured margin (533 events, max 210); the cost (66 of 38,771). `pooledLockInputs.ts` header carries the same in a shorter form and names tests that exist. All checked against my runs; no statement contradicted.

## Residual notes (not gaps, nothing blocking)

- The proof rests on premises outside this code: TBA's pay rule as declared per season (2023 `allWins`, 2024 to 2026 `semifinalWins`), the eight alliance bracket, three robots credited a row, and at most four robots paid on one alliance (FIRST's backup rule). The header states each and the corpus gate fails if a fifth robot is paid or a row credits four. A future season with a new rule kind must derive its bound (the `Record<PlayoffPayRule, number>` forces a line); a new season that reuses an existing rule kind only needs a declared rule, which the registration test already forces.
- Seasons before 2023: 216 is a margin over the measured 210, not a proof (stated in the header).
- Two 2026 ISR district events have no alliance data in the corpus, so they say nothing either way.
