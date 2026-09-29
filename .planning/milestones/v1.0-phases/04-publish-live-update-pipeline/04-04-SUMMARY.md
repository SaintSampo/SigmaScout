---
phase: 04-publish-live-update-pipeline
plan: 04
subsystem: data-pipeline
tags: [publish-pipeline, r2, zod, rounding, payload-budget, opr, epa, sigma1]

# Dependency graph
requires:
  - phase: 04-publish-live-update-pipeline
    plan: "04-01"
    provides: "packages/harness/pageArtifacts.ts (artifactKey, five page schemas), packages/harness/r2Client.ts (putObject), and the single-event publish.ts tracer this plan widens"
  - phase: 04-publish-live-update-pipeline
    plan: "04-02"
    provides: "packages/harness/rounding.ts (roundMetric/roundProbability/roundPmf/ROUNDING_RULE) and packages/corpus/db.ts's selectScheduledMatches, both consumed unchanged"
  - phase: 04-publish-live-update-pipeline
    plan: "04-03"
    provides: "packages/harness/manifests.ts (buildLiveWindowsManifest/buildAlgorithmsManifest) and packages/harness/stateSnapshot.ts (serializeState/emitSeedSql), both called directly from publishSeasons"
provides:
  - "packages/harness/publish.ts: the full offline publisher — buildEventArtifact/buildTeamsArtifact/buildTeamSeasonArtifact/buildEventsArtifact/buildCompareArtifact (all validate-then-return) and publishSeasons (the multi-season, multi-page, multi-algorithm orchestrator, bounded-concurrency uploads, D-12 state-snapshot/D1-seed emission)"
  - "docs/publish-budget.md: the D-23 committed budget doc with real 2022-2026 measured numbers, the D-12/D-24 manual re-baseline resolution, and the D-11 baseline-provenance link"
  - "packages/harness/payloadBudget.test.ts: the D-05 payload-regression test reading docs/publish-budget.md's machine-readable block as its only input"
  - "A real, complete 2022-2026 x opr/epa/sigma1 publish in production R2: 54,671 page objects + 2 manifests, 2,274,047,079 bytes, verified fetchable over public HTTPS"
  - "EventArtifactSchema.teams tightened from optional to required in packages/harness/pageArtifacts.ts (carried-forward issue resolution)"
  - "A real production bug fix in packages/harness/rounding.ts's roundTo (malformed double-exponent string for near-zero/near-huge magnitudes), discovered running the real corpus at scale"
affects: [04-05-cron-worker-scaffold, 04-06-worker-read-path, 04-07-worker-runtime-budget, phase-05-teams-events-ui, phase-06-team-page, phase-07-event-page, phase-08-compare-page]

# Actuals (#2632)
actuals:
  tokens: 26158
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Every publish.ts assembly function (buildEventArtifact/buildTeamsArtifact/buildTeamSeasonArtifact/buildEventsArtifact/buildCompareArtifact) parses its candidate through the matching pageArtifacts.ts schema BEFORE returning — a validation failure throws before the caller could ever reach a putObject call (T-04-22), rather than validating at the call site as the 04-01 tracer did"
    - "publishSeasons mirrors cli.ts's runSeasons orchestration locally (season loop, carrySeason boundary threading) rather than importing it, following the exact precedent tune.ts's own file header already documents for the same reason: runSeasons drops finalStates, which this plan needs for D-12's live-state snapshot"
    - "A bounded-concurrency uploader (BoundedUploader, ~16 in-flight PUTs) records every candidate object's page-kind/key/byte-length regardless of --dry-run — --dry-run measures budgets without spending a Class-A operation, it just skips the actual putObject call"
    - "Rounding is applied via shiftDecimalPoint, which combines an existing JS-rendered exponent numerically instead of string-concatenating a second one — required because JS renders |x| < 1e-6 or >= 1e21 in exponential notation on its own, and the original implementation's naive string-concat silently produced NaN for those magnitudes"
    - "Event summary counts (teamCount/matchCount/playedMatchCount) and team-season match rows both derive from the SAME season stream already fetched for the replay (respecting --include-offseason) rather than a second unfiltered corpus query — a deliberate simplicity/completeness tradeoff, documented inline"

key-files:
  created:
    - docs/publish-budget.md
    - packages/harness/publish.test.ts
    - packages/harness/payloadBudget.test.ts
  modified:
    - packages/harness/publish.ts
    - packages/harness/pageArtifacts.ts
    - packages/harness/pageArtifacts.test.ts
    - packages/harness/rounding.ts
    - packages/harness/rounding.test.ts
    - package.json

