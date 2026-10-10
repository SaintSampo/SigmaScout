# Quick Task 261009-r9x: The awards posted flag waits for real awards, and the live Worker records who won - Context

**Gathered:** 2026-10-09
**Status:** Ready for planning

<domain>
## Task Boundary

Jacob, 2026-10-09, chose "Fix it fully" for follow up 18 of `.planning/todos/pending/champ-joint-lock-follow-ups.md`, with the Worker deploy that implies.

The Locks guarantee on both tabs holds slots back until an event's awards are done (`packages/core/districts/reservedSlots.ts`, `champReservedSlots.ts`), because Impact (and at a District Championship Engineering Inspiration, Rookie All Star and the winning alliance) take a slot whatever a team's points are. Two live gaps, both in `apps/worker/src/districtRefresh.ts` and both pre existing:

1. **The flag turns on too early.** `awardsPosted = awards !== null && awards.length > 0` (~257), and a published `true` is never asked about again (~241). If TBA lists an event's Winner and Finalist before its judged awards, Awards read as final on both tabs while the judged awards are still due: award ceilings drop and the reservations go to zero.
2. **The live artifact never learns WHO won.** `qualifyingAwards` is carried forward from the offline publisher (`packages/harness/districtRankingsMerge.ts` header, line ~25 and ~557); the Worker polls `/event/{key}/awards` only for the boolean. So once the flag is true the held slot returns to the points race, and the award winner that actually took it is not in `awardQualified` until the next offline republish. A team can read Locked on a slot an Impact winner already holds.

Measured (`data/corpus.sqlite`, every district points event of every season: 953 district events, 110 District Championships, 64 divisions): every event with any award listed also lists an award beyond Winner and Finalist (0 events with Winner and Finalist only); every such event but one pre 2022 championship has award points on some district team's row; 12 events since 2022 list judged awards but no Impact (11 in 2022, `2026isde2`), so "wait for Impact" is not a usable rule. The corpus is ingested after the fact, so it cannot show whether TBA lists awards all at once.

Scope: the Worker's district pass, the shared merge in `packages/harness/districtRankingsMerge.ts`, the offline publisher's flag rule (`scripts/publishDistricts.ts` ~904), their tests, `docs/worker-operations.md`, the follow ups todo. No artifact SHAPE change (`qualifyingAwards` and `state.awardsPosted` already exist), no algorithm version change, no browser lock math change.

</domain>

<decisions>
## Implementation Decisions

