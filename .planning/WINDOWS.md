---
schema_version: 1
open_count: 13
waived_count: 0
fixed_count: 3
total_count: 16
last_updated: 2026-08-29T23:52:19.000Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | packages/harness/statbotics.ts |  | STATBOTICS_REFERENCE_FALLBACK per-season values (2022-2026) are unverified best-available estimates (~0.70-0.72), not individually sourced against Statbotics' own published figures — the live endpoint reproducibly 500s (reconfirmed 2026-08-13) and Statbotics' blog page renders numbers client-side from the same broken API, so this pipeline has no way to scrape verified numbers | open |  | 2026-08-13T16:13:38.414Z |  |
| 2 | 02 | deviation | packages/harness/statbotics.ts |  | SC-2 (Statbotics per-team numeric tolerance) recorded blocked-on-external-dependency per D-14 -- api.statbotics.io/v3/year/{year} reproducibly returns HTTP 500, re-confirmed live 2026-08-14; EPA correctness rests on synthetic-fixture tests and walk-forward structural proofs instead | open |  | 2026-08-14T04:31:03.405Z |  |
| 3 | 02 | deviation | packages/core/algorithms/epa.ts |  | epa.ts's predict() sums a team's own learned foulsCommitted component directly into that team's own predicted score, rather than adding the OPPOSING alliance's foulsCommitted per D-04 (the cross-alliance attribution 02-04's Sigma1 implements explicitly). Whether this materially skews EPA's predicted scores is unverified and out of scope for plan 02-04 to fix -- observed while implementing Sigma1's own D-04 handling, not investigated further. | fixed | epa.ts predict() now excludes an alliance's own foulsCommitted from its offensive total and adds the opposing alliance's foulsCommitted instead, mirroring sigma1's D-04 handling; regression test added in epa.test.ts. | 2026-08-14T05:13:43.248Z | 2026-08-14T06:40:51.008Z |
| 4 | 03 | unrun-verify | packages/core/algorithms/breakdown/2024.ts |  | 03-07's Task 2 acceptance criterion `pnpm harness --season 2024 --algorithm sigma1 --include-offseason` exits 0 is NOT met: parseBreakdown()'s unconditional Zod parse of self-reported offseason score_breakdown JSON throws uncaught (2024cafb_qm1, missing `adjustPoints`) -- a separate, pre-existing defect in the SCORE-side breakdown schema, unguarded by eventType/compLevel, previously masked by CR-01's earlier RP-guard crash (which occurred at 2024mnst_qm1, position 17029/22099, well before 2024cafb). Out of scope for 03-07, whose files_modified are RP-only; CR-01's own fix is proven correct (the replay progresses 17358 matches past the old crash point, including 329 offseason matches, before hitting this new one). | fixed | Fixed by T-03-18b's tryParseBreakdownPair guard (packages/core/algorithms/breakdown/index.ts, quick task 260818-inm): a score_breakdown that fails its season Zod schema now degrades to the existing D-05 fallback path (inflated measurement noise, never a throw) instead of aborting the harness batch. Both `pnpm harness --season 2024 --algorithm sigma1 --include-offseason` and `pnpm harness --event 2024wvrox --algorithm sigma1` now exit 0, observed 2026-08-18: breakdownParseFailureCount 1004 (season run, matching the phase-03 security audit's independently measured 1,004/4,757 figure) and 19 (event run) respectively. | 2026-08-17T00:00:00.000Z | 2026-08-18T18:06:47.326Z |
| 5 | 03 | unrun-verify | packages/core/algorithms/breakdown/2024.ts |  | 03-07's Task 2 acceptance criterion `pnpm harness --event 2024wvrox --algorithm sigma1` exits 0 is NOT met: the SAME class of defect as ledger #4, but worse -- the event's very FIRST match (2024wvrox_sf1m1, offseason, compLevel sf) fails parseBreakdown() with ~13 missing required score fields, confirming this is systemic to self-reported offseason breakdowns generally, not one bad match. Network + TBA_API_KEY both worked (304 Not Modified on both TBA calls); the crash is data-shape, not connectivity. | fixed | Fixed by T-03-18b's tryParseBreakdownPair guard (packages/core/algorithms/breakdown/index.ts, quick task 260818-inm): a score_breakdown that fails its season Zod schema now degrades to the existing D-05 fallback path (inflated measurement noise, never a throw) instead of aborting the harness batch. Both `pnpm harness --season 2024 --algorithm sigma1 --include-offseason` and `pnpm harness --event 2024wvrox --algorithm sigma1` now exit 0, observed 2026-08-18: breakdownParseFailureCount 1004 (season run, matching the phase-03 security audit's independently measured 1,004/4,757 figure) and 19 (event run) respectively. | 2026-08-17T00:00:00.000Z | 2026-08-18T18:06:47.672Z |
| 6 | 04 | stub | apps/worker/src/scheduled.ts |  | runGlobalRebuild's incremental teams/{year} merge updates metrics/matchCount but NOT the win/loss/tie record field (would need per-team match outcomes threaded through touchedTeamsByAlgorithm, which the plan's time budget did not extend to) -- stays accurate only as of the last offline pnpm publish:seasons run until a future plan extends this | open |  | 2026-08-22T18:03:00.607Z |  |
| 7 | 04 | stub | apps/worker/src/scheduled.ts |  | The online path never rebuilds events/{year} at all (only teams/{year} via runGlobalRebuild) -- the events list stays accurate only as of the last offline pnpm publish:seasons run; extending the incremental-merge mechanism to events/{year} is deferred to a future plan | open |  | 2026-08-22T18:03:06.054Z |  |
| 8 | 04 | deviation | apps/worker/src/scheduled.ts |  | Phase B (artifact writes) is deliberately best-effort: a failure there does not change an event's 'advanced' outcome (state has genuinely advanced correctly), but a skipped artifact stays one tick stale until that team's next match at that event -- no future trigger re-attempts a partially-completed Phase B on its own | open |  | 2026-08-22T18:03:11.610Z |  |
| 9 | 04 | deviation | docs/publish-budget.md |  | 3 published algorithms folded together for a single ordinary match exceed the deployed Worker's real per-tick subrequest budget (estimated cost 50 vs usable ~41); confirmed by repeated live observation, not fixed in this plan (Rule 4 -- architectural) | open |  | 2026-08-23T03:17:45.065Z |  |
| 10 | 04 | unrun-verify | apps/worker/src/scheduled.ts |  | epa/sigma1 solo deployed-Worker freshness runs (plan 04-07 Task 2) never folded a single match within the poll window and were not diagnosed to root cause within the plan's session; opr's identical rig succeeded cleanly (6/6, digestMatch=true). Not reproduced in an isolated local call to the same algorithm code with the same real data. The CI-runnable offline equivalence test (scheduled.replay.test.ts) independently proves equivalence for all three algorithms and is unaffected. | open |  | 2026-08-23T03:17:53.122Z |  |
| 11 | 06.1 | unmet-truth | docs/publish-budget.md |  | teams/{year} page kind measured max, updated again by exclude-offseason-demo-teams.md's 2026-08-29 post-exclusion republish (generation 961340e8-9e45-4d91-8e85-f72982ac3d87): now 3,705,194 bytes (was 3,732,955 per 07-17's D-18 republish, was 3,577,069 before that), a small decrease from excluding 30 frc9970-frc9999 demo-team keys from every published team surface, but STILL over committed budgetMaxBytes (3,500,000) -- the exclusion was never expected to fix this ceiling (explicit non-goal) and did not; ceiling still deliberately not raised; payloadBudget.test.ts left red pending a developer decision | open |  | 2026-08-27T00:37:40.533Z |  |
| 15 | 07 | unmet-truth | docs/publish-budget.md |  | team/{teamKey}/{year} page kind still crosses BOTH its committed budgetMaxBytes (375,000) and payloadBudget.test.ts's separate absolute structural ceiling (TEAM_PAGE_ABSOLUTE_MAX_BYTES = 600,000), re-measured against exclude-offseason-demo-teams.md's 2026-08-29 post-exclusion republish (generation 961340e8-9e45-4d91-8e85-f72982ac3d87): max now 675,943 bytes (80.3% over budget, 12.7% over the absolute ceiling), down from 821,938 bytes (119% over budget, 37% over the absolute ceiling) measured against 07-17's D-18 republish -- the max-holding key changed from v1/team/frc9999/2024 (a demo key, no longer published at all) to v1/team/frc3538/2024/vpr@2.0.0+tuned-2026-08.json, CONFIRMED (not assumed) as a real team (234 played matches in the 2024 season). Excluding demo teams was never expected to clear either ceiling (explicit non-goal of that todo) and did not -- both stay open for their own, separate resolution. Neither ceiling raised | open |  | 2026-08-28T18:55:00.000Z |  |
| 12 | 07 | deviation | packages/corpus/integrity.test.ts | 314 | 07-05's mandated full-corpus rankings backfill (zero NULL record_wins/losses/ties/ranking_score corpus-wide) permanently falsifies this pre-existing 07-02 test's nullRows assertion, which expects to still find an event_rankings row with all four columns NULL; out of 07-05's declared scope (plan verification requires packages/corpus/ diff stay empty for the whole plan), so left unfixed and reported here for a future plan to update the stale assertion | resolved | Resolved by the phase-7 orchestrator after wave 5: the no-default assertion moved out of the corpus-backed block and onto a purpose-built pre-migration database (legacy-shaped event_rankings + a row, then opened through openCorpus so the real ALTER TABLE block runs). Phrased that way it tests the migration itself and no backfill can invalidate it. Proven non-vacuous by injecting DEFAULT 0 into the migration and observing exactly this assertion go RED. | 2026-08-28T04:38:17.003Z | 2026-08-28T05:57:27.078Z |  |
| 13 | 07 | deviation | scripts/verifySubsetPublish.ts |  | 2025isios published alliances:[] against 07-10's committed expectAlliances:populated seed value; confirmed against live TBA (GET /event/2025isios/alliances -> 200, []) as real TBA state, a third D-17 empty-alliances event beyond RESEARCH.md's original two (2025bc, 2026wvrox) -- expectation left unedited per plan's first prohibition, routed to 07-14 | resolved | Resolved by plan 07-19 Task 1: `2025isios`'s seed entry in `scripts/verifySubsetPublish.ts` was corrected from `expectAlliances: "populated"` to `expectAlliances: "empty"`, with an inline comment naming this ledger row, confirming the correction is a stale-seed fix (not an observed-value adjustment to a still-live check) and noting the entry is now `expectAbsent` so its `RENAMED_EVENT_SUBSET` duplicate is the one that actually exercises the corrected `alliances: "empty"` check going forward. Verified live by plan 07-19 Task 4 (2026-08-29): `pnpm verify:subset` reports `2025isios/vpr` GREEN, `alliances=0`, no failing entries attributable to this row. | 2026-08-28T05:45:22.023Z | 2026-08-29T00:00:00.000Z |
| 14 | 07 | deviation | packages/ingest/normalize.ts |  | 2024orbb/2025orbb (Oregon BunnyBots, offseason event_type 99 running a non-FRC custom game) self-reported a non-integer score_breakdown.{color}.rp value (e.g. 32.5, 34.5, 12.5) on 30 match rows across the two events -- not a real ranking-point count, same family as ledger #4/#5 (self-reported offseason breakdowns not matching the official schema), on the RP side rather than score-breakdown-parse. Blocked 07-17's --include-offseason full republish (TeamSeasonMatchSchema's actualRedRp/actualBlueRp .int() assertion threw). Fixed out-of-scope, authorized at 07-17's checkpoint:decision: normalize.ts's extractRp now requires Number.isInteger and degrades to null; publish.ts's actualRedRp/actualBlueRp assignment gained a toIntegerRpOrNull defence-in-depth guard against any value already sitting in the corpus; the two events were re-ingested (pnpm ingest --event 2024orbb/2025orbb --force), reducing non-integer rows in data/corpus.sqlite from 30 to 0. Tests added in normalize.test.ts and publish.test.ts. | open |  | 2026-08-28T17:50:41.285Z |  |
| 16 | 07 | deviation | apps/worker/src/scheduled.ts |  | Deployed Worker (version 638da16c-d538-4551-b3a0-a2757a77061f, surfaced by plan 07-19 Task 3) observed exceeding the free-plan CPU budget on 100% of ticks captured (7/7 across two capture windows, several hours after the deploy): outcome:"exceededCpu", cpuTime pinned at 10, empty logs array on every tick. RESOLVED 2026-08-29 -- fix deployed as version 6c9c93dd-1dbc-45fd-aee5-5de57e3ffcf3 and verified on three consecutive live ticks (outcome:"ok", cpuTime 17/21/30 ms, exceptions []) captured while eventsConsidered:2 showed the data trigger was STILL fully active -- so the fix is distinguishable from the calendar self-heal that would otherwise have arrived by itself on 2026-09-01/09-02. THREE PREMISES IN THE ORIGINAL ENTRY WERE DISPROVEN. (1) "No event was live in either observation" -- the deployed live-windows manifest (generation 47d020a4-1a16-4331-bd70-ce2f468bf2d1) reported TWO events live, 2026azscor and 2026scsc, both PHANTOM `inferred` windows synthesised from start_date for zero-match offseason events. The operator judged liveness by "is a real competition happening"; the Worker judges it by the manifest, and the two disagreed. (2) "The empty logs array means the tick's own console.log never ran, so it died before handler code" -- scheduled.ts emits its only success line as the tick's LAST statement, so an empty array proves non-COMPLETION, never non-ENTRY. A 2026-08-29T21:55Z capture caught a SURVIVING tick logging eventsConsidered:2 at cpuTime 38 ms. (3) NEW, found during the fix read-back: "cpuTime pinned at 10 means the free plan enforces a FLAT 10 ms per-invocation ceiling" -- it does not. The SAME version returned ok at cpuTime 38 (21:55:44Z) and was killed at cpuTime 10 sixty seconds later (21:56:44Z) on identical code and identical data; no flat threshold satisfies both. Observed successes reach 208 ms (replay rig, 2026-08-23) and observed kills are pinned at exactly 10 on all 11 of them -- never 9, never 11 -- because a killed invocation's final reading IS the limit it was terminated at. Cloudflare's limits page (fetched 2026-08-29) documents the real rule: 10 ms is the CONFIGURED limit per Cron Trigger on Workers Free, and apps/worker/wrangler.toml sets no [limits]/cpu_ms override, but "each isolate has some built-in flexibility to allow for cases where your Worker infrequently runs over the configured limit", and a Worker that "starts hitting the limit consistently" has its execution "terminated according to the limit configured". THE CONSTANT IS RIGHT; THE ENFORCEMENT MODEL WAS NOT. The operative failure boundary is not "a tick costs more than 10 ms" but "EVERY tick costs more than 10 ms" -- which is exactly what the AND-gate produced, and why a week of healthy ticks flipped to 100% failure with no deploy in between. Root cause is that AND-gate: (A) per-tick Zod validation of all 1,581 live-windows, 1,542 of them permanently closed, costing 5-9 ms of the 10 ms budget on a do-nothing tick -- under the limit on its own, hence survivable for a week; (B) the phantom windows keeping that tick out of its early exit and onto a 38 ms live path, consistently over the limit. Fixed and committed 2026-08-29: filter-at-read in liveWindows.ts, prune-at-build plus no-blind-windows in manifests.ts, and 32 regression tests -- none of which asserted on a time value or encoded the disproven ceiling, checked explicitly. Investigation: .planning/debug/worker-tick-exceeds-cpu-budget.md | fixed |  | 2026-08-29T20:41:00.000Z | 2026-08-29T22:30:00.000Z |