key-decisions:
  - "EventArtifactSchema.teams tightened from optional to required (pageArtifacts.ts, outside this plan's declared files_modified — Rule 3 deviation, explicitly authorized by the carried-forward issue). publish.ts now always populates it, defaulting to [] only when an event genuinely has no team data in this run's scope, never omitting the key."
  - "The corpus has no event-name column at all (packages/corpus/schema.sql) — EventsArtifactSchema.name and TeamSeasonEventSchema.eventName both fall back to the event key itself rather than fabricating a name or editing a corpus schema file outside this plan's scope. Documented inline in publish.ts and recorded as a Known Stub below."
  - "CompareArtifactSchema's brierScore/winnerAccuracy/calibrationBins are NOT rounded — they map to none of rounding.ts's five ROUNDING_RULE field classes, and this mirrors artifact.ts's own explicit HarnessArtifactSchema policy ('Unrounded — rounding happens only when the HTML report renders a value') rather than inventing a sixth rounding rule."
  - "Event summary counts and team-season match rows are computed from the SAME (possibly --include-offseason-filtered) season stream already fetched for the replay, not a second unfiltered query — an offseason event shows zero counts when offseason matches are excluded from a given run's scope. A genuine simplification tradeoff against a third corpus query per season, not a bug."
  - "The D1 seed files (reports/publish/seed-{opr,epa,sigma1}.sql) were produced but NOT applied via wrangler d1 execute — this worktree cannot determine whether plan 04-05's D1 database exists yet (parallel worktree, not merged into this branch's view at the time this plan ran), and the plan's own Task 2 text explicitly authorizes recording them as produced-but-not-yet-applied in that case."

requirements-completed: [DATA-03]
# DATA-05 intentionally NOT marked complete — this plan closes DATA-05's
# payload-budget and R2-write-volume measurement halves, but the Worker
# CPU-per-tick and peak-tick-subrequest halves remain "pending — measured
# in plan 04-07" in docs/publish-budget.md's own Worker runtime budget
# table, matching 04-03-SUMMARY.md's identical precedent for the same
# multi-plan requirement.

coverage:
  - id: D1
    description: "publish.ts widened from the 04-01 tracer's single-event mode into the full multi-season, multi-page, multi-algorithm offline publisher — every assembly function validates before returning, so a schema-parse failure performs zero uploads (T-04-22)"
    requirement: DATA-03
    verification:
      - kind: unit
        ref: "packages/harness/publish.test.ts (13 tests: per-artifact assembly + rounding, zero-upload-on-parse-failure via a mocked putObject, computeSizeStats, and a real-corpus re-check that selectScheduledMatches carries no OUTCOME_KEYS key)"
        status: pass
      - kind: unit
        ref: "packages/harness/publish.tracer.test.ts and packages/harness/pageArtifacts.test.ts (both re-run green against the widened publish.ts and the tightened EventArtifactSchema.teams)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A real, complete offline publish of all five seasons (2022-2026) across all three shipped algorithms, uploaded to production R2 and fetched back over public HTTPS"
    requirement: DATA-03
    verification:
      - kind: manual_procedural
        ref: "pnpm publish:seasons run to completion (exit code 0, confirmed by the harness's own background-task notification): 54,671 page objects + 2 manifests, 2,274,047,079 bytes, ~14m41s wall clock. curl round-trip against v1/manifest/algorithms.json (HTTP 200, lists exactly opr/epa/sigma1) and v1/manifest/live-windows.json (HTTP 200) — see docs/publish-budget.md and this SUMMARY's Task Commits section for the full transcript"
        status: pass
    human_judgment: false
  - id: D3
    description: "The D-05 payload budget: a committed budget doc with real measured numbers naming the run that produced them, and a failing test that guards it"
    requirement: DATA-05
    verification:
      - kind: unit
        ref: "packages/harness/payloadBudget.test.ts (10 tests: well-formedness/non-vacuity guard, internal consistency, absolute upper bounds on teams/team from the real run, parser-robustness against a missing/corrupt block, and a fresh re-measurement of a real event through publish.ts's own assembly path)"
        status: pass
      - kind: other
        ref: "node -e structure check over docs/publish-budget.md (the plan's own Task 2 <verify> block)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The Cloudflare-dashboard cross-check for R2 storage total and Class-A operation count — genuinely requires human dashboard access this executor does not have"
    verification: []
    human_judgment: true
    rationale: "04-VALIDATION.md's own Manual-Only Verifications table states this exact figure is account-level and can only be read from the Cloudflare dashboard by a human; this plan records the local counter's numbers (2,274,047,079 bytes, 54,673 Class-A ops) honestly rather than fabricating a dashboard figure it cannot obtain."

