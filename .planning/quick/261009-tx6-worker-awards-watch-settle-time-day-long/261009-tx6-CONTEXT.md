# Quick Task 261009-tx6: The Worker's awards watch, closed out - Context

**Gathered:** 2026-10-09
**Status:** Ready for planning

<domain>
## Task Boundary

Jacob, 2026-10-09: "fix the gaps. do not leave anything undone. I want you to be done after this." This task closes every leftover of quick task 261009-r9x (the awards flag and the live winner records, Worker 33d0ded7), listed as (a) to (g) in `.planning/todos/pending/champ-joint-lock-follow-ups.md`. The Worker deploy that fixing them needs is covered by that instruction; the orchestrator performs it, the executor does not.

What is still open after 261009-r9x:
- (a) the flag turns true at the FIRST judged award with points; an Impact listed in a later batch would be recorded after the held slot was already released.
- (b)/(e) awards or points that land after the event's live window closes (one hour after its last match) are never seen until an offline republish.
- (d) an event with no awards cursor row in a quiet district may never be asked again.
- (f) an offline republish from an older corpus overwrites the live flag and winner records, and nothing re merges until something moves.
- (g) while the flag waits, the PUBLISHED verdicts hold a recorded winner's slot twice and can take a Locked back.
- (c) no real district event has exercised the pass.

Scope: `apps/worker/src/districtRefresh.ts`, `apps/worker/src/scheduled.ts` (only the call site that hands the district pass its windows), `packages/harness/districtRankingsMerge.ts`, `packages/core/districts/eventAwards.ts`, their tests, `docs/worker-operations.md`, the todo. No artifact shape change, no algorithm version change, no D1 migration, no browser change.

</domain>

<decisions>
## Implementation Decisions

### D1. The flag also waits for the awards list to SETTLE (closes a)
- The live rule gains a third fact: the event's awards list has not changed for at least `AWARDS_SETTLE_MS` = 60 minutes. Live: `judgedAwardListed && awardPointsPresent && listSettled`. Hindsight (publisher) is unchanged (either of the first two).
- "Last changed" is stored on the event's awards cursor row in `lastAdvancedAt`: set to the tick's `nowIso` whenever the stored awards ETag changes (including the first list stored). No D1 migration (the column exists and is unused on awards rows). A row with an ETag and no `lastAdvancedAt` (written by Worker 33d0ded7) reads as changed NOW the first time it is seen, which is the conservative side.
- Winner records are still merged on every list in hand, as today; only the flag waits.

### D2. A day long watch after the event, with a forced look every 15 minutes (closes b, e, d, f and makes D1 fire)
- The district pass is handed a WATCH SET, not only the live windows: every district event whose window is live OR ended within the last `DISTRICT_AWARDS_WATCH_MS` = 24 hours. Only the district pass sees the wider set; match folding, probing and promotion keep today's windows.
- A district none of whose watched events is currently live is processed only on ticks whose UTC minute is a multiple of 5 (good citizenship toward TBA). A district with a live member event runs every tick as today.
- THE FORCED LOOK: on ticks whose UTC minute is a multiple of 15, every watched district's rankings are asked WITHOUT the ETag and the gate is passed unconditionally. Inside, every watched event whose flag is not yet true is asked for its awards (R-A2 step 3 already does this). This is the one mechanism that (i) evaluates the settle timer of D1 without any waiting marker, (ii) re merges after an offline republish replaced the artifact, (iii) gives a row to an event that has none, (iv) recovers from any failed cursor write. Nothing can stay stuck for more than 15 minutes while the district is watched.
- CATCH UP on forced look ticks: also ask awards for district events on the artifact with `playoffsDone` true and `awardsPosted` false that are NOT in the watch set (older events), at most 8 per district per forced look, oldest first by week. They need cursor rows: read them in one extra D1 batch after the R2 read. This resolves an event whose awards or points landed after its watch ended, the next time its district is watched.
- R-A2's conditional asks before the gate, the null ETag retry marker and the cursor write order of 261009-r9x stay as they are on the other ticks.

### D3. The published verdicts gate an award on its own event's state (closes g)
- `awardQualifiedSets` (`packages/harness/districtRankingsMerge.ts` ~155) counts a consuming award only once its event's published state says it is given: a Winner (type 1) when `playoffsDone` is true, every other consuming award when `awardsPosted` is true. An award whose event row carries NO state block counts as today (hindsight rows). This is the rule the browser already applies (`districtLedgerStatus.ts`, `champLedgerStatus.ts`).
- Gate: the publisher's whole artifact before and after comparison over every season prints the clean line (zero verdict changes), with the scratch comparer of 261009-r9x (`r9x-compare.mjs`) or an equivalent. The 261009-r9x lock regression pin that showed locked, contending, locked becomes: not locked until the flag is true (no take back); rewrite that pin.

