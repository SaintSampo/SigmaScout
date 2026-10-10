---
phase: quick-261009-tx6
verified: 2026-10-10T00:50:00Z
status: passed
score: 15/15 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification: false
gaps: []
warnings:
  - id: W-R27
    title: "A consuming award listed after the flag is true still takes a held place back (documented limit R27)"
  - id: W-ORDER
    title: "The methodology copy ships with the Pages push, before the Worker deploy and the live windows manifest republish make it true"
info:
  - "publish.ts seeds event cursors for the newly kept closed district windows (calendar windows seed a null folded key)"
  - "the Worker's idle tick now builds the algorithm context on every due 5 minute mark during a watch (only after a district is due and proven)"
---

# Quick task 261009-tx6 Verification Report

**Goal:** close out the live Worker's awards handling and make the PUBLISHED district verdicts sound.
**Commits checked:** a7c77122, e9dab2d7, 0ac3c524, 11190093, d971b1d1, 8fb29c8a (base aa888eba). HEAD is 8fb29c8a. Working tree at the end is identical to the start (only the pre-existing todo edit and untracked quick task dirs).
**Verified by:** reading the code line by line, running the gates, and writing my own adversarial tests (kept outside the repo, listed below).

## Gates run by me

| Gate | Result |
| ---- | ------ |
| `npx vitest run apps/worker packages/harness packages/core/districts scripts` | 144 files, 3613 tests, all passed |
| `npx vitest run apps/web/src/components/methodology` | 5 files, 85 tests passed |
| `tsc --noEmit` root, `apps/web/tsconfig.json`, `apps/web/tsconfig.e2e.json`, `apps/worker/tsconfig.json` | all four print nothing (clean) |
| `npx tsx scripts/measureLedgerTenets.ts` | tenet A 0, tenet B 0 |
| `npx tsx scripts/measureLedgerSettledTenets.ts` | `VIOLATIONS: none` |
| `measureChampJointLocks`, `measureChampTenets` | `VIOLATIONS: none` both |
| `measureChampCutoff --check-history` | `no drift` for both generated files |
| Publisher dry run of all 109 district artifacts at HEAD (my own dump) compared with the executor's baseline and with the planner's | `artifacts 109 \| differing 0 \| carried events 1124 \| flips 0 \| qualifyingAwards 3251 -> 3251`, `R9X COMPARE CLEAN` against both |
| Every one of those 109 real published artifacts through the Worker merge, 304 path, 200 path, and 200 twice | 0 differ from the input, 0 unstable. So a forced look on unchanged data never produces a put |
| `npx wrangler deploy --dry-run` (bundle only, no upload) | bundles, 1349.61 KiB |

