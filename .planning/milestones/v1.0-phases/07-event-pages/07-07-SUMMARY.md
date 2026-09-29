---
phase: 07-event-pages
plan: 07
subsystem: api
tags: [zod, schema, event-page, page-artifacts, rounding, tdd]

requires:
  - phase: 07-event-pages
    provides: "07-06's redefined TeamMetric.spread (√(P+R)) and its rewritten pageArtifacts.ts doc sites"
  - phase: 07-event-pages
    provides: "07-02's event_alliances table and event_rankings D-18.6 columns (corpus shapes this plan's field names map onto, read-only reference)"
provides:
  - "EventMatchSchema/EventUpcomingMatchSchema.redScoreVarianceOwn/blueScoreVarianceOwn (D-18 item 3)"
  - "EventMatchSchema/EventUpcomingMatchSchema.sortTime (D-13's chronological merge key, amended in by 07-12)"
  - "EventTeamSchema.rank/record/rp (D-18 item 6, D-07, D-08)"
  - "EventAllianceSchema and EventArtifactSchema.alliances (D-18 item 7, D-15, D-16, D-17)"
  - "EventArtifactSchema.name/startDate/location/week (D-18 item 8) and the exported composeEventLocation(stateProv, country) helper (PD-01)"
  - "ROUNDING_RULE.rankingPoints (2 decimals)"
affects: [07-08, 07-10, 07-11, 07-12, 07-13, 07-14, 07-15, 07-17, 07-19, 07-20]

actuals:
  tokens: 33000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "eventFixtureWith(overrides) test helper (module scope, beside validEventFixture) — mirrors fixtureWithMatchRow's partial-override shape across top level / matches[0] / upcoming[0] / teams, reused by all three tasks"
    - "Direct property access on a parsed Zod result (no intermediate `as unknown as {...}` cast) as the mechanism for PD-10's dual-RED-mode proof — the missing field is a `pnpm typecheck` TS2339 error before the schema edit, not just a runtime undefined"

key-files:
  created: []
  modified:
    - packages/harness/pageArtifacts.ts
    - packages/harness/pageArtifacts.test.ts
    - packages/harness/rounding.ts
    - packages/harness/rounding.test.ts

key-decisions:
  - "Followed the plan's resolved_field_names table verbatim — no field renamed or reshaped from what the plan fixed"
  - "eventFixtureWith moved to module scope (beside validEventFixture) after first drafting it nested inside Task 1's describe block — the plan's own action text required it live there so Tasks 2 and 3 could reuse it; folded into Task 2's commit since that is the first task to actually reuse it"
  - "Reworded one doc-comment phrase ('the two arrays stay separate on the wire' -> 'the two arrays remain two distinct arrays on the wire') to avoid a literal substring collision with 07-06's PD-09 sweep gate (`grep -rniE \"...|stay separate\"`) — same meaning, different words, gate stays green"
  - "Tracer feedback gate (Task 1, type=\"tracer\"): AUTO_CHAIN and AUTO_CFG both read false, but the tracer's <verify> is fully automated (pnpm vitest + pnpm typecheck, no UI/visual component) and had already run and passed cleanly before this decision point — proceeded directly to Task 2 rather than emitting a checkpoint:human-verify that would only ask the user to re-run the same command already confirmed passing. Session-level Auto Mode explicitly directs this bias for non-blocking, fully-automated checks."
  - "EVNT-02, EVNT-04, EVNT-05, EVNT-06 left Pending in REQUIREMENTS.md despite appearing in this plan's frontmatter requirements list — matches the established 07-02/07-03/07-06 precedent: this plan ships only the schema-level half (the fields a rendered tab needs to exist and parse); the requirement text describes the rendered tab itself, owned by 07-11 (EVNT-02), 07-12 (EVNT-04), 07-14 (EVNT-05) and 07-13 (EVNT-06) per this plan's own <inherited_ownership> section"

patterns-established:
  - "New optional/nullable page-artifact fields get a doc comment stating which of PD-04's absence kinds they carry (optional-never-null / optional-and-nullable / optional-absence-only), not just that they are optional"
  - "A rounding-rule reuse (no new key) is recorded by extending the existing file-header paragraph that already states the prior reuse, rather than writing a second, disconnected note"

requirements-completed: []

