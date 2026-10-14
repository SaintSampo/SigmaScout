# Quick Task 261013-lve: The playoff point pool is the most the pay rule can hand out, proven, not a measured maximum - Context

**Gathered:** 2026-10-13
**Status:** Ready for planning (plan against HEAD e0e8856e, pushed)

<domain>
## Task Boundary

Jacob's rule: "it is mission critical that no team is told they are locked at any stop, and then later they are not locked." Jacob, 2026-10-09: "fix the gaps. do not leave anything undone."

Quick task 261012-mw2 learned TBA's district playoff pay rule exactly (`packages/core/districts/securedPlayoffPoints.ts`: a robot is paid the rounded UP share of its alliance's semifinal points for the semifinal wins it was on the field for, plus 5 per Finals win it was on the field for if its alliance won; 2023 has its own form; fitted exactly to 11,991 paid values). Its executor then pointed at a constant that predates the rule:

- `packages/core/districts/pointPool.ts` ~146 to 158: `PLAYOFF_POOL` is the placement table times three robots (210) plus a "backup robot margin" of 3, so 213. Its comment says the highest playoff total ever handed out at a district event is 212. It is a MEASURED maximum plus one, not a proven one.
- The pooled lock test (`pooledLockInputs.ts`, `eventRemainingPool`) treats it as an UPPER BOUND on all the playoff points an event can still hand out. An understated pool can show a false Locked on the District Locks tab and in the published `districtLock` verdict (the Worker's merge reads `pooledLockInputs`).
- Under the real rule each robot's share is rounded up, so an alliance that rotates a fourth robot can be paid more than three times its points. A first reading (orchestrator, not verified): four paying alliances (20, 20, 13, 7 semifinal points), up to 3 points of rounding each, plus 30 for the two Finals wins, gives up to about 222 at the district tier. With 212 already observed, an event above 213 is a matter of time.

Scope: `packages/core/districts/pointPool.ts`, `pooledLockInputs.ts` only as needed, the pay rule module only to export what the bound needs, tests, the sweeps' pins, headers. `pointPool.ts` is bundled into the Worker, so this task CHANGES the Worker bundle: say so, and the orchestrator deploys the Worker afterwards (no district event is live). No artifact schema change, no algorithm version change.

</domain>

<decisions>
## Implementation Decisions

### D1. Prove the maximum from the rule, per season
- For each declared season rule, the exact maximum total of playoff points one eight alliance district tier event can pay to all robots together, over every bracket outcome and every legal lineup (three robots on the field per match, an alliance of three or four, the fourth joining and sitting at any time). Derive it in closed form AND confirm it by exhaustive or randomised search that does not share code with the closed form (state the search's size and whether it reaches the maximum).
- `PLAYOFF_POOL` becomes that proven maximum (the largest over the registered season rules, or per season if the pool readers already know the season: say which and why). The measured margin constant goes. A unit test fails if a season rule is registered and the bound was not derived for it.
- Corpus check (local data gated): every 2023 to 2026 event's real playoff total is at or below the bound; report the distribution (how many at 210, 211, 212 and above).

### D2. The other pools are looked at, not changed blindly
- The qualification pool (`qualificationPool`, with its phantom attendee margin), the selection pool (computed from the formula) and the award pool (`awardPool`, a measured maximum by rookie count) each say in their own comments what they rest on. Report for each whether it is PROVEN or MEASURED, and for a measured one how close the corpus has come to it. Change nothing there in this task unless one is plainly understated against the corpus (then STOP and report). The award pool cannot be proven from a rule (events choose how many awards to give); say so.

### D3. Effect and gates
- Baselines before the first edit with the 261012-mw2 tooling (`SCRATCH/mw2/gates.sh` and the diff tools; `SCRATCH/mw2-verify/final` or `SCRATCH/mw2/exec/after-t7` as the reading at HEAD).
- A larger pool can only REMOVE pooled locks (it is the safe direction). Measure: the District Locks sweeps (`measureLedgerTenets.ts`, `measureLedgerSettledTenets.ts`): Locked on points before and after, lost per stop kind, zero violations; the Champ sweeps must not move (the champ tier does not use this pool: confirm by reading and by the gates); `orch_takeback.mts` reads `take-backs 0`; the cutoff history check; the Now dump identical (every event of a finished season is final, so the pool is 0 there); the publisher comparison clean.
- The monotone and walk tests stay at 0 Locked lost, 0 margin drops, 0 bounds higher, 0 floors lower with the rules on; pins that move are replaced with executed values, each explained by the larger pool, never fitted.
- Full `npx vitest run` with `REQUIRE_LOCAL_DATA=1`; four typechecks (root, web, e2e, worker) chained with `&&` and a sentinel echo; the Worker bundle builds (`npx wrangler deploy --dry-run` from `apps/worker`).

### D4. Headers
- `pointPool.ts` and `pooledLockInputs.ts`: the bound is proven from the pay rule, with the derivation in a few lines and the test names; which pools remain measured.

### D5. Decisions after the planner's measurements (orchestrator, 2026-10-13; BINDING, they override the text above where they differ)
- **The proven maximum is 216, not "about 222"** (214 under the 2023 rule). The orchestrator's first reading was wrong: the rounding gains are 2, 2, 1, 1 over the four paying alliances, not 3 each. Confirmed by an exhaustive search through the public pay function that shares no code with the closed form (never above 216; reached).
- **The pool is 216 for every season** (the pool readers are not told the season). It rests on FIRST's rule that an alliance at a district tier event has at most four robots (a captain, two picks and one backup), the same rule the joint proof rests on (quick task 261009-tx9); the corpus has 132 of 3,968 alliances holding a win at four robots and none at five. State that in the header as what the bound rests on, with the numbers at five robots (217 / 220) and with no roster rule (222 / 225) beside it, so a reader can see the margin that is NOT taken. Seasons before 2023 have no declared rule; for them 216 is a measured margin (all 533 of their district tier events top out at 210): say so.
- **Cost accepted:** 66 of 38,771 Locked on points displays at rewound stops are lost (all pooled only; 63 are Locked again by the event's last stop), nothing gained, no take back at any sweep stop. The pinned example of quick task 261009-uhb (frc2067 at 2026cthar) reads In range at Alliances final and Round 1 and Locked from Round 2; its assertion is re read as "once Locked, stays Locked".
- **The other pools do not change** (selection proven; qualification's three phantom attendees and the award pools measured and never exceeded).
- **The Worker bundle changes** (the pool, and two files joining its import closure). The orchestrator deploys the Worker afterwards with the owner's go ahead. No republish.
- The gate tooling is `SCRATCH/d7r/gates.sh` with `SCRATCH/lve/gates_compare_lve.sh` (the CONTEXT's `mw2/gates.sh` does not exist).

### Claude's Discretion
- Names and placement.
- If a step is ambiguous take the LARGER pool and record the reading.
- No new todo items: readings and limits go in headers and the SUMMARY.

</decisions>

<specifics>
## Specific Ideas

- SCRATCH = `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad`. Tooling of the earlier tasks: `mw2/` (gates, expected files), `d7r/worker_closure.mjs` (for THIS task it must report `pointPool.ts` as bundled: that is expected, not a failure), `orch_takeback.mts`.
- The Worker's merge reads the pooled test at `packages/harness/districtRankingsMerge.ts` ~688 (`pooledDistrictPoints`).
- Tests: `npx vitest run <paths>` from the repo root (never `timeout <n> pnpm`); run every `npx` from the repo root and download nothing. Long commands run in the background with a log. Never Read, cat or echo `.env`. The executor must not push or deploy. Long content goes through the Write tool, never a Bash heredoc.

</specifics>

<canonical_refs>
## Canonical References

- `packages/core/districts/pointPool.ts`, `pooledLockInputs.ts`, `securedPlayoffPoints.ts`, `locks.ts`, `reservedSlots.ts`
- `apps/web/src/components/districts/districtLedgerStatus.ts`, `packages/harness/districtRankingsMerge.ts`
- `scripts/measureLedgerTenets.ts`, `measureLedgerSettledTenets.ts`, `scripts/districtLocksNoTakeBack.test.ts`, `districtLocksStagedReplay.test.ts`
- `.planning/quick/261012-mw2-a-team-in-the-bracket-is-credited-the-pl/261012-mw2-SUMMARY.md` (the pay rule; the finding)
</canonical_refs>
