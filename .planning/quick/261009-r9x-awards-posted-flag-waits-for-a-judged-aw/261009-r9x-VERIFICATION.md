---
phase: quick-261009-r9x
verified: 2026-10-09T21:15:00Z
status: passed
score: 11/11 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps: []
advisories:
  - "No real live district event has exercised the new pass; first real observation is due at the first 2027 district event (recorded as leftover (c) in the todo). Every tick sequence is covered by the Worker tests and by two adversarial runs, but not by real TBA behaviour."
  - "An awards cursor row for an event whose published artifact carries no state block and which has no match observation: a changed list passes the gate, then the loop drops the list, so its ETag is never stored and the district is read from R2 each tick until a state block exists. Cost only, no wrong output. Unreachable through the pass's own writes (a row is written only for an event the loop already gave a state block)."
  - "A 200 awards response with no ETag header stores a null ETag, which step 2 then asks unconditionally, so the district passes the gate (one R2 read) every tick for that event. TBA sends an ETag, so this is theoretical."
  - "The published districtLock can take a Locked back for the window in which a recorded Impact winner consumes a slot and the flag still waits on points. Documented in the code, the doc and the todo (g). I confirmed no web code reads districtLock.status or champLock.status except champLock.status === 'prequalified' (champLedgerStatus.ts:580), which comes from the curated pre-qualification list, not from recorded awards."
  - ".planning/todos/pending/champ-joint-lock-follow-ups.md is modified but not committed, and the quick task directory is untracked. The orchestrator needs to commit both."
---

# Quick task 261009-r9x Verification Report

**Goal:** The live Worker's "awards posted" flag turns on only once a judged award (not Winner or Finalist) is listed AND its points are in the district rankings. The Worker records who won the qualifying awards into the district artifact in the SAME write and watches the awards list while the event is live. The offline publisher shares the rule and the record builder with zero historical flips.
**Verified:** 2026-10-09 against HEAD 2ee9b85c (base c5029590)
**Status:** passed. No blocker and no gap. Not pushed, not deployed, nothing committed by the verifier.

## Observable truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | D1 live: flag true only with a judged award in this tick's list AND award points on the post-merge candidate; Winner and Finalist only reads false; a published true stays true | VERIFIED | `awardsPostedRule(..., "live")` is `judged && points` (`eventAwards.ts:90`). `applyDistrictEventAwards` evaluates it on the artifact after the rankings merge (`districtRankingsMerge.ts`). `districtRefresh.ts:393,413` hands the merge only `carriedFlag = published?.awardsPosted === true`. `raise` only raises. My fuzz (400 artifacts x 3 steps) asserted that a flag going false to true always has a judged list entry and points on the prior artifact, and that the flag is monotone. |
| 2 | D1 offline: shared rule at hindsight vantage, zero flips | VERIFIED | `publishDistricts.ts` calls `awardsPostedRule(..., "hindsight")` with the judged set built by `isJudgedAwardType`. My own fresh dump at HEAD against the planner dump at c5029590: `artifacts 109 \| differing 0 \| carried events 1124 \| awardsPosted true before 1124 after 1124 \| flips 0 \| qualifyingAwards entries before 3251 after 3251` then `R9X COMPARE CLEAN`. |
| 3 | D2: every awards body merged before the verdict pass through ONE shared builder; idempotent; nothing removed; division or unrowed event records nothing | VERIFIED | `applyDistrictEventAwards` runs immediately before `recomputeDistrictVerdicts` in both entry points. `qualifyingAwardRecord` is the one builder, called by both the merge and `publishDistricts.ts`. Fuzz: second call byte-identical, existing entries are a prefix of the result, no duplicate (event, type) per team, no record for `2026aacmp1` (division) or an unrowed event, only types 0/1/9/10, `awardOnly` correct per tier, non-artifact recipients and null team keys ignored. |
| 4 | D2: flag, records, districtLock and champLock in ONE R2 put; Impact winner reads lockedAward in that artifact | VERIFIED | One `candidate` build (`districtRefresh.ts:426-429`), one `writeDistrictArtifactObject` (line 482). Tick 3 of the five-tick test asserts one put with flag true, Impact entry once and `lockedAward`. |
| 5 | D3 as decided in R-A2 (conditional asks before the gate, 200 passes the gate, 304 is no news, the one unconditional ask in the loop, ETag stored last, quiet tick reads no R2) | VERIFIED | `districtRefresh.ts` steps 2, 3, 5, 7 as described. Tick 5 of the five-tick test and test (b) assert zero district reads on a quiet tick with a row. Cursor writes are after the put or the unchanged comparison (`writeCursors`). |
| 6 | R-B: failed ask logs one warn, counts as no news, district proceeds, `districtsFailed` not incremented | VERIFIED | `askAwards` wraps the poll in try, uses `safeParse`, fails into `awardsFailed`. `counter.spend` cannot fail (`subrequestCounter.ts`). Tests (f) and my X1 (503 on a quiet tick: `districtsFailed` 0, nothing written, zero R2 reads, one warn, row unchanged, next tick recovers the list) and X3 pass. |
| 7 | D8 retry marker and write order | VERIFIED | Marker pushed for `awardsFailed && !carriedFlag`, written with a null ETag; awards cursors before the rankings cursor in `writeCursors`. Tests D8 (i), (ii), (iii) pass, plus my X3 (304 then a failing unconditional ask on a row with an ETag: marker null, next tick turns the flag true). |
| 8 | D4 lock regression pins | VERIFIED | `districtRankingsMerge.test.ts` describe 261009-r9x and the five-tick Worker test pass (full run below). |
| 9 | Scope fence and R-C | VERIFIED | `git diff c5029590..HEAD --stat` touches no `stateStore.ts`, no `apps/worker/migrations`, no `pageArtifacts.ts`. Every changed line in `champLedgerStatus.ts`, `champJointLock.ts`, `reservedSlots.ts`, `tbaPoll.ts` and `districtEventState.ts` is a comment line (filtered diff printed nothing). The import-free-of-corpus assertions pass. |
| 10 | D5 and R-D docs and todo | VERIFIED | `docs/worker-operations.md` states the rule, step order, non-fatal failure, null-ETag marker, the two freshness limits. Todo item 18 closed with leftovers (a) to (g). The todo is uncommitted (see advisories). |
| 11 | Gates | VERIFIED | See below. |