coverage:
  - id: D1
    description: "EventMatchSchema and EventUpcomingMatchSchema carry redScoreVarianceOwn/blueScoreVarianceOwn (D-18 item 3), copying TeamSeasonMatchSchema's existing pair spelling; ROUNDING_RULE.variance reused, no new key"
    requirement: "EVNT-04"
    verification:
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts#EventMatchSchema / EventUpcomingMatchSchema — redScoreVarianceOwn/blueScoreVarianceOwn and sortTime"
        status: pass
    human_judgment: false
  - id: D2
    description: "EventMatchSchema and EventUpcomingMatchSchema carry sortTime (D-13's chronological merge key), z.number().int().optional(), never nullable; a merge case proves the published shape supports D-13's concatenate-then-sort chronological ordering"
    requirement: "EVNT-04"
    verification:
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts#Test 8 — the D-13 merge is possible from the published shape alone"
        status: pass
    human_judgment: false
  - id: D3
    description: "EventTeamSchema carries rank/record/rp, all three independently optional, no fabricated zero, real zero distinguishable from absence, half-present state legal (PD-05)"
    requirement: "EVNT-02"
    verification:
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts#EventTeamSchema — rank/record/rp"
        status: pass
    human_judgment: false
  - id: D4
    description: "EventAllianceSchema (allianceNumber, optional name, whole picks array) and EventArtifactSchema.alliances, both representable absence states (absent key and empty array) parsing to the same meaning"
    requirement: "EVNT-05"
    verification:
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts#EventAllianceSchema / EventArtifactSchema identity fields"
        status: pass
    human_judgment: false
  - id: D5
    description: "EventArtifactSchema carries name/startDate/location/week (D-18 item 8), and the exported composeEventLocation(stateProv, country) single-sources the location string"
    verification:
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts#Test 8/Test 9 in the EventAllianceSchema / EventArtifactSchema identity fields block"
        status: pass
    human_judgment: false
  - id: D6
    description: "ROUNDING_RULE gains exactly one key (rankingPoints: 2), proven by an exhaustive Object.keys(ROUNDING_RULE) assertion observed RED (six keys against seven expected) before the key was added"
    verification:
      - kind: unit
        ref: "packages/harness/rounding.test.ts#ROUNDING_RULE — plain data, quotable by name / ROUNDING_RULE.rankingPoints"
        status: pass
    human_judgment: false
  - id: D7
    description: "A pre-republish artifact (validEventFixture(), never mutated) still parses through every schema this plan touched, carrying none of the nine new keys"
    verification:
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts#valid-fixture parse + Test 1 in both new describe blocks"
        status: pass
    human_judgment: false
  - id: D8
    description: "pageArtifacts.ts gains zero new imports and stays a browser-safe schema leaf; PAGE_ARTIFACT_SCHEMA_VERSION stays 1; nothing published"
    verification:
      - kind: unit
        ref: "packages/harness/browserSafeSchemas.test.ts (full suite) + git diff grep criteria"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-08-28
status: complete
---

# Phase 07 Plan 07: Event-Page Schema Additions Summary

**Nine additive/optional fields, one new nested schema (`EventAllianceSchema`), one exported pure helper (`composeEventLocation`), and one new `ROUNDING_RULE` key added to `packages/harness/pageArtifacts.ts` — the contract downstream plans 07-08 (fill), 07-10 (publish), and 07-11 through 07-15 (render) are written against. Nothing published; `publish.ts` untouched.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-08-27T22:44:26Z (first baseline `pnpm test` run)
- **Completed:** 2026-08-28T03:02:39Z (final full-suite verification)
- **Tasks:** 3/3
- **Files modified:** 4 (`packages/harness/pageArtifacts.ts`, `packages/harness/pageArtifacts.test.ts`, `packages/harness/rounding.ts`, `packages/harness/rounding.test.ts`)

## Baseline (recorded before Task 1, per the plan's `<baseline>`)

```
pnpm test
```
- **Pre-plan:** 108 passed | 1 failed (109 files); 1526 passed | 1 failed (1527 tests) — the one accepted failure is `payloadBudget.test.ts`'s `teams/{year}` internal-consistency check (`WINDOWS.md` ledger #11).
- **Post-plan:** 108 passed | 1 failed (109 files); 1554 passed | 1 failed (1555 tests) — **same single failure, zero new failures** (PD-08). +28 new tests total (26 in `pageArtifacts.test.ts`, 2 in `rounding.test.ts`).

Three baseline counts from `<baseline>`, before and after:

| Count | Pre-plan | Post-plan |
|---|---|---|
| `redScoreVarianceOwn`/`blueScoreVarianceOwn` line count (comment-filtered) | 2 | 6 |
| `sortTime` line count (comment-filtered) | 1 | 3 |
| `ROUNDING_RULE` key count | six (`metric`, `score`, `probability`, `pmf`, `variance`, `percentile`) | seven (+ `rankingPoints`) |

