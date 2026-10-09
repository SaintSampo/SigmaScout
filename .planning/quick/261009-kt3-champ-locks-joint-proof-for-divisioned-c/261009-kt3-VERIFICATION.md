---
phase: quick-261009-kt3
verified: 2026-10-09T21:40:00Z
status: human_needed
score: 9/10 must-haves verified (1 deviation awaiting acceptance)
behavior_unverified: 0
overrides_applied: 0
gaps: []
human_verification:
  - test: "Accept or reject the two lower pins (FIM 2026 Divisions final 50 locks vs the plan's 60; NE 2026 Divisions final 12 vs the plan's 17)"
    expected: "Jacob confirms soundness first means the lower earliness is acceptable, so the plan's must-have text can be overridden with the as-executed pins"
    why_human: "The plan said never change the proof to meet a pin and also never fit a pin; the executor rewrote two pins to the as-executed values after adding a soundness term the plan did not have. This is a plan-versus-code deviation only the owner can accept."
  - test: "Confirm the two unverified FRC rule readings the proof is deliberately conservative about (a team on both a division roster and a finals roster; one point paying award per team across division and finals)"
    expected: "Rules or corpus support them, or Jacob accepts the conservative handling"
    why_human: "Rules text is not in the repo. The proof does not rely on the first (it pays both), and the second is corpus-measured 2023 to 2026 only."
---

# Quick 261009-kt3 Verification Report

**Goal:** extend the Champ Locks joint worst case lock proof to divisioned championships (FIM 4 divisions, NE/ON/TX 2 divisions with a finals event) and to 2026 California's two championships; fold every dcmp tier row into the floor and ceiling; soundness first (zero sweep violations over all 48 championships of 2023 to 2026), single event results unchanged.
**Verified:** 2026-10-09
**Status:** human_needed (no soundness gap found; one plan-pin deviation needs owner acceptance)
**Re-verification:** No, initial verification

## Commands run by the verifier (own processes, outputs read)

| Command | Result |
|---|---|
| `npx tsx scripts/measureChampJointLocks.ts` | exit 0; 48 championships (31 single, 16 divisioned, 1 multiple); `SINGLE SUBTOTAL 31 championships / 248 stops / proof applied at 217 / shipped 340 / joint only 414 / combined 754 / violations 0`; `SKIPPED (0)`; `VIOLATIONS: none` |
| `npx tsx scripts/measureChampTenets.ts` | exit 0; `VIOLATIONS: none`; Locked on points 6,836 (0 violations), Locked out 271,340 (0 violations) |
| `npx tsx scripts/measureChampCutoff.ts --check-history` | exit 0; no drift for dcmpHistory.generated.ts and champCutoffTuning.generated.ts |
| `npx vitest run packages/core/districts apps/web/src/components/districts scripts` | 89 files passed, 2,466 tests passed, 0 skipped |
| `npx vitest run scripts/measureChampJointLocks.test.ts --reporter=verbose` | 11 passed (FNC pins, FIM/NE/CA pins, D3 pin), none skipped |
| `npx tsc --noEmit` for root, `apps/web/tsconfig.json`, `apps/web/tsconfig.e2e.json` | all three exit 0 |
| Spot check of `maxFinalsPointsByPlacement`, `routeFinals`, `championshipShape` | 60,30,0,0 and 30,0; 2024necmp tie series routes to champion 2; 2024micmp placements a2=1, a1=2, a4=3, a3=4; shapes divisioned / multiple / unsupported / unsupported as specified |

## Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Shape detection D1; 48 championships classify 31/16/1/0 | VERIFIED | `championshipShape` in finalsBracket.ts read in full; sweep header lines show 31 single, 16 divisioned, 1 multiple, SKIPPED (0) |
| 2 | Finals maxima 60/30/0/0 and 30/0; `routeFinals` bijection, real 2024 to 2026 rows, 2024necmp tie | VERIFIED | Spot check above; finalsBracket.test.ts and bracket.test.ts pass |
| 3 | Every dcmp row enters floor and ceiling (D3); floor at Now is `pointTotal` | VERIFIED | `for (const dcmpEntry of dcmpSources)` loop at champLedgerStatus.ts 517; `entry.rows.map(sourceOf)` at champLedgerRows.ts 845 and 951; sweep `floorGap` assertion (scripts/measureChampJointLocks.ts 480 to 513) covers every row of every team, 0 violations; D3 pin test passes (frc27 445 minus 90) |
| 4 | Each DCMP award gated on its own event's stage (R3) | VERIFIED | champLedgerStatus.ts 596 to 599 reads `dcmpStageByEvent.get(award.eventKey)`; winner on elim, others on award |
| 5 | Joint proof runs for divisioned and multiple shapes under the stated frames, R8/R9 | VERIFIED | `divisionedJointProof`, `multipleJointProof`, `divisionedJointFrames`, `jointLockBoundMultiple` read in full; R9 puts a no row team in every input (line 914 to 917); single path unchanged |
| 6 | Soundness tested: E3, S2, S3, R9 saturation, cover upper bound vs exact on 20,000 instances | VERIFIED | Tests exist (E3 1140, S2 1268, S3 1427, R9 832, cover bound 741 in champJointLock.test.ts) and pass; plus the verifier's own oracle below |
| 7 | Sweep: 48 championships, zero violations, skipped none, exit 0, single subtotal unchanged | VERIFIED | Sweep output above, exact subtotal match |
| 8 | Pins exactly as the planner prototype (FIM 60 and 63, NE 17 and 15, CA 15 and 19, FNC unchanged) | PASSED WITH DEVIATION, needs acceptance | Four of six new pins match the plan (FIM Finals decided 63, NE Finals decided 15, CA 15 and 19) and FNC pins unchanged. **FIM Divisions final executes at 50 (plan 60) and NE Divisions final at 12 (plan 17).** Every pin test passes against the as-executed values, so the pin text was rewritten. SUMMARY attributes FIM -6 to the finals seats open to any rival (a soundness term added at executor discretion, mutation M5 reported failing S2/E3 without it) and the remainder to the tab's pre registration ceiling for rivals with no dcmp row. All teams that fell out of the sets qualified at Now, so no lock was lost to unsoundness; the deviation only delays locks. Not independently reproduced by the verifier (see below) |
| 9 | Methodology gains the two D8 sentences, flat third person, no dash | VERIFIED | git diff shows both exact sentences appended; no hyphen or dash characters in them |
| 10 | Scope fence: districtLedgerStatus.ts, reservedSlots.ts, pooledLockInputs.ts, publisher, Worker, harness unedited | VERIFIED | `git diff --name-only fdd99fc5..HEAD` grep for those paths prints nothing; 19 non planning files changed |