````json
[
  {
    "id": 1,
    "kind": "stub",
    "phase": "01",
    "file": "packages/harness/statbotics.ts",
    "line": null,
    "description": "STATBOTICS_REFERENCE_FALLBACK per-season values (2022-2026) are unverified best-available estimates (~0.70-0.72), not individually sourced against Statbotics' own published figures — the live endpoint reproducibly 500s (reconfirmed 2026-08-13) and Statbotics' blog page renders numbers client-side from the same broken API, so this pipeline has no way to scrape verified numbers",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-13T16:13:38.414Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "deviation",
    "phase": "02",
    "file": "packages/harness/statbotics.ts",
    "line": null,
    "description": "SC-2 (Statbotics per-team numeric tolerance) recorded blocked-on-external-dependency per D-14 -- api.statbotics.io/v3/year/{year} reproducibly returns HTTP 500, re-confirmed live 2026-08-14; EPA correctness rests on synthetic-fixture tests and walk-forward structural proofs instead",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-14T04:31:03.405Z",
    "resolved_at": null
  },
  {
    "id": 3,
    "kind": "deviation",
    "phase": "02",
    "file": "packages/core/algorithms/epa.ts",
    "line": null,
    "description": "epa.ts's predict() sums a team's own learned foulsCommitted component directly into that team's own predicted score, rather than adding the OPPOSING alliance's foulsCommitted per D-04 (the cross-alliance attribution 02-04's Sigma1 implements explicitly). Whether this materially skews EPA's predicted scores is unverified and out of scope for plan 02-04 to fix -- observed while implementing Sigma1's own D-04 handling, not investigated further.",
    "status": "fixed",
    "reason": "epa.ts predict() now excludes an alliance's own foulsCommitted from its offensive total and adds the opposing alliance's foulsCommitted instead, mirroring sigma1's D-04 handling; regression test added in epa.test.ts.",
    "recorded_at": "2026-08-14T05:13:43.248Z",
    "resolved_at": "2026-08-14T06:40:51.008Z"
  },
  {
    "id": 4,
    "kind": "unrun-verify",
    "phase": "03",
    "file": "packages/core/algorithms/breakdown/2024.ts",
    "line": null,
    "description": "03-07's Task 2 acceptance criterion `pnpm harness --season 2024 --algorithm sigma1 --include-offseason` exits 0 is NOT met: parseBreakdown()'s unconditional Zod parse of self-reported offseason score_breakdown JSON throws uncaught (2024cafb_qm1, missing `adjustPoints`) -- a separate, pre-existing defect in the SCORE-side breakdown schema, unguarded by eventType/compLevel, previously masked by CR-01's earlier RP-guard crash (which occurred at 2024mnst_qm1, position 17029/22099, well before 2024cafb). Out of scope for 03-07, whose files_modified are RP-only; CR-01's own fix is proven correct (the replay progresses 17358 matches past the old crash point, including 329 offseason matches, before hitting this new one).",
    "status": "fixed",
    "reason": "Fixed by T-03-18b's tryParseBreakdownPair guard (packages/core/algorithms/breakdown/index.ts, quick task 260818-inm): a score_breakdown that fails its season Zod schema now degrades to the existing D-05 fallback path (inflated measurement noise, never a throw) instead of aborting the harness batch. Both `pnpm harness --season 2024 --algorithm sigma1 --include-offseason` and `pnpm harness --event 2024wvrox --algorithm sigma1` now exit 0, observed 2026-08-18: breakdownParseFailureCount 1004 (season run, matching the phase-03 security audit's independently measured 1,004/4,757 figure) and 19 (event run) respectively.",
    "recorded_at": "2026-08-17T00:00:00.000Z",
    "resolved_at": "2026-08-18T18:06:47.326Z"
  },
  {
    "id": 5,
    "kind": "unrun-verify",
    "phase": "03",
    "file": "packages/core/algorithms/breakdown/2024.ts",
    "line": null,
    "description": "03-07's Task 2 acceptance criterion `pnpm harness --event 2024wvrox --algorithm sigma1` exits 0 is NOT met: the SAME class of defect as ledger #4, but worse -- the event's very FIRST match (2024wvrox_sf1m1, offseason, compLevel sf) fails parseBreakdown() with ~13 missing required score fields, confirming this is systemic to self-reported offseason breakdowns generally, not one bad match. Network + TBA_API_KEY both worked (304 Not Modified on both TBA calls); the crash is data-shape, not connectivity.",
    "status": "fixed",
    "reason": "Fixed by T-03-18b's tryParseBreakdownPair guard (packages/core/algorithms/breakdown/index.ts, quick task 260818-inm): a score_breakdown that fails its season Zod schema now degrades to the existing D-05 fallback path (inflated measurement noise, never a throw) instead of aborting the harness batch. Both `pnpm harness --season 2024 --algorithm sigma1 --include-offseason` and `pnpm harness --event 2024wvrox --algorithm sigma1` now exit 0, observed 2026-08-18: breakdownParseFailureCount 1004 (season run, matching the phase-03 security audit's independently measured 1,004/4,757 figure) and 19 (event run) respectively.",
    "recorded_at": "2026-08-17T00:00:00.000Z",
    "resolved_at": "2026-08-18T18:06:47.672Z"
  },
  {
    "id": 6,
    "kind": "stub",
    "phase": "04",
    "file": "apps/worker/src/scheduled.ts",
    "line": null,
    "description": "runGlobalRebuild's incremental teams/{year} merge updates metrics/matchCount but NOT the win/loss/tie record field (would need per-team match outcomes threaded through touchedTeamsByAlgorithm, which the plan's time budget did not extend to) -- stays accurate only as of the last offline pnpm publish:seasons run until a future plan extends this",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-22T18:03:00.607Z",
    "resolved_at": null
  },
  {
    "id": 7,
    "kind": "stub",
    "phase": "04",
    "file": "apps/worker/src/scheduled.ts",
    "line": null,
    "description": "The online path never rebuilds events/{year} at all (only teams/{year} via runGlobalRebuild) -- the events list stays accurate only as of the last offline pnpm publish:seasons run; extending the incremental-merge mechanism to events/{year} is deferred to a future plan",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-22T18:03:06.054Z",
    "resolved_at": null
  },
  {
    "id": 8,
    "kind": "deviation",
    "phase": "04",
    "file": "apps/worker/src/scheduled.ts",
    "line": null,
    "description": "Phase B (artifact writes) is deliberately best-effort: a failure there does not change an event's 'advanced' outcome (state has genuinely advanced correctly), but a skipped artifact stays one tick stale until that team's next match at that event -- no future trigger re-attempts a partially-completed Phase B on its own",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-22T18:03:11.610Z",
    "resolved_at": null
  },
  {
    "id": 9,
    "kind": "deviation",
    "phase": "04",
    "file": "docs/publish-budget.md",
    "line": null,
    "description": "3 published algorithms folded together for a single ordinary match exceed the deployed Worker's real per-tick subrequest budget (estimated cost 50 vs usable ~41); confirmed by repeated live observation, not fixed in this plan (Rule 4 -- architectural)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-23T03:17:45.065Z",
    "resolved_at": null
  },
  {
    "id": 10,
    "kind": "unrun-verify",
    "phase": "04",
    "file": "apps/worker/src/scheduled.ts",
    "line": null,
    "description": "epa/sigma1 solo deployed-Worker freshness runs (plan 04-07 Task 2) never folded a single match within the poll window and were not diagnosed to root cause within the plan's session; opr's identical rig succeeded cleanly (6/6, digestMatch=true). Not reproduced in an isolated local call to the same algorithm code with the same real data. The CI-runnable offline equivalence test (scheduled.replay.test.ts) independently proves equivalence for all three algorithms and is unaffected.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-23T03:17:53.122Z",
    "resolved_at": null
  },
  {
    "id": 11,
    "kind": "unmet-truth",
    "phase": "06.1",
    "file": "docs/publish-budget.md",
    "line": null,
    "description": "teams/{year} page kind measured max, updated again by exclude-offseason-demo-teams.md's 2026-08-29 post-exclusion republish (generation 961340e8-9e45-4d91-8e85-f72982ac3d87): now 3,705,194 bytes (was 3,732,955 per 07-17's D-18 republish, was 3,577,069 before that), a small decrease from excluding 30 frc9970-frc9999 demo-team keys from every published team surface, but STILL over committed budgetMaxBytes (3,500,000) -- the exclusion was never expected to fix this ceiling (explicit non-goal) and did not; ceiling still deliberately not raised; payloadBudget.test.ts left red pending a developer decision",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-27T00:37:40.533Z",
    "resolved_at": null
  },
  {
    "id": 12,
    "kind": "deviation",
    "phase": "07",
    "file": "packages/corpus/integrity.test.ts",
    "line": 314,
    "description": "07-05's mandated full-corpus rankings backfill (zero NULL record_wins/losses/ties/ranking_score corpus-wide) permanently falsifies this pre-existing 07-02 test's nullRows assertion, which expects to still find an event_rankings row with all four columns NULL; out of 07-05's declared scope (plan verification requires packages/corpus/ diff stay empty for the whole plan), so left unfixed and reported here for a future plan to update the stale assertion",
    "status": "resolved",
    "reason": "Resolved by the phase-7 orchestrator after wave 5: the no-default assertion moved out of the corpus-backed block and onto a purpose-built pre-migration database (legacy-shaped event_rankings + a row, then opened through openCorpus so the real ALTER TABLE block runs). Phrased that way it tests the migration itself and no backfill can invalidate it. Proven non-vacuous by injecting DEFAULT 0 into the migration and observing exactly this assertion go RED.",
    "recorded_at": "2026-08-28T04:38:17.003Z",
    "resolved_at": "2026-08-28T05:57:27.078Z"
  },
  {
    "id": 13,
    "kind": "deviation",
    "phase": "07",
    "file": "scripts/verifySubsetPublish.ts",
    "line": null,
    "description": "2025isios published alliances:[] against 07-10's committed expectAlliances:populated seed value; confirmed against live TBA (GET /event/2025isios/alliances -> 200, []) as real TBA state, a third D-17 empty-alliances event beyond RESEARCH.md's original two (2025bc, 2026wvrox) -- expectation left unedited per plan's first prohibition, routed to 07-14",
    "status": "resolved",
    "reason": "Resolved by plan 07-19 Task 1: 2025isios's seed entry in scripts/verifySubsetPublish.ts was corrected from expectAlliances: \"populated\" to expectAlliances: \"empty\", with an inline comment naming this ledger row, confirming the correction is a stale-seed fix (not an observed-value adjustment to a still-live check) and noting the entry is now expectAbsent so its RENAMED_EVENT_SUBSET duplicate is the one that actually exercises the corrected alliances: \"empty\" check going forward. Verified live by plan 07-19 Task 4 (2026-08-29): pnpm verify:subset reports 2025isios/vpr GREEN, alliances=0, no failing entries attributable to this row.",
    "recorded_at": "2026-08-28T05:45:22.023Z",
    "resolved_at": "2026-08-29T00:00:00.000Z"
  },
  {
    "id": 14,
    "kind": "deviation",
    "phase": "07",
    "file": "packages/ingest/normalize.ts",
    "line": null,
    "description": "2024orbb/2025orbb (Oregon BunnyBots, offseason event_type 99 running a non-FRC custom game) self-reported a non-integer score_breakdown.{color}.rp value (e.g. 32.5, 34.5, 12.5) on 30 match rows across the two events -- not a real ranking-point count, same family as ledger #4/#5 (self-reported offseason breakdowns not matching the official schema), on the RP side rather than score-breakdown-parse. Blocked 07-17's --include-offseason full republish (TeamSeasonMatchSchema's actualRedRp/actualBlueRp .int() assertion threw). Fixed out-of-scope, authorized at 07-17's checkpoint:decision: normalize.ts's extractRp now requires Number.isInteger and degrades to null; publish.ts's actualRedRp/actualBlueRp assignment gained a toIntegerRpOrNull defence-in-depth guard against any value already sitting in the corpus; the two events were re-ingested (pnpm ingest --event 2024orbb/2025orbb --force), reducing non-integer rows in data/corpus.sqlite from 30 to 0. Tests added in normalize.test.ts and publish.test.ts.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-28T17:50:41.285Z",
    "resolved_at": null
  },
  {
    "id": 15,
    "kind": "unmet-truth",
    "phase": "07",
    "file": "docs/publish-budget.md",
    "line": null,
    "description": "team/{teamKey}/{year} page kind still crosses BOTH its committed budgetMaxBytes (375,000) and payloadBudget.test.ts's separate absolute structural ceiling (TEAM_PAGE_ABSOLUTE_MAX_BYTES = 600,000), re-measured against exclude-offseason-demo-teams.md's 2026-08-29 post-exclusion republish (generation 961340e8-9e45-4d91-8e85-f72982ac3d87): max now 675,943 bytes (80.3% over budget, 12.7% over the absolute ceiling), down from 821,938 bytes (119% over budget, 37% over the absolute ceiling) measured against 07-17's D-18 republish -- the max-holding key changed from v1/team/frc9999/2024 (a demo key, no longer published at all) to v1/team/frc3538/2024/vpr@2.0.0+tuned-2026-08.json, CONFIRMED (not assumed) as a real team (234 played matches in the 2024 season). Excluding demo teams was never expected to clear either ceiling (explicit non-goal of that todo) and did not -- both stay open for their own, separate resolution. Neither ceiling raised",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-28T18:55:00.000Z",
    "resolved_at": null
  },
  {
    "id": 16,
    "kind": "deviation",
    "phase": "07",
    "file": "apps/worker/src/scheduled.ts",
    "line": null,
    "description": "Deployed Worker (version 638da16c-d538-4551-b3a0-a2757a77061f, surfaced by plan 07-19 Task 3) observed exceeding the free-plan CPU budget on 100% of ticks captured (7/7 across two capture windows, several hours after the deploy): outcome:\"exceededCpu\", cpuTime pinned at 10, empty logs array on every tick. RESOLVED 2026-08-29 -- fix deployed as version 6c9c93dd-1dbc-45fd-aee5-5de57e3ffcf3 and verified on three consecutive live ticks (outcome:\"ok\", cpuTime 17/21/30 ms, exceptions []) captured while eventsConsidered:2 showed the data trigger was STILL fully active -- so the fix is distinguishable from the calendar self-heal that would otherwise have arrived by itself on 2026-09-01/09-02. THREE PREMISES IN THE ORIGINAL ENTRY WERE DISPROVEN. (1) \"No event was live in either observation\" -- the deployed live-windows manifest (generation 47d020a4-1a16-4331-bd70-ce2f468bf2d1) reported TWO events live, 2026azscor and 2026scsc, both PHANTOM `inferred` windows synthesised from start_date for zero-match offseason events. The operator judged liveness by \"is a real competition happening\"; the Worker judges it by the manifest, and the two disagreed. (2) \"The empty logs array means the tick's own console.log never ran, so it died before handler code\" -- scheduled.ts emits its only success line as the tick's LAST statement, so an empty array proves non-COMPLETION, never non-ENTRY. A 2026-08-29T21:55Z capture caught a SURVIVING tick logging eventsConsidered:2 at cpuTime 38 ms. (3) NEW, found during the fix read-back: \"cpuTime pinned at 10 means the free plan enforces a FLAT 10 ms per-invocation ceiling\" -- it does not. The SAME version returned ok at cpuTime 38 (21:55:44Z) and was killed at cpuTime 10 sixty seconds later (21:56:44Z) on identical code and identical data; no flat threshold satisfies both. Observed successes reach 208 ms (replay rig, 2026-08-23) and observed kills are pinned at exactly 10 on all 11 of them -- never 9, never 11 -- because a killed invocation's final reading IS the limit it was terminated at. Cloudflare's limits page (fetched 2026-08-29) documents the real rule: 10 ms is the CONFIGURED limit per Cron Trigger on Workers Free, and apps/worker/wrangler.toml sets no [limits]/cpu_ms override, but \"each isolate has some built-in flexibility to allow for cases where your Worker infrequently runs over the configured limit\", and a Worker that \"starts hitting the limit consistently\" has its execution \"terminated according to the limit configured\". THE CONSTANT IS RIGHT; THE ENFORCEMENT MODEL WAS NOT. The operative failure boundary is not \"a tick costs more than 10 ms\" but \"EVERY tick costs more than 10 ms\" -- which is exactly what the AND-gate produced, and why a week of healthy ticks flipped to 100% failure with no deploy in between. Root cause is that AND-gate: (A) per-tick Zod validation of all 1,581 live-windows, 1,542 of them permanently closed, costing 5-9 ms of the 10 ms budget on a do-nothing tick -- under the limit on its own, hence survivable for a week; (B) the phantom windows keeping that tick out of its early exit and onto a 38 ms live path, consistently over the limit. Fixed and committed 2026-08-29: filter-at-read in liveWindows.ts, prune-at-build plus no-blind-windows in manifests.ts, and 32 regression tests -- none of which asserted on a time value or encoded the disproven ceiling, checked explicitly. Investigation: .planning/debug/worker-tick-exceeds-cpu-budget.md",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-29T20:41:00.000Z",
    "resolved_at": "2026-08-29T22:30:00.000Z"
  }
]
````
