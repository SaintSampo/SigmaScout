# Quick Task 261010-d7r: The joint lock proof never raises a bound when a division's awards turn final, and the divisioned proof runs before the finals key exists - Context

**Gathered:** 2026-10-10
**Status:** Ready for planning (plan against HEAD 38e29a12, quick task 261010-66y complete)

<domain>
## Task Boundary

Jacob's rule: "it is mission critical that no team is told they are locked at any stop, and then later they are not locked. but also once a team is locked, we should know it as soon as we can." Jacob, 2026-10-09: "fix the gaps. do not leave anything undone."

Run 2 of quick task 261010-66y found a soundness defect in the SHIPPED divisioned joint lock proof (quick tasks 261009-kt3, 261009-pgq, 261009-tx9) and, because of it, had to drop its decision D3 (the divisioned proof running before the finals key is on the artifact).

### The defect (measured by the 261010-66y executor, 2026-10-10)

- `apps/web/src/components/districts/champLedgerStatus.ts` (~1262 to 1280): the judged award budget K handed to the proof is, per division, the whole ceiling (14) while that division's Awards are open and `max(0, 14 - awardedTeamCountAt)` once they read final (the 261009-pgq remaining budget rule).
- While a division's Awards are open a rival's posted award points are not in its floor and the proof gives each rival at most ONE point paying award (`MAX_POINT_PAYING_AWARDS_PER_TEAM = 1`). Once the division's Awards read final, the awarded rivals' points ARE in their floors, and the proof can still hand one of the remaining budget, or a consuming award, to a rival that already holds a posted award. That rival now carries two awards, which no earlier reading allowed, so a bound can RISE and a Locked team can lose it.
- Measured on rewound readings: with every division's Playoffs final and the finals not started, 11 teams over the 16 divisioned championships of 2023 to 2026 are Locked with the divisions' Awards open and not Locked with them final. No sweep stop sits between those two readings, so the sweeps' `take-backs 0` did not see it.
- Measured on the live staged walk with D3 on: at "every division finished, finals on no row" the proof dropped teams it had Locked at "playoff points land": 2026 FIM 1 (frc5675, bound 81 then 83 against 83 slots), NE 2 (frc4909, frc2713), TX 2 (frc624, frc9140), ONT 0. Each read Locked again once the finals' state was written.
- It is reachable live today wherever the proof runs before a division's Awards read final (finals rows posted, or a registration at the finals key, before a division's awards flag turns true). At a real championship the order of "finals rows post" and "a division's awards flag turns true" is a coin flip.

Scope: `packages/core/districts/champJointLock.ts` and its tests, `apps/web/src/components/districts/champLedgerStatus.ts`, `packages/core/districts/finalsBracket.ts` only as D2 needs, the sweeps and walk tests under `scripts/`. No artifact schema change, no algorithm version change. If any file the Worker bundles changes in code (not comments), say so plainly in the SUMMARY: the orchestrator is holding the one Worker deploy until this task lands.

</domain>

<decisions>
## Implementation Decisions

### D1. A rival that already holds a posted award takes no further point paying award
- In the proof's input at a position: a rival that carries award points above 0 on its row at a dcmp key whose Awards read FINAL at that position has used its one point paying award. The proof gives it no judged award from any remaining budget and no consuming award's points or place. Its posted points stay in its floor as today.
- The remaining budget of a division whose Awards read final stays `max(0, 14 - awarded teams)` (the flag alone is still not trusted to mean every judged award is in) and goes only to rivals with no posted award.
- This uses only facts the proof already rests on (`champJointLock.ts` header ~228: one judged award per team per event; no team has award points at both its division and the finals; one point paying award per rival). It adds no new assumption. State that in the header.
- Why it is monotone: before a division's Awards are final every rival takes at most one award out of 14 judged and C consuming. After, the awarded rivals hold their one (in the floor) and the others take at most one out of what is left. Every reading after is one of the readings before.
- Check the SINGLE and the TWO CHAMPIONSHIP shapes for the same transition and say in the plan what you find (the single proof is refused once its Awards read final; the two championship proof runs one input per championship). Fix whatever has the same defect; leave byte identical whatever does not.
- T itself: if T holds a posted award the same rule applies wherever the proof models T's own awards. Take the side that is sound for T's bound and record the reading.