## Observable truths

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | D3 award gated on its own event's state | VERIFIED | `awardQualifiedSets` (districtRankingsMerge.ts 360-394) reads `eventStateByKey` (any tier, state-carrying row wins). Winner counts on `playoffsDone \|\| awardsPosted`, other consuming awards on `awardsPosted`, no state block counts as before |
| 2 | D8 ceilings and floors, one finality helper | VERIFIED | `openAtPlayedRows` + `publishedCategoryFinality` (single call site of `districtEventCategoryFinality`). `pointTotal` on the wire untouched. Idempotence and 200/304 agreement proven by my tests below |
| 3 | D8 stability: `dcmpStillAhead` and the seed on both paths | VERIFIED | Both entry points evaluate `dcmpStillAhead` and `unexplainedDistrictCeilings` on the incoming artifact before merging. My tests: seed 83 survives 200, 304, 200, 304; no team granted a hypothetical championship by an open row; the calendar-only championship difference survives |
| 4 | D3/D8 publisher gate | VERIFIED | Re-run by me, clean against two independent baselines |
| 5 | D1 three-fact live rule and settle clock | VERIFIED | `awardsPostedRule` live needs all three; `awardsListSettled` returns false for null/undefined ETag, differing ETag, null/undefined/unparseable time, future time and a clock that goes backwards. Tick tests of mine: future time, 1 ms future, "not a date", empty string, null, backwards clock, flapping ETag all keep the flag false and the unusable ones are re-stamped with the tick time; the 61 minute control turns it true |
| 6 | D9 manifest retention | VERIFIED | Builder keeps a district window (measured or calendar) until `endMs + 24h`, non district windows unchanged. Tick test of mine: a kept closed measured or calendar window gets no `/matches` or event detail request, no probe, no promotion, no plain event cursor row |
| 7 | D2 watch set, cadences | VERIFIED | My matrix over minutes 0..59 on the idle path: processed exactly at 0,5,...,55; rankings asked with no ETag exactly at 0,15,30,45. Calendar proof, odd manifests (endMs before startMs, bad district key, bad event key) resolve with no throw |
| 8 | D2 forced look and R5 ended-event ask | VERIFIED | Code read (districtRefresh.ts 749-755) and the executor's tests; consistent with my two event runs |
| 9 | D2 catch up | VERIFIED | Code read: candidates from artifact rows, key pattern checked, rows read in one counted batch of 90, never asked first then least recently asked, cap 8, `lastPolledAt` stamped on every ask |
| 10 | D2 reach and cost | VERIFIED | Three call sites in scheduled.ts; mismatch return still excluded; `runDistrictRefresh` has every I/O inside a try or counted. A live non district window costs identically at minutes 1, 15 and 0 (31 subrequests, 4 TBA, 10 D1, 10 R2 gets, zero district URLs, zero district cursor selects). Nothing watched costs one manifest read |
| 11 | D4 award stage walk | VERIFIED | Passes; I extended it (below) |
| 12 | Scope of the no take back claim stated | VERIFIED | Plan, doc, SUMMARY say award stage only |
| 13 | D10 methodology copy | VERIFIED | Two rows, no dash characters, test pins them, nothing else in the repo pins the old title |
| 14 | Scope fence | VERIFIED | `git diff --name-only aa888eba..HEAD` is exactly the 16 planned files; only two `apps/web` files; `reservedSlots.ts` changed in comment lines only; the Worker bundles |
| 15 | D5 doc and todo, D6 no push or deploy | VERIFIED | Doc carries the cadences, worst case, settle limit, seed, retention; todo section closes (a) (b) (d) (e) (f) (g) and keeps (c); nothing pushed |

## My adversarial tests (kept at the scratchpad, not in the repo)

`scratchpad/zzVerifyTx6.test.ts.keep` (pure merge) and `scratchpad/zzVerifyTx6Worker.test.ts.keep` (real `runTick`). Both deleted from the repo after the run.

**Item 2, held place never taken back during the award stage**
- Pure merge: all 28 pairs of the 8 PNW district events, every admissible interleaving of {list, award points, flag} for both events (80 orderings per pair, 2240 runs). Zero lost held places at either tier, final verdicts equal the baseline in every run. A teeth check (`losses()` on baseline then fully rewound) does detect a regression.
- Real `runTick` through the watch: 4 pairs in both orders (orsal+orore, wasam+wasno, orwil+waahs, wabon+wayak), 3 variants each, 24 runs of 39 ticks: (a) events finishing 60 minutes apart with staggered lists and points, (b) a rankings 200 that brings points for the second event while the first waits for its settle, (c) the second event's judged list arriving after the first event's flag is already true. Zero lost held places at both tiers, final `districtLock`, `champLock`, `maxRemainingDistrict`, `maxRemainingChamp` equal the baseline in all 24.
- DCMP award stage (`2026pncmp`), which the task's replay never walks: Winner listed with playoffs done, then judged list, then points, then flag. Zero lost champ places, final equals baseline. Champ status counts per step (locked/lockedAward/prequalified/contending/eliminated): 8/0/0/25/93, 6/3/0/24/93, 6/3/0/24/93, 6/3/0/24/93, 12/8/0/2/104.

**Item 3, the executor's Winner deviation**
Winner at the DCMP, matrix over (`playoffsDone`, `awardsPosted`) with the champ reservation: `reservedChampSlots` reserves the winning alliance only when `!neverHappening && !awardFinal && !elimFinal`; the gate counts it when the state is absent, `playoffsDone` or `awardsPosted`. Observed frc2046 champ status: (false,false) contending (reserved, uncounted); (false,true) lockedAward; (true,false) lockedAward; (true,true) lockedAward. No state leaves a Winner neither reserved nor counted, except `neverHappening` (a past season whose DCMP never started), where no Winner can exist. The deviation is right and is a superset of the plan's rule. A state with no block on any row both reserves and counts (held twice), which is the old hindsight shape and the safe side, and the Worker cannot create it because a list is merged only for an event that has a published or observed state.