### D1. What "awards posted" means, one shared rule
- A new pure function in `packages/core/districts` (or beside the merge in `packages/harness`), used by BOTH producers, with two inputs: `judgedAwardListed` (the awards list holds an award whose type is neither Winner 1 nor Finalist 2) and `awardPointsPresent` (some district team's row at that event carries award points above 0).
- **Worker (live):** `awardsPosted` is true only when BOTH hold, read on the candidate artifact AFTER this tick's rankings are merged. Judged awards listed but points not yet in TBA's district rankings keeps Awards open (award ceilings and reservations stay), which is the conservative side. A published `true` stays true (awards do not un post).
- **Publisher (offline, hindsight):** true when EITHER holds (`withNonZeroAwardPoints` stays an OR, the "any award" terms become "a judged award"). Gate: computed over the whole corpus, ZERO events may change their published flag against today's rule; the executor proves it with a before and after diff of the publisher's state map and stops if any event flips.

### D2. The Worker records who won, in the same write as the flag
- A new shared merge step in `packages/harness/districtRankingsMerge.ts` (`applyDistrictEventAwards` or equivalent) that takes the TBA awards list for one event and adds, to each RECIPIENT that is a team of the district artifact, a `qualifyingAwards` entry built exactly as the publisher builds it (`scripts/publishDistricts.ts` ~415 to 428: `isQualificationRelevantAward(awardType, tier)`, `awardDisplayName(awardType, season)`, `isAwardOnly(awardType, tier)`). The publisher is refactored to call the same builder so the two cannot drift.
- The event's award tier comes from the artifact's own rows (`eventTierByKey`): `district` or `dcmp`. A DCMP DIVISION (a dcmp tier key with trailing digits, `championshipStemOf(key) !== key`) contributes nothing, as in the publisher (a division Winner must never reach the list). An event on no row contributes nothing.
- Idempotent: an entry with the same `eventKey` and `awardType` on a team is not added twice. Recipients that are not district teams are ignored. Nothing is ever removed.
- Awards are merged on EVERY awards response that carries a body, whether or not the flag turns true this tick: a DCMP Winner listed first is recorded at once (the browser already gates it on the Playoffs stage), and Impact is recorded while the flag still waits on points (the browser gates it on the Awards stage, so nothing reads it early).
- The merge runs BEFORE the verdict recompute in the same candidate build, so `districtLock`, `champLock`, the flag and the winner records land in one R2 write.

### D3. Keep asking while the event is live
- While `awardsPosted` is not yet true: the awards request is sent WITHOUT the cached ETag (a 304 carries no list, and the rule needs the list each tick to re evaluate against newly merged points). The comment at ~262 ("a 304 is false") is rewritten.
- Once `awardsPosted` is true: the Worker KEEPS polling that event's awards for as long as the event is in a live window, conditionally (ETag), and merges any award listed later (D2). The "published true skips the request forever" branch goes. Cost: one conditional subrequest per finished live event per tick; the plan is Workers Paid (10,000 subrequests per invocation).
- The existing cheap steady state (rankings 304 and nothing observed: no R2 read) stays as it is.

### D4. Tests
- Shared rule and merge (unit): Winner and Finalist only -> not posted; judged listed, no award points -> not posted (Worker), posted (publisher); judged listed and points -> posted; Impact recipient gets `{eventKey, awardType 0, label, awardOnly false}` at the district tier; EI and RAS at a district event are `awardOnly: true`; DCMP Winner recorded with the flag still false; a division key records nothing; a non district recipient is ignored; a second identical merge changes nothing; an award listed on a later tick is added.
- Worker pass (`apps/worker/test/scheduled.district.test.ts`): tick 1 Winner and Finalist only -> `awardsPosted` false, no ETag sent on tick 2; tick 2 judged listed but rankings carry no award points -> false; tick 3 rankings carry the points -> true, `qualifyingAwards` holds the Impact winner, and the published `districtLock` verdicts count that winner as award qualified in the SAME written artifact; tick 4 a late EI is merged with the flag already true (conditional request, 200); tick 5 a 304 changes nothing and writes nothing.
- A district tier lock regression on a small synthetic district: with the old behaviour (flag true, no winner recorded) a knife edge team reads `locked`; with the new behaviour it does not until the winner is recorded and still qualifies or not as the slots then say. Pin both.
- Publisher: the zero flip corpus gate of D1 (corpus gated test or a scripted check whose output goes in the SUMMARY).
- Every existing Worker and harness test passes; `scheduled.district.test.ts`'s static import assertions (no corpus, no node built ins in the Worker) still hold.

### D5. Docs and todo
- `docs/worker-operations.md` (~950 and ~980) describes the old rule ("a district artifact that already publishes `awardsPosted: true`..."): rewrite those sentences to the new behaviour. The module header's KNOWN FRESHNESS LIMIT (awards that post after the live window closes wait for a republish) stays true and stays documented; with the flag false in that case the reservations stay held, which is conservative.
- Methodology (`districtLedgerContent.ts` ~337 "Awards posted after every event in the district has finished wait for the next offline republish"): still true; touch only if a sentence now reads false, flat voice, no dash characters.
- Close item 18 in `.planning/todos/pending/champ-joint-lock-follow-ups.md` and record what is left: (a) awards listed in several batches after the first judged award with points (the reservation is released at that first batch; later winners are merged as they appear); (b) the live window closing before the ceremony; (c) no real live district event has exercised this yet, first observation due at the first 2027 district event.

### D6. Release (the orchestrator does this, not the executor)
- Commit, push (CI runs the tests), then deploy the Worker with `npx wrangler deploy` from `apps/worker` on a clean tree at the pushed SHA (project memory `worker-deploy-and-tail`). Jacob granted the deploy on 2026-10-09 by choosing "Fix it fully". The executor must NOT deploy and has no network.
- The deploy also ships every Worker bundled change made since the last deploy (project memory notes a Worker deploy has been owed since 261006-3gg): the full Worker and harness test suites are the gate.

### D7. Corrections after the planner read the pass (orchestrator, 2026-10-09; these supersede D3's wording where they differ)
- **The watch is driven by the list changing (R-A2).** The pass leaves at its gate (rankings 304 and nothing observed) before it reaches the awards block, and a finished event stops passing the gate, so "keeps asking each tick" was false as written. Now the awards cursor row stores the ETag of the last awards response merged, whatever the flag says. Before the gate every member window event with an awards cursor row is asked conditionally; a 200 (the list changed) lets the district through the gate. Inside the loop an event whose flag is not yet true and whose conditional ask gave 304 (or that had no row) is asked unconditionally so the rule has the list. Cursor writes stay last. A DCMP Winner listed on a quiet tick is therefore recorded on that tick, and an event waiting on points costs one conditional request per tick and no R2 read.
- **An awards request that fails is not fatal to the district.** It logs a warn, counts as no awards news, stores no cursor, and the rankings merge proceeds.
- **Comment only rewording** in `champLedgerStatus.ts` and `champJointLock.ts` is allowed, with the comment only proof.
- **Recorded leftovers (todo):** awards or points landing after the live window closes; an offline republish from an older corpus overwriting live records; the published verdicts consuming a recorded winner's slot and still reserving one while the flag waits on points (conservative).

### D8. Binding addenda after the plan check (orchestrator, 2026-10-09; the plan text does not carry these, the executor applies them in Task 2 and Task 4)
- **A failed awards ask always gets retried (closes the checker's liveness blocker).** When an awards ask fails (step 1 or step 3) for an event whose flag is NOT yet true, that event's awards cursor row is written with a NULL ETag at the end of the tick, creating the row if it is absent (a retry marker, never an ETag from the failed response). R-A2 step 1 asks a null ETag row unconditionally, so the next tick's 200 passes the gate and the pass evaluates the rule again. This supersedes R-B's "no cursor written from it" for not yet posted events. A failed ask for an event whose flag is already true leaves its row untouched (its next conditional ask is the retry).
- **Cursor write order.** The awards cursors are written FIRST, then the district's rankings cursor. If an awards cursor write throws, the rankings cursor is not written that tick, so the next tick's rankings 200 passes the gate again.
- **Tests to add (Task 2):** (i) the gate passes on a match observation with rankings 304, the step 3 ask fails for an event with no row: a null ETag row is written; next tick everything else is quiet, step 1 asks unconditionally, the 200 passes the gate, the list is merged and its ETag stored. (ii) rankings 200 brings the award points while the step 1 conditional ask fails: the points are written, the flag stays false, the row's ETag is null; next tick rankings 304, the unconditional ask returns the judged list: flag true, winner recorded, one write. (iii) an awards cursor write that throws leaves the rankings cursor unwritten.
- **Wording (Task 4):** leftover (d) in the docs and the todo says an event with no awards cursor row whose district is quiet may not be asked again while it stays quiet (not "joins on the next tick"), and names the one remaining way to get there: a D1 cursor write failing on the same tick an awards ask failed.

### Claude's Discretion
- Where the shared rule and builder live, and their names. The Worker must keep importing nothing from `packages/corpus`, no `better-sqlite3`, no `node:` built in.
- How the pass threads the awards list to the merge (extend `eventState` with the list, or a second map).

</decisions>

<specifics>
## Specific Ideas

- TBA award payload (`packages/ingest/schemas.ts` ~341): `{ name, award_type, event_key, recipient_list: [{ team_key, awardee }], year }`.
- Artifact record (`packages/harness/pageArtifacts.ts` ~2076): `{ eventKey, awardType, label, awardOnly }`. District tier events contribute types 0, 9, 10 (9 and 10 `awardOnly: true`); DCMP tier events contribute 0, 1, 9, 10 (`awardOnly: false`).
- `consumingAwardTypesForTier` and `isQualificationRelevantAward` are in `packages/core/districts/qualification.ts`; `awardQualifiedSets` (districtRankingsMerge.ts ~155) already derives the consuming sets from `qualifyingAwards`, so recording the winner is enough for the verdicts.
- The browser already reads both fields: `apps/web/src/components/districts/districtLedgerStatus.ts` and `champLedgerStatus.ts` gate each award on its own event's stage. No browser change is expected; if the planner finds one is needed, say so in the plan.
- Run tests with `npx vitest run <paths>` from the repo root (the Worker's tests run from the root too), never `timeout <n> pnpm`. Three typechecks plus the Worker's own tsconfig if it has one, chained with `&&` and a sentinel echo. `npx tsx scripts/measureChampJointLocks.ts`, `measureChampTenets.ts` and `measureLedgerTenets.ts` must stay at zero violations (they read published artifacts and should not move). Never Read, cat or echo `.env`.

</specifics>

<canonical_refs>
## Canonical References

- `apps/worker/src/districtRefresh.ts` (the pass, ~150 to 318), `apps/worker/src/tbaPoll.ts` (`pollEventAwards`), `apps/worker/src/districtEventState.ts`, `apps/worker/test/scheduled.district.test.ts`
- `packages/harness/districtRankingsMerge.ts` (`applyDistrictRankings`, `applyDistrictEventState`, `awardQualifiedSets`, `reservedDistrictSlots`, `recomputeDistrictVerdicts`), `scripts/publishDistricts.ts` (~404 to 428 the award list, ~880 to 905 the state map)
- `packages/core/districts/qualification.ts`, `reservedSlots.ts`, `champReservedSlots.ts` (`championshipStemOf`)
- Quick tasks 260925-ms7 (the Impact reservation), 261006-3gg (the champ reservation), 261009-pgq SUMMARY (where this was found)
</canonical_refs>