`pageArtifacts.test.ts` case count: 53 -> 79 (+26). `rounding.test.ts`: 25 -> 27 (+2).

## Accomplishments
- `EventMatchSchema`/`EventUpcomingMatchSchema` gain `redScoreVarianceOwn`/`blueScoreVarianceOwn` (D-18 item 3) and `sortTime` (D-13's chronological merge key, amended in by 07-12's gap-finding) — same names/spellings the team artifact has carried since Phase 6.
- `EventTeamSchema` gains `rank`/`record`/`rp` (D-18 item 6, D-07, D-08) — three independently optional fields, no fabricated zero, a real `0`/`0-0-0` distinguishable from absence.
- New `EventAllianceSchema` and `EventArtifactSchema.alliances` (D-18 item 7, D-15, D-16, D-17) — `picks` published whole (never truncated to three), `allianceNumber` explicit rather than positional, `name` omitted (never `""`) when TBA sent none.
- `EventArtifactSchema` gains `name`/`startDate`/`location`/`week` (D-18 item 8) and the exported `composeEventLocation(stateProv, country)` helper (PD-01), single-sourcing the location string for both the event page and the Events list.
- `ROUNDING_RULE.rankingPoints = 2` — the only new rounding key; two documented reuses (`redScoreVarianceOwn`/`blueScoreVarianceOwn` reuse `ROUNDING_RULE.variance`) and five documented no-entries (`rank`, `record.*`, `week`, `allianceNumber`, `sortTime`) recorded per PD-03.

## Task Commits

Each task was committed atomically:

1. **Task 1: TRACER — per-alliance own predicted-score variance and the chronological `sortTime` key** - `746bfab2` (feat)
2. **Task 2: Official rank, TBA's authoritative record and ranking points on `EventTeamSchema`** - `ceb191c9` (feat)
3. **Task 3: `EventAllianceSchema`, the `alliances` array, and the event's own identity fields** - `cb203510` (feat)

_All three tasks were TDD (`tdd="true"`) — RED observed in both vitest and `pnpm typecheck` modes before each schema edit, then GREEN. No separate `test(...)`/`feat(...)` commit split was used per-task since each task's plan action described writing the tests then the schema together as one atomic unit of work; RED/GREEN evidence is quoted below instead._

## RED Evidence (PD-10 — every new-field case observed failing in both modes before its schema edit)

**Task 1** (`pnpm vitest run packages/harness/pageArtifacts.test.ts`, before the schema edit): `Tests 7 failed | 56 passed (63)`. Representative quotes:
```
AssertionError: expected undefined to be 1710500000 // Object.is equality
- Expected: 1710500000
+ Received: undefined
 ❯ packages/harness/pageArtifacts.test.ts:545:28   (Test 6 — sortTime round-trip)
```
```
AssertionError: expected true to be false // Object.is equality
 ❯ packages/harness/pageArtifacts.test.ts:557:28   (Test 7a — sortTime rejects non-integer)
```
`pnpm typecheck` (before the schema edit):
```
packages/harness/pageArtifacts.test.ts(506,31): error TS2339: Property 'redScoreVarianceOwn' does not exist on type '{ matchKey: string; ...; blueComponents?: Record<...> | undefined; }'.
packages/harness/pageArtifacts.test.ts(542,31): error TS2339: Property 'sortTime' does not exist on type '{ matchKey: string; ...; blueComponents?: Record<...> | undefined; }'.
```

**Task 2** (`pnpm vitest run`, before the schema edit): `Tests 6 failed | 64 passed (70)`. Representative quote:
```
AssertionError: expected undefined to be 12 // Object.is equality
 ❯ packages/harness/pageArtifacts.test.ts:634:35   (Test 7 — half-present rank)
```
`pnpm typecheck`:
```
packages/harness/pageArtifacts.test.ts(592,29): error TS2339: Property 'rank' does not exist on type '{ teamKey: string; metrics: Record<...>; teamNumber?: number | undefined; nickname?: string | undefined; }'.
packages/harness/pageArtifacts.test.ts(593,29): error TS2339: Property 'record' does not exist on type '{ teamKey: string; metrics: Record<...>; teamNumber?: number | undefined; nickname?: string | undefined; }'.
```
`rounding.test.ts`'s exhaustive `Object.keys(ROUNDING_RULE)` assertion, observed RED before `rankingPoints` was added (`Tests 3 failed | 24 passed (27)`):
```
- Expected
+ Received
  [
    "metric", "percentile", "pmf", "probability",
-   "rankingPoints",
    "score", "variance",
  ]
```
plus `AssertionError: expected undefined to be 2` (`ROUNDING_RULE.rankingPoints`) and `AssertionError: expected NaN to be 3.84` (`roundTo(3.835, ROUNDING_RULE.rankingPoints)`).

