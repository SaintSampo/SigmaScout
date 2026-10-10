---
phase: quick-261010-66y
verified: 2026-10-10
head: 38e29a12 (eight commits on f1f1f693)
status: human_needed
score: 8/8 truths verified in code; 0 gaps; 2 human items (unobservable offline)
gaps: []
human_verification:
  - test: "First live district championship (2027): watch whether TBA posts one event's district points rows for ALL of its ranked teams together"
    expected: "No event's rows arrive in chunks. If they do, a capacity proven field can read proven while up to half of the largest event's teams are still on no row (those teams read out until their rows land)."
    why_human: "The whole rule (dcmpFieldProof lines b and c1) rests on a stated, unverified premise (module header: ASSUMED, NOT VERIFIED). Nothing local can test TBA's live posting behavior."
  - test: "Deploy the Worker only while no District Championship is live"
    expected: "R11 turns a stateless championship row from hindsight to open on its first tick; deployed mid championship it would take published locks back once."
    why_human: "Release timing, not a code property."
---

# 261010-66y verification (goal backward, at HEAD 38e29a12)

Verdict: **human_needed** (no code gap found). Everything checkable offline holds. The only open items are the TBA posting premise the owner already stated, and a release timing note.

## Commands run and results

| Check | Command | Result |
| --- | --- | --- |
| Staged walks | `REQUIRE_LOCAL_DATA=1 npx vitest run scripts/champFieldStagedWalk.test.ts scripts/districtLocksStagedReplay.test.ts` | 2 files, **79 tests passed** (31 walk + 48 replay), 0 skipped, every local data group RAN |
| Full suite | `REQUIRE_LOCAL_DATA=1 npx vitest run` | **355 files, 8744 passed, 1 skipped** (rankingsLive, network) |
| Gate tooling | `gates.sh .../66y-verify/final` then `gates_compare.sh .../66y-exec/after-t8 .../66y-verify/final` | last line **`D8 GATES IDENTICAL`** (joint 1186, champ 129, ledger 163, settled 35 lines identical; cutoff no drift; `championships 48, stops 412, take-backs 0`; now identical on both tabs, 109 artifacts 16345 teams; UL3 and R9X publisher compares CLEAN) |
| P12 | `node p12_gate.mjs .../66y-exec/base .../66y-verify/final` | last line **`P12 GATE HOLDS`** |
| Typechecks | root + web + e2e + worker, chained | **`TYPECHECKS CLEAN`** |
| Worker bundle | `wrangler deploy --dry-run --outdir` (no network) | builds |
| Repo state | `git status` before and after | unchanged (only the pre-existing untracked task dirs and two todo edits) |

The gate comparison against `base` moves exactly the planner's fact 12: 17 divisioned joint stop rows (combined lock stops lost 0, gained 17), 13 champ tenets rows (all FIM, FIT, NE), 85 of 109 districts byte identical, `VIOLATIONS: none` on joint, champ and settled sweeps. Locked out shown 271340 to 271608 and award qualified at now 149 to 417 is the accepted reading (A) consequence (D10), every one award qualified at Now.

## Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | A rowless team reads out only on a PROVEN field (a started, b posted, c1 capacity on the LARGEST posted key, c2 posted finals row, c3 season over only) | VERIFIED | `packages/core/districts/dcmpFieldProof.ts` 283-300 matches D1 and D11. Subset test: 25 artifacts, 146 proper subsets, 0 read proven (closest miss 19 teams below); Now census 109 artifacts, 108 proven (98 capacity, 10 season over), 2020isr no key, 0 unproven after a start. Unit tests cover a, b, c1, c2, c3, null slots, lone parent, monotone. |
| 2 | Every reader follows the one flag at Now and a rewound position is unchanged | VERIFIED | Grep of every reader: `champLedgerRows.ts` (`dcmpStartedForTeam`, `fieldSettledForRowlessTeam`, `fieldRowOpen`), `champLedgerStatus.ts` (ceiling grant 757-780, reservation 870, `jointProofAt` 1068 `fieldNotProven`), `ChampLocksLedger.tsx` (flag 478, `dcmpSelected` 951, estimates 756, range state 835, award draws 790), `districtFieldOverlay.ts` (238), merge (`publishedFieldProof` 796, 1011, 1081). `fieldProven = !atNow \|\| ...`, defaults true everywhere else. History gates identical. `measureChampCutoff.ts:415` calls the old signature unchanged (history only). |
| 3 | Staged walks bite | VERIFIED | Each rule off variant is asserted to take locks back, see counts below. |
| 4 | History did not move | VERIFIED | D8 identical to after-t8, P12 holds vs base. |
| 5 | Task 8 reading A: tab ceiling same with and without the finals row; convention test exists | VERIFIED | Group 11: 16 championships, 144 stops, a ceiling differs at 0 stops. Group 7 convention test ran: 265 finals rows, 153 with award points, 0 without a consuming award; 20 finals only rows, 0 with other points. Lone parent key unit test present. |
| 6 | "up to N" only where settled, not exact, above zero; no dash, no tilde | VERIFIED | `districtLedgerRows.ts` `const upTo = !settledElim.exact && settledElim.points > 0`; printed by `districtLedgerFinalFigure` (cell and total drawer chip). Added copy lines scanned for hyphen, dash, tilde: none. Grand total cell intentionally unchanged (D6 "totals unchanged"). |
| 7 | Typechecks | VERIFIED | TYPECHECKS CLEAN. |
| 8 | D3 drop left a consistent tree | VERIFIED | No `finalsMayBeAbsent` or R14 anywhere in `apps packages scripts`; `championshipShape` keeps only D2; R15 (`champLiveFetchKeys`) in; the judged budget finding is pinned as a measurement (group 9: 11 teams) and described in `finalsBracket.ts` and decision 5 of `champLedgerStatus.ts`. Worker task 261010-d7r owns the fix, not reported here. |