### D2. Re apply D3 of 261010-66y (the divisioned proof runs before the finals key is on the artifact)
- The as built patch is `SCRATCH/66y-exec/t6-d3-as-built-then-dropped.patch` (SCRATCH is the session scratchpad named below). R15 (the brackets stay fetched until the finals have finished) is already in. Re apply D3 on top of D1 with its equivalence gate exactly as 261010-66y planned it (16 championships, every stop before the finals have a played row: reason, input, bounds, locked set, reservation and floors equal with the parent key's rows removed), and with the live walks through the window tick asserting 0 take backs. If D3 still fails any gate after D1, DROP it again, keep the refusal, and report exactly which tick and which team: never fit.

### D3. A monotone property the sweeps did not have (the test that would have caught this)
- **Awards order test (always on where it can be, local data gated on the real championships):** for every divisioned championship of 2023 to 2026 and every stop from "alliance points in" onward, for every subset of its divisions switched from Awards open to Awards final (with the season's real posted awards), in every order: no team's bound rises and no Locked team is lost. The 11 team measurement of 261010-66y (group 9 of `scripts/champFieldStagedWalk.test.ts`) becomes an assertion of 0.
- **Micro step walks:** extend the staged live walks so that, for every divisioned championship the local data and the corpus brackets allow (all 16 if feasible, at least the four of 2026), the walk steps one real fact at a time through the division playoffs and the finals with the bracket facts in hand: each played playoff row, each category turning final with its points, each division's awards flag turning true (in every order of divisions), the finals rows posting before and after the divisions' flags, the finals' own stages. At every step the tab's own status code runs; no team shown Locked is later not Locked. Run each walk with D1 switched off inside the test and report the take backs, so the test is shown to bite.
- Report every step where ANY team's joint bound rises, Locked or not, with the cause. A rise that is not explained by a stated modelling limit is a finding: STOP and report it rather than pinning it.

### D4. Gates
- Baselines BEFORE the first edit (the tooling of 261010-66y is under `SCRATCH/66y/`: `gates.sh`, `gates_compare.sh`, `p12_gate.mjs`; take new baselines at HEAD 38e29a12).
- The four sweeps: zero violations, `SKIPPED (0)`. Every SINGLE block and the California block of the joint sweep byte identical unless D1 finds and fixes the same defect there (then report each moved line). Divisioned lines may move: report every moved line; per stop the combined Locked count after is at or above before (no lock lost at any sweep stop); pins replaced with executed values, never fitted.
- `orch_takeback.mts`: `take-backs 0`. `measureChampCutoff.ts --check-history`: no drift. The Now dump of both tabs identical. The publisher whole artifact comparison clean.
- The proof's soundness tests (the exhaustive and sampled futures of 261009-tx9, E3 and S2 and the targeted real futures) are extended to states where some divisions' Awards are final with awarded rivals, and every legal future's real slot takers stay at or below the bound. Mutation check, reverted and reported: letting an awarded rival take a second award must fail the monotone test (not the soundness test: say which fails).
- Full `npx vitest run`; four typechecks (root, web, e2e, worker) chained with `&&` and a sentinel echo; `REQUIRE_LOCAL_DATA=1` in every verify command.

### D5. Docs and todo
- Module headers (`champJointLock.ts`, `champLedgerStatus.ts` decision 5, `finalsBracket.ts`): the rule, why it is monotone, and that the earlier remaining budget rule let an awarded rival take a second award. Remove the "not closed" note 261010-66y left there.
- Todo `.planning/todos/pending/champ-joint-lock-follow-ups.md`: strike item 10 as CLOSED by this task if D2 lands (one sentence), else leave its STILL OPEN note with the new reason. No new item. Leave the file uncommitted.

### D6. Decisions after the planner's measurements (orchestrator, 2026-10-10; binding, they override the text above where they differ)
- **D1's clause on consuming awards is WITHDRAWN** (planner premise P1). An awarded rival takes no further JUDGED award from a remaining budget; it may still take a consuming award. Six teams (2017 and 2018 FIM) hold a division judged award and a consuming award at the finals of the same championship, so the clause could understate, and it is not needed: the cause is the judged budget alone (`champJointLock.ts` 765 to 766 and 514 to 515 through 809), and a consuming award takes one place whatever the rival's points. The plan's pin for this stands. D1's sentence "it adds no new assumption" is withdrawn with it.
- **D1 alone does not make the proof monotone. The planner's three further findings are all in scope and nothing is struck:** F-B (the finals' Awards flag turning true before a division's: the proof refused and 306 locks were lost in the walks; the proof now runs until every key's Awards are final, with no consuming award past the finals' Awards, and the Live fetch set keeps the keys until every event has finished), F-C (2026 California, one championship's Awards final while the other is open: a finished championship needs no bracket facts and has its Winner counted), F-D (an unconfirmed listed fourth read at its alliance's settled value OR on a seat, never both).
- **D2 is re applied by hand** (the as built patch does not apply to HEAD), with its equivalence gate and its drop rule.
- The CONTEXT's "divisioned totals 1989 / 1750 / 3739" are the every championship totals; divisioned alone is 1608 / 1274 / 2882.
- Two executor runs: Tasks 1 and 2, then Tasks 3 to 5.
- No file the Worker bundles changes; Task 5 gates on it. The Worker deploy of 261010-66y is already live (version 335327ff, 2026-10-10), so nothing is held any more: if the closure gate finds a bundled file changed, STOP and report.

### D7. Binding addenda after the plan check (orchestrator, 2026-10-10; the plan text does not carry these, the executor applies them)
- **Three executor runs, not two:** run A does Tasks 1 and 2, run B does Task 3 alone (the F-D rule and the micro step walks are heavy), run C does Tasks 4 and 5 and writes the SUMMARY. Each run leaves a hand over note for the next.
- **Step 0 of every run checks the gate tooling exists** (`d7r/gates.sh`, `d7r/d7r_gate.mjs`, `d7r/worker_closure.mjs`, `d7r/expected_t1_moved.txt`, `d7r/base`, the `.mts` ports, `66y/gates_compare.sh`, `66y/p12_gate.mjs` under the session scratchpad) and stops if it does not. The executor works in the main checkout, no worktree (`data/local-publish` and `data/corpus.sqlite` are gitignored).
- **F-B's limit is stated, not called closed (Task 2):** setting the consuming awards to 0 once the finals' Awards read final rests on the same awards flag limit as `reservedChampSlots` (a consuming award listed after the list has settled). One sentence in the header and in the SUMMARY.
- **More walk edges (Task 3, and Task 4 for the first):** the field proof turning true mid playoffs (which switches D2's absent finals reading on) and, as a synthetic edge, turning false again; a finals row posting with no state block; a Winner listed before the playoff points; a division's awards flag turning true before its playoff points. Each asserts no Locked team is lost. The SUMMARY names plainly what stays unwalked (`dcmpSlots` or `cmpSlots` changing, an alliance list changing after a pick) rather than implying completeness.
- **Rule off bites are stated honestly:** the awards order rule off must lose locks through the module the status code really imports (assert above 0); the F-D rule off loses no Locked team and only drops margins, and the test says so; D2 has no rule off in the monotone file (it is an earliness rule: its proofs are the equivalence gate and the live walks, two separate things, and the SUMMARY says so).
- **SUMMARY wording:** the sweeps not moving in Tasks 2 to 4 shows only that the rewound stops did not change; the lattice and micro step tests are what check F-B, F-C and F-D.

### Claude's Discretion
- How the "has used its award" fact reaches the proof (a field on the rival, a set on the input).
- If a step is ambiguous take the side that covers MORE futures (the larger bound) unless that side is the one that breaks monotonicity; then stop and report.

</decisions>

<specifics>
## Specific Ideas

- SCRATCH = `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad`. Run 2's material: `SCRATCH/66y-exec/` (baselines `base`, `after-t8`; the D3 patch; `final-walk-verbose.txt`), `SCRATCH/66y/run1-handover.md`.
- The 261010-66y SUMMARY (the section on the dropped D3 and the open finding) and group 9 and group 10 of `scripts/champFieldStagedWalk.test.ts` are the starting point.
- Current divisioned totals after 261010-66y Task 8: shipped 1989, proof alone 1750, combined 3739.
- Tests: `npx vitest run <paths>` from the repo root (never `timeout <n> pnpm`). Never Read, cat or echo `.env`. The executor has no network and must not push or deploy. Long content goes through the Write tool, never a Bash heredoc.

</specifics>

<canonical_refs>
## Canonical References

- `packages/core/districts/champJointLock.ts` (header facts ~228; `JointLockInput`; `MAX_POINT_PAYING_AWARDS_PER_TEAM`; the cover bound ~700 to 750), `champJointLock.test.ts`
- `apps/web/src/components/districts/champLedgerStatus.ts` (`awardedTeamCountAt` ~1004; the judged budget ~1262 to 1280; `divisionedJointProof`; `jointProofAt`), `packages/core/districts/finalsBracket.ts` (`championshipShape`)
- `scripts/champFieldStagedWalk.test.ts`, `scripts/measureChampJointLocks.ts` and its test, `scripts/districtLocksStagedReplay.test.ts`
- `.planning/quick/261010-66y-at-the-live-position-a-team-with-no-cham/261010-66y-SUMMARY.md`, `261010-66y-PLAN.md` (Task 6, P8, R14, R15), `.planning/quick/261009-pgq-champ-locks-earliness-a-rowless-team-lea/261009-pgq-SUMMARY.md` (the remaining budget rule), `.planning/quick/261009-tx9-divisioned-joint-proof-follows-the-backu/` (the soundness tests)
</canonical_refs>