## Independent oracle (verifier built, not in repo)

Scratchpad script `oracle.mts`/`oracle2.mts`: 2 divisions, 3 alliances each, 19 pool teams, one spare seat per alliance, one unpicked backup candidate that may sit on one division roster, finalist and champion finals backups drawn from any team off the finals rosters (so a team may be on a division roster and a finals roster), one consuming and one judged award each assignable to any team, every division ordering and both champions enumerated, every role assignment enumerated per team (about 65 million assignment checks per variant). Inputs went through the shipped `divisionedJointFrames` and `jointLockBound`. Ten variants: finals maxima (30,0) and the stress (60,30), C and K in {0,1} combinations, division 1 undecided and decided, floors tight (120 to 190) and wide (20 to 210).

- Result: **no under count in any of the 10 variants x 19 teams x 2 floor regimes.** Minimum slack 0 (the bound is exact for 11 to 19 of 19 teams per variant on the wide floor run), so the oracle is not vacuous.
- A mutant with `anyRivalSeats` dropped was NOT caught by this small instance (it is not discriminating for that term), so the SUMMARY's claim that the term is needed rests on the repo's S2 test at FIM scale, which I did not re-run against a mutant. This is not counter evidence.
- The 4 division shape and the multiple shape were not re-derived by me; they rely on S2 and S3 in the repo (passing) and the 48 championship sweep (0 violations).

## Anti-pattern scan

TBD/FIXME/XXX in files changed by the task: none. No stubs found: every new export is called from `champLedgerStatus.ts`, `useDistrictLedgerData.ts` or the sweep.

## Residual risks (not gaps)

1. The proof treats a team on a division roster and a finals roster as possible (pays both); that reading is unverified against the FRC manual but is the conservative side. FIM costs 6 locks at Divisions final for it.
2. One point paying award per team across division and finals is corpus measured 2023 to 2026 only (header and `MAX_POINT_PAYING_AWARDS_PER_TEAM` document it; a rule change would be caught by the sweep, not by the proof).
3. `measureChampTenets` locked on points shown fell from 7,234 (2tr) to 6,836 with 0 violations: SUMMARY attributes it to folded finals floors and the reservation reading the finals stage. Consistent with a soundness fix, not independently attributed.
4. A rival with no dcmp row keeps a whole hypothetical DCMP ceiling until every dcmp key has started (pre existing tab rule); it costs NE 5 and FIM 4 locks at Divisions final (follow up 15). The NE teams named in the SUMMARY as missing (frc133 and others) do have necmp rows; the cost comes from other teams in their pool, which I did not trace.

## Override suggestion for truth 8

```yaml
overrides:
  - must_have: "Pins: FIM 2026 at Divisions final, finals not started locks exactly the 60 teams of the planner readings (S' 83); NE 2026 exactly 17 (S' 32)"
    reason: "Planner prototype pins came from a relaxation that S2 and E3 show is unsound at FIM scale; the executor added finals seats open to any rival and kept the tab's pre registration ceiling, so 50 and 12 are the sound counts. Soundness first."
    accepted_by: "Jacob"
    accepted_at: "<ISO timestamp when accepted>"
```

## Gaps Summary

No under count, no violation, no missing artifact, no wiring break. Zero soundness gaps. The one open item is the owner decision on the two lower "Divisions final" pins (FIM 50, NE 12) versus the plan text (60, 17); it is a deviation toward more conservative, not less.

---

_Verified: 2026-10-09_
_Verifier: Claude (gsd-verifier)_