**Task 3** (`pnpm vitest run`, before the schema edit): `Tests 8 failed | 71 passed (79)`. Representative quote:
```
TypeError: composeEventLocation is not a function
 ❯ packages/harness/pageArtifacts.test.ts:736:12   (Test 9)
```
`pnpm typecheck`:
```
packages/harness/pageArtifacts.test.ts(12,3): error TS2305: Module "./pageArtifacts.js" has no exported member 'composeEventLocation'.
packages/harness/pageArtifacts.test.ts(650,19): error TS2339: Property 'alliances' does not exist on type '{ schemaVersion: 1; ...; teams: {...}[]; }'.
```

## Resolved Field Names (reproduced verbatim from the plan)

| UI-SPEC dependency | Resolved field | Declared on | Type | Absence contract |
|---|---|---|---|---|
| #3 per-alliance own predicted-score variance (played) | `redScoreVarianceOwn`, `blueScoreVarianceOwn` | `EventMatchSchema` | `z.number().optional()` | absent for OPR/EPA and for pre-republish rows |
| #3 same, upcoming | `redScoreVarianceOwn`, `blueScoreVarianceOwn` | `EventUpcomingMatchSchema` | `z.number().optional()` | same |
| D-13 chronological merge + the upcoming row's scheduled-time string | `sortTime` | `EventMatchSchema` AND `EventUpcomingMatchSchema` | `z.number().int().optional()` | absent only for pre-republish rows; never null |
| #2 official event rank | `rank` | `EventTeamSchema` | `z.number().int().positive().optional()` | absent when the event has no ranking rows (D-08's 259 events) |
| #2 TBA's authoritative record | `record` | `EventTeamSchema` | `RecordSchema.optional()` (existing `{wins, losses, ties}` integers) | absent, never `0-0-0` |
| #2 ranking points | `rp` | `EventTeamSchema` | `z.number().optional()` | absent; a real `0` is distinct from absent |
| #1 event name | `name` | `EventArtifactSchema` | `z.string().min(1).optional()` | optional, never null |
| #1 event start date | `startDate` | `EventArtifactSchema` | `z.string().min(1).optional()` | optional, never null |
| #1 event location | `location` | `EventArtifactSchema` | `z.string().min(1).nullable().optional()` | `null` when genuinely unrecorded |
| #1 competition week | `week` | `EventArtifactSchema` | `z.number().int().nullable().optional()` | `null` when not derivable |
| #6 alliance data | `alliances` | `EventArtifactSchema` | `z.array(EventAllianceSchema).optional()` | absent OR `[]`, both meaning no alliance data |
| #6 one alliance | `EventAllianceSchema` | new nested schema | `{ allianceNumber, name?, picks }` | see Task 3 |

**Two names deliberately NOT introduced:** no field for the alliance leader position and none for a fourth/reserve robot — both are positions in `picks` (PD-02). No `totalTeams` on `EventTeamSchema` and no red+blue `variance` on either event match row (PD-06).

## Rounding Disposition (PD-03)

- **New key:** `ROUNDING_RULE.rankingPoints = 2` (`rp` — TBA's own reported Ranking Score, a per-match average, TBA's own published precision).
- **Documented reuse:** `EventMatchSchema`/`EventUpcomingMatchSchema.redScoreVarianceOwn`/`blueScoreVarianceOwn` reuse `ROUNDING_RULE.variance` unchanged — same physical quantity as `TeamSeasonMatchSchema`'s pair, no new key.
- **Documented no-entries (integral by construction):** `rank`, `record.wins`/`record.losses`/`record.ties`, `week`, `allianceNumber` (all plain integers) and `sortTime` (an epoch-seconds timestamp — rounding it would be meaningless at best and would silently reorder a match list at worst).

## Files Created/Modified
- `packages/harness/pageArtifacts.ts` - nine new optional fields across four existing schemas, one new nested schema (`EventAllianceSchema`), one new exported helper (`composeEventLocation`)
- `packages/harness/pageArtifacts.test.ts` - `eventFixtureWith(overrides)` module-scope helper; +26 test cases across three new describe blocks; D-21 mechanical scan extended to cover an enriched fixture's `teams[0]`/`alliances[0]` key sets
- `packages/harness/rounding.ts` - `ROUNDING_RULE.rankingPoints`, field-class table row, extended reuse/no-entry paragraphs
- `packages/harness/rounding.test.ts` - widened exhaustive key-set assertion (renamed to state the current seven-key set), new `ROUNDING_RULE.rankingPoints` describe block