**Item 8, idempotence**
Start states: finished, a fully open dcmp row, a district award category open, stored ceilings that predate the change (both set to 0), a stored remaining event plus an open row, a newcomer with and without a played row. For each: 200 once, 304 once, 200 twice, 304 twice, 200 then 304, 304 then 200 all give equal `maxRemainingDistrict`, `maxRemainingChamp`, `districtLock`, `champLock` for every team, and `recomputeDistrictVerdicts` is a fixed point. A newcomer holding an open row keeps ceiling 98 across ticks and drops to the bare seed 83 when the flag closes the category.

## Findings

### WARNING W-R27: a consuming award listed after the flag is true still takes a held place back
This is the limit the plan (R27), `eventAwards.ts`, the pass header and the doc already state, so it is not a gap against the must-haves. I measured what it costs because the SUMMARY's headline ("the published Locked is no longer taken back") reads wider than it is. Pure merge, flag true on a list with no Impact (judged award present, points present), then the Impact arrives:
- District tier: `2026wasam` and `2026wasno`: `frc5920` reads held when the flag turns true and `eliminated` on the next list (a jump from Locked straight to Eliminated). The other six events lose nothing.
- Champ tier at `2026pncmp`: a late Impact (type 0), Engineering Inspiration (9) or Rookie All Star (10) takes `frc9450` and `frc3674` from held to contending. A late Winner (1) loses nothing.
It needs a list that stays unchanged for 60 minutes and then changes. The Locks tabs read the same rows, so the tab shows it too. Jacob accepted the rule; I am only recording the size so the acceptance is informed. The methodology row says a Locked waits for an unchanged hour, which is true, and does not say a later award can still revoke it.

### WARNING W-ORDER: the page copy ships before the behaviour it describes
"Awards are picked up for a day after an event's last match" is true only after both the Worker deploy and a republish of the live windows manifest (`manifests.ts` is offline code; the Worker's loader keeps no closed window the old manifest dropped). A Pages push goes out first. Until the manifest is republished: live districts, the forced look and the catch up work at once, but an ended event with no live sibling in its district is not watched. The SUMMARY says so. Suggest: Worker deploy, run `publishLiveWindows` (or any run that rebuilds the manifest), then push.

### INFO
- `packages/harness/publish.ts` (not edited) seeds `event_cursor` from every window in the rebuilt manifest, so a rebaseline now also seeds cursors for kept closed district windows. A closed measured window seeds the replay's last folded key (harmless). A closed CALENDAR window of an event the corpus holds no matches for seeds `NULL`, which erases the proof the watch needs for it, for the rest of its 24 hours. Needs a rebaseline inside that day with the event missing from the corpus; unlikely after a normal ingest.
- Idle ticks on a due 5 minute mark now build the algorithm context for the suspension check (two counted subrequests, module build). Only after a district is due and proven, and it is the same context a busy tick builds.
- TBA cost while watched: a live district with several ended siblings sends one conditional awards request per sibling per tick. Bounded by the documented 3M + 4.

## Hunt results against the brief

1. Flag without a judged award, points and 60 settled minutes: the only writers of `awardsPosted: true` are `applyDistrictEventAwards`' `raise` (gated by `awardsPostedRule` live) and the offline publisher (hindsight, untouched). No ETag or clock is stored for a list not merged: the stores happen after the put, only for lists handed to the merge, and an event skipped by the `continue` guards (no state, no row) is never stored. Missing, unparseable, future time and backwards clock all read as not settled. No gap.
2. Take backs during the award stage: none found (see the 2240 and 24 run results). The only way is the R27 limit above.
3. Winner deviation: sound (above).
4. Throws and counting: the cursor reads, chunking and suspension check are inside try; odd manifests resolve with `districtsFailed` counts, no throw (my run: considered 3, unchanged 1, failed 2). Every request and D1 call goes through `counter.spend`; the executor's equality test and mine agree.
5. Zero cost with no district event in any watch set: confirmed at minutes 0, 1 and 15 with a live non district window, identical to the byte of the counters.
6. Cadences: processed exactly on multiples of 5, unconditional rankings on multiples of 15, both idle returns and the probe only return call the pass, the mismatch return still does not. The suspended idle path is pinned by an existing test. A watched district is left unprocessed only by design: an unproven calendar window, a state generation mismatch.
7. D9: confirmed, including that non district windows keep today's retention.
8. D8 idempotence: confirmed on both paths from five start states.

## Verdict

All must-haves hold in the code, all gates pass, the zero flip publisher gate reproduces on my own dump, and I found no path that breaks the award stage claim. Two warnings (W-R27, W-ORDER) are for the caller's awareness before the deploy. No gaps.

_Verified: 2026-10-10_
_Verifier: Claude (gsd-verifier)_