# Metrics
duration: ~30min
completed: 2026-08-22
status: complete
---

# Phase 4 Plan 4: Full-Season Multi-Page Publish & Payload Budget Summary

**publish.ts widened into the real offline publisher — a complete 2022-2026 × opr/epa/sigma1 run (54,671 objects, 2.27 GB) landed in production R2, with a committed payload budget and its guarding test built from that run's real numbers.**

## Performance

- **Duration:** ~30 min (including the real `pnpm publish:seasons` run, ~14m41s wall clock, which ran in the background overlapping test/doc-writing work)
- **Tasks:** 3 (all executed)
- **Files modified:** 9 (3 created, 6 modified)

## Accomplishments

- **Widened `publish.ts` from a single-event tracer into the full publisher** (`buildEventArtifact`, `buildTeamsArtifact`, `buildTeamSeasonArtifact`, `buildEventsArtifact`, `buildCompareArtifact`, `publishSeasons`). Every assembly function now parses its candidate through the matching `pageArtifacts.ts` schema before returning (T-04-22) — a validation failure throws before any `putObject` call could be reached, proven by a mocked-`putObject` test that asserts zero calls on a deliberately malformed input.
- **Rounding (D-06) is applied on the way into every published numeric field** — `pRedWin`/component means/predicted scores/alliance-total variance/RP pmfs all go through `rounding.ts`'s helpers exactly once, at assembly time, never at the source. A team-season match row's rounding is asserted by re-rounding the produced value and confirming it equals itself.
- **The D-12 live-state snapshot and D1 bulk-seed files are produced at the end of the run** (`reports/publish/seed-{opr,epa,sigma1}.sql`), using only the FINAL season's finalStates — earlier seasons' states existed solely to thread the `carrySeason` boundary, documented inline so a reader does not assume all five seasons are seeded.
- **D-08's scheduled-match parameters are populated for every event that still has unplayed matches** — `selectScheduledMatches`'s output is handed straight to `algorithm.predict()` (no outcome columns were ever selected, a stronger guarantee than the leak-proof Proxy), re-checked by a dedicated test against a real corpus row.
- **Resolved the carried-forward `EventArtifactSchema.teams` issue**: tightened from optional to required in `pageArtifacts.ts` (a documented Rule 3 deviation — that file is outside this plan's declared `files_modified`, but no later plan owns it and leaving it optional was a latent defect). `publish.ts` now always populates the field, defaulting to `[]` only when an event genuinely has no team data in scope.
- **Ran the real thing.** `pnpm publish:seasons` completed successfully (confirmed by the harness's own background-task exit-code-0 notification plus a clean completion transcript with no error trace): all five seasons × all three algorithms, **54,671 page objects + 2 manifests, 2,274,047,079 bytes (≈2.12 GiB), in ~14 minutes 41 seconds**. Verified live: `v1/manifest/algorithms.json` and `v1/manifest/live-windows.json` both fetch `HTTP 200` over the public R2 endpoint; the algorithms manifest lists exactly `opr`, `epa`, `sigma1`.
- **Wrote `docs/publish-budget.md`**, D-23's single committed budget doc: the payload budget table (all five page kinds plus both manifests), the two D-05-named at-risk artifacts' raw AND compressed sizes (the compressed measurement is a genuine finding — the plain `r2.dev` URL applies no `Content-Encoding` at all, recorded honestly rather than assumed), storage/write volume against R2's free-tier allowances, the D-12/D-24 manual re-baseline resolution stated plainly with exact commands and the consequence of skipping it, the D-11 baseline-provenance link, and a `pending — measured in plan 04-07` Worker runtime budget table.
- **Built `payloadBudget.test.ts`**, the D-05 failing-test half: reads `docs/publish-budget.md`'s machine-readable block as its ONLY input, asserts well-formedness/internal-consistency/absolute-upper-bounds (from the real measured numbers, with clear headroom over the committed `budgetMaxBytes`), proves a missing/corrupt block throws a named `PublishBudgetParseError` rather than skipping silently, and re-measures one real event's artifacts through `publish.ts`'s own assembly path.
- **Auto-fixed a real production bug in `rounding.ts`** discovered running the real corpus at scale (see Deviations below).

## Task Commits

1. **Task 1: Widen publish.ts from one event to every page of every season** - `9998edb1` (feat)
2. **Task 2: Run the real thing, and write down what it actually cost** - `f48593e9` (docs)
3. **Task 3: Make a payload regression fail a test on the commit that causes it** - `86453587` (test)

## Files Created/Modified

- `packages/harness/publish.ts` - widened into the full offline publisher: five assembly functions, `publishSeasons`, `computeSizeStats`, `BoundedUploader`, CLI (`--event` and `--seasons` modes)
- `packages/harness/publish.test.ts` - 13 tests covering every assembly function, the T-04-22 validation gate, `computeSizeStats`, and the D-08 outcome-key re-check
- `packages/harness/pageArtifacts.ts` - `EventArtifactSchema.teams` tightened from optional to required
- `packages/harness/pageArtifacts.test.ts` - `validEventFixture()` updated with `teams: []` to match the tightened schema
- `packages/harness/rounding.ts` - `roundTo` fixed to use `shiftDecimalPoint` (combines an existing exponent numerically instead of string-concatenating a second one)
- `packages/harness/rounding.test.ts` - 3 new regression tests for the exponential-notation edge case
- `docs/publish-budget.md` - the D-23 committed budget doc with real 2022-2026 measured numbers
- `packages/harness/payloadBudget.test.ts` - 10 tests: well-formedness, internal consistency, absolute bounds, parser robustness, fresh re-measurement
- `package.json` - `publish:seasons` script added

## Decisions Made

- Assembly functions self-validate (call `.parse()` internally before returning) rather than leaving validation to the call site, per the plan's own action text ("returns an object that it parses through its schema before returning") — a change from the 04-01 tracer's pattern, applied uniformly across all five functions including the widened `buildEventArtifact`.
- `EventArtifactSchema.teams` tightened to required (see Key Decisions in frontmatter and Deviations below).
- The corpus's missing event-name column is worked around with an event-key fallback, not fabricated data or an out-of-scope schema edit (see Deviations below).
- `CompareArtifactSchema`'s scoring figures are deliberately left unrounded, mirroring `artifact.ts`'s existing policy.
- D1 seed files are produced but not applied (`wrangler d1 execute` not run) — this worktree has no reliable way to know whether plan 04-05's D1 database exists yet, and the plan's own text names this exact fallback.
- The Cloudflare dashboard's own R2 storage/Class-A op counts are recorded as an open manual step rather than fabricated — see `docs/publish-budget.md`'s Storage and write volume section and this SUMMARY's `coverage.D4`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking, out-of-scope file] `EventArtifactSchema.teams` tightened from optional to required**
- **Found during:** Task 1
- **Issue:** The carried-forward issue explicitly assigned to this plan (see plan frontmatter's `<carried_forward_issue>`): `pageArtifacts.ts`'s `EventArtifactSchema.teams` was left optional by plan 04-02 pending this plan's population of it. `pageArtifacts.ts` is outside this plan's declared `files_modified`, and no plan after this one owns that file.
- **Fix:** Populated `teams` for every event artifact in `publish.ts` (defaulting to `[]` only when an event genuinely has no data in scope), and tightened the schema field to required in `pageArtifacts.ts` in the same change, per the carried-forward issue's explicit instruction. Also updated `pageArtifacts.test.ts`'s `validEventFixture()` (also outside this plan's declared files) to add `teams: []`, since the tightened schema otherwise broke three of its existing tests.
- **Files modified:** `packages/harness/pageArtifacts.ts`, `packages/harness/pageArtifacts.test.ts`
- **Verification:** `pnpm vitest run packages/harness/pageArtifacts.test.ts packages/harness/publish.tracer.test.ts` — 26/26 pass.
- **Committed in:** `9998edb1` (Task 1 commit)

**2. [Rule 1 - Bug] `rounding.ts`'s `roundTo` silently produced `NaN` for magnitudes JS renders in exponential notation**
- **Found during:** Task 1, running the required `pnpm publish:artifacts --seasons 2026 --algorithm opr --dry-run` smoke test against the real corpus
- **Issue:** `roundTo`'s exponential-string trick (`` Number(`${magnitude}e${decimals}`) ``) assumed `magnitude.toString()` never itself contains an `"e"`. JS switches a number's own `toString()` to exponential notation once its magnitude drops below `1e-6` or reaches `1e21` — `(0.00000001).toString() === "1e-8"`. A confident OPR blowout prediction produces a `pRedWin` this small (or this close to 1, via `1 - pRedWin`), and the naive concatenation built a malformed double-exponent string like `"1e-8e4"`, which `Number(...)` silently parses to `NaN` rather than throwing — invisible until a real `EventArtifactSchema.parse()` call rejected the resulting `NaN` many matches downstream of `roundTo` itself.
- **Fix:** Added `shiftDecimalPoint`, which parses `magnitude`'s own exponent (if its string form has one) and combines it numerically with the requested decimal shift, instead of string-concatenating a second `"e..."` suffix. Applied on both the forward and backward shift inside `roundTo`.
- **Files modified:** `packages/harness/rounding.ts`, `packages/harness/rounding.test.ts` (3 new regression tests: sub-1e-6 magnitude, just-above-threshold magnitude, and a >=1e21 magnitude on the forward shift)
- **Verification:** `pnpm vitest run packages/harness/rounding.test.ts` (22/22 pass); `pnpm publish:artifacts --seasons 2026 --algorithm opr --dry-run` then completed cleanly; the subsequent real full `pnpm publish:seasons` run completed with zero validation errors.
- **Committed in:** `9998edb1` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking/out-of-scope-file per the carried-forward issue, 1 bug)
**Impact on plan:** Both fixes were necessary for the plan's own acceptance criteria to pass at all — the schema tightening was explicitly instructed by the carried-forward issue, and the rounding fix was a genuine correctness bug the real-corpus smoke test surfaced exactly as intended. No scope creep beyond what each fix required.

## Known Stubs

- **`EventsArtifactSchema.name` / `TeamSeasonEventSchema.eventName` fall back to the event key itself** (e.g. `"2026casj"`) rather than a human-readable event name — `packages/corpus/schema.sql`'s `events` table has no name/nickname column at all (the same gap 04-03's `LiveWindowEntry` already worked around by omitting the field entirely; this plan's schemas require the field present, so a fallback was needed instead of an omission). Fixing this properly requires adding a name column to the corpus schema and backfilling it from TBA's event response — out of this plan's `files_modified` (`packages/corpus/schema.sql`, `packages/ingest/normalize.ts`). Recorded in `.planning/WINDOWS.md` below.
- **Worker runtime budget rows** (CPU per tick, subrequests per tick, TBA requests per event-day, KV writes per day) in `docs/publish-budget.md` all read `pending — measured in plan 04-07` — explicitly planned, not a defect; the plan's own action text requires leaving this table present-but-empty rather than omitted.
- **D1 seed files produced but not applied** — `reports/publish/seed-{opr,epa,sigma1}.sql` exist locally (gitignored) but `wrangler d1 execute` was not run against them, since this worktree cannot determine whether plan 04-05's D1 database exists yet. Explicitly authorized by the plan's own Task 2 text for exactly this situation.
- **The Cloudflare dashboard cross-check for R2 storage/Class-A operations is unperformed** — recorded as `coverage.D4` above with `human_judgment: true`; this executor has no dashboard access.

Ledger entries appended to `.planning/WINDOWS.md`:
- `stub` — `packages/harness/publish.ts` (event/eventName fallback to event key, no corpus name column)
- `unrun-verify` — `docs/publish-budget.md` (Cloudflare dashboard R2/Class-A cross-check, human-only)

## Issues Encountered

None beyond the two auto-fixed deviations documented above. The background `pnpm publish:seasons` run completed in ~14m41s — much faster than the plan's own cited precedent (Phase 3 plan 06's comparable five-season run took ~6 hours), likely because `publishSeasons` batches `algorithm.teamMetrics` once per algorithm per season rather than per team, and Sigma1's Monte Carlo RP draws were not the bottleneck this run's scale exercised.

## User Setup Required

None for this plan specifically. Production R2 credentials were already provisioned in plan 04-01; this plan only consumed them (via `.env`, copied into this worktree per its own `<worktree_env_note>` and deleted before this final commit).

## Next Phase Readiness

- Every page the site will render (`teams`, `team`, `events`, `event`, `compare` — five kinds, three algorithms, five seasons) has a real, published, schema-valid artifact in production R2. Phases 5-8 have real data to fetch against.
- Both manifests (`v1/manifest/live-windows.json`, `v1/manifest/algorithms.json`) are published and verified fetchable — plans 04-05/04-06's cron Worker can read them directly.
- The D1 seed files exist locally, ready for `wrangler d1 execute` once plan 04-05's D1 database is confirmed to exist — this plan does not gate that; see Known Stubs.
- `docs/publish-budget.md`'s payload-budget and R2-write-volume sections are complete and real; its Worker-runtime-budget table is the explicit open item plan 04-07 fills in.
- The Cloudflare dashboard cross-check (R2 storage/Class-A op counts as billed) remains an open manual step — a human with account access should read the dashboard after this run and record the two figures alongside this SUMMARY's local-counter numbers.

---
*Phase: 04-publish-live-update-pipeline*
*Completed: 2026-08-22*