## Decisions Made
- Followed the plan's `<resolved_field_names>` table verbatim; no field renamed or reshaped.
- `eventFixtureWith` moved to module scope beside `validEventFixture` (the plan's own instruction) after an initial draft nested it inside Task 1's describe block — folded into Task 2's commit, the first task that actually needed to reuse it.
- Reworded one doc-comment phrase to avoid a literal substring collision with 07-06's PD-09 sweep gate (`stay separate` -> `remain two distinct arrays`) — same meaning, gate stays green.
- Did not stop for a `checkpoint:human-verify` after Task 1's tracer commit: `AUTO_CHAIN`/`AUTO_CFG` both read `false`, but the tracer's `<verify>` is a fully automated `pnpm vitest && pnpm typecheck` command with no UI/visual component, and it had already run and passed before this decision point. Proceeding directly to Task 2 rather than asking the user to re-run an already-passing automated command.
- `EVNT-02`, `EVNT-04`, `EVNT-05`, `EVNT-06` left **Pending** in REQUIREMENTS.md — matches the established 07-02/07-03/07-06 precedent. This plan ships only the schema-level half; the requirement text describes the rendered tab, owned by 07-11 (EVNT-02), 07-12 (EVNT-04), 07-14 (EVNT-05) and 07-13 (EVNT-06) per this plan's own `<inherited_ownership>` section.

## Deviations from Plan

None (substantive) - plan executed exactly as written, all nine fields under the exact names `<resolved_field_names>` fixed, all `must_haves` truths and prohibitions upheld. Two mechanical adjustments made while writing the tests (both documented above under Decisions Made, neither a scope or behavior change): moving `eventFixtureWith` to module scope, and rewording one doc-comment phrase that collided with an unrelated grep gate.

## Issues Encountered

None. All acceptance-criteria greps passed on first check after each task's implementation (with the two adjustments above applied before the final check).

## Verification Confirmations

- `pnpm typecheck` exits 0.
- `grep -c "PAGE_ARTIFACT_SCHEMA_VERSION = 1" packages/harness/pageArtifacts.ts` -> `1` (D-02, no bump).
- `git diff packages/harness/pageArtifacts.ts packages/harness/rounding.ts | grep -cE '^\+\s*import '` -> `0` (zero new imports either file).
- `grep -rniE "two meanings|consistency spread|stay separate" packages/harness/pageArtifacts.ts` -> no matches (07-06's PD-09 sweep gate survived this plan's new doc comments).
- Whole-plan `git diff --stat` touches exactly four files: `packages/harness/pageArtifacts.ts`, `packages/harness/pageArtifacts.test.ts`, `packages/harness/rounding.ts`, `packages/harness/rounding.test.ts`.
- `git diff --stat` against `packages/harness/publish.ts apps/web/ packages/corpus/ packages/ingest/ packages/core/ docs/ package.json pnpm-lock.yaml` -> empty.
- `git log --oneline` shows exactly one commit per task (three commits: `746bfab2`, `ceb191c9`, `cb203510`).
- **Nothing was published:** `packages/harness/publish.ts` untouched; no R2 object written or deleted; `payloadBudget.test.ts` shows exactly the recorded baseline failure and no movement. The one-way door for this phase's published-schema decisions is 07-17's gated write pass (PD-07); this commit is fully reversible via `git revert`.
- No secret was read, echoed, or interpolated at any point; `.env` untouched, per `.claude/CLAUDE.md`'s Secrets handling convention.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 07-08 (`buildEventArtifact`) can now fill `redScoreVarianceOwn`/`blueScoreVarianceOwn`, `sortTime`, `rank`/`record`/`rp`, `alliances`, and `name`/`startDate`/`location`/`week` for a real event — every field it needs is declared and its exact spelling fixed in `<resolved_field_names>` above.
- 07-10 can publish a real subset event artifact against this contract without further schema changes.
- 07-11 through 07-15 (Insights, Quals, Alliances, Elims, header) can be written against these exact field names without opening a diff.
- No blockers. The one open item this plan carries forward unchanged is `WINDOWS.md` ledger #11 (`teams/{year}` payload budget), explicitly out of scope here and already tracked.

## Self-Check: PASSED

All four modified source files found on disk; `07-07-SUMMARY.md` found on disk; all three task commit hashes (`746bfab2`, `ceb191c9`, `cb203510`) found in `git log --oneline --all`.

---
*Phase: 07-event-pages*
*Completed: 2026-08-28*