### D4. A replay test on real data (the nearest thing to c)
- A Worker pass test driven by the committed fixture `data/fixtures/phase10/district-2026pnw.json`: take one finished district event of that artifact, rewind it (flag false, its `qualifyingAwards` entries removed, its award points zeroed in the rows and the totals), then feed the pass the TBA shaped payloads rebuilt from the fixture in realistic order (Winner and Finalist first; then the judged list; then the rankings carrying the award points; then 60 minutes of quiet with forced looks). Assert tick by tick that the flag stays false until all three facts hold, and that the FINAL artifact's event state, `qualifyingAwards` and `districtLock` verdicts for that event equal the fixture's own (the live path reproduces what the offline publisher published). Assert that no team's published `districtLock` reads `locked` at any tick and something else at a later tick.

### D5. Docs, todo
- `docs/worker-operations.md`: the settle time, the watch set, the 5 and 15 minute cadences, the catch up, and what a forced look costs (one unconditional rankings request and one R2 read per watched district per 15 minutes).
- Todo: strike (a), (b), (d), (e), (f), (g) as CLOSED by this task. (c) stays as a one line note that the first real observation is the first 2027 district event, with the replay test named as the stand in. Nothing else is left open in that section.

### D6. Release (orchestrator)
- Push, CI, then `npx wrangler deploy` from `apps/worker` on the clean pushed tree, then watch two ticks. The executor has no network and must not deploy.

### D7. Corrections after the planner read the code (orchestrator, 2026-10-09)
- The watch set needs a new loader in `apps/worker/src/liveWindows.ts` and three call sites in `scheduled.ts` (ended windows never reached the old call site, and the tick returned before the district pass when nothing was live). Accepted.
- A finished probe (inferred) window event dropped out of the district pass as soon as its match list went quiet; the watch set includes an unprocessed inferred window only when its match cursor shows a folded match. Accepted.
- An event whose published `playoffsDone` was regressed by a republish from an older corpus is not asked (reservations stay held). The fix is at the source: a separate quick task makes the offline publisher refuse to regress live facts.
- The PNW fixture carries no state blocks; the replay builds its baseline in the test. `runDistrictRefresh`'s batched cursor read is wrapped so the pass truly never throws.

### D8. The published ceilings count what is still open at an event that already has a points row
- Found by the planner's replay: when award points arrive after an event already has a row, the PUBLISHED `districtLock` takes a Locked back on 6 of the 8 PNW 2026 district events (frc9430, frc5920), because `maxRemainingDistrict` sums `remainingEvents` only. A published value that is not true is fixed even though no page renders it.
- In the shared verdict pass, every `eventPoints` row whose state block says a category is not final adds that category's ceiling at the row's tier, as the browser's status modules do. A row with no state block adds nothing. Publisher comparison stays clean; the replay runs over all eight PNW district events and asserts no take back on any of them.

### D9. The manifest keeps a just closed district window
- `buildLiveWindowsManifest` keeps a district event's window that closed within `DISTRICT_AWARDS_WATCH_MS` of the build clock, so a manifest rebuilt inside the 24 hours does not end the watch.

### D10. The methodology states the new freshness
- `districtLedgerContent.ts` ~338 to 339 and its test: awards are picked up for a day after an event's last match, and a Locked waits until the award list has been unchanged for an hour. Flat voice, no dash characters. The only browser file touched.

### Claude's Discretion
- How the watch set reaches `runDistrictRefresh` (a second option beside `windows`, or a wider `windows` with a per entry `live` boolean).
- Constant names and where they live.
- If any step is ambiguous take the side that holds reservations LONGER and record the reading.

</decisions>

<specifics>
## Specific Ideas

- Current pass: `apps/worker/src/districtRefresh.ts` (R-A2 steps 1 to 7, D8 retry marker and cursor order), call site `apps/worker/src/scheduled.ts` ~2392 (`windows: [...foldableWindows, ...promotedWindows]`), windows built by `packages/harness/manifests.ts` (`LIVE_WINDOW_PAD_MS` one hour; entries carry `startMs`, `endMs`, `districtKey`, `inferred`).
- Awards cursor row fields available without a migration: `tbaEtag`, `lastFoldedMatchKey`, `lastPolledAt`, `lastAdvancedAt`, `rosterEtag` (`apps/worker/src/stateStore.ts` ~239).
- `runDistrictRefresh` must still never throw; every new request and D1 read or write is counted with `counter.spend`; the Worker imports nothing from `packages/corpus`, no `better-sqlite3`, no `node:` built in.
- Tests: `npx vitest run <paths>` from the repo root (never `timeout <n> pnpm`); four typechecks (root, web, e2e, worker) chained with `&&` and a sentinel echo; `npx tsx scripts/measureChampJointLocks.ts`, `measureChampTenets.ts`, `measureLedgerTenets.ts` at zero violations; `measureChampCutoff.ts --check-history` no drift; final full `npx vitest run`. Never Read, cat or echo `.env`.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/quick/261009-r9x-awards-posted-flag-waits-for-a-judged-aw/` (CONTEXT D1 to D8, SUMMARY, VERIFICATION)
- `.planning/todos/pending/champ-joint-lock-follow-ups.md` (the 261009-r9x section)
</canonical_refs>