## Walk counts (printed by the run)

- Synthetic four divisions, field rule off: Locked taken back 9, field teams read out 12 (asserted `toBeGreaterThan(0)` and pinned). Second walk, rule off: 12, 11, 9, 6 from 0..3 final divisions; finals part off 0 (said plainly).
- Real first walk, field rule off: FIM 41 taken back and 121 read out; NE 0/50, ONT 0/49, TX 0/45, CA 0/60 (read out only, stated). District Locks tab rule off: Locked then Declined FIM 119, NE 50, ONT 49, TX 41, CA 55. Rules on: 0 everywhere.
- Real second walk (points at each event end), rule off taken back per start: FIM 68, 81, 48, 11; NE 14, 20; ONT 6, 11; TX 10, 17; CA 17, 39. Finals part off: FIM 3, 3, 2, 0. Rules on: 0.
- Published series: first rows rule off takes 10 published `champLock` back at synthetic single and ceilings drop and rise on 161 (FIM), 92 (NE), 90 (ONT), 86 (TX), 117 (CA) teams; rules on 0 and 0 on all twelve walks.
- Group 12 dominance: 24 walks, 75 unproven ticks, 1 tick not dominated (2026 PNW, published, registered first, 51 unseen attendees vs 50 carrying; field of 51 against capacity 50).

## Attempts to break it (my own, all scratch under 66y-verify)

1. **Core fuzz** (`fuzz1.mts`, 60000 random shapes: single, 2 and 4 divisions with and without parent, CA, three championships, random post order, chunked posting, random registrations, slots from 0.5x to +20): proven goes true then false ONLY when a brand new field fixing key appears after the field read proven (cause `newKey`, the header's limit 4). Never from rows added to an existing key, never from a state arriving, never from a small late key.
2. **Realistic fuzz** (`fuzz2.mts`, 40000 runs: even sizes within 5, slots within 5 of the truth or null, whole event posting, finals after divisions, season not over): **zero** proven to unproven transitions and **zero** reads of proven with a whole event unseen. The only "unseen" hits in the unrestricted run are the season over line applied to a mixed state that cannot occur in a finished year.
3. **Real data** (`real1.mts`): 109 artifacts, 60 random row orders each (all dcmp rows interleaved arbitrarily, state on first row): 6480 runs, **0** proven to unproven.
4. **Hand cases** (`hand.mts`): lone division, lone parent, parent posted beside one division, null slots, slots 0, three equal championships, CA 61/60, four divisions at 1 and 3 posted: all read as designed. One note: a posted parent key beside ONE known division with the other divisions on no row at all reads proven by line c2 (relies on the finals being played only after every division is done and posted).
5. **Walk order permutation** (`perm/perm.test.ts`, a copy of the walk file in the scratchpad that posts the field fixing keys in reverse and in six seeded random orders, run through vitest with a node_modules junction, removed afterwards): every rules ON assertion of every group, the dominance test included, still holds (0 Locked taken back, 0 field team read out, 0 published take backs, 0 ceilings dropping then rising, 1 non dominated tick = PNW). The only failures in any order are the pinned rule off counts and the pinned "below the line" counts (e.g. ONT unseen-without-hypothetical 4 becomes 5, CA 3 becomes 1), which are order dependent measurements, not soundness.

## Warnings (stated limits, not gaps)

1. **TBA posts one event's rows for all its teams together: unverified** (frontmatter item 1). The capacity line (c1) forgives half of the largest posted event, so a single championship of 50 reads proven at 25 posted rows. If TBA ever posts in chunks, the not yet posted attendees read out until their rows land and a lock could be taken back. The walks post whole events by construction.
2. **Field above published capacity** (header limit 2): at one published tick of the PNW walk (registered first, "pncmp started on the field, state only") one unseen below-the-line attendee is not covered by a hypothetical. No lock was taken back on any walk, in any order.
3. **Proven can fall back when a new field fixing key appears after the field proved** (header limit 4). Not reachable for any published district; the safe direction (hypothetical ceiling returns, locks delayed or, if one was already shown, retaken).
4. **Season over line reads the client clock** (`new Date().getUTCFullYear()` in the tab and overlay). A viewer with a clock set to the next year, looking at a live partial championship whose known keys all read Awards final, would get the season over proof. Safe default for a normal clock; not worth code.
5. **c2 trusts finals imply all divisions posted** (above).
6. Joint proof judged award budget raising a bound when a division's Awards turn final: known, pinned, separate task 261010-d7r. Out of scope here.

## Files

- Report: `C:/Users/Jacob/Documents/GitHub/SigmaScout/.planning/quick/261010-66y-at-the-live-position-a-team-with-no-cham/261010-66y-VERIFICATION.md`
- Scratch: `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad/66y-verify/` (fuzz1.mts, fuzz2.mts, real1.mts, hand.mts, perm/, final/, walk.txt, full.txt, tsc.txt)