## The eight specific checks

1. **Flag true without both facts, or from Winner and Finalist only.** No such path. The only sources of `true` are `carriedFlag` (published true) and `awardsPostedRule` live. Fuzz and X2 (Winner and Finalist only with points already in the rankings, four ticks) never raise it.
2. **Flag and records in different writes.** No. Both come out of the one `candidate`; the unchanged branch writes nothing.
3. **ETag stored for a list not merged.** No. Step 7 iterates `eventAwards.keys()`, which is filled only inside the loop after the event passes both skips and after `eventState.set`; a list for a skipped event is dropped with no ETag. If the build or the put throws, the district catch runs before any cursor write. (One cost-only edge, advisory 2.)
4. **Throw or whole-district failure from an awards failure.** No. Pre-loop `readEventCursors` is unchanged from the old code (same key list). Inside the loop the only new throwing calls are inside `askAwards`'s try or `safeParse`. `counter.spend` is infallible.
5. **Tick sequences where the flag can never turn true while the event is in a live window.** Walked all five: list then points (step 5 asks unconditionally when the rankings 200 brings points and step 2 was 304), points then list (the changed list passes the gate and reads the points already on the artifact), both at once, failure on the tick that brings the points (null-ETag marker, next tick asks unconditionally), failure with no row (marker row created). Also a failed ask on a quiet tick (no marker needed, the stored ETag makes the next ask the retry, X1). All end with the flag true. The only exits are the documented ones: window closed before the ceremony, or a D1 cursor write failing on the same tick an ask failed.
6. **Subrequest accounting.** `askAwards` spends 1 before every request; each cursor write spends 1 in `writeCursors`; the artifact read and write spend inside `readArtifactObject` and `writeDistrictArtifactObject`. Nothing unaccounted.
7. **Wrong tier, division, non-district recipient, duplicate.** Tier from `eventTierByKey`; dcmp-tier key whose `championshipStemOf` differs records nothing; recipients resolved against the artifact's teams; dedupe on (event, type) across existing and just-appended. Fuzz confirmed.
8. **Behaviour with no live member event finished.** Unchanged. With no awards cursor rows step 2 makes no request, the gate is the old gate, so the steady state is one conditional rankings request and no R2 read (test at line 782 asserts zero awards requests and zero district reads).

## Commands run

| Command | Result |
|---------|--------|
| `npx vitest run apps/worker packages/harness packages/core/districts scripts` | 142 files passed, 3480 tests passed |
| `npx tsc --noEmit -p .`, `-p apps/web/tsconfig.json`, `-p apps/web/tsconfig.e2e.json`, `-p apps/worker/tsconfig.json` | all four exit 0 |
| `npx tsx scripts/measureLedgerTenets.ts` | tenet A 0, tenet B 0 |
| fresh `publishDistricts.ts --dry-run --no-bake --local-out` plus `r9x-compare.mjs` against the planner dump | `R9X COMPARE CLEAN`, 0 flips |
| my adversarial merge fuzz (temporary file, deleted) | 3 passed |
| my adversarial Worker sequences X1, X2, X3 (temporary file, deleted) | 3 passed |

The temporary adversarial test files were removed; `git status` shows only the todo modification and the untracked quick directory.

## Anti-patterns

No TBD, FIXME or XXX added in changed source. No stubs.

## Human verification

None blocking. Advisory only: watch the first real district event of 2027 (todo leftover (c)), and after the Worker deploy confirm `district-awards-poll-failed` warns stay rare.

---
_Verified: 2026-10-09_
_Verifier: Claude (gsd-verifier)_
